from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.core.deps import require_supervisor
from app.models.submission import Submission
from app.models.submission_history import SubmissionHistory
from app.models.user import User

router = APIRouter()


@router.get("/{submission_id}")
def get_submission_history(
    submission_id: str,
    user=Depends(require_supervisor),
    db: Session = Depends(get_db),
):
    """Return the audit trail for a submission."""
    # Verify submission exists and belongs to this tenant
    sub = db.query(Submission).filter(
        Submission.id == submission_id,
        Submission.tenant_id == user["tenant_id"],
    ).first()
    if not sub:
        raise HTTPException(status_code=404, detail="Submission not found")

    rows = (
        db.query(SubmissionHistory, User.name)
        .outerjoin(User, SubmissionHistory.changed_by == User.id)
        .filter(SubmissionHistory.submission_id == submission_id)
        .order_by(SubmissionHistory.created_at.desc())
        .all()
    )
    return [
        {
            "id": str(h.id),
            "action": h.action,
            "changed_by": str(h.changed_by),
            "changed_by_name": name or "Unknown",
            "note": h.note,
            "created_at": h.created_at,
        }
        for h, name in rows
    ]
