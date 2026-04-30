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
    url = os.environ.get("DATABASE_URL", "")
    if not url:
        url = "postgresql://fieldgovern:password@localhost:5432/fieldgovern"
    return url


def _parse_cors(raw: str) -> List[str]:
    """Parse CORS_ORIGINS env var — handles comma-separated or JSON array formats."""
    raw = raw.strip()
    if raw.startswith("["):
        import json
        try:
            return json.loads(raw)
        except (ValueError, Exception):
            pass
    return [o.strip().strip("'\"") for o in raw.split(",") if o.strip()]


class Settings(BaseSettings):
    DATABASE_URL: str = _resolve_database_url()
    REDIS_URL: str = "redis://localhost:6379"
    JWT_SECRET: str = "change-me-in-production"
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_MINUTES: int = 60 * 2
    AWS_ACCESS_KEY_ID: str = ""
    AWS_SECRET_ACCESS_KEY: str = ""
    AWS_S3_BUCKET: str = "fieldgovern-media"
    AWS_REGION: str = "ap-south-1"
    MEDIA_DIR: str = "uploads"
    STORAGE_BACKEND: str = "local"
    GDRIVE_FOLDER_ID: str = "1397LHY_x8KMvkAaq-_9LaepszN1a8Thp"
    GDRIVE_CLIENT_SECRET_PATH: str = "credentials/gdrive-oauth-client.json"
    GDRIVE_TOKEN_PATH: str = "credentials/gdrive-token.json"
    VAPID_PUBLIC_KEY: str = ""
    VAPID_PRIVATE_KEY: str = ""
    VAPID_CLAIM_EMAIL: str = "mailto:admin@fieldgovern.app"

    # Email / SMTP
    SMTP_HOST: str = ""
    SMTP_PORT: int = 587
    SMTP_USER: str = ""
    SMTP_PASSWORD: str = ""
    SMTP_FROM_EMAIL: str = "noreply@fieldgovern.app"
    SMTP_FROM_NAME: str = "FieldGovern"
    SMTP_USE_TLS: bool = True
    APP_URL: str = "http://localhost:5173"

    # Google OAuth (free — register at console.cloud.google.com)
    GOOGLE_CLIENT_ID: str = ""

    # Sentry error monitoring
    SENTRY_DSN: str = ""

    # MSG91 — WhatsApp notifications (optional; stored per-tenant too but global fallback)
    MSG91_AUTH_KEY: str = ""

    # Stored as plain str so pydantic-settings never tries JSON-list parsing on it.
    # Parsed into a list by the cors_origins property below.
    CORS_ORIGINS: str = "http://localhost:5173,http://localhost:4173,https://app.fieldgovern.com"

    @property
    def cors_origins(self) -> List[str]:
        return _parse_cors(self.CORS_ORIGINS)

    class Config:
        env_file = ".env"


settings = Settings()
