from datetime import datetime, timezone
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from typing import Any, Literal, Optional
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.core.deps import get_current_user, require_enumerator, require_supervisor
from app.core.rate_limit import limiter
from app.models.submission import Submission
from app.models.submission_history import SubmissionHistory
from app.models.form import Form
from app.models.user import User
from app.models.tenant import Tenant
from app.services.email import send_flagged_submission_email
from app.services.webhook import fire_webhooks
from app.services.whatsapp import notify as wa_notify
from app.services.telegram import notify as tg_notify
import asyncio
import logging

logger = logging.getLogger(__name__)
router = APIRouter()


def _fire_webhook_bg(tenant_id: str, event: str, payload: dict, submission_id: str):
    """Fire a single webhook in a background task (new DB session)."""
    from app.core.database import SessionLocal
    db = SessionLocal()
    try:
        fire_webhooks(db, tenant_id, event, payload)
    except Exception:
        logger.warning("Background webhook fire failed for submission %s", submission_id)
    finally:
        db.close()


class SubmissionCreate(BaseModel):
    form_id: str
    form_version: int
    data_json: dict[str, Any]
    gps_open: Optional[dict] = None
    gps_submit: Optional[dict] = None
    local_created_at: Optional[str] = None


VALID_STATUSES = {"synced", "flagged", "approved", "rejected"}


class SubmissionUpdate(BaseModel):
    status: Optional[Literal["synced", "flagged", "approved", "rejected"]] = None
    flag_note: Optional[str] = None
    reviewer_name: Optional[str] = None


class BulkUpdateBody(BaseModel):
    ids: list[str]
    status: str
    flag_note: Optional[str] = None


class SubmissionDataEdit(BaseModel):
    data_json: dict[str, Any]


class SerialNoUpdate(BaseModel):
    serial_no: int


# ── List all submissions ──────────────────────────────────────────────────────

