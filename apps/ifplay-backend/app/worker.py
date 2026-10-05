"""后台工作器（单进程本地 MVP）：从 SQLite 领取 queued 任务执行。

- 使用独立数据库会话（不复用请求会话）。
- 领取用条件 UPDATE 原子化，避免同一任务重复执行。
- 只处理 queued；playable/failed/interrupted 不自动重试。
"""
from __future__ import annotations

import threading

from .db import new_session
from .services.task_service import process_queued_tasks


class Worker:
    def __init__(self, poll_interval: float = 0.2) -> None:
        self.poll_interval = poll_interval
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        if self._thread is not None:
            return
        self._thread = threading.Thread(target=self._loop, name="ifplay-worker", daemon=True)
        self._thread.start()

    def _loop(self) -> None:
        while not self._stop.is_set():
            db = new_session()
            try:
                process_queued_tasks(db)
            except Exception:  # noqa: BLE001  单轮失败不退出；任务失败态已由 _fail 落库
                pass
            finally:
                db.close()
            self._stop.wait(self.poll_interval)

    def stop(self) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=5)
            self._thread = None
