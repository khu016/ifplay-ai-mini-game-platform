import asyncio
import json
from pathlib import Path
from time import monotonic

from pydantic import ValidationError

from .errors import AppError
from .schemas import ErrorDetail, Extraction, Outline, OutlineVersion, ProjectInfo, now

PROMPTS = Path(__file__).parent / "prompts"


def parse(content, schema):
    cleaned = content.strip()
    if cleaned.startswith("```json") and cleaned.endswith("```"):
        cleaned = cleaned[7:-3].strip()
    elif cleaned.startswith("```") and cleaned.endswith("```"):
        cleaned = cleaned[3:-3].strip()
    try:
        return schema.model_validate_json(cleaned)
    except ValidationError:
        raise AppError(
            "INVALID_MODEL_OUTPUT", "模型输出不符合约定结构，候选未设为有效大纲。", 502
        ) from None


def verify_info(info: ProjectInfo, description: str) -> ProjectInfo:
    result = info.model_copy(deep=True)
    for field in ["project_name", "client", "technology", "location", "scale", "investor"]:
        value = getattr(result, field)
        if value is None:
            result.evidence.pop(field, None)
            continue
        source = result.evidence.get(field, "")
        if not source or source not in description or value not in source:
            setattr(result, field, None)
            result.evidence.pop(field, None)
            result.issues.append(f"{field} 缺少可核对原文依据，已标为待补充。")
    # 原始模型 issues 最多 12 条，原文校验最多追加 6 条；明确保留，避免截断核查问题。
    return ProjectInfo.model_validate(result.model_dump())


class OutlineService:
    def __init__(self, store, settings, model):
        self.store, self.settings, self.model = store, settings, model
        self.active = set()

    def claim(self, task_id):
        if task_id in self.active:
            raise AppError("TASK_BUSY", "该任务正在生成，请等待完成。", 409)
        task = self.store.get(task_id)
        self.active.add(task_id)
        return task

    async def generate(self, task):
        started = monotonic()
        try:
            self.settings.check_call()
            task.error = None
            task.status = "extracting"
            task.generation_started_at = now()
            task.first_outline_chunk_seconds = None
            task.generation_elapsed_seconds = None
            self.store.save(task)
            info = None
            for stage, schema, max_output in [
                ("extract", Extraction, 1000),
                ("outline", Outline, 5000),
            ]:
                if stage == "outline":
                    task.status = "generating"
                    self.store.save(task)
                system = (PROMPTS / f"{stage}.md").read_text(encoding="utf-8")
                inputs = {"description": task.description}
                if info is not None:
                    inputs["project_info"] = info.model_dump()
                messages = [
                    {"role": "system", "content": system},
                    {"role": "user", "content": json.dumps(inputs, ensure_ascii=False)},
                ]
                for attempt in range(self.settings.max_attempts):
                    content = ""
                    task.attempts += 1
                    self.store.save(task)
                    try:
                        async for chunk in self.model.stream(task.id, stage, messages, max_output):
                            content += chunk
                            if len(content.encode("utf-8")) > 100_000:
                                raise AppError("INVALID_MODEL_OUTPUT", "模型候选输出超限。", 502)
                            # 信息提取不暴露原始字段流；大纲 chunk 为待校验候选。
                            if stage == "outline":
                                if task.first_outline_chunk_seconds is None:
                                    task.first_outline_chunk_seconds = monotonic() - started
                                yield "chunk", {"stage": stage, "text": chunk}
                        result = parse(content, schema)
                        break
                    except AppError as exc:
                        # 已输出的流不能混入新候选；数量或质量违规不重试烧钱。
                        if (
                            exc.code != "MODEL_TEMPORARY"
                            or content
                            or attempt + 1 == self.settings.max_attempts
                        ):
                            raise
                        await asyncio.sleep(0.25)
                if stage == "extract":
                    info = verify_info(result, task.description)
                    task.project_info = info
                    self.store.save(task)
                else:
                    candidate = task.model_copy(deep=True)
                    candidate.versions.append(
                        OutlineVersion(outline=result, project_info=info, model=self.settings.model)
                    )
                    candidate.status = "ready"
                    candidate.generation_elapsed_seconds = monotonic() - started
                    self.store.save(candidate)
                    task = candidate
            yield "done", {"task": task.model_dump(mode="json")}
        except (asyncio.CancelledError, GeneratorExit):
            # 已发送 done 后关闭流，不应将成功任务改为 interrupted。
            if task.status == "ready":
                raise
            task.status = "interrupted"
            task.generation_elapsed_seconds = monotonic() - started
            task.error = ErrorDetail(code="INTERRUPTED", message="生成被中断，可显式重试。")
            try:
                self.store.save(task)
            except AppError:
                pass  # 磁盘故障时原持久化 generating 状态将在重启时恢复。
            raise
        except Exception as exc:
            error = (
                exc
                if isinstance(exc, AppError)
                else AppError("GENERATION_FAILED", "生成失败，已有有效大纲仍保留。", 500)
            )
            task.status = "error"
            task.generation_elapsed_seconds = monotonic() - started
            task.error = ErrorDetail(code=error.code, message=error.message)
            try:
                self.store.save(task)
            except AppError:
                error = AppError("STORAGE_FAILED", "无法保存生成状态，请检查本地存储。", 500)
            yield "error", error.payload()
        finally:
            self.active.discard(task.id)
