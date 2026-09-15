import asyncio
import json
from pathlib import Path

from pydantic import ValidationError

from .errors import AppError
from .schemas import ErrorDetail, Outline, OutlineVersion, ProjectInfo

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
        raise AppError("INVALID_MODEL_OUTPUT", "模型输出不符合约定结构，候选未设为有效大纲。", 502) from None


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
        try:
            self.settings.check_call()
            task.error = None
            task.status = "extracting"
            self.store.save(task)
            info = None
            for stage, schema, max_output in [("extract", ProjectInfo, 1000),
                                               ("outline", Outline, 5000)]:
                if stage == "outline":
                    task.status = "generating"
                    self.store.save(task)
                system = (PROMPTS / f"{stage}.md").read_text(encoding="utf-8")
                inputs = {"description": task.description}
                if info is not None:
                    inputs["project_info"] = info.model_dump()
                messages = [{"role": "system", "content": system},
                            {"role": "user", "content": json.dumps(inputs, ensure_ascii=False)}]
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
                                yield "chunk", {"stage": stage, "text": chunk}
                        result = parse(content, schema)
                        break
                    except AppError as exc:
                        # 已输出的流不能混入新候选；数量或质量违规不重试烧钱。
                        if (exc.code != "MODEL_TEMPORARY" or content or
                                attempt + 1 == self.settings.max_attempts):
                            raise
                        await asyncio.sleep(0.25)
                if stage == "extract":
                    info = result
                    task.project_info = info
                    self.store.save(task)
                else:
                    task.versions.append(OutlineVersion(outline=result, project_info=info,
                                                        model=self.settings.model))
            task.status = "ready"
            self.store.save(task)
            yield "done", {"task": task.model_dump(mode="json")}
        except asyncio.CancelledError:
            task.status = "interrupted"
            task.error = ErrorDetail(code="INTERRUPTED", message="生成被中断，可显式重试。")
            self.store.save(task)
            raise
        except Exception as exc:
            error = exc if isinstance(exc, AppError) else AppError(
                "GENERATION_FAILED", "生成失败，已有有效大纲仍保留。", 500)
            task.status = "error"
            task.error = ErrorDetail(code=error.code, message=error.message)
            try:
                self.store.save(task)
            except AppError:
                error = AppError("STORAGE_FAILED", "无法保存生成状态，请检查本地存储。", 500)
            yield "error", error.payload()
        finally:
            self.active.discard(task.id)
