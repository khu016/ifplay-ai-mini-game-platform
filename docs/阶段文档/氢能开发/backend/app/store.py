import fcntl
import json
import os
import threading
from contextlib import contextmanager
from pathlib import Path
from uuid import UUID, uuid4

from pydantic import ValidationError

from .errors import AppError
from .schemas import ErrorDetail, Ledger, Task, now


class Store:
    def __init__(self, root: Path):
        self.root = root.resolve()
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        (self.root / "tasks").mkdir(exist_ok=True, mode=0o700)
        self.mutex = threading.RLock()
        self.lock_file = None

    def acquire(self):
        self.lock_file = (self.root / ".process.lock").open("a")
        try:
            fcntl.flock(self.lock_file, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            self.lock_file.close()
            self.lock_file = None
            raise AppError(
                "STORE_BUSY", "已有进程使用同一数据目录，请勿启动多个服务。", 409
            ) from None

    def release(self):
        if self.lock_file:
            self.lock_file.close()
            self.lock_file = None

    def task_path(self, task_id: UUID) -> Path:
        return self.root / "tasks" / f"{UUID(str(task_id))}.json"

    def read(self, path, schema):
        try:
            if path.is_symlink():
                raise ValueError()
            return schema.model_validate_json(path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            raise AppError("NOT_FOUND", "任务不存在。", 404) from None
        except (ValidationError, ValueError, UnicodeError):
            raise AppError(
                "STORAGE_CORRUPT", "本地记录损坏，已保留原文件，请联系执行者。", 500
            ) from None
        except OSError:
            raise AppError("STORAGE_FAILED", "无法读取本地记录。", 500) from None

    def write(self, path, value):
        temporary = path.with_name(f".{path.name}.{uuid4().hex}.tmp")
        try:
            if path.is_symlink():
                raise OSError()
            fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, "w", encoding="utf-8") as stream:
                json.dump(value.model_dump(mode="json"), stream, ensure_ascii=False, indent=2)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, path)
            directory_fd = os.open(path.parent, os.O_RDONLY)
            try:
                os.fsync(directory_fd)
            finally:
                os.close(directory_fd)
        except OSError:
            raise AppError("STORAGE_FAILED", "本地记录保存或同步失败，请核查存储。", 500) from None
        finally:
            try:
                temporary.unlink(missing_ok=True)
            except OSError:
                pass

    def get(self, task_id):
        with self.mutex:
            task = self.read(self.task_path(task_id), Task)
            if task.id != task_id:
                raise AppError("STORAGE_CORRUPT", "任务记录标识不一致。", 500)
            return task

    def save(self, task):
        task.updated_at = now()
        with self.mutex:
            self.write(self.task_path(task.id), task)

    def recover(self):
        for path in (self.root / "tasks").glob("*.json"):
            task = self.read(path, Task)
            if path != self.task_path(task.id):
                raise AppError("STORAGE_CORRUPT", "任务记录标识不一致。", 500)
            if task.status in {"extracting", "generating"}:
                task.status = "interrupted"
                task.error = ErrorDetail(code="INTERRUPTED", message="上次生成被中断，可显式重试。")
                self.save(task)

    @contextmanager
    def ledger(self):
        with self.mutex:
            path = self.root / "budget.json"
            ledger = self.read(path, Ledger) if path.exists() else Ledger()
            yield ledger
            self.write(path, ledger)
