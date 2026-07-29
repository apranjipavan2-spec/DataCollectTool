"""Cleaner handoff: bridge TableForge ↔ datacleaner (Flask app on :5050 or /cleaner).

Pattern mirrors the existing FieldGovern handoff in datacleaner:
  1. TF creates a handoff_id pointing at a dataset_id.
  2. TF opens the cleaner with ?tf_url=...&handoff_id=... (and optional focus_col).
  3. Cleaner GETs /api/cleaner/fetch/{id} → CSV stream of current df.
  4. User cleans inside datacleaner (Excel-grid, unique-values, undo/redo all there).
  5. Cleaner POSTs cleaned CSV to /api/cleaner/save-back/{id} → df replaced + columns re-detected.
"""

import io
import os
import uuid
import time
from typing import Optional

import pandas as pd
from fastapi import APIRouter, HTTPException, Request, Header
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel

from .ai import _load_ai_cfg

from ..shared import (
    datasets,
    column_type_overrides,
    add_audit_log,
    sanitize_for_json,
    _detect_columns,
)

router = APIRouter()

# handoff_id -> {dataset_id, created_at, focus_col, completed_at}
_handoffs: dict = {}
_HANDOFF_TTL = 60 * 60 * 4  # 4 hours


def _gc_handoffs():
    """Drop expired handoff tokens."""
    now = time.time()
    expired = [k for k, v in _handoffs.items() if now - v["created_at"] > _HANDOFF_TTL]
    for k in expired:
        _handoffs.pop(k, None)


class HandoffReq(BaseModel):
    dataset_id: str
    focus_col: Optional[str] = None


@router.post("/api/cleaner/handoff")
async def create_handoff(req: HandoffReq):
    """Create a handoff token the cleaner can use to pull + push the dataset."""
    _gc_handoffs()
    if req.dataset_id not in datasets:
        raise HTTPException(404, "Dataset not found")
    handoff_id = uuid.uuid4().hex
    _handoffs[handoff_id] = {
        "dataset_id": req.dataset_id,
        "created_at": time.time(),
        "focus_col": req.focus_col,
        "completed_at": None,
    }
    return {
        "handoff_id": handoff_id,
        "focus_col": req.focus_col,
        "ttl_seconds": _HANDOFF_TTL,
    }


@router.get("/api/cleaner/fetch/{handoff_id}")
async def fetch_dataset(handoff_id: str):
    """Cleaner pulls the current dataset as CSV. Strings preserved (no parse)."""
    if handoff_id not in _handoffs:
        raise HTTPException(404, "Unknown or expired handoff")
    dataset_id = _handoffs[handoff_id]["dataset_id"]
    if dataset_id not in datasets:
        raise HTTPException(404, "Dataset no longer available")
    df = datasets[dataset_id]["df"]
    buf = io.StringIO()
    df.to_csv(buf, index=False)
    filename = datasets[dataset_id].get("filename") or "dataset.csv"
    return PlainTextResponse(
        content=buf.getvalue(),
        media_type="text/csv",
        headers={
            "X-TF-Filename": filename,
            "X-TF-Focus-Col": _handoffs[handoff_id].get("focus_col") or "",
        },
    )


@router.post("/api/cleaner/save-back/{handoff_id}")
async def save_back(handoff_id: str, request: Request):
    """Cleaner POSTs cleaned CSV. Body is raw text/csv. Dataset df is replaced
    and column type cache is reset so type-hints + role badges re-evaluate.
    """
    if handoff_id not in _handoffs:
        raise HTTPException(404, "Unknown or expired handoff")
    dataset_id = _handoffs[handoff_id]["dataset_id"]
    if dataset_id not in datasets:
        raise HTTPException(404, "Dataset no longer available")

    raw = (await request.body()).decode("utf-8", errors="replace")
    if not raw.strip():
        raise HTTPException(400, "Empty CSV body")
    try:
        df = pd.read_csv(io.StringIO(raw))
    except Exception as e:
        raise HTTPException(400, f"CSV parse failed: {e}")

    prev_rows = len(datasets[dataset_id]["df"])
    prev_cols = list(datasets[dataset_id]["df"].columns)
    datasets[dataset_id]["df"] = df
    # Reset type overrides — cleaner is authoritative on types after a handoff
    column_type_overrides[dataset_id] = {}

    _handoffs[handoff_id]["completed_at"] = time.time()

    new_cols = list(df.columns)
    col_changes = []
    if set(new_cols) != set(prev_cols):
        added = sorted(set(new_cols) - set(prev_cols))
        removed = sorted(set(prev_cols) - set(new_cols))
        if added:
            col_changes.append(f"+{len(added)} cols")
        if removed:
            col_changes.append(f"-{len(removed)} cols")
    add_audit_log(
        dataset_id,
        "cleaner_save_back",
        f"Cleaner returned cleaned data: {len(df)} rows (was {prev_rows})" +
        (f"; {', '.join(col_changes)}" if col_changes else "")
    )

    columns = _detect_columns(df)
    payload = {
        "status": "ok",
        "dataset_id": dataset_id,
        "row_count": len(df),
        "columns": columns,
        "preview": sanitize_for_json(df.head(50).fillna("").to_dict(orient="records")),
    }
    # Stash so TableForge frontend can fetch the result via handoff_id after the cleaner closes.
    _handoffs[handoff_id]["last_result"] = payload
    return payload


@router.get("/api/cleaner/handoff/{handoff_id}")
async def handoff_status(handoff_id: str):
    """Frontend polls this to know when the cleaner has saved back (fallback if postMessage misses).
    When completed, returns the same snapshot the cleaner posted so frontend can refresh in one round-trip.
    """
    if handoff_id not in _handoffs:
        raise HTTPException(404, "Unknown or expired handoff")
    h = _handoffs[handoff_id]
    return {
        "handoff_id": handoff_id,
        "dataset_id": h["dataset_id"],
        "focus_col": h.get("focus_col"),
        "completed": h.get("completed_at") is not None,
        "completed_at": h.get("completed_at"),
        "result": h.get("last_result"),
    }


@router.delete("/api/cleaner/handoff/{handoff_id}")
async def delete_handoff(handoff_id: str):
    """Frontend can revoke a handoff explicitly (e.g. user closed the cleaner tab)."""
    _handoffs.pop(handoff_id, None)
    return {"status": "ok"}


@router.get("/api/ai/config-internal")
async def get_ai_config_internal(x_internal_secret: str = Header(default="")):
    """Resolved AI config incl. the raw key, for the Cleaner service on the
    private Docker network only. Lives in this unauthenticated router (like
    the rest of the cleaner handoff) rather than the FieldGovern-identity-gated
    `ai` router, since Cleaner has no FieldGovern user JWT to present here —
    guarded instead by a shared secret both containers are given at deploy time.
    nginx proxies the whole /analyzer/ prefix, so this path is otherwise
    reachable from the public internet like any other route in this app."""
    expected = os.environ.get("INTERNAL_SHARED_SECRET", "")
    if not expected or x_internal_secret != expected:
        raise HTTPException(403, "Forbidden")
    return _load_ai_cfg()
