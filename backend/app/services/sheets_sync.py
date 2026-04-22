"""
Google Sheets live sync — Apps Script webhook approach.

Setup for orgs:
1. Open Google Sheets → Extensions → Apps Script
2. Paste the provided script (see SHEETS_SCRIPT_TEMPLATE below)
3. Deploy as web app → Anyone can access → copy URL
4. Paste the URL in FieldGovern → Org Settings → Integrations → Sheets Sync URL

Per-form config stored in forms.sheets_sync_config:
{
  "enabled": true,
  "apps_script_url": "https://script.google.com/macros/s/.../exec",
  "include_metadata": true
}

We POST JSON to the Apps Script URL on every new submission.
The Apps Script handles appending the row — no OAuth on our side.
Never raises — Sheets failures must never block API responses.
"""
from __future__ import annotations

import json
import logging
from typing import Any

import httpx

logger = logging.getLogger(__name__)
_TIMEOUT = httpx.Timeout(15.0)

SHEETS_SCRIPT_TEMPLATE = """
// Paste this in Google Apps Script, deploy as web app (anyone can access)
function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    var sheetName = data._sheet || 'FieldGovern';
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(sheetName) || ss.insertSheet(sheetName);

    // Write headers if first row is empty
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(Object.keys(data).filter(k => !k.startsWith('_')));
    }
    // Append data row
    var values = Object.entries(data)
      .filter(([k]) => !k.startsWith('_'))
      .map(([, v]) => typeof v === 'object' ? JSON.stringify(v) : v);
    sheet.appendRow(values);
    return ContentService.createTextOutput('OK');
  } catch(err) {
    return ContentService.createTextOutput('ERROR: ' + err.message);
  }
}
"""


def _get_config(form) -> dict:
    cfg = form.sheets_sync_config or {}
    if isinstance(cfg, str):
        try: cfg = json.loads(cfg)
        except Exception: cfg = {}
    return cfg


def _flatten_submission(data_json: dict, metadata: dict) -> dict:
    """Flatten nested submission data for Sheets row."""
    row: dict[str, Any] = {}
    for k, v in data_json.items():
        if isinstance(v, list):
            row[k] = ", ".join(str(i) for i in v)
        elif isinstance(v, dict):
            for sk, sv in v.items():
                row[f"{k}_{sk}"] = sv
        else:
            row[k] = v
    row.update(metadata)
    return row


async def _post_to_script(url: str, payload: dict) -> None:
    async with httpx.AsyncClient(timeout=_TIMEOUT) as c:
        r = await c.post(url, json=payload)
        r.raise_for_status()


def sync_submission(form, submission_data: dict, metadata: dict | None = None) -> None:
    """
    Post a single submission row to the form's configured Apps Script URL.
    Fires asynchronously — never blocks the response.
    """
    import asyncio
    cfg = _get_config(form)
    if not cfg.get("enabled") or not cfg.get("apps_script_url"):
        return

    url = cfg["apps_script_url"]
    include_meta = cfg.get("include_metadata", True)

    meta = metadata or {}
    row = _flatten_submission(submission_data, meta if include_meta else {})

    async def _fire():
        try:
            await _post_to_script(url, row)
            logger.info("[SheetsSync] Synced submission to form=%s", form.id)
        except Exception as e:
            logger.warning("[SheetsSync] Failed for form=%s: %s", form.id, e)

    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            loop.create_task(_fire())
        else:
            loop.run_until_complete(_fire())
    except Exception as e:
        logger.warning("[SheetsSync] Could not schedule sync: %s", e)


def bulk_sync_submissions(form, submissions: list[dict]) -> None:
    """
    Post multiple submission rows (used after migration import).
    Fires each as a background task — never blocks.
    """
    cfg = _get_config(form)
    if not cfg.get("enabled") or not cfg.get("apps_script_url"):
        return
    for sub in submissions:
        data = sub.get("data_json", sub)
        sync_submission(form, data)
