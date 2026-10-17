"""Environment-backed settings shared by backend infrastructure."""

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql+psycopg://website:website@localhost:5440/website"
    log_level: str = "INFO"


settings = Settings()
