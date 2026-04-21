"""
Google Drive media storage for FieldGovern.

Uses OAuth2 (personal account) instead of service account, because Google
no longer allows service accounts to create files in personal Drive
(zero storage quota policy, 2024).

One-time setup:
  1. Go to Google Cloud Console → APIs & Services → Credentials
  2. Create an OAuth 2.0 Client ID (type: Desktop app)
  3. Download the JSON → backend/credentials/gdrive-oauth-client.json
  4. Run:  python scripts/gdrive_auth.py
     This opens a browser, you sign in, and a refresh token is saved to
     backend/credentials/gdrive-token.json
  5. All subsequent uploads use the saved token (auto-refreshes)
"""
import io
import json
import logging
from pathlib import Path

from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseUpload

from app.core.config import settings

logger = logging.getLogger(__name__)

SCOPES = ["https://www.googleapis.com/auth/drive.file"]

_drive_service = None


def _get_service():
    """Build the Drive service from saved OAuth2 token (auto-refreshes)."""
    global _drive_service
    if _drive_service is not None:
        return _drive_service

    token_path = Path(settings.GDRIVE_TOKEN_PATH)
    if not token_path.exists():
        raise RuntimeError(
            f"Drive token not found at {token_path}. "
            "Run: python scripts/gdrive_auth.py"
        )

    creds = Credentials.from_authorized_user_file(str(token_path), SCOPES)

    # Auto-refresh if expired
    if creds.expired and creds.refresh_token:
        creds.refresh(Request())
        # Save refreshed token
        token_path.write_text(creds.to_json())
        logger.info("Refreshed Google Drive OAuth token")

    if not creds.valid:
        raise RuntimeError("Drive token is invalid. Re-run: python scripts/gdrive_auth.py")

    _drive_service = build("drive", "v3", credentials=creds, cache_discovery=False)
    return _drive_service


# ── Folder management ──────────────────────────────────────────────────────

_folder_cache: dict[str, str] = {}


def _find_or_create_folder(name: str, parent_id: str) -> str:
    """Find an existing sub-folder or create one. Results are cached."""
    cache_key = f"{parent_id}/{name}"
    if cache_key in _folder_cache:
        return _folder_cache[cache_key]

    svc = _get_service()

    query = (
        f"name='{name}' and '{parent_id}' in parents "
        f"and mimeType='application/vnd.google-apps.folder' and trashed=false"
    )
    results = svc.files().list(q=query, fields="files(id)", spaces="drive").execute()
    files = results.get("files", [])

    if files:
        folder_id = files[0]["id"]
    else:
        meta = {
            "name": name,
            "mimeType": "application/vnd.google-apps.folder",
            "parents": [parent_id],
        }
        folder = svc.files().create(body=meta, fields="id").execute()
        folder_id = folder["id"]
        logger.info(f"Created Drive folder '{name}' ({folder_id})")

    _folder_cache[cache_key] = folder_id
    return folder_id


def _ensure_path(tenant_id: str, submission_id: str) -> str:
    """Ensure <root>/<tenant_id>/<submission_id> folder hierarchy."""
    root = settings.GDRIVE_FOLDER_ID
    tenant_folder = _find_or_create_folder(tenant_id, root)
    submission_folder = _find_or_create_folder(submission_id, tenant_folder)
    return submission_folder


# ── Public API ──────────────────────────────────────────────────────────────

def upload_to_drive(
    content: bytes,
    filename: str,
    mime_type: str,
    tenant_id: str,
    submission_id: str,
) -> dict:
    """Upload a file to Google Drive.

    Returns: {"file_id": str, "web_view_link": str, "web_content_link": str}
    """
    svc = _get_service()
    parent_id = _ensure_path(tenant_id, submission_id)

    # Idempotent: check for existing file with same name
    query = f"name='{filename}' and '{parent_id}' in parents and trashed=false"
    existing = svc.files().list(q=query, fields="files(id)").execute().get("files", [])

    media = MediaIoBaseUpload(io.BytesIO(content), mimetype=mime_type, resumable=False)

    if existing:
        file_id = existing[0]["id"]
        updated = svc.files().update(
            fileId=file_id, media_body=media,
            fields="id,webViewLink,webContentLink",
        ).execute()
        logger.info(f"Updated Drive file {file_id} ({filename})")
        return {
            "file_id": updated["id"],
            "web_view_link": updated.get("webViewLink", ""),
            "web_content_link": updated.get("webContentLink", ""),
        }
    else:
        meta = {"name": filename, "parents": [parent_id]}
        created = svc.files().create(
            body=meta, media_body=media,
            fields="id,webViewLink,webContentLink",
        ).execute()
        logger.info(f"Uploaded Drive file {created['id']} ({filename})")
        return {
            "file_id": created["id"],
            "web_view_link": created.get("webViewLink", ""),
            "web_content_link": created.get("webContentLink", ""),
        }


def is_drive_configured() -> bool:
    """Check if Google Drive storage is configured and usable."""
    try:
        return (
            bool(settings.GDRIVE_FOLDER_ID)
            and Path(settings.GDRIVE_TOKEN_PATH).exists()
        )
    except Exception:
        return False
