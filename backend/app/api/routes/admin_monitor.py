"""Cross-tenant monitoring endpoints — master_admin only."""
from datetime import datetime, timezone
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
    """Per-tenant summary: programs, targets, collected submissions, user count.
    Uses 5 queries total regardless of tenant count (was 4N)."""
    tenants = db.query(Tenant).order_by(Tenant.name).all()
    if not tenants:
        return []

    tenant_ids = [t.id for t in tenants]

    # All programs for all tenants in one query
    programs = db.query(Program).filter(Program.tenant_id.in_(tenant_ids)).all()
    prog_ids = [p.id for p in programs]

    # All questionnaires for all programs in one query
    quests = (
        db.query(ProgramQuestionnaire)
        .filter(ProgramQuestionnaire.program_id.in_(prog_ids))
        .all()
    ) if prog_ids else []

    # Submission counts keyed by tenant_id — filter to form_ids from questionnaires only
    all_form_ids = list({q.form_id for q in quests if q.form_id})
    quest_form_tenant: dict[str, str] = {
        str(q.form_id): str(q.tenant_id) for q in quests if q.form_id
    }
    sub_by_tenant: dict[str, int] = {}
    if all_form_ids:
        for row in (
            db.query(Submission.tenant_id, func.count(Submission.id).label("cnt"))
            .filter(Submission.form_id.in_(all_form_ids))
            .group_by(Submission.tenant_id)
            .all()
        ):
            sub_by_tenant[str(row.tenant_id)] = row.cnt

    # User counts per tenant in one query
    user_by_tenant: dict[str, int] = {
        str(r.tenant_id): r.cnt
        for r in db.query(User.tenant_id, func.count(User.id).label("cnt"))
        .filter(User.tenant_id.in_(tenant_ids))
        .group_by(User.tenant_id)
        .all()
    }

    # Group programs and questionnaires in Python
    progs_by_tenant: dict[str, list] = {}
    for p in programs:
        progs_by_tenant.setdefault(str(p.tenant_id), []).append(p)

    quests_by_prog: dict[str, list] = {}
    for q in quests:
        quests_by_prog.setdefault(str(q.program_id), []).append(q)

    result = []
    for t in tenants:
        tid = str(t.id)
        t_progs = progs_by_tenant.get(tid, [])
        t_quests = [q for p in t_progs for q in quests_by_prog.get(str(p.id), [])]
        total_target = sum(q.total_target or 0 for q in t_quests)
        result.append({
            "tenant_id": tid,
            "tenant_name": t.name,
            "plan_tier": t.plan_tier,
            "user_count": user_by_tenant.get(tid, 0),
            "program_count": len(t_progs),
            "questionnaire_count": len(t_quests),
            "total_target": total_target,
            "total_collected": sub_by_tenant.get(tid, 0),
            "pct": round(sub_by_tenant.get(tid, 0) / total_target * 100, 1) if total_target else 0,
        })
    return result


