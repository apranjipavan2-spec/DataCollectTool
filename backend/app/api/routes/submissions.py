from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from typing import Any, Optional
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.core.deps import get_current_user, require_enumerator, require_supervisor
from app.core.rate_limit import limiter
from app.models.submission import Submission
from app.models.submission_history import SubmissionHistory
from app.models.form import Form
from app.models.user import User
from app.services.email import send_flagged_submission_email
from app.services.webhook import fire_webhooks
import logging

logger = logging.getLogger(__name__)
router = APIRouter()


class SubmissionCreate(BaseModel):
    form_id: str
    form_version: int
    data_json: dict[str, Any]
    gps_open: Optional[dict] = None
    gps_submit: Optional[dict] = None
    local_created_at: Optional[str] = None


VALID_STATUSES = {"synced", "flagged", "approved", "rejected"}


class SubmissionUpdate(BaseModel):
    status: Optional[str] = None       # synced | flagged | approved | rejected
    flag_note: Optional[str] = None    # reason for flagging / review info
    reviewer_name: Optional[str] = None  # supervisor name for approve/reject


@router.get("/")
def list_submissions(
    form_id: Optional[str] = None,
    enumerator_id: Optional[str] = None,
    status: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    q: Optional[str] = None,          # full-text search: enumerator name or data_json
    page: int = 1,
    page_size: int = 50,
    user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    role = user.get("role", "")
    if role not in ("org_admin", "supervisor", "enumerator", "master_admin"):
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    try:
        page_size = min(page_size, 200)  # cap at 200
        query = db.query(Submission, User.name).outerjoin(
            User, Submission.enumerator_id == User.id
        ).filter(Submission.tenant_id == user["tenant_id"])
        # Enumerators can only see their own submissions
        if role == "enumerator":
            query = query.filter(Submission.enumerator_id == user["sub"])
        if form_id:
            query = query.filter(Submission.form_id == form_id)
        if enumerator_id and role != "enumerator":
            query = query.filter(Submission.enumerator_id == enumerator_id)
        if status:
            query = query.filter(Submission.status == status)
        if date_from:
            query = query.filter(Submission.server_received_at >= datetime.fromisoformat(date_from))
        if date_to:
            end = datetime.fromisoformat(date_to).replace(hour=23, minute=59, second=59)
            query = query.filter(Submission.server_received_at <= end)
        if q:
            # Case-insensitive search: enumerator name/phone OR data_json cast to text
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
        return {
            "items": [
                {
                    "id": str(s.id),
                    "form_id": str(s.form_id),
                    "enumerator_id": str(s.enumerator_id) if s.enumerator_id else None,
                    "enumerator_name": name or "Unknown",
                    "status": s.status,
                    "serial_no": s.serial_no,
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


@router.post("/", status_code=201)
@limiter.limit("60/minute")
def create_submission(request: Request, body: SubmissionCreate, user=Depends(require_enumerator), db: Session = Depends(get_db)):
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

        # Fire webhooks (never blocks response)
        try:
            fire_webhooks(db, user["tenant_id"], "submission.created", {
                "submission_id": str(sub.id),
                "form_id": str(sub.form_id),
                "enumerator_id": str(sub.enumerator_id),
                "data_json": sub.data_json,
                "status": sub.status,
            })
        except Exception:
            logger.warning("Webhook fire failed for submission %s", sub.id)

        return {"id": str(sub.id), "status": sub.status}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.exception("Error creating submission")
        raise HTTPException(status_code=500, detail=f"Failed to create submission: {type(e).__name__}: {str(e)}")


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
        # Enumerators can only view their own submissions
        if role == "enumerator" and str(sub.enumerator_id) != str(user["sub"]):
            raise HTTPException(status_code=403, detail="You can only view your own submissions")
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
            "local_created_at": sub.local_created_at.isoformat() if sub.local_created_at else None,
            "server_received_at": sub.server_received_at.isoformat() if sub.server_received_at else None,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Error fetching submission %s", submission_id)
        raise HTTPException(status_code=500, detail=f"Failed to fetch submission: {type(e).__name__}: {str(e)}")


@router.patch("/{submission_id}")
def update_submission(submission_id: str, body: SubmissionUpdate, user=Depends(require_supervisor), db: Session = Depends(get_db)):
    """Flag/unflag/approve/reject a submission with optional note."""
    try:
        sub = db.query(Submission).filter(
            Submission.id == submission_id, Submission.tenant_id == user["tenant_id"]
        ).first()
        if not sub:
            raise HTTPException(status_code=404, detail="Submission not found")

        if body.status is not None and body.status not in VALID_STATUSES:
            raise HTTPException(status_code=422, detail=f"Invalid status. Must be one of: {', '.join(sorted(VALID_STATUSES))}")

        old_status = sub.status
        old_flag_note = sub.flag_note

        if body.status is not None:
            sub.status = body.status

        # For approve/reject, store reviewer info in flag_note
        reviewer = body.reviewer_name or user.get("name") or user.get("sub", "reviewer")
        if body.status == "approved":
            sub.flag_note = f"Approved by {reviewer}"
        elif body.status == "rejected":
            reason = body.flag_note or "No reason provided"
            sub.flag_note = f"Rejected by {reviewer}: {reason}"
        elif body.flag_note is not None:
            sub.flag_note = body.flag_note

        # Audit trail
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

            # Email supervisors when a submission is flagged
            if body.status == "flagged":
                try:
                    form = db.query(Form).filter(Form.id == sub.form_id).first()
                    form_title = form.title if form else "Unknown Form"
                    enumerator = db.query(User).filter(User.id == sub.enumerator_id).first()
                    enumerator_name = enumerator.name if enumerator else "Unknown"
                    supervisor_name = user.get("name") or user.get("sub", "Supervisor")

                    # Notify all supervisors / admins in the tenant who have email
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

        # Fire webhooks on status change (never blocks response)
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

        return {"id": str(sub.id), "status": sub.status, "flag_note": sub.flag_note}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.exception("Error updating submission %s", submission_id)
        raise HTTPException(status_code=500, detail=f"Failed to update submission: {type(e).__name__}: {str(e)}")


@router.get("/potential-duplicates")
def list_potential_duplicates(
    form_id: Optional[str] = None,
    user=Depends(require_supervisor),
    db: Session = Depends(get_db),
):
    """Return submission IDs that appear to be duplicates.

    A 'potential duplicate' is any submission where the same enumerator
    submitted the same form more than once on the same calendar day
    (local_created_at date).  Returns up to 200 groups.
    """
    from sqlalchemy import func, cast, Date, text

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

    # Enrich with names
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


class BulkUpdateBody(BaseModel):
    ids: list[str]
    status: str          # approved | rejected | flagged | synced
    flag_note: Optional[str] = None


@router.post("/bulk")
def bulk_update_submissions(
    body: BulkUpdateBody,
    user=Depends(require_supervisor),
    db: Session = Depends(get_db),
):
    """Bulk approve / reject / flag a set of submissions by ID.

    Returns {"updated": int, "skipped": int} — skipped means IDs not owned by
    this tenant or already in the target status.
    """
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
            continue  # already in target state

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

    skipped = len(body.ids) - len(subs)  # IDs that didn't belong to this tenant
    logger.info("Bulk %s: updated=%d skipped=%d by %s", body.status, updated, skipped, reviewer)
    return {"updated": updated, "skipped": skipped}


# ── Edit submission data (enumerator edits own record; admin edits any) ─────

class SubmissionDataEdit(BaseModel):
    data_json: dict[str, Any]


@router.patch("/{submission_id}/data")
def edit_submission_data(
    submission_id: str,
    body: SubmissionDataEdit,
    user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Edit the data_json of an existing submission.

    - Enumerators can only edit their own submissions, and only when the
      tenant setting allow_enumerator_edit is True (default).
    - Supervisors, org_admin, and master_admin can always edit any submission
      within their tenant.
    """
    role = user.get("role", "")

    # Fetch the submission
    sub = db.query(Submission).filter(
        Submission.id == submission_id,
        Submission.tenant_id == user["tenant_id"],
    ).first()
    if not sub:
        raise HTTPException(status_code=404, detail="Submission not found")

    if role == "enumerator":
        # Must be their own record
        if str(sub.enumerator_id) != str(user["sub"]):
            raise HTTPException(status_code=403, detail="You can only edit your own submissions")
        # Check tenant permission
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

class SerialNoUpdate(BaseModel):
    serial_no: int


@router.patch("/{submission_id}/serial-no")
def update_serial_no(
    submission_id: str,
    body: SerialNoUpdate,
    user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Update the serial number of a submission — master_admin only."""
    if user.get("role") != "master_admin":
        raise HTTPException(status_code=403, detail="Only master_admin can change serial numbers")

    sub = db.query(Submission).filter(Submission.id == submission_id).first()
    if not sub:
        raise HTTPException(status_code=404, detail="Submission not found")

    sub.serial_no = body.serial_no
    db.commit()
    return {"id": str(sub.id), "serial_no": sub.serial_no}
