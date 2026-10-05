"""应用配置（全部经环境变量注入，提供测试用默认值，不含真实密钥）。"""
from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parent.parent


class Settings:
    def __init__(self) -> None:
        def _env(key: str, default: str) -> str:
            return os.getenv(key, default)

        # 数据库（SQLite，服务重启后数据保留）
        self.database_url = _env("IFPLAY_DATABASE_URL", f"sqlite:///{BACKEND_ROOT / 'data' / 'ifplay.db'}")

        # GameBundle 共享契约（由 apps/ifplay-m0 运行时 zod schema 生成）
        self.contract_path = _env(
            "IFPLAY_CONTRACT_PATH",
            str(BACKEND_ROOT.parent / "ifplay-m0" / "contract" / "gamebundle-contract.json"),
        )

        # Provider（当前无真实 Key，仅 deterministic-test）
        self.provider = _env("IFPLAY_PROVIDER", "deterministic-test")

        # 费用（以下均为测试用占位单价，非真实价格；真实单价待供应商确认后经 env 注入）
        self.input_price_per_1k = float(_env("IFPLAY_INPUT_PRICE_PER_1K", "0.002"))
        self.output_price_per_1k = float(_env("IFPLAY_OUTPUT_PRICE_PER_1K", "0.006"))
        self.image_price = float(_env("IFPLAY_IMAGE_PRICE", "0.1"))
        self.budget_per_task = float(_env("IFPLAY_BUDGET_PER_TASK", "3.0"))
        self.safety_margin = float(_env("IFPLAY_SAFETY_MARGIN", "0.15"))
        self.max_output_tokens = int(_env("IFPLAY_MAX_OUTPUT_TOKENS", "4096"))
        self.max_images = int(_env("IFPLAY_MAX_IMAGES", "3"))

        # Provider 调用约束
        self.max_retries = int(_env("IFPLAY_MAX_RETRIES", "2"))
        self.timeout_seconds = float(_env("IFPLAY_TIMEOUT_SECONDS", "10.0"))

        # 澄清问题上限
        self.max_clarifications = int(_env("IFPLAY_MAX_CLARIFICATIONS", "5"))

        # 每款游戏保留最近 N 个版本
        self.max_versions = int(_env("IFPLAY_MAX_VERSIONS", "10"))

        # 内容修复最多两轮（第 3 次禁止调用）
        self.max_repair_rounds = int(_env("IFPLAY_MAX_REPAIR_ROUNDS", "2"))

        # 后台工作器（单进程本地 MVP）
        self.worker_enabled = _env("IFPLAY_WORKER_ENABLED", "true").lower() in ("1", "true", "yes")
        self.worker_poll_interval = float(_env("IFPLAY_WORKER_POLL_INTERVAL", "0.2"))


@lru_cache
def get_settings() -> Settings:
    return Settings()
