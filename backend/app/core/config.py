from pydantic_settings import BaseSettings
from typing import List


class Settings(BaseSettings):
    DATABASE_URL: str = "postgresql+pg8000://fieldpulse:password@localhost:5432/fieldpulse"
    REDIS_URL: str = "redis://localhost:6379"
    JWT_SECRET: str = "change-me-in-production"
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_MINUTES: int = 60 * 24 * 7  # 7 days
    AWS_ACCESS_KEY_ID: str = ""
    AWS_SECRET_ACCESS_KEY: str = ""
    AWS_S3_BUCKET: str = "fieldpulse-media"
    AWS_REGION: str = "ap-south-1"
    MEDIA_DIR: str = "uploads"  # local disk fallback for media files
    STORAGE_BACKEND: str = "drive"  # "local" | "drive" | "s3"
    GDRIVE_FOLDER_ID: str = "1397LHY_x8KMvkAaq-_9LaepszN1a8Thp"  # target Google Drive folder
    GDRIVE_CLIENT_SECRET_PATH: str = "credentials/gdrive-oauth-client.json"
    GDRIVE_TOKEN_PATH: str = "credentials/gdrive-token.json"
    VAPID_PUBLIC_KEY: str = ""
    VAPID_PRIVATE_KEY: str = ""
    VAPID_CLAIM_EMAIL: str = "mailto:admin@fieldpulse.app"

    # Email / SMTP
    SMTP_HOST: str = ""
    SMTP_PORT: int = 587
    SMTP_USER: str = ""
    SMTP_PASSWORD: str = ""
    SMTP_FROM_EMAIL: str = "noreply@fieldpulse.app"
    SMTP_FROM_NAME: str = "FieldPulse"
    SMTP_USE_TLS: bool = True
    APP_URL: str = "http://localhost:5173"

    CORS_ORIGINS: List[str] = ["http://localhost:5173", "http://localhost:4173"]

    class Config:
        env_file = ".env"


settings = Settings()
