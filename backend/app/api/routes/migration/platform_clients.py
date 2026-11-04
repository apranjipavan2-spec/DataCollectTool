"""
Async HTTP clients for Kobo, SurveyCTO, and ODK Central.
All methods return plain dicts/lists — no ORM dependencies.
"""
from __future__ import annotations

import base64
import uuid
from typing import Any

import httpx

from app.core.url_guard import UnsafeURL as UnsafeServerURL, check_public_https_url as check_server_url

TIMEOUT = httpx.Timeout(30.0)


# ── Kobo ─────────────────────────────────────────────────────────────────────
# Endpoints verified against https://kf.kobotoolbox.org/api/v2/schema/ (2026-11-04).

KOBO_PAGE = 500  # data endpoint max is 1000


class KoboClient:
    def __init__(self, server: str, token: str, transport: httpx.AsyncBaseTransport | None = None):
        self.base = check_server_url(server)
        self.headers = {"Authorization": f"Token {token.strip()}"}
        self._transport = transport  # tests inject httpx.MockTransport

    def _client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(timeout=TIMEOUT, headers=self.headers, transport=self._transport)

    async def list_forms(self) -> list[dict]:
        """Return every survey asset as {uid, name, submission_count, date_modified}."""
        forms: list[dict] = []
        offset = 0
        async with self._client() as c:
            while True:
                r = await c.get(f"{self.base}/api/v2/assets/",
                                params={"format": "json", "limit": 100, "offset": offset})
                r.raise_for_status()
                data = r.json()
                results = data.get("results", [])
                forms += [
                    {
                        "uid": a["uid"],
                        "name": a.get("name") or "Untitled",
                        "submission_count": a.get("deployment__submission_count", 0),
                        "date_modified": a.get("date_modified", ""),
                        "asset_type": a.get("asset_type", ""),
                    }
                    for a in results
                    if a.get("asset_type") == "survey"
                ]
                offset += len(results)
                if not results or not data.get("next") or offset >= data.get("count", 0):
                    return forms

    async def get_xlsform_bytes(self, uid: str) -> bytes:
        """Download the XLSForm for an asset (Kobo serves .xlsx for format=xls)."""
        async with self._client() as c:
            r = await c.get(f"{self.base}/api/v2/assets/{uid}/", params={"format": "xls"})
            r.raise_for_status()
            return r.content

    async def iter_submissions(self, uid: str):
        """Yield pages (lists) of raw submission dicts until exhausted."""
        start = 0
        async with self._client() as c:
            while True:
                r = await c.get(f"{self.base}/api/v2/assets/{uid}/data/",
                                params={"format": "json", "limit": KOBO_PAGE, "start": start})
                r.raise_for_status()
                data = r.json()
                rows = data.get("results", [])
                if not rows:
                    return
                yield rows
                start += len(rows)
                if not data.get("next") or start >= data.get("count", 0):
                    return


# ── SurveyCTO ─────────────────────────────────────────────────────────────────

class SurveyCTOClient:
    def __init__(self, server: str, username: str, password: str):
        # server = "yourserver" or full URL
        if not server.startswith("http"):
            server = f"https://{server}.surveycto.com"
        self.base = check_server_url(server)
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
        self.base = check_server_url(server)
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

_SKIP_KEYS = {
    "meta", "instanceID", "instanceName", "formhub",
    "KEY", "PARENT_KEY", "SET-OF",
}
_NUMERIC = {"number", "decimal", "rating"}


def _to_number(v: Any, ftype: str) -> Any:
    if not isinstance(v, str):
        return v
    try:
        return float(v) if ftype == "decimal" else int(v)
    except ValueError:
        try:
            return float(v)
        except ValueError:
            return v  # keep original rather than lose the answer


def _to_gps(v: Any) -> Any:
    # Kobo/SurveyCTO: "lat lon alt accuracy"
    if isinstance(v, str):
        parts = v.split()
        try:
            return {"lat": float(parts[0]), "lng": float(parts[1]),
                    "accuracy": float(parts[3]) if len(parts) > 3 else 0}
        except (ValueError, IndexError):
            return v
    # ODK Central OData: GeoJSON Point {coordinates:[lng, lat, alt], properties:{accuracy}}
    if isinstance(v, dict) and isinstance(v.get("coordinates"), list) and len(v["coordinates"]) >= 2:
        return {"lat": v["coordinates"][1], "lng": v["coordinates"][0],
                "accuracy": (v.get("properties") or {}).get("accuracy", 0)}
    return v


def _coerce(v: Any, field: dict) -> Any:
    if v is None or v == "":
        return v
    ftype = field.get("type")
    if ftype == "multiple_choice":
        return v.split() if isinstance(v, str) else v
    if ftype in _NUMERIC:
        return _to_number(v, ftype)
    if ftype == "gps":
        return _to_gps(v)
    if ftype == "repeat_group" and isinstance(v, list):
        children = {c["name"]: c for c in field.get("fields", []) if c.get("name")}
        return [{"_id": str(uuid.uuid4()), **map_submission_data(row, children)}
                for row in v if isinstance(row, dict)]
    return v


def map_submission_data(raw: dict, fields: dict[str, dict]) -> dict:
    """
    Map a raw platform submission to FieldGovern data_json.

    `fields` maps field name → schema field dict (top level; repeat_group fields
    carry their children). Keys are matched by full name or last path segment
    ("grp/age" → "age"); values are coerced by field type. Platform metadata
    (`_*`, `__*`, `meta/*`) is dropped; nested group dicts (ODK OData) are flattened.
    """
    result: dict = {}
    for k, v in raw.items():
        if k in _SKIP_KEYS or k.startswith(("_", "meta/", "formhub/")):
            continue
        short_k = k.rsplit("/", 1)[-1]
        target = k if k in fields else (short_k if short_k in fields else None)
        if target:
            result[target] = _coerce(v, fields[target])
        elif isinstance(v, dict):
            result.update(map_submission_data(v, fields))  # ODK group object
    return result
