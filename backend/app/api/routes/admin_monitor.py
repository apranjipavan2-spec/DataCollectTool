"""Cross-tenant monitoring endpoints — master_admin only."""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import func
import uuid as _uuid

from app.core.database import get_db
from app.core.deps import require_master_admin
from app.models.tenant import Tenant
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
