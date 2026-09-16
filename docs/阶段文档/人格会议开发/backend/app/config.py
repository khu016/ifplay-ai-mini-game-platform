from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )

    # 数据与安全
    database_url: str = "sqlite:///./data/app.db"
    session_secret: str = "dev-secret-change-me"
    session_ttl_days: int = 7
    code_ttl_minutes: int = 10
    dev_email_code: bool = True  # 开发期：验证码直接返回，不接真实邮件

    # 会议上限
    max_units_per_meeting: int = 20

    # 模型
    model_provider: str = ""
    model_name: str = ""
    model_api_key: str = ""
    model_base_url: str = "https://api.deepseek.com/v1"
    model_timeout_seconds: float = 60.0
    model_max_retries: int = 2


@lru_cache
def get_settings() -> Settings:
    return Settings()
