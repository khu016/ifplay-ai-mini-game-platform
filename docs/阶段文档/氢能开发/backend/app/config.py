from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal
from pathlib import Path

from dotenv import dotenv_values

from .errors import AppError

ROOT = Path(__file__).resolve().parents[2]


@dataclass
class Settings:
    data_dir: Path = field(default_factory=lambda: ROOT / "data")
    api_key: str = field(default="", repr=False)
    model: str = "deepseek-flash"
    timeout: float = 30
    max_attempts: int = 2
    input_price: Decimal = Decimal("2")
    output_price: Decimal = Decimal("8")
    pricing_confirmed: bool = False
    pricing_checked_on: str = ""
    task_limit: Decimal = Decimal("1")
    monthly_limit: Decimal = Decimal("100")

    @classmethod
    def load(cls, project_root: Path = ROOT):
        try:
            env_path = project_root / ".env"
            if env_path.is_symlink():
                raise ValueError()
            # 只解析指定项目文件；禁用 ${VAR} 插值及进程变量继承，避免多 Agent 串用 Key。
            values = dotenv_values(env_path, interpolate=False) if env_path.exists() else {}

            def value(name, default):
                return values.get(name) or default

            result = cls(
                data_dir=project_root / "data",
                api_key=value("DEEPSEEK_API_KEY", ""),
                model=value("DEEPSEEK_MODEL", "deepseek-flash"),
                timeout=float(value("MODEL_TIMEOUT_SECONDS", "30")),
                input_price=Decimal(value("INPUT_CNY_PER_MILLION", "2")),
                output_price=Decimal(value("OUTPUT_CNY_PER_MILLION", "8")),
                pricing_confirmed=value("PRICING_CONFIRMED", "false").lower() == "true",
                pricing_checked_on=value("PRICING_CHECKED_ON", ""),
            )
            if not 1 <= result.timeout <= 180:
                raise ValueError()
            if (
                not result.input_price.is_finite()
                or result.input_price < 2
                or not result.output_price.is_finite()
                or result.output_price < 8
            ):
                raise ValueError()
            if result.model != "deepseek-flash":
                raise ValueError()
            if any(character in result.api_key for character in "\r\n${}"):
                raise ValueError()
            return result
        except (ValueError, ArithmeticError, OSError):
            raise AppError("INVALID_CONFIG", "模型或估价配置无效，请核对 .env。", 503) from None

    def check_call(self):
        if not self.api_key:
            raise AppError("MISSING_KEY", "请先在本机 .env 填入 DeepSeek API Key。", 503)
        try:
            age = (date.today() - date.fromisoformat(self.pricing_checked_on)).days
        except ValueError:
            age = -1
        if not self.pricing_confirmed or not 0 <= age <= 7:
            raise AppError("PRICING_UNCONFIRMED", "需核对并确认近七日人民币账户费率。", 503)
