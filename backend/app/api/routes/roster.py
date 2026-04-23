"""Respondent roster endpoints."""
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import require_role, require_supervisor
from app.models.roster import RespondentRoster

router = APIRouter()

require_org_admin = require_role("org_admin")


class RosterCreate(BaseModel):
    form_id: str
    name: str
    phone: Optional[str] = None
    address: Optional[str] = None
    target_enumerator_id: Optional[str] = None
    scheduled_date: Optional[str] = None
    notes: Optional[str] = None


class RosterUpdate(BaseModel):
    status: Optional[str] = None
    notes: Optional[str] = None
    target_enumerator_id: Optional[str] = None
    scheduled_date: Optional[str] = None


class BulkImportBody(BaseModel):
    form_id: str
    respondents: list[RosterCreate]


def _roster_to_dict(r: RespondentRoster) -> dict:
    return {
        "id": str(r.id),
        "form_id": str(r.form_id),
        "tenant_id": str(r.tenant_id),
        "name": r.name,
        "phone": r.phone,
        "address": r.address,
        "target_enumerator_id": str(r.target_enumerator_id) if r.target_enumerator_id else None,
        "status": r.status,
        "scheduled_date": str(r.scheduled_date) if r.scheduled_date else None,
        "notes": r.notes,
        "created_at": str(r.created_at) if r.created_at else None,
    }


@router.get("/")
def list_roster(
    form_id: Optional[str] = None,
    status: Optional[str] = None,
    user: dict = Depends(require_supervisor),
    db: Session = Depends(get_db),
):
    q = db.query(RespondentRoster).filter(RespondentRoster.tenant_id == user["tenant_id"])
    if form_id:
        q = q.filter(RespondentRoster.form_id == form_id)
    if status:
        q = q.filter(RespondentRoster.status == status)
    return [_roster_to_dict(r) for r in q.order_by(RespondentRoster.created_at.desc()).all()]


@router.post("/")
def create_roster(
    body: RosterCreate,
    user: dict = Depends(require_supervisor),
    db: Session = Depends(get_db),
):
    from datetime import date as _date
    r = RespondentRoster(
        form_id=body.form_id,
        tenant_id=user["tenant_id"],
        name=body.name,
        phone=body.phone,
        address=body.address,
        target_enumerator_id=body.target_enumerator_id or None,
        scheduled_date=_date.fromisoformat(body.scheduled_date) if body.scheduled_date else None,
        notes=body.notes,
    )
    db.add(r)
    db.commit()
    db.refresh(r)
    return _roster_to_dict(r)


@router.patch("/{roster_id}")
def update_roster(
    roster_id: str,
    body: RosterUpdate,
    user: dict = Depends(require_supervisor),
    db: Session = Depends(get_db),
):
    r = db.query(RespondentRoster).filter(
        RespondentRoster.id == roster_id,
        RespondentRoster.tenant_id == user["tenant_id"],
    ).first()
    if not r:
        raise HTTPException(status_code=404, detail="Roster entry not found")
    if body.status is not None:
        r.status = body.status
    if body.notes is not None:
        r.notes = body.notes
    if body.target_enumerator_id is not None:
        r.target_enumerator_id = body.target_enumerator_id or None
    if body.scheduled_date is not None:
        from datetime import date as _date
        r.scheduled_date = _date.fromisoformat(body.scheduled_date) if body.scheduled_date else None
    db.commit()
    db.refresh(r)
    return _roster_to_dict(r)


@router.delete("/{roster_id}")
def delete_roster(
    roster_id: str,
    user: dict = Depends(require_org_admin),
    db: Session = Depends(get_db),
):
    r = db.query(RespondentRoster).filter(
        RespondentRoster.id == roster_id,
        RespondentRoster.tenant_id == user["tenant_id"],
    ).first()
    if not r:
        raise HTTPException(status_code=404, detail="Roster entry not found")
    db.delete(r)
    db.commit()
    return {"ok": True}


@router.post("/bulk-import")
def bulk_import_roster(
    body: BulkImportBody,
    user: dict = Depends(require_org_admin),
    db: Session = Depends(get_db),
):
    from datetime import date as _date
    created = []
    for item in body.respondents:
        r = RespondentRoster(
            form_id=body.form_id,
            tenant_id=user["tenant_id"],
            name=item.name,
            phone=item.phone,
            address=item.address,
            target_enumerator_id=item.target_enumerator_id or None,
            scheduled_date=_date.fromisoformat(item.scheduled_date) if item.scheduled_date else None,
            notes=item.notes,
        )
        db.add(r)
        created.append(r)
    db.commit()
    return {"created": len(created)}
