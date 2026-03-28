"""Modular storage backend for FieldPulse.

Supports: local disk, Google Drive, S3 (future).
Selected via STORAGE_BACKEND env var (default: "drive").

── Data Format Strategy ──────────────────────────────────────────────
  Submissions : PostgreSQL JSONB — transactional, indexable, no
                corruption risk from partial writes.
  Media       : Compressed binary files
                • Photos  → JPEG ~75 % quality (server-side re-encode)
                • Audio   → WebM / OGG (as captured on device)
  Storage keys: {tenant_id}/{submission_id}/{field_name}.{ext}
                All backends store the same format — switching backends
                only changes WHERE files go, not HOW they're stored.
"""

import logging
from abc import ABC, abstractmethod
from pathlib import Path

from app.core.config import settings

logger = logging.getLogger(__name__)


# ── Abstract interface ──────────────────────────────────────────────


class StorageBackend(ABC):
    """Abstract storage interface — all backends implement this."""

    @abstractmethod
    def upload(self, content: bytes, key: str, mime_type: str) -> str:
        """Upload content and return a URL/path.

        Key format: tenant_id/submission_id/filename
        """
        ...

    @abstractmethod
    def download(self, key: str) -> bytes | None:
        """Download content by key. Returns None if not found."""
        ...

    @abstractmethod
    def delete(self, key: str) -> bool:
        """Delete content by key."""
        ...

    @abstractmethod
    def get_url(self, key: str) -> str:
        """Get public/signed URL for the content."""
        ...


# ── Local disk ──────────────────────────────────────────────────────


class LocalStorage(StorageBackend):
    """Store files on local disk under MEDIA_DIR."""

    def __init__(self):
        self.base = Path(settings.MEDIA_DIR)
        self.base.mkdir(parents=True, exist_ok=True)

    def upload(self, content: bytes, key: str, mime_type: str) -> str:
        path = self.base / key
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
        return f"/media/{key}"

    def download(self, key: str) -> bytes | None:
        path = self.base / key
        if path.exists():
            return path.read_bytes()
        return None

    def delete(self, key: str) -> bool:
        path = self.base / key
        if path.exists():
            path.unlink()
            return True
        return False

    def get_url(self, key: str) -> str:
        return f"/media/{key}"


# ── Google Drive ────────────────────────────────────────────────────


class DriveStorage(StorageBackend):
    """Store files on Google Drive (personal OAuth2 account).

    Delegates to the existing drive_storage module for actual API calls.
    Falls back to LocalStorage automatically if Drive is not configured
    or the upload fails.
    """

    def __init__(self):
        self._fallback = LocalStorage()

    def upload(self, content: bytes, key: str, mime_type: str) -> str:
        from app.core.drive_storage import is_drive_configured, upload_to_drive

        if not is_drive_configured():
            logger.warning("[DriveStorage] Drive not configured — falling back to local disk")
            return self._fallback.upload(content, key, mime_type)

        parts = key.split("/")
        tenant_id = parts[0] if len(parts) > 0 else "default"
        submission_id = parts[1] if len(parts) > 1 else "default"
        filename = parts[-1]

        try:
            result = upload_to_drive(content, filename, mime_type, tenant_id, submission_id)
            url = result.get("web_view_link") or result.get("web_content_link") or key
            return url
        except Exception as exc:
            logger.warning("[DriveStorage] Upload failed, falling back to local: %s", exc)
            return self._fallback.upload(content, key, mime_type)

    def download(self, key: str) -> bytes | None:
        # Drive API does not expose a simple download-by-name path;
        # fall back to local cache if available.
        logger.warning("[DriveStorage] download not implemented for Drive — trying local fallback")
        return self._fallback.download(key)

    def delete(self, key: str) -> bool:
        logger.warning("[DriveStorage] delete not implemented for Drive")
        return False

    def get_url(self, key: str) -> str:
        # Drive URLs are absolute and already stored in the DB.
        return key


# ── AWS S3 / compatible (R2, MinIO) ────────────────────────────────


class S3Storage(StorageBackend):
    """Store files on AWS S3 or compatible service.

    Requires boto3 (already in requirements.txt).
    Configure via env vars: AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY,
    AWS_S3_BUCKET, AWS_REGION.
    """

    def __init__(self):
        import boto3

        self.bucket = settings.AWS_S3_BUCKET
        self.client = boto3.client(
            "s3",
            region_name=settings.AWS_REGION,
            aws_access_key_id=settings.AWS_ACCESS_KEY_ID,
            aws_secret_access_key=settings.AWS_SECRET_ACCESS_KEY,
        )

    def upload(self, content: bytes, key: str, mime_type: str) -> str:
        self.client.put_object(
            Bucket=self.bucket,
            Key=key,
            Body=content,
            ContentType=mime_type,
        )
        return f"s3://{self.bucket}/{key}"

    def download(self, key: str) -> bytes | None:
        try:
            resp = self.client.get_object(Bucket=self.bucket, Key=key)
            return resp["Body"].read()
        except Exception:
            return None

    def delete(self, key: str) -> bool:
        try:
            self.client.delete_object(Bucket=self.bucket, Key=key)
            return True
        except Exception:
            return False

    def get_url(self, key: str) -> str:
        return self.client.generate_presigned_url(
            "get_object",
            Params={"Bucket": self.bucket, "Key": key},
            ExpiresIn=3600,
        )


# ── Singleton factory ──────────────────────────────────────────────

_storage: StorageBackend | None = None


def get_storage() -> StorageBackend:
    """Return the configured storage backend (cached singleton).

    Reads STORAGE_BACKEND env var: "local" | "drive" | "s3".
    Default is "drive".
    """
    global _storage
    if _storage is None:
        backend = settings.STORAGE_BACKEND.lower()
        if backend == "s3":
            _storage = S3Storage()
            logger.info("[Storage] Using S3 backend: %s", settings.AWS_S3_BUCKET)
        elif backend == "drive":
            _storage = DriveStorage()
            logger.info("[Storage] Using Google Drive backend")
        else:
            _storage = LocalStorage()
            logger.info("[Storage] Using local disk backend: %s", settings.MEDIA_DIR)
    return _storage