@router.get("/")
def list_submissions(
    form_id: Optional[str] = None,
    enumerator_id: Optional[str] = None,
    status: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    q: Optional[str] = None,
    page: int = 1,
    page_size: int = 50,
    backcheck_required: Optional[bool] = None,
    has_violations: Optional[bool] = None,
    slim: bool = False,
    user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    role = user.get("role", "")
    if role not in ("org_admin", "supervisor", "enumerator", "master_admin"):
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    try:
        page_size = min(page_size, 5000)
        query = db.query(Submission, User.name).outerjoin(
            User, Submission.enumerator_id == User.id
        ).filter(Submission.tenant_id == user["tenant_id"])
        if role == "enumerator":
            query = query.filter(Submission.enumerator_id == user["sub"])
        if form_id:
            query = query.filter(Submission.form_id == form_id)
        if enumerator_id and role != "enumerator":
            query = query.filter(Submission.enumerator_id == enumerator_id)
        if status:
            query = query.filter(Submission.status == status)
        if backcheck_required is not None:
            query = query.filter(Submission.backcheck_required == backcheck_required)
        if has_violations is not None:
            query = query.filter(Submission.has_violations == has_violations)
        if date_from:
            query = query.filter(Submission.server_received_at >= datetime.fromisoformat(date_from))
        if date_to:
            end = datetime.fromisoformat(date_to).replace(hour=23, minute=59, second=59)
            query = query.filter(Submission.server_received_at <= end)
        if q:
            from sqlalchemy import or_, func, Text
            term = f"%{q}%"
            query = query.filter(
                or_(
                    User.name.ilike(term),
                    User.phone.ilike(term),
                    func.cast(Submission.data_json, Text).ilike(term),
                )
            )
        total = query.count()
        rows = query.order_by(Submission.server_received_at.desc()).offset((page - 1) * page_size).limit(page_size).all()

        # Build form title lookup for this page's form_ids
        from app.models.form import Form as FormModel
        fids = list({s.form_id for s, _ in rows})
        form_title_map = {}
        if fids:
            for f in db.query(FormModel.id, FormModel.title).filter(FormModel.id.in_(fids)).all():
                form_title_map[f.id] = f.title

        return {
            "items": [
                {
                    "id": str(s.id),
                    "form_id": str(s.form_id),
                    "form_title": form_title_map.get(s.form_id, ""),
                    "enumerator_id": str(s.enumerator_id) if s.enumerator_id else None,
                    "enumerator_name": name or "Unknown",
                    "status": s.status,
                    "serial_no": s.serial_no,
                    "duplicate_suspect": bool((s.data_json or {}).get("_duplicate_suspect") == "true" or (s.data_json or {}).get("_duplicate_suspect") is True),
                    **({"data_json": s.data_json} if not slim else {}),
                    "has_violations": bool(s.has_violations),
                    "backcheck_required": bool(s.backcheck_required),
                    "consent_given": s.consent_given,
                    "local_created_at": s.local_created_at.isoformat() if s.local_created_at else None,
                    "server_received_at": s.server_received_at.isoformat() if s.server_received_at else None,
                }
                for s, name in rows
            ],
            "total": total,
            "page": page,
            "page_size": page_size,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Error listing submissions")
        raise HTTPException(status_code=500, detail=f"Failed to list submissions: {type(e).__name__}: {str(e)}")


# ── Submissions summary — accurate stats, no row fetching ────────────────────

@router.get("/summary")
def get_submissions_summary(
    form_id: Optional[str] = None,
    program_id: Optional[str] = None,
    status: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    user=Depends(require_supervisor),
    db: Session = Depends(get_db),
):
    from sqlalchemy import func, case, cast, Boolean
    from sqlalchemy.dialects.postgresql import JSONB

    base = db.query(Submission).filter(Submission.tenant_id == user["tenant_id"])
    if form_id:
        base = base.filter(Submission.form_id == form_id)
    if program_id:
        import uuid as _uuid
        base = base.filter(Submission.program_id == _uuid.UUID(program_id))
    if status:
        base = base.filter(Submission.status == status)
    if date_from:
        base = base.filter(Submission.server_received_at >= datetime.fromisoformat(date_from))
    if date_to:
        end = datetime.fromisoformat(date_to).replace(hour=23, minute=59, second=59)
        base = base.filter(Submission.server_received_at <= end)

    # Single aggregation query — no rows fetched
    agg = base.with_entities(
        func.count().label("total"),
        func.sum(case((Submission.status == "approved",  1), else_=0)).label("approved"),
        func.sum(case((Submission.status == "flagged",   1), else_=0)).label("flagged"),
        func.sum(case((Submission.status == "synced",    1), else_=0)).label("synced"),
        func.sum(case((Submission.has_violations == True, 1), else_=0)).label("violations"),
        func.sum(case((Submission.backcheck_required == True, 1), else_=0)).label("backcheck_required"),
    ).one()

    # Duplicate suspects — count via JSONB operator (uses index if present)
    dup_count = base.filter(
        Submission.data_json["_duplicate_suspect"].astext == "true"
    ).count()

    # By-status breakdown
    status_rows = base.with_entities(
        Submission.status, func.count().label("cnt")
    ).group_by(Submission.status).all()
    by_status = {r.status: r.cnt for r in status_rows}

    # By-form breakdown (join for title)
    form_rows = base.with_entities(
        Submission.form_id, Form.title, func.count().label("cnt")
    ).outerjoin(Form, Submission.form_id == Form.id).group_by(
        Submission.form_id, Form.title
    ).all()
    by_form = [{"form_id": str(r.form_id), "form_title": r.title or "", "count": r.cnt}
               for r in form_rows]

    # By-enumerator breakdown
    enum_rows = base.with_entities(
        Submission.enumerator_id, User.name, func.count().label("cnt")
    ).outerjoin(User, Submission.enumerator_id == User.id).group_by(
        Submission.enumerator_id, User.name
    ).order_by(func.count().desc()).all()
    by_enumerator = [{"enumerator_id": str(r.enumerator_id) if r.enumerator_id else None,
                      "name": r.name or "Unknown", "count": r.cnt}
                     for r in enum_rows]

    # By-date (daily counts, last 60 days)
    date_rows = base.with_entities(
        func.date_trunc("day", Submission.server_received_at).label("day"),
        func.count().label("cnt")
    ).group_by("day").order_by("day").all()
    by_date = [{"date": r.day.strftime("%Y-%m-%d"), "count": r.cnt}
               for r in date_rows if r.day]

    return {
        "total": agg.total or 0,
        "approved": agg.approved or 0,
        "flagged": agg.flagged or 0,
        "synced": agg.synced or 0,
        "violations": agg.violations or 0,
        "backcheck_required": agg.backcheck_required or 0,
        "duplicate_suspects": dup_count,
        "by_status": by_status,
        "by_form": by_form,
        "by_enumerator": by_enumerator,
        "by_date": by_date,
    }


# ── Map points — GPS locations of all submissions ────────────────────────────

@router.get("/map-points")
def get_map_points(
    form_id: Optional[str] = None,
    user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return GPS coordinates of all submissions for map visualisation (supervisor+)."""
    role = user.get("role", "")
    if role not in ("org_admin", "supervisor", "master_admin"):
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    try:
        q = (
            db.query(Submission, User.name, Form.title)
            .outerjoin(User, Submission.enumerator_id == User.id)
            .outerjoin(Form, Submission.form_id == Form.id)
            .filter(
                Submission.tenant_id == user["tenant_id"],
                Submission.gps_submit.isnot(None),
            )
        )
        if form_id:
            q = q.filter(Submission.form_id == form_id)
        rows = q.order_by(Submission.server_received_at.desc()).limit(3000).all()
        points = []
        for s, ename, ftitle in rows:
            gps = s.gps_submit or {}
            lat, lng = gps.get("lat"), gps.get("lng")
            if lat is None or lng is None:
                continue
            points.append({
                "id": str(s.id),
                "lat": lat,
                "lng": lng,
                "status": s.status,
                "enumerator_name": ename or "Unknown",
                "form_title": ftitle or "Unknown",
                "collected_at": s.local_created_at.isoformat() if s.local_created_at else None,
            })
        return points
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Error fetching map points")
        raise HTTPException(status_code=500, detail=str(e))


# ── Map summary — GPS stats without fetching rows ────────────────────────────

@router.get("/map-summary")
def get_map_summary(
    form_id: Optional[str] = None,
    program_id: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    user=Depends(require_supervisor),
    db: Session = Depends(get_db),
):
    from sqlalchemy import func, case
    try:
        base = db.query(Submission).filter(Submission.tenant_id == user["tenant_id"])
        if form_id:
            base = base.filter(Submission.form_id == form_id)
        if program_id:
            import uuid as _uuid2
            base = base.filter(Submission.program_id == _uuid2.UUID(program_id))
        if date_from:
            base = base.filter(Submission.server_received_at >= datetime.fromisoformat(date_from))
        if date_to:
            end = datetime.fromisoformat(date_to).replace(hour=23, minute=59, second=59)
            base = base.filter(Submission.server_received_at <= end)

        total = base.count()
        total_with_gps = base.filter(Submission.gps_submit.isnot(None)).count()

        # GPS bounds — aggregate from filtered base (no row fetch)
        from sqlalchemy import text as _text
        bounds_agg = (
            base.filter(Submission.gps_submit.isnot(None))
            .with_entities(
                func.min(Submission.server_received_at).label("first_date"),
                func.max(Submission.server_received_at).label("last_date"),
            )
            .one()
        )
        # lat/lng bounds via raw cast (SQLAlchemy JSONB cast to float in aggregate)
        bounds_row = db.execute(
            _text("""
                SELECT
                  MIN((gps_submit->>'lat')::float) AS lat_min,
                  MAX((gps_submit->>'lat')::float) AS lat_max,
                  MIN((gps_submit->>'lng')::float) AS lng_min,
                  MAX((gps_submit->>'lng')::float) AS lng_max
                FROM submissions
                WHERE tenant_id = :tid AND gps_submit IS NOT NULL
            """), {"tid": str(user["tenant_id"])}
        ).fetchone()

        # By-form breakdown (GPS only)
        form_rows = (
            base.filter(Submission.gps_submit.isnot(None))
            .with_entities(Submission.form_id, Form.title, func.count().label("cnt"))
            .outerjoin(Form, Submission.form_id == Form.id)
            .group_by(Submission.form_id, Form.title)
            .all()
        )
        forms = [{"form_id": str(r.form_id), "title": r.title or "", "gps_count": r.cnt}
                 for r in form_rows]

        # By-enumerator breakdown (GPS only)
        enum_rows = (
            base.filter(Submission.gps_submit.isnot(None))
            .with_entities(User.name, func.count().label("cnt"))
            .outerjoin(User, Submission.enumerator_id == User.id)
            .group_by(User.name)
            .order_by(func.count().desc())
            .all()
        )
        enumerators = [{"name": r.name or "Unknown", "gps_count": r.cnt} for r in enum_rows]

        bounds = None
        if bounds_row and bounds_row.lat_min is not None:
            bounds = {
                "lat_min": bounds_row.lat_min,
                "lat_max": bounds_row.lat_max,
                "lng_min": bounds_row.lng_min,
                "lng_max": bounds_row.lng_max,
            }

        return {
            "total_submissions": total,
            "total_with_gps": total_with_gps,
            "forms": forms,
            "enumerators": enumerators,
            "date_range": {
                "first": bounds_agg.first_date.strftime("%Y-%m-%d") if bounds_agg.first_date else None,
                "last": bounds_agg.last_date.strftime("%Y-%m-%d") if bounds_agg.last_date else None,
            },
            "bounds": bounds,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Error fetching map summary")
        raise HTTPException(status_code=500, detail=f"Map summary failed: {str(e)}")


# ── Enumerator performance stats ─────────────────────────────────────────────

@router.get("/enumerator-stats")
def get_enumerator_stats(
    form_id: Optional[str] = None,
    user=Depends(require_supervisor),
    db: Session = Depends(get_db),
):
    """Per-enumerator submission counts broken down by status."""
    from sqlalchemy import func
    try:
        q = (
            db.query(
                Submission.enumerator_id,
                User.name,
                User.phone,
                Submission.status,
                func.count(Submission.id).label("cnt"),
                func.max(Submission.server_received_at).label("last_at"),
            )
            .outerjoin(User, Submission.enumerator_id == User.id)
            .filter(Submission.tenant_id == user["tenant_id"])
        )
        if form_id:
            q = q.filter(Submission.form_id == form_id)
        q = q.group_by(Submission.enumerator_id, User.name, User.phone, Submission.status)
        rows = q.all()

        stats: dict = {}
        for row in rows:
            eid = str(row.enumerator_id) if row.enumerator_id else "unknown"
            if eid not in stats:
                stats[eid] = {
                    "enumerator_id": eid,
                    "name": row.name or row.phone or "Unknown",
                    "total": 0,
                    "synced": 0, "approved": 0, "flagged": 0, "rejected": 0,
                    "last_submission": None,
                }
            stats[eid]["total"] += row.cnt
            stats[eid][row.status] = stats[eid].get(row.status, 0) + row.cnt
            last = row.last_at.isoformat() if row.last_at else None
            if last and (stats[eid]["last_submission"] is None or last > stats[eid]["last_submission"]):
                stats[eid]["last_submission"] = last

        return sorted(stats.values(), key=lambda x: -x["total"])
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Error fetching enumerator stats")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/enumerator-scorecard")
def get_enumerator_scorecard(
    form_id: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    user=Depends(require_supervisor),
    db: Session = Depends(get_db),
):
    """Per-enumerator performance scorecard: submissions/day, accuracy rate, backcheck pass rate."""
    from sqlalchemy import func, case
    try:
        q = (
            db.query(
                Submission.enumerator_id,
                User.name,
                User.phone,
                func.count(Submission.id).label("total"),
                func.sum(case((Submission.status == "approved", 1), else_=0)).label("approved"),
                func.sum(case((Submission.status == "flagged", 1), else_=0)).label("flagged"),
                func.sum(case((Submission.status == "rejected", 1), else_=0)).label("rejected"),
                func.sum(case((Submission.has_violations == True, 1), else_=0)).label("violations"),
                func.sum(case((Submission.backcheck_required == True, 1), else_=0)).label("bc_required"),
                func.sum(case((Submission.backcheck_completed == True, 1), else_=0)).label("bc_completed"),
                func.min(Submission.server_received_at).label("first_at"),
                func.max(Submission.server_received_at).label("last_at"),
            )
            .outerjoin(User, Submission.enumerator_id == User.id)
            .filter(Submission.tenant_id == user["tenant_id"])
        )
        if form_id:
            q = q.filter(Submission.form_id == form_id)
        if date_from:
            q = q.filter(Submission.server_received_at >= date_from)
        if date_to:
            q = q.filter(Submission.server_received_at <= date_to)
        q = q.group_by(Submission.enumerator_id, User.name, User.phone)
        rows = q.all()

        result = []
        for r in rows:
            total = r.total or 0
            approved = int(r.approved or 0)
            flagged = int(r.flagged or 0)
            rejected = int(r.rejected or 0)
            reviewed = approved + flagged + rejected
            accuracy_rate = round(approved / reviewed * 100, 1) if reviewed > 0 else None

            bc_required = int(r.bc_required or 0)
            bc_completed = int(r.bc_completed or 0)
            backcheck_pass_rate = round(bc_completed / bc_required * 100, 1) if bc_required > 0 else None

            if r.first_at and r.last_at:
                days = max(1, (r.last_at - r.first_at).days + 1)
            else:
                days = 1
            submissions_per_day = round(total / days, 1)

            result.append({
                "enumerator_id": str(r.enumerator_id) if r.enumerator_id else "unknown",
                "name": r.name or r.phone or "Unknown",
                "total": total,
                "approved": approved,
                "flagged": flagged,
                "rejected": rejected,
                "violations": int(r.violations or 0),
                "backcheck_required": bc_required,
                "backcheck_completed": bc_completed,
                "accuracy_rate": accuracy_rate,
                "backcheck_pass_rate": backcheck_pass_rate,
                "submissions_per_day": submissions_per_day,
                "first_submission": r.first_at.isoformat() if r.first_at else None,
                "last_submission": r.last_at.isoformat() if r.last_at else None,
            })

        return sorted(result, key=lambda x: -x["total"])
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Error fetching enumerator scorecard")
        raise HTTPException(status_code=500, detail=str(e))


# ── Potential duplicates ──────────────────────────────────────────────────────

@router.get("/potential-duplicates")
def list_potential_duplicates(
    form_id: Optional[str] = None,
    user=Depends(require_supervisor),
    db: Session = Depends(get_db),
):
    """Return groups of submissions that appear to be duplicates.

    A 'potential duplicate' is any submission where the same enumerator
    submitted the same form more than once on the same calendar day.
    """
    from sqlalchemy import func, cast, Date

    q = (
        db.query(
            Submission.enumerator_id,
            Submission.form_id,
            cast(Submission.local_created_at, Date).label("day"),
            func.count(Submission.id).label("cnt"),
            func.array_agg(Submission.id).label("ids"),
        )
        .filter(Submission.tenant_id == user["tenant_id"])
    )
    if form_id:
        q = q.filter(Submission.form_id == form_id)

    q = (
        q.group_by(
            Submission.enumerator_id,
            Submission.form_id,
            cast(Submission.local_created_at, Date),
        )
        .having(func.count(Submission.id) > 1)
        .order_by(func.count(Submission.id).desc())
        .limit(200)
    )

    rows = q.all()

    user_map = {
        str(u.id): u.name or u.phone
        for u in db.query(User).filter(User.tenant_id == user["tenant_id"]).all()
    }
    form_map = {
        str(f.id): f.title
        for f in db.query(Form).filter(Form.tenant_id == user["tenant_id"]).all()
    }

    return [
        {
            "enumerator_id": str(row.enumerator_id) if row.enumerator_id else None,
            "enumerator_name": user_map.get(str(row.enumerator_id), "Unknown"),
            "form_id": str(row.form_id),
            "form_title": form_map.get(str(row.form_id), "Unknown"),
            "day": str(row.day),
            "count": row.cnt,
            "submission_ids": [str(sid) for sid in (row.ids or [])],
        }
        for row in rows
    ]


# ── Create submission ─────────────────────────────────────────────────────────

@router.post("/", status_code=201)
@limiter.limit("60/minute")
def create_submission(request: Request, body: SubmissionCreate, background_tasks: BackgroundTasks, user=Depends(require_enumerator), db: Session = Depends(get_db)):
    if user.get("role") != "master_admin":
        from app.api.routes.billing import check_submission_limit
        check_submission_limit(user["tenant_id"], db)

    try:
        sub = Submission(
            tenant_id=user["tenant_id"],
            form_id=body.form_id,
            form_version=body.form_version,
            enumerator_id=user.get("sub"),
            data_json=body.data_json,
            gps_open=body.gps_open,
            gps_submit=body.gps_submit,
            local_created_at=datetime.fromisoformat(body.local_created_at) if body.local_created_at else None,
        )
        db.add(sub)
        db.commit()
        db.refresh(sub)
        webhook_payload = {
            "submission_id": str(sub.id),
            "form_id": str(sub.form_id),
            "enumerator_id": str(sub.enumerator_id),
            "data_json": sub.data_json,
            "status": sub.status,
        }
        background_tasks.add_task(_fire_webhook_bg, str(user["tenant_id"]), "submission.created", webhook_payload, str(sub.id))
        return {"id": str(sub.id), "status": sub.status}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.exception("Error creating submission")
        raise HTTPException(status_code=500, detail=f"Failed to create submission: {type(e).__name__}: {str(e)}")


# ── Bulk status update ────────────────────────────────────────────────────────

@router.post("/bulk")
def bulk_update_submissions(
    body: BulkUpdateBody,
    user=Depends(require_supervisor),
    db: Session = Depends(get_db),
):
    """Bulk approve / reject / flag a set of submissions by ID."""
    if body.status not in VALID_STATUSES:
        raise HTTPException(status_code=422, detail=f"Invalid status. Must be one of: {', '.join(sorted(VALID_STATUSES))}")
    if not body.ids:
        raise HTTPException(status_code=422, detail="ids list must not be empty")
    if len(body.ids) > 200:
        raise HTTPException(status_code=422, detail="Maximum 200 IDs per bulk operation")

    subs = db.query(Submission).filter(
        Submission.id.in_(body.ids),
        Submission.tenant_id == user["tenant_id"],
    ).all()

    reviewer = user.get("name") or user.get("sub", "reviewer")
    updated = 0
    history_entries = []

    for sub in subs:
        old_status = sub.status
        if old_status == body.status:
            continue
        sub.status = body.status
        if body.status == "approved":
            sub.flag_note = f"Approved by {reviewer}"
        elif body.status == "rejected":
            reason = body.flag_note or "No reason provided"
            sub.flag_note = f"Rejected by {reviewer}: {reason}"
        elif body.flag_note is not None:
            sub.flag_note = body.flag_note

        history_entries.append(SubmissionHistory(
            submission_id=sub.id,
            changed_by=user.get("sub"),
            action=body.status,
            old_data={"status": old_status},
            new_data={"status": sub.status, "flag_note": sub.flag_note},
            note=f"Bulk action by {reviewer}",
        ))
        updated += 1

    db.add_all(history_entries)
    db.commit()

    skipped = len(body.ids) - len(subs)
    logger.info("Bulk %s: updated=%d skipped=%d by %s", body.status, updated, skipped, reviewer)
    return {"updated": updated, "skipped": skipped}


# ── Named sub-routes — must be before /{submission_id} to avoid being captured ─

@router.get("/my-backchecks")
def get_my_backchecks(user=Depends(require_enumerator), db: Session = Depends(get_db)):
    """Enumerator: list submissions assigned to me that need back-checking."""
    rows = db.query(Submission).filter(
        Submission.tenant_id == user["tenant_id"],
        Submission.enumerator_id == user["sub"],
        Submission.backcheck_required == True,
        Submission.backcheck_form_id != None,
        Submission.backcheck_completed != True,
    ).order_by(Submission.server_received_at.desc()).limit(50).all()

    result = []
    for s in rows:
        from app.models.form import Form as FormModel
        bc_form = db.query(FormModel).filter(FormModel.id == s.backcheck_form_id).first()
        result.append({
            "original_submission_id": str(s.id),
            "form_title": s.form_title if hasattr(s, "form_title") else None,
            "submitted_at": s.server_received_at.isoformat() if s.server_received_at else None,
            "backcheck_form_id": str(s.backcheck_form_id),
            "backcheck_form_title": bc_form.title if bc_form else "Back-check Form",
            "data_json": s.data_json,
        })
    return result


@router.get("/map-data")
def get_map_data(
    form_id: Optional[str] = Query(None),
    enumerator_id: Optional[str] = Query(None),
    days: int = Query(30, ge=0, le=3650),
    user: dict = Depends(require_supervisor),
    db: Session = Depends(get_db),
):
    """GPS pins for the live field map. Returns last N days of submissions with GPS. days=0 means all time."""
    from datetime import datetime, timezone, timedelta
    from app.models.form import Form
    from app.models.user import User as UserModel
    from app.models.roster import RespondentRoster

    q = db.query(Submission, RespondentRoster.name.label("roster_name")).outerjoin(
        RespondentRoster, Submission.roster_id == RespondentRoster.id
    ).filter(
        Submission.tenant_id == user["tenant_id"],
        Submission.gps_submit.isnot(None),
    )
    if days > 0:
        cutoff = datetime.now(timezone.utc) - timedelta(days=days)
        q = q.filter(Submission.server_received_at >= cutoff)
    if form_id:
        q = q.filter(Submission.form_id == form_id)
    if enumerator_id:
        q = q.filter(Submission.enumerator_id == enumerator_id)

    rows = q.order_by(Submission.server_received_at.desc()).limit(2000).all()

    enum_map = {str(u.id): u.name for u in db.query(UserModel).filter(UserModel.tenant_id == user["tenant_id"]).all()}
    form_map = {str(f.id): f.title for f in db.query(Form).filter(Form.tenant_id == user["tenant_id"]).all()}

    _BENEFICIARY_KEYS = ("beneficiary_name", "name", "respondent_name", "farmer_name",
                         "household_head", "participant_name", "applicant_name")

    def _beneficiary_name(s: Submission, roster_name: Optional[str]) -> Optional[str]:
        if roster_name:
            return roster_name
        dj = s.data_json or {}
        for k in _BENEFICIARY_KEYS:
            v = dj.get(k)
            if v and isinstance(v, str):
                return v
        return None

    return [{
        "id": str(s.id),
        "lat": (s.gps_submit or {}).get("lat"),
        "lng": (s.gps_submit or {}).get("lng"),
        "accuracy": (s.gps_submit or {}).get("accuracy"),
        "status": s.status,
        "enumerator": enum_map.get(str(s.enumerator_id), "Unknown"),
        "form": form_map.get(str(s.form_id), "Unknown"),
        "form_id": str(s.form_id),
        "received": s.server_received_at.isoformat() if s.server_received_at else None,
        "beneficiary_name": _beneficiary_name(s, roster_name),
    } for s, roster_name in rows if (s.gps_submit or {}).get("lat")]


# ── Get single submission ─────────────────────────────────────────────────────

@router.get("/{submission_id}")
def get_submission(submission_id: str, user=Depends(get_current_user), db: Session = Depends(get_db)):
    role = user.get("role", "")
    if role not in ("org_admin", "supervisor", "enumerator", "master_admin"):
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    try:
        row = db.query(Submission, User.name).outerjoin(
            User, Submission.enumerator_id == User.id
        ).filter(
            Submission.id == submission_id, Submission.tenant_id == user["tenant_id"]
        ).first()
        if not row:
            raise HTTPException(status_code=404, detail="Submission not found")
        sub, enumerator_name = row
        if role == "enumerator" and str(sub.enumerator_id) != str(user["sub"]):
            raise HTTPException(status_code=403, detail="You can only view your own submissions")
        # Attach uploaded media (photos, audio, audio audits) with servable URLs
        from app.models.media_file import MediaFile
        media = [
            {
                "field_name": m.field_name,
                "file_type": m.file_type,
                "mime_type": m.mime_type,
                "url": m.cloud_url,
                "size_bytes": m.file_size_bytes,
            }
            for m in db.query(MediaFile).filter(MediaFile.submission_id == sub.id).all()
        ]
        return {
            "id": str(sub.id),
            "form_id": str(sub.form_id),
            "enumerator_id": str(sub.enumerator_id) if sub.enumerator_id else None,
            "enumerator_name": enumerator_name or "Unknown",
            "form_version": sub.form_version,
            "serial_no": sub.serial_no,
            "data_json": sub.data_json,
            "gps_open": sub.gps_open,
            "gps_submit": sub.gps_submit,
            "status": sub.status,
            "flag_note": sub.flag_note,
            "backcheck_required": bool(sub.backcheck_required),
            "backcheck_form_id": str(sub.backcheck_form_id) if sub.backcheck_form_id else None,
            "local_created_at": sub.local_created_at.isoformat() if sub.local_created_at else None,
            "server_received_at": sub.server_received_at.isoformat() if sub.server_received_at else None,
            "media": media,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Error fetching submission %s", submission_id)
        raise HTTPException(status_code=500, detail=f"Failed to fetch submission: {type(e).__name__}: {str(e)}")


# ── Flag / approve / reject ───────────────────────────────────────────────────

@router.patch("/{submission_id}")
def update_submission(submission_id: str, body: SubmissionUpdate, user=Depends(require_supervisor), db: Session = Depends(get_db)):
    try:
        sub = db.query(Submission).filter(
            Submission.id == submission_id, Submission.tenant_id == user["tenant_id"]
        ).first()
        if not sub:
            raise HTTPException(status_code=404, detail="Submission not found")

        old_status = sub.status
        old_flag_note = sub.flag_note

        if body.status is not None:
            sub.status = body.status

        reviewer = body.reviewer_name or user.get("name") or user.get("sub", "reviewer")
        if body.status == "approved":
            sub.flag_note = f"Approved by {reviewer}"
        elif body.status == "rejected":
            reason = body.flag_note or "No reason provided"
            sub.flag_note = f"Rejected by {reviewer}: {reason}"
        elif body.flag_note is not None:
            sub.flag_note = body.flag_note

        if body.status and body.status != old_status:
            action_map = {"flagged": "flagged", "approved": "approved", "rejected": "rejected"}
            action = action_map.get(body.status, "updated")
            history_entry = SubmissionHistory(
                submission_id=sub.id,
                changed_by=user.get("sub"),
                action=action,
                old_data={"status": old_status, "flag_note": old_flag_note},
                new_data={"status": sub.status, "flag_note": sub.flag_note},
                note=sub.flag_note,
            )
            db.add(history_entry)

            if body.status == "flagged":
                try:
                    form = db.query(Form).filter(Form.id == sub.form_id).first()
                    form_title = form.title if form else "Unknown Form"
                    enumerator = db.query(User).filter(User.id == sub.enumerator_id).first()
                    enumerator_name = enumerator.name if enumerator else "Unknown"
                    supervisor_name = user.get("name") or user.get("sub", "Supervisor")
                    supervisors = db.query(User).filter(
                        User.tenant_id == user["tenant_id"],
                        User.role.in_(["org_admin", "supervisor"]),
                        User.is_active == True,
                    ).all()
                    for sup in supervisors:
                        sup_email = getattr(sup, "email", None)
                        if sup_email:
                            send_flagged_submission_email(
                                to=sup_email,
                                supervisor_name=supervisor_name,
                                form_title=form_title,
                                enumerator_name=enumerator_name,
                                flag_note=sub.flag_note,
                                submission_id=str(sub.id),
                            )
                except Exception as email_err:
                    logger.warning("Failed to send flagged-submission emails: %s", email_err)

        db.commit()

        if body.status in ("approved", "rejected") and body.status != old_status and sub.enumerator_id:
            try:
                from app.api.routes.notifications import send_push
                action_label = "approved" if body.status == "approved" else "rejected"
                note_text = (sub.flag_note or "").strip()
                send_push(
                    db, str(sub.enumerator_id),
                    f"Submission {action_label.capitalize()}",
                    f"Your submission was {action_label}.{' ' + note_text if note_text else ''}",
                    url="/collect",
                )
            except Exception:
                logger.warning("Push to enumerator failed for submission %s", sub.id)

        if body.status and body.status != old_status:
            try:
                fire_webhooks(db, user["tenant_id"], f"submission.{sub.status}", {
                    "submission_id": str(sub.id),
                    "form_id": str(sub.form_id),
                    "status": sub.status,
                    "flag_note": sub.flag_note,
                })
            except Exception:
                logger.warning("Webhook fire failed for submission %s status change", sub.id)
            # WhatsApp + Telegram notification on status change
            try:
                tenant = db.query(Tenant).filter(Tenant.id == sub.tenant_id).first()
                form_obj = db.query(Form).filter(Form.id == sub.form_id).first()
                if tenant:
                    notify_params = {
                        "serial_no": sub.serial_no or str(sub.id)[:8],
                        "form_title": form_obj.title if form_obj else str(sub.form_id),
                        "note": sub.flag_note or "",
                    }
                    wa_notify(tenant, f"submission.{sub.status}", notify_params)
                    asyncio.ensure_future(tg_notify(tenant, f"submission.{sub.status}", notify_params))
            except Exception:
                logger.warning("WhatsApp/Telegram notify failed for submission %s", sub.id)

        return {"id": str(sub.id), "status": sub.status, "flag_note": sub.flag_note}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.exception("Error updating submission %s", submission_id)
        raise HTTPException(status_code=500, detail=f"Failed to update submission: {type(e).__name__}: {str(e)}")


# ── Edit submission data ──────────────────────────────────────────────────────

@router.patch("/{submission_id}/data")
def edit_submission_data(
    submission_id: str,
    body: SubmissionDataEdit,
    user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    role = user.get("role", "")
    sub = db.query(Submission).filter(
        Submission.id == submission_id,
        Submission.tenant_id == user["tenant_id"],
    ).first()
    if not sub:
        raise HTTPException(status_code=404, detail="Submission not found")

    if role == "enumerator":
        if str(sub.enumerator_id) != str(user["sub"]):
            raise HTTPException(status_code=403, detail="You can only edit your own submissions")
        # Check override hierarchy: form-level → org-level
        form_override = None
        if sub.form_id:
            form = db.query(Form).filter(Form.id == sub.form_id).first()
            form_override = form.allow_enumerator_edit if form else None
        if form_override is not None:
            if not form_override:
                raise HTTPException(status_code=403, detail="Editing is disabled for this form.")
        else:
            from app.models.tenant import Tenant
            tenant = db.query(Tenant).filter(Tenant.id == user["tenant_id"]).first()
            if tenant and not getattr(tenant, "allow_enumerator_edit", True):
                raise HTTPException(
                    status_code=403,
                    detail="Your administrator has disabled enumerator editing. Contact your supervisor."
                )
    elif role not in ("org_admin", "supervisor", "master_admin"):
        raise HTTPException(status_code=403, detail="Insufficient permissions")

    sub.data_json = body.data_json
    db.commit()
    return {"id": str(sub.id), "status": "updated", "serial_no": sub.serial_no}


# ── Serial number — master_admin only ────────────────────────────────────────

@router.patch("/{submission_id}/serial-no")
def update_serial_no(
    submission_id: str,
    body: SerialNoUpdate,
    user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if user.get("role") != "master_admin":
        raise HTTPException(status_code=403, detail="Only master_admin can change serial numbers")

    sub = db.query(Submission).filter(Submission.id == submission_id).first()
    if not sub:
        raise HTTPException(status_code=404, detail="Submission not found")

    sub.serial_no = body.serial_no
    db.commit()
    return {"id": str(sub.id), "serial_no": sub.serial_no}


# ── Anonymize (DPDP) — master_admin only ─────────────────────────────────────

@router.post("/{submission_id}/anonymize")
def anonymize_submission(
    submission_id: str,
    user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if user.get("role") != "master_admin":
        raise HTTPException(status_code=403, detail="Only master_admin can anonymize submissions")
    sub = db.query(Submission).filter(
        Submission.id == submission_id, Submission.tenant_id == user["tenant_id"]
    ).first()
    if not sub:
        raise HTTPException(status_code=404, detail="Submission not found")
    sub.data_json = {"anonymized": True, "anonymized_at": datetime.now(timezone.utc).isoformat()}
    db.commit()
    return {"id": str(sub.id), "status": "anonymized"}


# ── Flag back-check — supervisor+ ────────────────────────────────────────────

@router.post("/{submission_id}/flag-backcheck")
def flag_backcheck(
    submission_id: str,
    user=Depends(require_supervisor),
    db: Session = Depends(get_db),
):
    sub = db.query(Submission).filter(
        Submission.id == submission_id, Submission.tenant_id == user["tenant_id"]
    ).first()
    if not sub:
        raise HTTPException(status_code=404, detail="Submission not found")
    sub.backcheck_required = True
    db.commit()
    return {"id": str(sub.id), "backcheck_required": True}


@router.post("/{submission_id}/complete-backcheck")
def complete_backcheck(
    submission_id: str,
    user=Depends(require_enumerator),
    db: Session = Depends(get_db),
):
    """Mark the original submission as back-check completed after enumerator submits."""
    sub = db.query(Submission).filter(
        Submission.id == submission_id,
        Submission.tenant_id == user["tenant_id"],
        Submission.enumerator_id == user["sub"],
    ).first()
    if not sub:
        raise HTTPException(status_code=404, detail="Submission not found")
    sub.backcheck_completed = True
    db.commit()
    return {"id": str(sub.id), "backcheck_completed": True}


@router.patch("/{submission_id}/backcheck-form")
def assign_backcheck_form(
    submission_id: str,
    body: dict,
    user=Depends(require_supervisor),
    db: Session = Depends(get_db),
):
    """Assign a specific form to use for back-checking this submission."""
    sub = db.query(Submission).filter(
        Submission.id == submission_id, Submission.tenant_id == user["tenant_id"]
    ).first()
    if not sub:
        raise HTTPException(status_code=404, detail="Submission not found")
    form_id = body.get("form_id")
    if form_id:
        form = db.query(Form).filter(
            Form.id == form_id, Form.tenant_id == user["tenant_id"]
        ).first()
        if not form:
            raise HTTPException(status_code=404, detail="Form not found")
    sub.backcheck_form_id = form_id
    sub.backcheck_required = True
    db.commit()
    return {
        "id": str(sub.id),
        "backcheck_required": True,
        "backcheck_form_id": str(sub.backcheck_form_id) if sub.backcheck_form_id else None,
    }
