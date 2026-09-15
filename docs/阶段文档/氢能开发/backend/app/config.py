import os
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal
from pathlib import Path

from dotenv import load_dotenv

from .errors import AppError

ROOT = Path(__file__).resolve().parents[2].parent


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
    def load(cls):
        load_dotenv(ROOT / ".env", override=False)
        try:
            result = cls(
                api_key=os.getenv("DEEPSEEK_API_KEY", ""),
                model=os.getenv("DEEPSEEK_MODEL", "deepseek-flash"),
                timeout=float(os.getenv("MODEL_TIMEOUT_SECONDS", "30")),
                input_price=Decimal(os.getenv("INPUT_CNY_PER_MILLION", "2")),
                output_price=Decimal(os.getenv("OUTPUT_CNY_PER_MILLION", "8")),
                pricing_confirmed=os.getenv("PRICING_CONFIRMED", "false").lower() == "true",
                pricing_checked_on=os.getenv("PRICING_CHECKED_ON", ""),
            )
            if not 1 <= result.timeout <= 180:
                raise ValueError()
            if any(not rate.is_finite() or rate <= 0 for rate in
                   [result.input_price, result.output_price]):
                raise ValueError()
            if result.model != "deepseek-flash":
                raise ValueError()
            return result
        except (ValueError, ArithmeticError):
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
