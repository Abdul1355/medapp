from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    database_url: str = "sqlite:///./medical_dev.db"
    secret_key: str = "development-only-change-me"
    access_token_expire_minutes: int = 30
    cors_origins: str = "http://localhost:8081,http://localhost:19006"
    clinic_id: int = 1
    ai_api_key: str = ""
    ai_model: str = ""
    ai_base_url: str = "https://api.openai.com/v1"

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @property
    def allowed_origins(self):
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

settings = Settings()
