"""Environment-backed settings shared by backend infrastructure."""

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql+psycopg://website:website@localhost:5440/website"
    log_level: str = "INFO"
    # Media: TMDB API Read Access Token (v4), sent as a Bearer header. Empty =
    # film and series search unavailable (books use Open Library, no key).
    tmdb_read_access_token: str = ""
    # Cards: the saved pokecardex HTML the catalog is imported from (tracked
    # in the repo), and the writable folder for downloaded scans, thumbnails,
    # logos and variant badges (a volume; see architecture.md).
    cards_source_dir: str = "domains/cards/source"
    cards_data_dir: str = "/data/cards"


settings = Settings()
