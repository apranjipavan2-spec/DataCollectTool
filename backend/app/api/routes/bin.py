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
from app.core.soft_delete import registry, label_for, RETENTION_DAYS

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


@router.get("/bin")
def list_bin(user: dict = Depends(require_org_admin), db: Session = Depends(get_db)):
    """Everything currently in the 360-day bin for this org, newest first."""
    tenant_id = user["tenant_id"]
    items = []
    for entity_type, (model, human) in registry().items():
        for row in _all_deleted(db, model, tenant_id):
            deleted_at = row.deleted_at
            purge_at = (deleted_at + timedelta(days=RETENTION_DAYS)) if deleted_at else None
            days_left = None
            if purge_at:
                days_left = max(0, (purge_at - datetime.now(timezone.utc)).days)
            items.append({
                "entity_type": entity_type,
                "entity_label": human,
                "id": str(row.id),
                "label": label_for(row),
                "deleted_at": deleted_at.isoformat() if deleted_at else None,
                "purge_at": purge_at.isoformat() if purge_at else None,
                "days_left": days_left,
            })
    items.sort(key=lambda x: x["deleted_at"] or "", reverse=True)
    return {"items": items, "count": len(items), "retention_days": RETENTION_DAYS}


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
def restore_item(entity_type: str, item_id: str,
                 user: dict = Depends(require_org_admin), db: Session = Depends(get_db)):
    """Bring an item back out of the bin."""
    _, row = _get_row(db, entity_type, item_id, user["tenant_id"])
    row.deleted_at = None
    db.commit()
    return {"restored": True, "entity_type": entity_type, "id": item_id}


@router.delete("/bin/{entity_type}/{item_id}")
def purge_item(entity_type: str, item_id: str,
               user: dict = Depends(require_org_admin), db: Session = Depends(get_db)):
    """Permanently delete one item from the bin (irreversible)."""
    model, row = _get_row(db, entity_type, item_id, user["tenant_id"])
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
    """Hard-delete every binned row older than RETENTION_DAYS. Returns count purged."""
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
