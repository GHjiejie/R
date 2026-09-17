"""应用配置：从环境变量读取，默认值对应 .env.example 与 docker-compose。"""
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    DATABASE_URL: str = "postgresql+psycopg2://demo:demo123@localhost:5432/userdb"
    REDIS_URL: str = "redis://localhost:6379/0"
    CACHE_TTL: int = 60
    NULL_CACHE_TTL: int = 30  # 空值缓存 TTL（防缓存穿透），建议短于正常缓存

    class Config:
        env_file = ".env"


settings = Settings()
