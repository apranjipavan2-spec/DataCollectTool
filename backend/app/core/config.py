import os
from pydantic_settings import BaseSettings
from typing import List


def normalize_db_url(url: str) -> str:
    """Normalize any PostgreSQL URL to use psycopg2 driver."""
    if not url:
        return url
    for prefix in ("postgresql+pg8000://", "postgresql+psycopg2://", "postgres://", "postgresql://"):
        if url.startswith(prefix):
            return "postgresql+psycopg2://" + url.split("://", 1)[1]
    return url


def _resolve_database_url() -> str:
    """Get DATABASE_URL from env, falling back to DATABASE_PUBLIC_URL if empty."""
    url = os.environ.get("DATABASE_URL", "")
    if not url:
        url = os.environ.get("DATABASE_PUBLIC_URL", "")
    if not url:
        url = "postgresql://fieldpulse:password@localhost:5432/fieldpulse"
    return url


class Settings(BaseSettings):
    DATABASE_URL: str = _resolve_database_url()
    REDIS_URL: str = "redis://localhost:6379"
    JWT_SECRET: str = "change-me-in-production"
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_MINUTES: int = 60 * 2  # 2 hours — client-side session timeout is 30 min; this is the server-side backstop
    AWS_ACCESS_KEY_ID: str = ""
    AWS_SECRET_ACCESS_KEY: str = ""
    AWS_S3_BUCKET: str = "fieldpulse-media"
    AWS_REGION: str = "ap-south-1"
    MEDIA_DIR: str = "uploads"  # local disk fallback for media files
    STORAGE_BACKEND: str = "local"  # "local" | "drive" | "s3"
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

    CORS_ORIGINS: List[str] = ["http://localhost:5173", "http://localhost:4173", "https://dct.up.railway.app", "https://datacollecttool-production.up.railway.app"]

    class Config:
        env_file = ".env"


settings = Settings()
