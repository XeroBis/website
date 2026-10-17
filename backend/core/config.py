"""Environment-backed settings shared by backend infrastructure."""

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql+psycopg://website:website@localhost:5440/website"
    log_level: str = "INFO"
    # Media: TMDB API Read Access Token (v4), sent as a Bearer header. Empty =
    # film and series search unavailable (books use Open Library, no key).
    tmdb_read_access_token: str = ""


settings = Settings()
