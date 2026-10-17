"""Runtime configuration. All secrets come from .env (see .env.example)."""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # TigerData / Timescale
    tigerdata_url: str = ""
    use_database: bool = False

    # LLM explanation layer
    anthropic_api_key: str = ""
    llm_model: str = "claude-sonnet-5-5"
    enable_llm: bool = False

    # Server
    cors_origins: str = "http://localhost:5173"
    open_meteo_forecast_url: str = "https://api.open-meteo.com/v1/forecast"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
