"""Cross-tenant monitoring endpoints — master_admin only."""
from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func
import uuid as _uuid

from app.core.database import get_db
from app.core.deps import require_master_admin
from app.models.tenant import Tenant
from app.models.form import Form
from app.models.program import Program, ProgramQuestionnaire
from app.models.submission import Submission
from app.models.user import User

router = APIRouter(prefix="/admin/monitor", tags=["admin-monitor"])


@router.get("/overview")
def get_overview(
    user=Depends(require_master_admin),
    db: Session = Depends(get_db),
):
    """Per-tenant summary: programs, targets, collected submissions, user count."""
    tenants = db.query(Tenant).order_by(Tenant.name).all()
    result = []
    for t in tenants:
        prog_ids = [
            r[0] for r in db.query(Program.id).filter(Program.tenant_id == t.id).all()
        ]

        quest_count = 0
        total_target = 0
        form_ids: list = []

        if prog_ids:
            quests = db.query(ProgramQuestionnaire).filter(
                ProgramQuestionnaire.program_id.in_(prog_ids)
            ).all()
            quest_count = len(quests)
            total_target = sum(q.total_target or 0 for q in quests)
            form_ids = [q.form_id for q in quests if q.form_id]

        sub_count = 0
        if form_ids:
            sub_count = (
                db.query(func.count(Submission.id))
                .filter(Submission.tenant_id == t.id, Submission.form_id.in_(form_ids))
                .scalar() or 0
            )

        user_count = (
            db.query(func.count(User.id)).filter(User.tenant_id == t.id).scalar() or 0
        )

        result.append({
            "tenant_id": str(t.id),
            "tenant_name": t.name,
            "plan_tier": t.plan_tier,
            "user_count": user_count,
            "program_count": len(prog_ids),
            "questionnaire_count": quest_count,
            "total_target": total_target,
            "total_collected": sub_count,
            "pct": round(sub_count / total_target * 100, 1) if total_target else 0,
        })
    return result


@router.get("/programs")
def get_all_programs(
    user=Depends(require_master_admin),
    db: Session = Depends(get_db),
    tenant_id: str = Query(None),
    status: str = Query(None),
):
    """All programs across all tenants with tenant name and progress stats."""
    stmt = (
        db.query(Program, Tenant)
        .join(Tenant, Tenant.id == Program.tenant_id)
    )
    if tenant_id:
        try:
            stmt = stmt.filter(Program.tenant_id == _uuid.UUID(tenant_id))
        except ValueError:
            pass
    if status:
        stmt = stmt.filter(Program.status == status)
    stmt = stmt.order_by(Tenant.name, Program.name)

    result = []
    for prog, tenant in stmt.all():
        quests = (
            db.query(ProgramQuestionnaire)
            .filter(ProgramQuestionnaire.program_id == prog.id)
            .all()
        )
        total_target = sum(q.total_target or 0 for q in quests)
        fids = [q.form_id for q in quests if q.form_id]
        sub_count = 0
        if fids:
            sub_count = (
                db.query(func.count(Submission.id))
                .filter(Submission.tenant_id == prog.tenant_id, Submission.form_id.in_(fids))
                .scalar() or 0
            )

        result.append({
            "id":  str(prog.id),
            "tenant_id": str(prog.tenant_id),
            "tenant_name": tenant.name,
            "name": prog.name,
            "scheme_name": prog.scheme_name or "",
            "description": prog.description or "",
            "status": prog.status,
            "start_date": prog.start_date.isoformat() if prog.start_date else None,
            "end_date": prog.end_date.isoformat() if prog.end_date else None,
            "questionnaire_count": len(quests),
            "total_target": total_target,
            "total_collected": sub_count,
            "pct": round(sub_count / total_target * 100, 1) if total_target else 0,
        })
    return result

def _resolve_tenant(tenant_id: str, db: Session) -> Tenant:
    try:
        tid = _uuid.UUID(tenant_id)
    except ValueError:
        raise HTTPException(400, "Invalid tenant_id")
    t = db.query(Tenant).filter(Tenant.id == tid).first()
    if not t:
        raise HTTPException(404, "Tenant not found")
    return t


@router.get("/tenant/{tenant_id}/users")
def get_tenant_users(tenant_id: str, user=Depends(require_master_admin), db: Session = Depends(get_db)):
    t = _resolve_tenant(tenant_id, db)
    users = db.query(User).filter(User.tenant_id == t.id, User.is_active == True).order_by(User.name).all()
    return [{"id": str(u.id), "name": u.name or u.phone, "phone": u.phone, "role": u.role, "email": u.email, "created_at": u.created_at.isoformat() if u.created_at else None} for u in users]


