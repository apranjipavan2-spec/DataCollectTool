"""
Recycle Bin — view, restore, and purge soft-deleted records.

Everything that used to be hard-deleted now lands here with a `deleted_at`
timestamp and is kept for RETENTION_DAYS (360). Org admins can restore any item
or purge it early; a scheduled job purges whatever has aged past the window.
"""
from __future__ import annotations

import logging
import os
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.database import get_db, SessionLocal
from app.core.deps import require_role
from app.core.soft_delete import registry, label_for, created_at_for, RETENTION_DAYS

logger = logging.getLogger(__name__)
router = APIRouter()
require_org_admin = require_role("org_admin")


def _all_deleted(db: Session, model, tenant_id):
    return (
        db.query(model)
        .execution_options(include_deleted=True)
        .filter(model.tenant_id == tenant_id, model.deleted_at.isnot(None))
        .all()
    )


# ── File-explorer-style grouping ─────────────────────────────────────────────
# Fixed sidebar order + icon for every known folder, shown even at zero count
# so the taxonomy never "disappears" just because nothing's binned there yet.
GROUP_DEFS = [
    ("Forms",                "📋"),
    ("Form Assignments",     "🔗"),
    ("Analyzer Projects",    "📊"),
    ("Cleaner Projects",     "🧹"),
    ("Writer Files",         "✍️"),
    ("AI Reports",           "🤖"),
    ("Records",              "🗂️"),
    ("Data Collected",       "📥"),
    ("Shared Files",         "📁"),
    ("Programs & Setup",     "🏷️"),
    ("Scheduled Reports",    "⏰"),
    ("Webhooks",             "🔌"),
    ("Data Rights Requests", "⚖️"),
]
_GROUP_ICON = dict(GROUP_DEFS)

# entity_type -> folder name. "project" is a shared table for four different
# tools (UserToolProject.tool), so it's split out below instead.
_ENTITY_GROUP = {
    "submission":          "Data Collected",
    "respondent":          "Records",
    "form":                "Forms",
    "assignment":          "Form Assignments",
    "shared_file":         "Shared Files",
    "program":             "Programs & Setup",
    "program_location":    "Programs & Setup",
    "participant_type":    "Programs & Setup",
    "questionnaire":       "Programs & Setup",
    "location_target":     "Programs & Setup",
    "location":            "Programs & Setup",
    "scheduled_report":    "Scheduled Reports",
    "webhook":             "Webhooks",
    "data_rights_request": "Data Rights Requests",
}
_PROJECT_TOOL_GROUP = {
    "analyzer": "Analyzer Projects",
    "cleaner":  "Cleaner Projects",
    "writer":   "Writer Files",
    "ai_job":   "AI Reports",
}


def _group_for(entity_type: str, row) -> tuple[str, str]:
    if entity_type == "project":
        name = _PROJECT_TOOL_GROUP.get(getattr(row, "tool", None), "Other Projects")
    else:
        name = _ENTITY_GROUP.get(entity_type, "Other")
    return name, _GROUP_ICON.get(name, "🗄️")


@router.get("/bin")
def list_bin(tenant_id: str | None = None,
             user: dict = Depends(require_org_admin), db: Session = Depends(get_db)):
    """Everything currently in the 360-day bin for this org, newest first.

    master_admin may pass ?tenant_id=<id> to view another org's bin; the param
    is ignored for everyone else, who always see only their own tenant_id.
    """
    from app.core.config import settings
    tenant_id = tenant_id if (tenant_id and user.get("role") == "master_admin") else user["tenant_id"]
    items = []
    group_counts: dict[str, int] = {}
    for entity_type, (model, human) in registry().items():
        for row in _all_deleted(db, model, tenant_id):
            deleted_at = row.deleted_at
            created_at = created_at_for(row)
            purge_at = (deleted_at + timedelta(days=RETENTION_DAYS)) if deleted_at else None
            days_left = None
            if purge_at:
                days_left = max(0, (purge_at - datetime.now(timezone.utc)).days)
            group, icon = _group_for(entity_type, row)
            group_counts[group] = group_counts.get(group, 0) + 1
            items.append({
                "entity_type": entity_type,
                "entity_label": human,
                "group": group,
                "icon": icon,
                "id": str(row.id),
                "label": label_for(row),
                "created_at": created_at.isoformat() if created_at else None,
                "deleted_at": deleted_at.isoformat() if deleted_at else None,
                "purge_at": purge_at.isoformat() if purge_at else None,
                "days_left": days_left,
            })
    items.sort(key=lambda x: x["deleted_at"] or "", reverse=True)

    # Every known folder, in fixed order, always present — even at 0 — plus
    # any unmapped fallback folder ("Other"/"Other Projects") that actually has items.
    groups = [{"name": n, "icon": i, "count": group_counts.get(n, 0)} for n, i in GROUP_DEFS]
    known = {n for n, _ in GROUP_DEFS}
    for name, count in group_counts.items():
        if name not in known:
            groups.append({"name": name, "icon": _GROUP_ICON.get(name, "🗄️"), "count": count})

    return {
        "items": items,
        "count": len(items),
        "groups": groups,
        "retention_days": RETENTION_DAYS,
        "allow_hard_delete": settings.ALLOW_HARD_DELETE,
    }


