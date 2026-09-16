"""应用配置：从环境变量读取，默认值对应 .env.example 与 docker-compose。"""
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    DATABASE_URL: str = "postgresql+psycopg2://demo:demo123@localhost:5432/userdb"
    REDIS_URL: str = "redis://localhost:6379/0"
    CACHE_TTL: int = 60

    class Config:
        env_file = ".env"


settings = Settings()