@router.get("/tenant/{tenant_id}/submissions")
def get_tenant_submissions(tenant_id: str, page: int = Query(1, ge=1), page_size: int = Query(50, le=200), user=Depends(require_master_admin), db: Session = Depends(get_db)):
    t = _resolve_tenant(tenant_id, db)
    total = db.query(func.count(Submission.id)).filter(Submission.tenant_id == t.id).scalar() or 0
    rows = (db.query(Submission, User, Form).outerjoin(User, User.id == Submission.enumerator_id).outerjoin(Form, Form.id == Submission.form_id).filter(Submission.tenant_id == t.id).order_by(Submission.server_received_at.desc()).offset((page - 1) * page_size).limit(page_size).all())
    return {"total": total, "items": [{"id": str(s.id), "serial_no": s.serial_no, "form_title": f.title if f else str(s.form_id)[:8], "enumerator_name": u.name if u else "Unknown", "status": s.status, "server_received_at": s.server_received_at.isoformat() if s.server_received_at else None} for s, u, f in rows], "page": page, "page_size": page_size}


@router.get("/tenant/{tenant_id}/enumerator-stats")
def get_tenant_enumerator_stats(tenant_id: str, user=Depends(require_master_admin), db: Session = Depends(get_db)):
    t = _resolve_tenant(tenant_id, db)
    rows = (db.query(User.id, User.name, func.count(Submission.id).label("total"), func.sum((Submission.status == "approved").cast("int")).label("approved"), func.sum((Submission.status == "flagged").cast("int")).label("flagged"), func.sum((Submission.status == "rejected").cast("int")).label("rejected"), func.max(Submission.server_received_at).label("last_sub")).join(Submission, Submission.enumerator_id == User.id).filter(User.tenant_id == t.id, Submission.tenant_id == t.id).group_by(User.id, User.name).order_by(func.count(Submission.id).desc()).all())
    return [{"id": str(r.id), "name": r.name or "Unknown", "total": r.total, "approved": int(r.approved or 0), "flagged": int(r.flagged or 0), "rejected": int(r.rejected or 0), "synced": r.total - int(r.approved or 0) - int(r.flagged or 0) - int(r.rejected or 0), "last_submission": r.last_sub.isoformat() if r.last_sub else None} for r in rows]


# ── Platform Usage Dashboard ─────────────────────────────────────────────────

@router.get("/platform-usage")
def platform_usage(user=Depends(require_master_admin), db: Session = Depends(get_db)):
    """Per-tenant usage summary for master_admin dashboard."""
    from datetime import datetime, timezone, timedelta
    from sqlalchemy import text

    month_start = datetime.now(timezone.utc).replace(day=1, hour=0, minute=0, second=0, microsecond=0)

    tenants = db.query(Tenant).filter(Tenant.name != "Platform").order_by(Tenant.created_at.desc()).all()
    result = []
    platform_totals = {"tenants": len(tenants), "submissions_this_month": 0, "total_submissions": 0, "total_users": 0}

    for t in tenants:
        total_subs = db.query(func.count(Submission.id)).filter(Submission.tenant_id == t.id).scalar() or 0
        month_subs = db.query(func.count(Submission.id)).filter(
            Submission.tenant_id == t.id,
            Submission.server_received_at >= month_start,
        ).scalar() or 0
        total_users = db.query(func.count(User.id)).filter(
            User.tenant_id == t.id, User.is_active == True
        ).scalar() or 0
        total_forms = db.query(func.count(Form.id)).filter(Form.tenant_id == t.id).scalar() or 0
        last_sub = db.query(func.max(Submission.server_received_at)).filter(Submission.tenant_id == t.id).scalar()

        platform_totals["submissions_this_month"] += month_subs
        platform_totals["total_submissions"] += total_subs
        platform_totals["total_users"] += total_users

        result.append({
            "tenant_id": str(t.id),
            "tenant_name": t.name,
            "plan": getattr(t, "plan", "starter"),
            "total_submissions": total_subs,
            "submissions_this_month": month_subs,
            "total_users": total_users,
            "total_forms": total_forms,
            "last_activity": last_sub.isoformat() if last_sub else None,
            "created_at": t.created_at.isoformat() if t.created_at else None,
        })

    return {"platform_totals": platform_totals, "tenants": result}