@router.get("/programs")
def get_all_programs(
    user=Depends(require_master_admin),
    db: Session = Depends(get_db),
    tenant_id: str = Query(None),
    status: str = Query(None),
):
    """All programs across all tenants with progress stats.
    Uses 3 queries total regardless of program count (was 2N)."""
    stmt = db.query(Program, Tenant).join(Tenant, Tenant.id == Program.tenant_id)
    if tenant_id:
        try:
            stmt = stmt.filter(Program.tenant_id == _uuid.UUID(tenant_id))
        except ValueError:
            pass
    if status:
        stmt = stmt.filter(Program.status == status)
    rows = stmt.order_by(Tenant.name, Program.name).all()

    if not rows:
        return []

    # All questionnaires for all programs in one query
    prog_ids = [prog.id for prog, _ in rows]
    all_quests = (
        db.query(ProgramQuestionnaire)
        .filter(ProgramQuestionnaire.program_id.in_(prog_ids))
        .all()
    )

    quests_by_prog: dict[str, list] = {}
    for q in all_quests:
        quests_by_prog.setdefault(str(q.program_id), []).append(q)

    # Submission counts for all relevant form_ids in one aggregation
    all_form_ids = list({q.form_id for q in all_quests if q.form_id})
    sub_counts: dict[tuple, int] = {}
    if all_form_ids:
        for r in (
            db.query(Submission.tenant_id, Submission.form_id, func.count(Submission.id).label("cnt"))
            .filter(Submission.form_id.in_(all_form_ids))
            .group_by(Submission.tenant_id, Submission.form_id)
            .all()
        ):
            sub_counts[(str(r.tenant_id), str(r.form_id))] = r.cnt

    result = []
    for prog, tenant in rows:
        quests = quests_by_prog.get(str(prog.id), [])
        total_target = sum(q.total_target or 0 for q in quests)
        fids = [q.form_id for q in quests if q.form_id]
        sub_count = sum(sub_counts.get((str(prog.tenant_id), str(fid)), 0) for fid in fids)
        result.append({
            "id": str(prog.id),
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
    """Per-tenant usage summary for master_admin dashboard.
    Uses 6 queries total regardless of tenant count (was 5N)."""
    month_start = datetime.now(timezone.utc).replace(day=1, hour=0, minute=0, second=0, microsecond=0)

    tenants = db.query(Tenant).filter(Tenant.name != "Platform").order_by(Tenant.created_at.desc()).all()
    if not tenants:
        return {"platform_totals": {"tenants": 0, "submissions_this_month": 0, "total_submissions": 0, "total_users": 0}, "tenants": []}

    tenant_ids = [t.id for t in tenants]

    total_subs: dict[str, int] = {
        str(r.tenant_id): r.cnt
        for r in db.query(Submission.tenant_id, func.count(Submission.id).label("cnt"))
        .filter(Submission.tenant_id.in_(tenant_ids))
        .group_by(Submission.tenant_id).all()
    }
    month_subs: dict[str, int] = {
        str(r.tenant_id): r.cnt
        for r in db.query(Submission.tenant_id, func.count(Submission.id).label("cnt"))
        .filter(Submission.tenant_id.in_(tenant_ids), Submission.server_received_at >= month_start)
        .group_by(Submission.tenant_id).all()
    }
    total_users: dict[str, int] = {
        str(r.tenant_id): r.cnt
        for r in db.query(User.tenant_id, func.count(User.id).label("cnt"))
        .filter(User.tenant_id.in_(tenant_ids), User.is_active == True)
        .group_by(User.tenant_id).all()
    }
    total_forms: dict[str, int] = {
        str(r.tenant_id): r.cnt
        for r in db.query(Form.tenant_id, func.count(Form.id).label("cnt"))
        .filter(Form.tenant_id.in_(tenant_ids))
        .group_by(Form.tenant_id).all()
    }
    last_sub: dict[str, datetime | None] = {
        str(r.tenant_id): r.last
        for r in db.query(Submission.tenant_id, func.max(Submission.server_received_at).label("last"))
        .filter(Submission.tenant_id.in_(tenant_ids))
        .group_by(Submission.tenant_id).all()
    }

    platform_totals = {
        "tenants": len(tenants),
        "submissions_this_month": sum(month_subs.values()),
        "total_submissions": sum(total_subs.values()),
        "total_users": sum(total_users.values()),
    }

    result = []
    for t in tenants:
        tid = str(t.id)
        ls = last_sub.get(tid)
        result.append({
            "tenant_id": tid,
            "tenant_name": t.name,
            "plan": getattr(t, "plan", "starter"),
            "total_submissions": total_subs.get(tid, 0),
            "submissions_this_month": month_subs.get(tid, 0),
            "total_users": total_users.get(tid, 0),
            "total_forms": total_forms.get(tid, 0),
            "last_activity": ls.isoformat() if ls else None,
            "created_at": t.created_at.isoformat() if t.created_at else None,
        })

    return {"platform_totals": platform_totals, "tenants": result}
