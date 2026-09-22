from pydantic_settings import BaseSettings, SettingsConfigDict

TOPICS = {"orders": 2, "payments": 1}
GROUPS = ("lab-fulfillment", "lab-analytics")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="LAB_", env_file=".env", extra="ignore")
    bootstrap_servers: str = "localhost:19092,localhost:19093,localhost:19094"
    controller_hosts: str = "localhost:19095,localhost:19096,localhost:19097"
    observations_path: str = "/observations"
    database_path: str = "data/lab.db"
    broker_data_root: str = "/broker-data"


settings = Settings()
