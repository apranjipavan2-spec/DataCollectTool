"""
Async HTTP clients for Kobo, SurveyCTO, and ODK Central.
All methods return plain dicts/lists — no ORM dependencies.
"""
from __future__ import annotations

import base64
import json
from typing import Any

import httpx

TIMEOUT = httpx.Timeout(30.0)


# ── Kobo ─────────────────────────────────────────────────────────────────────

class KoboClient:
    def __init__(self, server: str, token: str):
        self.base = server.rstrip("/")
        self.headers = {"Authorization": f"Token {token}"}

    async def list_forms(self) -> list[dict]:
        """Return list of {uid, name, deployment_count, date_modified}."""
        async with httpx.AsyncClient(timeout=TIMEOUT) as c:
            r = await c.get(f"{self.base}/api/v2/assets/?format=json", headers=self.headers)
            r.raise_for_status()
            data = r.json()
        results = data.get("results", [])
        return [
            {
                "uid": a["uid"],
                "name": a.get("name", "Untitled"),
                "submission_count": a.get("deployment__submission_count", 0),
                "modified": a.get("date_modified", ""),
                "asset_type": a.get("asset_type", ""),
            }
            for a in results
            if a.get("asset_type") == "survey"
        ]

    async def get_xlsform_bytes(self, uid: str) -> bytes:
        """Download the XLSForm Excel for a given asset uid."""
        async with httpx.AsyncClient(timeout=TIMEOUT) as c:
            r = await c.get(
                f"{self.base}/api/v2/assets/{uid}/export.xls",
                headers=self.headers,
                follow_redirects=True,
            )
            r.raise_for_status()
            return r.content

    async def get_submissions(self, uid: str, page: int = 1, page_size: int = 100) -> dict:
        """Return {count, next, results: [submission_dict, ...]}."""
        params = {"format": "json", "limit": page_size, "start": (page - 1) * page_size}
        async with httpx.AsyncClient(timeout=TIMEOUT) as c:
            r = await c.get(
                f"{self.base}/api/v2/assets/{uid}/data/",
                headers=self.headers,
                params=params,
            )
            r.raise_for_status()
            return r.json()


# ── SurveyCTO ─────────────────────────────────────────────────────────────────

class SurveyCTOClient:
    def __init__(self, server: str, username: str, password: str):
        # server = "yourserver" or full URL
        if not server.startswith("http"):
            server = f"https://{server}.surveycto.com"
        self.base = server.rstrip("/")
        raw = f"{username}:{password}"
        self.headers = {
            "Authorization": "Basic " + base64.b64encode(raw.encode()).decode()
        }

    async def list_forms(self) -> list[dict]:
        """Return list of {id, title, version}."""
        async with httpx.AsyncClient(timeout=TIMEOUT) as c:
            r = await c.get(f"{self.base}/api/v1/forms", headers=self.headers)
            r.raise_for_status()
            forms = r.json() if r.headers.get("content-type", "").startswith("application/json") else []
        return [
            {
                "id": f.get("id", ""),
                "title": f.get("title", "Untitled"),
                "version": f.get("version", ""),
                "date_updated": f.get("dateUpdated", ""),
            }
            for f in (forms if isinstance(forms, list) else [])
        ]

    async def get_xlsform_bytes(self, form_id: str) -> bytes:
        """Download XLSForm for a SurveyCTO form."""
        async with httpx.AsyncClient(timeout=TIMEOUT) as c:
            r = await c.get(
                f"{self.base}/api/v2/forms/{form_id}/xls",
                headers=self.headers,
                follow_redirects=True,
            )
            r.raise_for_status()
            return r.content

    async def get_submissions(self, form_id: str, last_known_date: str = "") -> list[dict]:
        """Return submissions as list of dicts (wide CSV converted)."""
        params: dict[str, str] = {"format": "json"}
        if last_known_date:
            params["date"] = last_known_date
        async with httpx.AsyncClient(timeout=TIMEOUT) as c:
            r = await c.get(
                f"{self.base}/api/v1/forms/data/wide/{form_id}",
                headers=self.headers,
                params=params,
            )
            r.raise_for_status()
            data = r.json()
        return data if isinstance(data, list) else []


# ── ODK Central ───────────────────────────────────────────────────────────────

class ODKCentralClient:
    def __init__(self, server: str, username: str, password: str):
        self.base = server.rstrip("/")
        raw = f"{username}:{password}"
        self.headers = {
            "Authorization": "Basic " + base64.b64encode(raw.encode()).decode()
        }

    async def list_projects(self) -> list[dict]:
        async with httpx.AsyncClient(timeout=TIMEOUT) as c:
            r = await c.get(f"{self.base}/v1/projects", headers=self.headers)
            r.raise_for_status()
            return r.json()

    async def list_forms(self, project_id: int) -> list[dict]:
        async with httpx.AsyncClient(timeout=TIMEOUT) as c:
            r = await c.get(f"{self.base}/v1/projects/{project_id}/forms", headers=self.headers)
            r.raise_for_status()
            forms = r.json()
        return [
            {
                "id": f.get("xmlFormId", ""),
                "title": f.get("name", "Untitled"),
                "version": f.get("version", ""),
                "submission_count": f.get("submissions", 0),
            }
            for f in forms
        ]

    async def get_xlsform_bytes(self, project_id: int, form_id: str) -> bytes:
        async with httpx.AsyncClient(timeout=TIMEOUT) as c:
            r = await c.get(
                f"{self.base}/v1/projects/{project_id}/forms/{form_id}.xlsx",
                headers=self.headers,
                follow_redirects=True,
            )
            r.raise_for_status()
            return r.content

    async def get_submissions(self, project_id: int, form_id: str) -> list[dict]:
        """Fetch via OData JSON feed."""
        async with httpx.AsyncClient(timeout=TIMEOUT) as c:
            r = await c.get(
                f"{self.base}/v1/projects/{project_id}/forms/{form_id}.svc/Submissions",
                headers={**self.headers, "Accept": "application/json"},
            )
            r.raise_for_status()
            data = r.json()
        return data.get("value", [])


# ── submission mapper ─────────────────────────────────────────────────────────

def map_submission_data(raw: dict, field_name_set: set[str]) -> dict:
    """
    Map a raw platform submission dict to FieldGovern data_json format.
    Only keeps keys that match a known field name. Strips platform metadata.
    """
    _SKIP_KEYS = {
        "_id", "_uuid", "_submission_time", "_submitted_by", "_xform_id_string",
        "_geolocation", "_tags", "_notes", "_version", "_attachments",
        "meta", "instanceID", "instanceName", "formhub",
        "KEY", "PARENT_KEY", "SET-OF",
    }
    result = {}
    for k, v in raw.items():
        if k in _SKIP_KEYS or k.startswith("_") or k.startswith("meta/"):
            continue
        # Strip group prefix (e.g. "group_household/age" → try both)
        short_k = k.split("/")[-1] if "/" in k else k
        target_k = k if k in field_name_set else (short_k if short_k in field_name_set else None)
        if target_k:
            # Convert "select_multiple" space-separated strings to arrays
            if isinstance(v, str) and " " in v and all(p.isalnum() or p == "_" for p in v.split()):
                result[target_k] = v.split()
            else:
                result[target_k] = v
    return result
