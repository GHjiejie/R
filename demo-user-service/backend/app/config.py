"""应用配置：从环境变量读取，默认值对应 .env.example 与 docker-compose。"""
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    DATABASE_URL: str = "postgresql+psycopg2://demo:demo123@localhost:5432/userdb"
    REDIS_URL: str = "redis://localhost:6379/0"
    CACHE_TTL: int = Field(default=60, ge=1)
    NULL_CACHE_TTL: int = Field(default=30, ge=1)  # 空值缓存 TTL（防缓存穿透）
    CACHE_TTL_JITTER: int = Field(default=30, ge=0)  # TTL 随机扰动上限（秒）
    CORS_ORIGINS: list[str] = ["http://localhost:5173"]  # 允许的前端来源（逗号分隔可配多个）

settings = Settings()
