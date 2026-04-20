"""
Schedule CRUD endpoints.

Supervisors/admins create schedules, enumerators view their own.
"""
from datetime import date
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import require_enumerator
from app.models.schedule import Schedule
from app.models.form import Form
from app.models.user import User
from app.models.program import ProgramQuestionnaire, ProgramParticipantType, Program, ProgramLocation
from app.api.routes.notifications import send_push

router = APIRouter()


class ScheduleCreate(BaseModel):
    form_id: str
    enumerator_id: str
    start_date: date
    end_date: date
    location: str = ""
    target_count: int = 0
    notes: str = ""
    program_questionnaire_id: Optional[str] = None
    location_id: Optional[str] = None


class ScheduleUpdate(BaseModel):
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    location: Optional[str] = None
    target_count: Optional[int] = None
    notes: Optional[str] = None
    status: Optional[str] = None
    program_questionnaire_id: Optional[str] = None
    location_id: Optional[str] = None


@router.get("/")
def list_schedules(
    status: Optional[str] = None,
    user=Depends(require_enumerator),
    db: Session = Depends(get_db),
):
    """List schedules. Enumerators see only their own; admins/supervisors see all."""
    q = db.query(Schedule).filter(
        Schedule.tenant_id == user["tenant_id"],
        Schedule.is_active == True,
    )

    # Enumerators only see their own schedules
    if user["role"] == "enumerator":
        q = q.filter(Schedule.enumerator_id == user["sub"])

    if status:
        q = q.filter(Schedule.status == status)

    q = q.order_by(Schedule.start_date.asc())
    schedules = q.all()

    # Batch-fetch form titles and enumerator names
    form_ids = {s.form_id for s in schedules}
    user_ids = {s.enumerator_id for s in schedules}

    form_map = {}
    if form_ids:
        forms = db.query(Form.id, Form.title).filter(Form.id.in_(form_ids)).all()
        form_map = {str(f.id): f.title for f in forms}

    user_map = {}
    if user_ids:
        users = db.query(User.id, User.name).filter(User.id.in_(user_ids)).all()
        user_map = {str(u.id): u.name for u in users}

    # Batch-fetch program context for schedules that have one
    pq_ids = {s.program_questionnaire_id for s in schedules if s.program_questionnaire_id}
    loc_ids = {s.location_id for s in schedules if s.location_id}

    pq_map: dict = {}
    if pq_ids:
        pqs = db.query(ProgramQuestionnaire).filter(ProgramQuestionnaire.id.in_(pq_ids)).all()
        prog_ids = {pq.program_id for pq in pqs}
        pt_ids = {pq.participant_type_id for pq in pqs if pq.participant_type_id}
        prog_map = {str(p.id): p for p in db.query(Program).filter(Program.id.in_(prog_ids)).all()} if prog_ids else {}
        pt_map = {str(t.id): t.name for t in db.query(ProgramParticipantType).filter(ProgramParticipantType.id.in_(pt_ids)).all()} if pt_ids else {}
        for pq in pqs:
            prog = prog_map.get(str(pq.program_id))
            pq_map[str(pq.id)] = {
                "questionnaire_id": str(pq.id),
                "questionnaire_name": pq.name,
                "program_id": str(pq.program_id),
                "program_name": prog.name if prog else "",
                "scheme_name": prog.scheme_name if prog else "",
                "participant_type_id": str(pq.participant_type_id) if pq.participant_type_id else None,
                "participant_type_name": pt_map.get(str(pq.participant_type_id), "") if pq.participant_type_id else "",
            }

    loc_map: dict = {}
    if loc_ids:
        locs = db.query(ProgramLocation).filter(ProgramLocation.id.in_(loc_ids)).all()
        loc_map = {str(l.id): {"location_id": str(l.id), "district": l.district, "block": l.block, "village": l.village, "state": l.state} for l in locs}

    return [
        {
            "id": str(s.id),
            "form_id": str(s.form_id),
            "form_title": form_map.get(str(s.form_id), "Unknown"),
            "enumerator_id": str(s.enumerator_id),
            "enumerator_name": user_map.get(str(s.enumerator_id), "Unknown"),
            "start_date": s.start_date.isoformat(),
            "end_date": s.end_date.isoformat(),
            "location": s.location,
            "target_count": s.target_count,
            "notes": s.notes,
            "status": s.status,
            "created_at": s.created_at.isoformat() if s.created_at else "",
            "program_questionnaire_id": str(s.program_questionnaire_id) if s.program_questionnaire_id else None,
            "location_id": str(s.location_id) if s.location_id else None,
            "program_context": pq_map.get(str(s.program_questionnaire_id)) if s.program_questionnaire_id else None,
            "location_context": loc_map.get(str(s.location_id)) if s.location_id else None,
        }
        for s in schedules
    ]


@router.post("/")
def create_schedule(
    body: ScheduleCreate,
    user=Depends(require_enumerator),
    db: Session = Depends(get_db),
):
    """Create a schedule (admin/supervisor only)."""
    if user["role"] == "enumerator":
        raise HTTPException(status_code=403, detail="Only admins/supervisors can create schedules")

    schedule = Schedule(
        tenant_id=user["tenant_id"],
        form_id=body.form_id,
        enumerator_id=body.enumerator_id,
        start_date=body.start_date,
        end_date=body.end_date,
        location=body.location,
        target_count=body.target_count,
        notes=body.notes,
        status="upcoming" if body.start_date > date.today() else "active",
        program_questionnaire_id=body.program_questionnaire_id or None,
        location_id=body.location_id or None,
    )
    db.add(schedule)
    db.commit()
    db.refresh(schedule)

    # Auto-notify the enumerator about the new schedule
    form = db.query(Form).filter(Form.id == body.form_id).first()
    form_title = form.title if form else "a form"
    send_push(
        db,
        user_id=body.enumerator_id,
        title="New Schedule Assigned",
        body=f"You have been scheduled for \"{form_title}\" ({body.start_date} to {body.end_date})",
        url="/collect",
    )

    return {"id": str(schedule.id), "status": schedule.status}


@router.patch("/{schedule_id}")
def update_schedule(
    schedule_id: str,
    body: ScheduleUpdate,
    user=Depends(require_enumerator),
    db: Session = Depends(get_db),
):
    """Update a schedule (admin/supervisor only)."""
    if user["role"] == "enumerator":
        raise HTTPException(status_code=403, detail="Only admins/supervisors can update schedules")

    schedule = db.query(Schedule).filter(
        Schedule.id == schedule_id,
        Schedule.tenant_id == user["tenant_id"],
    ).first()
    if not schedule:
        raise HTTPException(status_code=404, detail="Schedule not found")

    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(schedule, field, value)

    db.commit()
    return {"id": str(schedule.id), "status": schedule.status}


@router.delete("/{schedule_id}")
def delete_schedule(
    schedule_id: str,
    user=Depends(require_enumerator),
    db: Session = Depends(get_db),
):
    """Soft-delete a schedule."""
    if user["role"] == "enumerator":
        raise HTTPException(status_code=403, detail="Only admins/supervisors can delete schedules")

    schedule = db.query(Schedule).filter(
        Schedule.id == schedule_id,
        Schedule.tenant_id == user["tenant_id"],
    ).first()
    if not schedule:
        raise HTTPException(status_code=404, detail="Schedule not found")

    schedule.is_active = False
    schedule.status = "cancelled"
    db.commit()
    return {"deleted": True}
