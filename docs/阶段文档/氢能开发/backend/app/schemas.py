from datetime import datetime, timezone
from decimal import Decimal
from typing import Literal
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


class Schema(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class ErrorDetail(Schema):
    code: str
    message: str


class ErrorResponse(Schema):
    error: ErrorDetail


class CreateTask(Schema):
    description: str = Field(min_length=10, max_length=4000)
    name: str = Field(default="氢能项目大纲", min_length=1, max_length=120)


class ProjectInfo(Schema):
    project_name: str | None = Field(default=None, max_length=200)
    client: str | None = Field(default=None, max_length=200)
    technology: str | None = Field(default=None, max_length=500)
    location: str | None = Field(default=None, max_length=200)
    scale: str | None = Field(default=None, max_length=200)
    investor: str | None = Field(default=None, max_length=200)


class Chapter(Schema):
    number: int = Field(ge=1, le=9)
    title: str = Field(min_length=1, max_length=200)
    subtitles: list[str] = Field(min_length=3, max_length=5)

    @field_validator("subtitles")
    @classmethod
    def valid_subtitles(cls, values):
        if any(not value.strip() or len(value) > 200 for value in values):
            raise ValueError("invalid subtitles")
        return [value.strip() for value in values]


class Outline(Schema):
    chapters: list[Chapter] = Field(min_length=9, max_length=9)

    @model_validator(mode="after")
    def ordered(self):
        if [chapter.number for chapter in self.chapters] != list(range(1, 10)):
            raise ValueError("chapter order must be 1..9")
        return self


class OutlineVersion(Schema):
    created_at: str = Field(default_factory=now)
    outline: Outline
    project_info: ProjectInfo
    model: str


class Task(Schema):
    schema_version: Literal[1] = 1
    id: UUID = Field(default_factory=uuid4)
    name: str
    description: str
    created_at: str = Field(default_factory=now)
    updated_at: str = Field(default_factory=now)
    status: Literal["created", "extracting", "generating", "ready", "error", "interrupted"] = "created"
    project_info: ProjectInfo | None = None
    versions: list[OutlineVersion] = Field(default_factory=list)
    error: ErrorDetail | None = None
    attempts: int = 0


class Charge(Schema):
    id: UUID = Field(default_factory=uuid4)
    task_id: UUID
    month: str
    stage: Literal["extract", "outline"]
    model: str
    reserved_cny: Decimal = Field(ge=0)
    charged_cny: Decimal = Field(ge=0)
    status: Literal["reserved", "settled", "uncertain"] = "reserved"
    input_tokens: int | None = None
    output_tokens: int | None = None
    elapsed_seconds: float | None = None
    first_chunk_seconds: float | None = None


class Ledger(Schema):
    schema_version: Literal[1] = 1
    charges: list[Charge] = Field(default_factory=list)


class BudgetView(Schema):
    month: str
    spent_or_reserved_cny: Decimal
    remaining_cny: Decimal
    monthly_limit_cny: Decimal
    task_limit_cny: Decimal
    pricing_confirmed: bool


class Health(Schema):
    status: Literal["ok"] = "ok"
    model: str
    key_configured: bool


def markdown(task: Task) -> str:
    version = task.versions[-1]
    # 不将用户输入的 Markdown 当 HTML 执行；此入口仅输出纯文本文件。
    def text(value: str) -> str:
        return value.replace("\n", " ").replace("\r", " ").replace("<", "〈").replace(">", "〉")

    lines = ["# " + text(task.name), "", "本文件为辅助大纲，不代表已验证的可行性结论。", ""]
    for key, label in [("project_name", "项目名称"), ("client", "客户"),
                       ("technology", "技术路线"), ("location", "地点"),
                       ("scale", "规模"), ("investor", "投资方")]:
        lines.append(f"- {label}：{text(getattr(version.project_info, key) or '待补充')}")
    lines.append("")
    numerals = "一二三四五六七八九"
    for chapter in version.outline.chapters:
        lines.extend([f"## 第{numerals[chapter.number - 1]}章 {text(chapter.title)}", ""])
        lines.extend(f"- {text(subtitle)}" for subtitle in chapter.subtitles)
        lines.append("")
    return "\n".join(lines)
