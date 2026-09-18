"""Analytics endpoints — daily progress and trend."""
from datetime import date, timedelta
from typing import Optional
from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, cast, Date
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import require_supervisor
from app.models.submission import Submission
from app.models.user import User
from app.models.roster import RespondentRoster

router = APIRouter()


@router.get("/daily-progress")
def daily_progress(
    form_id: str = Query(...),
    date: Optional[str] = Query(None, description="YYYY-MM-DD, defaults to today"),
    user: dict = Depends(require_supervisor),
    db: Session = Depends(get_db),
):
    from datetime import date as _date
    target_date = _date.fromisoformat(date) if date else _date.today()

    rows = (
        db.query(Submission.enumerator_id, func.count(Submission.id).label("count"))
        .filter(
            Submission.form_id == form_id,
            Submission.tenant_id == user["tenant_id"],
            cast(Submission.server_received_at, Date) == target_date,
            Submission.enumerator_id != None,
        )
        .group_by(Submission.enumerator_id)
        .all()
    )

    enum_ids = [r.enumerator_id for r in rows]
    users_map: dict = {}
    if enum_ids:
        users = db.query(User).filter(User.id.in_(enum_ids)).all()
        users_map = {u.id: u.name or u.phone for u in users}

    by_enumerator = [
        {"user_id": str(r.enumerator_id), "name": users_map.get(r.enumerator_id, "Unknown"), "count": r.count}
        for r in rows
    ]
    total = sum(r["count"] for r in by_enumerator)

    roster_rows = (
        db.query(RespondentRoster.target_enumerator_id, func.count(RespondentRoster.id).label("target"))
        .filter(
            RespondentRoster.form_id == form_id,
            RespondentRoster.tenant_id == user["tenant_id"],
            RespondentRoster.target_enumerator_id != None,
        )
        .group_by(RespondentRoster.target_enumerator_id)
        .all()
    )
    roster_targets = {str(r.target_enumerator_id): r.target for r in roster_rows}

    return {
        "date": str(target_date),
        "total": total,
        "by_enumerator": by_enumerator,
        "roster_targets": roster_targets,
    }


@router.get("/trend")
def submission_trend(
    form_id: str = Query(...),
    days: int = Query(7, ge=1, le=90),
    user: dict = Depends(require_supervisor),
    db: Session = Depends(get_db),
):
    from datetime import date as _date
    today = _date.today()
    start = today - timedelta(days=days - 1)

    rows = (
        db.query(cast(Submission.server_received_at, Date).label("day"), func.count(Submission.id).label("count"))
        .filter(
            Submission.form_id == form_id,
            Submission.tenant_id == user["tenant_id"],
            cast(Submission.server_received_at, Date) >= start,
        )
        .group_by("day")
        .order_by("day")
        .all()
    )

    day_counts = {str(r.day): r.count for r in rows}
    dates = [(start + timedelta(days=i)).isoformat() for i in range(days)]
    counts = [day_counts.get(d, 0) for d in dates]

    return {"dates": dates, "counts": counts}