def _get_row(db: Session, entity_type: str, item_id: str, tenant_id):
    reg = registry()
    if entity_type not in reg:
        raise HTTPException(404, "Unknown item type")
    model, _ = reg[entity_type]
    row = (
        db.query(model)
        .execution_options(include_deleted=True)
        .filter(model.id == item_id, model.tenant_id == tenant_id, model.deleted_at.isnot(None))
        .first()
    )
    if not row:
        raise HTTPException(404, "Item not found in bin")
    return model, row


@router.post("/bin/{entity_type}/{item_id}/restore")
def restore_item(entity_type: str, item_id: str, tenant_id: str | None = None,
                 user: dict = Depends(require_org_admin), db: Session = Depends(get_db)):
    """Bring an item back out of the bin."""
    effective_tenant_id = tenant_id if (tenant_id and user.get("role") == "master_admin") else user["tenant_id"]
    _, row = _get_row(db, entity_type, item_id, effective_tenant_id)
    row.deleted_at = None
    # Forms/projects also carry their own status/archived flag alongside the
    # shared deleted_at — clear it too, or the item stays hidden from its own
    # list even after leaving the bin.
    if entity_type == "form":
        row.status = "draft"
    elif entity_type == "project":
        row.archived_at = None
    db.commit()
    return {"restored": True, "entity_type": entity_type, "id": item_id}


@router.delete("/bin/{entity_type}/{item_id}")
def purge_item(entity_type: str, item_id: str, tenant_id: str | None = None,
               user: dict = Depends(require_org_admin), db: Session = Depends(get_db)):
    """Permanently delete one item from the bin (irreversible)."""
    from app.core.config import settings
    if not settings.ALLOW_HARD_DELETE:
        raise HTTPException(
            status_code=403,
            detail="Hard delete is disabled. Client data is retained; use anonymize for erasure.",
        )
    effective_tenant_id = tenant_id if (tenant_id and user.get("role") == "master_admin") else user["tenant_id"]
    model, row = _get_row(db, entity_type, item_id, effective_tenant_id)
    if entity_type == "shared_file":
        _remove_disk_file(row)
    db.delete(row)
    db.commit()
    return {"purged": True, "entity_type": entity_type, "id": item_id}


def _remove_disk_file(shared_file_row) -> None:
    path = getattr(shared_file_row, "disk_path", None)
    try:
        if path and os.path.exists(path):
            os.remove(path)
    except OSError as e:
        logger.warning("Could not remove shared file from disk: %s", e)


# ── Scheduled purge (called by the scheduler) ─────────────────────────────────

def purge_expired() -> int:
    """Hard-delete every binned row older than RETENTION_DAYS. Returns count purged.

    No-op unless ALLOW_HARD_DELETE is set — by default client data is never
    physically removed, only kept soft-deleted in the bin.
    """
    from app.core.config import settings
    if not settings.ALLOW_HARD_DELETE:
        return 0
    cutoff = datetime.now(timezone.utc) - timedelta(days=RETENTION_DAYS)
    purged = 0
    db = SessionLocal()
    try:
        for entity_type, (model, _) in registry().items():
            rows = (
                db.query(model)
                .execution_options(include_deleted=True)
                .filter(model.deleted_at.isnot(None), model.deleted_at < cutoff)
                .all()
            )
            for row in rows:
                if entity_type == "shared_file":
                    _remove_disk_file(row)
                db.delete(row)
                purged += 1
        # submission_comments has no ORM model in the registry — purge via raw SQL.
        db.execute(text(
            "DELETE FROM submission_comments WHERE deleted_at IS NOT NULL AND deleted_at < :cutoff"
        ), {"cutoff": cutoff})
        db.commit()
        if purged:
            logger.info("Recycle-bin purge: hard-deleted %d expired items", purged)
    except Exception:
        db.rollback()
        logger.exception("Recycle-bin purge failed")
    finally:
        db.close()
    return purged
