from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import or_
from sqlalchemy.sql import func
from pydantic import BaseModel
from typing import Optional, List
from app.core.deps import require_supervisor, get_current_user, get_db
from app.models.user_tool_project import UserToolProject

router = APIRouter()

# Version history is kept inline in the JSONB `data` blob under "_history" —
# capped in count and throttled in time so autosave ticks don't blow up the
# row with near-identical snapshots.
MAX_HISTORY_VERSIONS = 12
MIN_SECONDS_BETWEEN_VERSIONS = 120


class ProjectIn(BaseModel):
    tool: str          # 'analyzer' | 'cleaner'
    name: str
    program_id: Optional[str] = None
    data: dict = {}
    autosave: bool = False


def _serialize(r: UserToolProject) -> dict:
    data = dict(r.data or {})
    history = data.pop("_history", [])
    data.pop("_autosave", None)
    return {
        "id": str(r.id),
        "tool": r.tool,
        "name": r.name,
        "program_id": str(r.program_id) if r.program_id else None,
        "data": data,
        "history_count": len(history),
        "shared_with": [str(t) for t in (r.shared_with_tenants or [])],
        "archived_at": r.archived_at.isoformat() if r.archived_at else None,
        "created_at": r.created_at.isoformat() if r.created_at else None,
        "updated_at": r.updated_at.isoformat() if r.updated_at else None,
    }


@router.get("/tool-projects/")
def list_projects(tool: str = "", archived: bool = False,
                  user=Depends(require_supervisor), db: Session = Depends(get_db)):
    tenant_id = user["tenant_id"]
    q = db.query(UserToolProject).filter(
        or_(
            (UserToolProject.user_id == user["sub"]) & (UserToolProject.tenant_id == tenant_id),
            UserToolProject.shared_with_tenants.any(tenant_id),
        )
    )
    if tool:
        q = q.filter(UserToolProject.tool == tool)
    # Active list hides archived projects; pass ?archived=true for the Archive folder.
    if archived:
        q = q.filter(UserToolProject.archived_at.isnot(None))
    else:
        q = q.filter(UserToolProject.archived_at.is_(None))
    rows = q.order_by(UserToolProject.updated_at.desc()).all()
    return [_serialize(r) for r in rows]


@router.post("/tool-projects/")
def upsert_project(body: ProjectIn, user=Depends(require_supervisor), db: Session = Depends(get_db)):
    # Upsert by tool + name + user
    existing = db.query(UserToolProject).filter(
        UserToolProject.user_id == user["sub"],
        UserToolProject.tenant_id == user["tenant_id"],
        UserToolProject.tool == body.tool,
        UserToolProject.name == body.name,
    ).first()

    new_data = dict(body.data)
    new_data["_autosave"] = body.autosave

    if existing:
        old_data = dict(existing.data or {})
        history = old_data.pop("_history", [])
        changed = old_data.get("csv_content") != new_data.get("csv_content")
        if changed:
            last_saved_at = history[-1]["saved_at"] if history else None
            due = True
            if last_saved_at:
                try:
                    elapsed = (datetime.now(timezone.utc) - datetime.fromisoformat(last_saved_at)).total_seconds()
                    due = elapsed >= MIN_SECONDS_BETWEEN_VERSIONS
                except Exception:
                    due = True
            if due:
                history.append({
                    "snapshot": old_data,
                    "saved_at": datetime.now(timezone.utc).isoformat(),
                    "autosave": old_data.get("_autosave", False),
                })
                history = history[-MAX_HISTORY_VERSIONS:]
        new_data["_history"] = history
        existing.program_id = body.program_id
        existing.data = new_data
        db.commit()
        return {"id": str(existing.id), "created": False}

    new_data["_history"] = []
    proj = UserToolProject(
        tenant_id=user["tenant_id"],
        user_id=user["sub"],
        tool=body.tool,
        name=body.name,
        program_id=body.program_id or None,
        data=new_data,
    )
    db.add(proj)
    db.commit()
    db.refresh(proj)
    return {"id": str(proj.id), "created": True}


class ShareProjectRequest(BaseModel):
    tenant_ids: List[str]


@router.patch("/tool-projects/{project_id}/share")
def share_project(project_id: str, body: ShareProjectRequest, user=Depends(get_current_user), db: Session = Depends(get_db)):
    """Share a tool-project with other tenants. Only the owner (within their own tenant) can share."""
    proj = db.query(UserToolProject).filter(
        UserToolProject.id == project_id,
        UserToolProject.tenant_id == user["tenant_id"],
    ).first()
    if not proj:
        raise HTTPException(404, "Project not found")
    if str(proj.user_id) != user["sub"]:
        raise HTTPException(403, "Only the project owner can share it")
    proj.shared_with_tenants = body.tenant_ids
    db.commit()
    return {"id": str(proj.id), "shared_with": body.tenant_ids}


def _owned_project(project_id: str, user, db: Session) -> UserToolProject:
    proj = db.query(UserToolProject).filter(
        UserToolProject.id == project_id,
        UserToolProject.user_id == user["sub"],
        UserToolProject.tenant_id == user["tenant_id"],
    ).first()
    if not proj:
        raise HTTPException(404, "Project not found")
    return proj


@router.delete("/tool-projects/{project_id}")
def delete_project(project_id: str, user=Depends(require_supervisor), db: Session = Depends(get_db)):
    """Soft-delete: archive the project instead of removing it. Stays restorable."""
    proj = _owned_project(project_id, user, db)
    if proj.archived_at is None:
        proj.archived_at = func.now()
        db.commit()
    return {"archived": True}


@router.post("/tool-projects/{project_id}/restore")
def restore_project(project_id: str, user=Depends(require_supervisor), db: Session = Depends(get_db)):
    """Move an archived project back into the active list."""
    proj = _owned_project(project_id, user, db)
    proj.archived_at = None
    db.commit()
    return {"restored": True}


@router.get("/tool-projects/{project_id}/history")
def list_project_history(project_id: str, user=Depends(require_supervisor), db: Session = Depends(get_db)):
    """List saved version checkpoints for a project (autosave + manual saves), newest first."""
    proj = _owned_project(project_id, user, db)
    history = (proj.data or {}).get("_history", [])
    return [
        {
            "index": i,
            "saved_at": h.get("saved_at"),
            "autosave": h.get("autosave", False),
            "row_count": h.get("snapshot", {}).get("row_count"),
            "col_count": h.get("snapshot", {}).get("col_count"),
            "filename": h.get("snapshot", {}).get("filename"),
        }
        for i, h in reversed(list(enumerate(history)))
    ]


@router.post("/tool-projects/{project_id}/history/{index}/restore")
def restore_project_version(project_id: str, index: int, user=Depends(require_supervisor), db: Session = Depends(get_db)):
    """Roll a project's live data back to a past checkpoint. The current state is
    itself archived first, so restoring a version is never destructive/final."""
    proj = _owned_project(project_id, user, db)
    data = dict(proj.data or {})
    history = data.get("_history", [])
    if index < 0 or index >= len(history):
        raise HTTPException(404, "Version not found")

    target = history[index]["snapshot"]
    current_snapshot = {k: v for k, v in data.items() if k != "_history"}
    remaining = history[:index] + history[index + 1:]
    remaining.append({
        "snapshot": current_snapshot,
        "saved_at": datetime.now(timezone.utc).isoformat(),
        "autosave": current_snapshot.get("_autosave", False),
    })

    new_data = dict(target)
    new_data["_history"] = remaining[-MAX_HISTORY_VERSIONS:]
    proj.data = new_data
    db.commit()
    return {"restored": True, "data": target}
