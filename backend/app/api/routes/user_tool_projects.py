from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
from app.core.deps import require_supervisor, get_db
from app.models.user_tool_project import UserToolProject

router = APIRouter()


class ProjectIn(BaseModel):
    tool: str          # 'analyzer' | 'cleaner'
    name: str
    program_id: Optional[str] = None
    data: dict = {}


@router.get("/tool-projects/")
def list_projects(tool: str = "", user=Depends(require_supervisor), db: Session = Depends(get_db)):
    q = db.query(UserToolProject).filter(
        UserToolProject.user_id == user["sub"],
        UserToolProject.tenant_id == user["tenant_id"],
    )
    if tool:
        q = q.filter(UserToolProject.tool == tool)
    rows = q.order_by(UserToolProject.updated_at.desc()).all()
    return [
        {
            "id": str(r.id),
            "tool": r.tool,
            "name": r.name,
            "program_id": str(r.program_id) if r.program_id else None,
            "data": r.data,
            "created_at": r.created_at.isoformat() if r.created_at else None,
            "updated_at": r.updated_at.isoformat() if r.updated_at else None,
        }
        for r in rows
    ]


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


@router.delete("/tool-projects/{project_id}")
def delete_project(project_id: str, user=Depends(require_supervisor), db: Session = Depends(get_db)):
    proj = db.query(UserToolProject).filter(
        UserToolProject.id == project_id,
        UserToolProject.user_id == user["sub"],
        UserToolProject.tenant_id == user["tenant_id"],
    ).first()
    if not proj:
        raise HTTPException(404, "Project not found")
    db.delete(proj)
    db.commit()
    return {"deleted": True}
