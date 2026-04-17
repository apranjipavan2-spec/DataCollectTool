"""Google Sheets export service for FieldPulse.

Creates a new Google Sheet in the configured Drive folder, writes submission
rows, sets column headers, and returns the public editor URL.

Requirements:
  - Same OAuth token as Drive (credentials/gdrive-token.json)
  - Token must have the 'spreadsheets' scope.
    If you've already authorized Drive-only, re-run:
        python scripts/gdrive_auth.py
    The updated script requests both Drive + Sheets scopes.

The sheet is created inside the same Google Drive folder used for media
(GDRIVE_FOLDER_ID), under a sub-folder named "Exports".
"""

import logging
from pathlib import Path

from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from googleapiclient.discovery import build

from app.core.config import settings

logger = logging.getLogger(__name__)

SCOPES = [
    "https://www.googleapis.com/auth/drive.file",
    "https://www.googleapis.com/auth/spreadsheets",
]

_sheets_service = None
_drive_service_for_sheets = None


def _get_services():
    """Build Sheets + Drive services from saved OAuth2 token."""
    global _sheets_service, _drive_service_for_sheets

    if _sheets_service is not None:
        return _sheets_service, _drive_service_for_sheets

    token_path = Path(settings.GDRIVE_TOKEN_PATH)
    if not token_path.exists():
        raise RuntimeError(
            f"Drive token not found at {token_path}. "
            "Run: python scripts/gdrive_auth.py"
        )

    creds = Credentials.from_authorized_user_file(str(token_path), SCOPES)

    if creds.expired and creds.refresh_token:
        creds.refresh(Request())
        token_path.write_text(creds.to_json())
        logger.info("Refreshed Google OAuth token (sheets)")

    if not creds.valid:
        raise RuntimeError(
            "Google OAuth token is invalid or missing the 'spreadsheets' scope. "
            "Re-run: python scripts/gdrive_auth.py"
        )

    _sheets_service = build("sheets", "v4", credentials=creds, cache_discovery=False)
    _drive_service_for_sheets = build("drive", "v3", credentials=creds, cache_discovery=False)
    return _sheets_service, _drive_service_for_sheets


def export_to_sheets(
    title: str,
    headers: list[str],
    rows: list[list],
    tenant_id: str,
) -> str:
    """Create a Google Sheet with the given data and return its URL.

    Args:
        title:     Sheet title (e.g. form name + date)
        headers:   Column header strings
        rows:      List of value lists (must align with headers)
        tenant_id: Used to organise the file under the right Drive folder

    Returns:
        URL of the created Google Sheet (opens in browser directly).
    """
    svc_sheets, svc_drive = _get_services()

    # ── 1. Create blank spreadsheet ──────────────────────────────────────
    spreadsheet = svc_sheets.spreadsheets().create(
        body={
            "properties": {"title": title},
            "sheets": [{"properties": {"title": "Submissions"}}],
        },
        fields="spreadsheetId,spreadsheetUrl",
    ).execute()

    sheet_id = spreadsheet["spreadsheetId"]
    sheet_url = spreadsheet["spreadsheetUrl"]
    logger.info("[Sheets] Created spreadsheet %s", sheet_id)

    # ── 2. Write header row + data ───────────────────────────────────────
    all_values = [headers] + rows
    svc_sheets.spreadsheets().values().update(
        spreadsheetId=sheet_id,
        range="Submissions!A1",
        valueInputOption="RAW",
        body={"values": all_values},
    ).execute()

    # ── 3. Bold the header row ───────────────────────────────────────────
    svc_sheets.spreadsheets().batchUpdate(
        spreadsheetId=sheet_id,
        body={
            "requests": [
                {
                    "repeatCell": {
                        "range": {
                            "sheetId": 0,
                            "startRowIndex": 0,
                            "endRowIndex": 1,
                        },
                        "cell": {
                            "userEnteredFormat": {
                                "textFormat": {"bold": True},
                                "backgroundColor": {"red": 0.22, "green": 0.26, "blue": 0.41},
                                "textFormat": {
                                    "bold": True,
                                    "foregroundColor": {"red": 1, "green": 1, "blue": 1},
                                },
                            }
                        },
                        "fields": "userEnteredFormat(textFormat,backgroundColor)",
                    }
                },
                {
                    "autoResizeDimensions": {
                        "dimensions": {
                            "sheetId": 0,
                            "dimension": "COLUMNS",
                            "startIndex": 0,
                            "endIndex": len(headers),
                        }
                    }
                },
            ]
        },
    ).execute()

    # ── 4. Move file into Drive export folder ────────────────────────────
    try:
        _ensure_export_folder(svc_drive, sheet_id, tenant_id)
    except Exception as e:
        # Non-fatal — sheet exists, just not in the right folder
        logger.warning("[Sheets] Could not move sheet to exports folder: %s", e)

    logger.info("[Sheets] Export complete: %d rows → %s", len(rows), sheet_url)
    return sheet_url


# ── Folder helpers ────────────────────────────────────────────────────────────

_export_folder_cache: dict[str, str] = {}


def _ensure_export_folder(svc_drive, sheet_id: str, tenant_id: str) -> None:
    """Move the sheet into <root>/<tenant_id>/Exports/ folder."""
    if not settings.GDRIVE_FOLDER_ID:
        return  # Drive not configured — leave sheet in root

    cache_key = f"exports/{tenant_id}"
    if cache_key not in _export_folder_cache:
        # Find or create tenant folder
        tenant_folder = _find_or_create_folder(svc_drive, tenant_id, settings.GDRIVE_FOLDER_ID)
        # Find or create Exports sub-folder
        exports_folder = _find_or_create_folder(svc_drive, "Exports", tenant_folder)
        _export_folder_cache[cache_key] = exports_folder

    exports_folder_id = _export_folder_cache[cache_key]

    # Move the sheet into the folder
    file_meta = svc_drive.files().get(fileId=sheet_id, fields="parents").execute()
    prev_parents = ",".join(file_meta.get("parents", []))
    svc_drive.files().update(
        fileId=sheet_id,
        addParents=exports_folder_id,
        removeParents=prev_parents,
        fields="id,parents",
    ).execute()


def _find_or_create_folder(svc_drive, name: str, parent_id: str) -> str:
    query = (
        f"name='{name}' and '{parent_id}' in parents "
        f"and mimeType='application/vnd.google-apps.folder' and trashed=false"
    )
    results = svc_drive.files().list(q=query, fields="files(id)").execute()
    files = results.get("files", [])
    if files:
        return files[0]["id"]

    folder = svc_drive.files().create(
        body={
            "name": name,
            "mimeType": "application/vnd.google-apps.folder",
            "parents": [parent_id],
        },
        fields="id",
    ).execute()
    return folder["id"]
