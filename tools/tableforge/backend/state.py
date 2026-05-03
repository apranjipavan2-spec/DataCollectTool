"""Shared in-memory state, constants, and global utilities."""

import os
from pathlib import Path
from typing import Optional

from .utils import sanitize_for_json, add_audit_log, _is_multi_choice, _detect_columns, apply_metrics_and_bins

# ── In-Memory Stores ─────────────────────────────────────────────

datasets: dict = {}
custom_metrics: dict = {}
custom_bins: dict = {}
audit_logs: dict = {}
annotations: dict = {}
column_type_overrides: dict = {}

# ── Directories ─────────────────────────────────────────────────────

BASE_DIR = Path(__file__).resolve().parent.parent
PROJECTS_DIR = BASE_DIR / "projects"
EXPORTS_DIR = BASE_DIR / "exports"
CACHE_DIR = BASE_DIR / "cache"
METRICS_DIR = BASE_DIR / "metrics"
LIBRARY_DIR = BASE_DIR / "library"
PARQUET_DIR = BASE_DIR / "parquet_cache"

for d in [PROJECTS_DIR, EXPORTS_DIR, CACHE_DIR, METRICS_DIR, LIBRARY_DIR, PARQUET_DIR]:
    d.mkdir(exist_ok=True)

# ── Constants ──────────────────────────────────────────────────────

LARGE_FILE_THRESHOLD = 50 * 1024 * 1024  # 50 MB
SUPER_ADMIN_ROLE = "master_admin"
MEMORY_LIMIT = 500 * 1024 * 1024  # 500 MB

# ── User Directory ────────────────────────────────────────────────────

def get_user_projects_dir(user_id: Optional[str]) -> Path:
    """Get user-scoped projects directory. Falls back to shared dir if no user."""
    if user_id:
        user_dir = PROJECTS_DIR / user_id
        user_dir.mkdir(exist_ok=True)
        return user_dir
    return PROJECTS_DIR

def is_super_admin(role: Optional[str]) -> bool:
    return role == SUPER_ADMIN_ROLE

def sanitize_for_json(obj):
    """Recursively replace NaN/Infinity with None in nested structures."""
    if isinstance(obj, dict):
        return {k: sanitize_for_json(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [sanitize_for_json(v) for v in obj]
    if isinstance(obj, float):
        if np.isnan(obj) or np.isinf(obj):
            return None
        return obj
    if isinstance(obj, (np.integer,)):
        return int(obj)
    if isinstance(obj, (np.floating,)):
        if np.isnan(obj) or np.isinf(obj):
            return None
        return float(obj)
    if isinstance(obj, (np.bool_,)):
        return bool(obj)
    if isinstance(obj, pd.Timestamp):
        if pd.isna(obj):
            return None
        return obj.isoformat()
    if isinstance(obj, pd.Period):
        return str(obj)
    if isinstance(obj, np.ndarray):
        return sanitize_for_json(obj.tolist())
    if pd.isna(obj) if not isinstance(obj, (str, list, dict)) else False:
        return None
    return obj

def add_audit_log(dataset_id: str, action: str, details: str = ""):
    """Add an entry to the audit trail."""
    if dataset_id not in audit_logs:
        audit_logs[dataset_id] = []
    audit_logs[dataset_id].append({
        "timestamp": datetime.now().isoformat(),
        "action": action,
        "details": details,
    })
