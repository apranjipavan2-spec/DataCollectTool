from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import or_
from sqlalchemy.sql import func
from pydantic import BaseModel
from typing import Optional, List
from app.core.deps import require_supervisor, get_current_user, get_db
from app.models.user_tool_project import UserToolProject

router = APIRouter()


class ProjectIn(BaseModel):
    tool: str          # 'analyzer' | 'cleaner'
    name: str
    program_id: Optional[str] = None
    data: dict = {}


def _serialize(r: UserToolProject) -> dict:
    return {
        "id": str(r.id),
        "tool": r.tool,
        "name": r.name,
        "program_id": str(r.program_id) if r.program_id else None,
        "data": r.data,
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

    if existing:
        existing.program_id = body.program_id
        existing.data = body.data
        db.commit()
        return {"id": str(existing.id), "created": False}

    proj = UserToolProject(
        tenant_id=user["tenant_id"],
        user_id=user["sub"],
        tool=body.tool,
        name=body.name,
        program_id=body.program_id or None,
        data=body.data,
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
