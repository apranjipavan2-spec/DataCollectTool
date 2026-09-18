"""MEAL beneficiary feedback/accountability module.

Not a parallel data-capture system: a "feedback form" is just a regular FieldGovern form,
submitted either by staff (via /collect, same as any survey) or by the public (via the
existing make-public + public_survey.py pipeline). The only new thing here is a resolution
workflow layered on top of whichever submissions belong to a program's designated
feedback form — open -> in_progress -> resolved|escalated, with an assignee and a note.
"""
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import require_enumerator, require_supervisor
from app.models.program import Program
from app.models.submission import Submission
from app.models.feedback_resolution import FeedbackResolution
from app.models.user import User
from app.services.notify import create_notification

router = APIRouter()

VALID_STATUSES = {"open", "in_progress", "resolved", "escalated"}


class FeedbackFormIn(BaseModel):
    form_id: Optional[str] = None  # None clears it


class FeedbackUpdateIn(BaseModel):
    status: Optional[str] = None
    assigned_to: Optional[str] = None
    resolution_note: Optional[str] = None


def _get_program(prog_id: str, user: dict, db: Session) -> Program:
    p = db.query(Program).filter(Program.id == prog_id, Program.tenant_id == user["tenant_id"]).first()
    if not p:
        raise HTTPException(404, "Program not found")
    return p


@router.put("/programs/{prog_id}/feedback-form")
def set_feedback_form(prog_id: str, body: FeedbackFormIn, user=Depends(require_supervisor), db: Session = Depends(get_db)):
    prog = _get_program(prog_id, user, db)
    prog.feedback_form_id = body.form_id
    db.commit()
    return {"feedback_form_id": str(prog.feedback_form_id) if prog.feedback_form_id else None}


@router.get("/programs/{prog_id}/feedback")
def list_feedback(prog_id: str, status: Optional[str] = None,
                   user=Depends(require_enumerator), db: Session = Depends(get_db)):
    prog = _get_program(prog_id, user, db)
    if not prog.feedback_form_id:
        return []

    subs = db.query(Submission).filter(
        Submission.form_id == prog.feedback_form_id, Submission.tenant_id == user["tenant_id"],
    ).order_by(Submission.server_received_at.desc()).all()

    sub_ids = [s.id for s in subs]
    resolutions = {
        r.submission_id: r for r in db.query(FeedbackResolution).filter(
            FeedbackResolution.submission_id.in_(sub_ids), FeedbackResolution.tenant_id == user["tenant_id"],
        ).all()
    } if sub_ids else {}

    assignee_ids = {r.assigned_to for r in resolutions.values() if r.assigned_to}
    assignee_map = {u.id: u.name for u in db.query(User).filter(User.id.in_(assignee_ids)).all()} if assignee_ids else {}

    rows = []
    for s in subs:
        res = resolutions.get(s.id)
        row_status = res.status if res else "open"
        if status and row_status != status:
            continue
        rows.append({
            "submission_id": str(s.id),
            "data": s.data_json,
            "created_at": s.server_received_at.isoformat() if s.server_received_at else None,
            "status": row_status,
            "assigned_to": str(res.assigned_to) if res and res.assigned_to else None,
            "assigned_to_name": assignee_map.get(res.assigned_to, "") if res else "",
            "resolution_note": res.resolution_note if res else None,
            "resolved_at": res.resolved_at.isoformat() if res and res.resolved_at else None,
        })
    return rows


@router.patch("/feedback/{submission_id}")
def update_feedback(submission_id: str, body: FeedbackUpdateIn,
                     user=Depends(require_supervisor), db: Session = Depends(get_db)):
    sub = db.query(Submission).filter(Submission.id == submission_id, Submission.tenant_id == user["tenant_id"]).first()
    if not sub:
        raise HTTPException(404, "Submission not found")
    if body.status is not None and body.status not in VALID_STATUSES:
        raise HTTPException(400, f"status must be one of {sorted(VALID_STATUSES)}")

    res = db.query(FeedbackResolution).filter(
        FeedbackResolution.submission_id == submission_id, FeedbackResolution.tenant_id == user["tenant_id"],
    ).first()
    if not res:
        res = FeedbackResolution(tenant_id=user["tenant_id"], submission_id=submission_id)
        db.add(res)

    prev_assigned = res.assigned_to
    if body.status is not None:
        res.status = body.status
        if body.status == "resolved":
            res.resolved_by = user["sub"]
            res.resolved_at = datetime.now(timezone.utc)
    if body.assigned_to is not None:
        res.assigned_to = body.assigned_to or None
    if body.resolution_note is not None:
        res.resolution_note = body.resolution_note
    db.commit()

    if res.assigned_to and str(res.assigned_to) != str(prev_assigned):
        create_notification(db, str(user["tenant_id"]), str(res.assigned_to),
                             "feedback", "Feedback item assigned to you",
                             (res.resolution_note or "")[:120], f"/submissions/{submission_id}")

    return {
        "submission_id": str(sub.id), "status": res.status,
        "assigned_to": str(res.assigned_to) if res.assigned_to else None,
        "resolution_note": res.resolution_note,
        "resolved_at": res.resolved_at.isoformat() if res.resolved_at else None,
    }
