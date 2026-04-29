"""Field Govern API — Cleaner, Analyzer, Panel Study, AI Tabulation."""
import io
import logging
import uuid as _uuid
from collections import defaultdict
from datetime import datetime, timezone, timedelta
from typing import Optional
from uuid import UUID

logger = logging.getLogger(__name__)

import pandas as pd
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import func, text
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import require_role
from app.api.routes.export import _flatten, _build_enumerator_map
from app.models.form import Form
from app.models.program import Program, ProgramQuestionnaire, ProgramAnalysis
from app.models.submission import Submission
from app.models.tenant import Tenant
from app.models.user import User
from app.models.system_setting import SystemSetting
from app.services import ai_service


def _get_global_ai_cfg(db: Session) -> dict:
    row = db.query(SystemSetting).filter(SystemSetting.key == "ai_config").first()
    return row.value if row else {}

router = APIRouter()
require_supervisor = require_role("org_admin", "supervisor")
require_org_admin  = require_role("org_admin")


# ── Schemas ──────────────────────────────────────────────────────────────────

class WaveIn(BaseModel):
    questionnaire_id: str
    wave_number: int
    wave_label: str
    panel_key: Optional[str] = None


class TabulateRequest(BaseModel):
    column_headers: list
    sample_rows: list = []
    user_prompt: str = ""
    research_type: str = "field_survey"


class TabulateExecuteRequest(BaseModel):
    groupby_field: str
    value_field: str
    aggregation: str = "count"        # count | sum | mean
    form_ids: Optional[list] = None
    chart_type: str = "bar"           # bar | line | pie
    title: str = ""
    show_percent: bool = False
    secondary_groupby: str = ""


class TabulateCsvRequest(BaseModel):
    rows: list
    groupby_field: str
    value_field: str = "*"
    aggregation: str = "count"
    chart_type: str = "bar"
    title: str = ""
    show_percent: bool = False
    secondary_groupby: str = ""


class WriterRequest(BaseModel):
    style: str = "field_survey"
    date_range: str = ""
    custom_context: str = ""
    tabulation_data: str = ""


class RestoreRequest(BaseModel):
    analysis_id: str


class FeedbackRequest(BaseModel):
    vote: Optional[str] = None  # 'up' | 'down' | null


class PolishRequest(BaseModel):
    title: str
    groupby_field: str
    value_field: str = "*"
    aggregation: str = "count"
    rows: list = []
    is_cross_tab: bool = False
    sub_keys: list = []


class InterpretRequest(BaseModel):
    title: str
    subtitle: str = ""
    groupby_field: str
    value_field: str = "*"
    aggregation: str = "count"
    rows: list = []
    is_cross_tab: bool = False
    sub_keys: list = []
    show_percent: bool = False
    column_labels: dict = {}
    focus_prompt: str = ""
    extra_context: str = ""


# ── Program Wave CRUD ─────────────────────────────────────────────────────────

@router.get("/programs/{program_id}/waves")
def get_waves(program_id: str, user: dict = Depends(require_supervisor), db: Session = Depends(get_db)):
    prog = db.query(Program).filter(
        Program.id == program_id, Program.tenant_id == user["tenant_id"]
    ).first()
    if not prog:
        raise HTTPException(404, "Program not found")
    qs = db.query(ProgramQuestionnaire).filter(
        ProgramQuestionnaire.program_id == program_id,
        ProgramQuestionnaire.tenant_id == user["tenant_id"],
    ).order_by(ProgramQuestionnaire.wave_number).all()
    return [
        {
            "questionnaire_id": str(q.id),
            "name": q.name,
            "wave_number": q.wave_number,
            "wave_label": q.wave_label,
            "panel_key": q.panel_key,
            "form_id": str(q.form_id) if q.form_id else None,
        }
        for q in qs
    ]


@router.patch("/programs/{program_id}/panel-study")
def toggle_panel_study(program_id: str, body: dict, user: dict = Depends(require_org_admin), db: Session = Depends(get_db)):
    prog = db.query(Program).filter(
        Program.id == program_id, Program.tenant_id == user["tenant_id"]
    ).first()
    if not prog:
        raise HTTPException(404, "Program not found")
    prog.is_panel_study = body.get("is_panel_study", False)
    db.commit()
    return {"ok": True}


@router.put("/programs/{program_id}/waves")
def set_wave(program_id: str, body: WaveIn, user: dict = Depends(require_org_admin), db: Session = Depends(get_db)):
    q = db.query(ProgramQuestionnaire).filter(
        ProgramQuestionnaire.id == body.questionnaire_id,
        ProgramQuestionnaire.program_id == program_id,
        ProgramQuestionnaire.tenant_id == user["tenant_id"],
    ).first()
    if not q:
        raise HTTPException(404, "Questionnaire not found")
    q.wave_number = body.wave_number
    q.wave_label = body.wave_label
    q.panel_key = body.panel_key
    db.commit()
    return {"ok": True}


@router.delete("/programs/{program_id}/waves/{questionnaire_id}")
def clear_wave(program_id: str, questionnaire_id: str, user: dict = Depends(require_org_admin), db: Session = Depends(get_db)):
    q = db.query(ProgramQuestionnaire).filter(
        ProgramQuestionnaire.id == questionnaire_id,
        ProgramQuestionnaire.program_id == program_id,
        ProgramQuestionnaire.tenant_id == user["tenant_id"],
    ).first()
    if not q:
        raise HTTPException(404, "Questionnaire not found")
    q.wave_number = None
    q.wave_label = None
    q.panel_key = None
    db.commit()
    return {"ok": True}


# ── Attrition Report ──────────────────────────────────────────────────────────

@router.get("/programs/{program_id}/attrition")
def attrition_report(program_id: str, user: dict = Depends(require_supervisor), db: Session = Depends(get_db)):
    prog = db.query(Program).filter(
        Program.id == program_id, Program.tenant_id == user["tenant_id"]
    ).first()
    if not prog:
        raise HTTPException(404, "Program not found")
    if not prog.is_panel_study:
        return {"is_panel_study": False, "waves": []}

    waves = db.query(ProgramQuestionnaire).filter(
        ProgramQuestionnaire.program_id == program_id,
        ProgramQuestionnaire.tenant_id == user["tenant_id"],
        ProgramQuestionnaire.wave_number.isnot(None),
    ).order_by(ProgramQuestionnaire.wave_number).all()

    if len(waves) < 2:
        return {"is_panel_study": True, "waves": [], "transitions": []}

    wave_data = []
    for w in waves:
        subs = db.query(Submission).filter(
            Submission.questionnaire_id == w.id,
            Submission.tenant_id == user["tenant_id"],
            Submission.household_id.isnot(None),
        ).all()
        hh_ids = set(s.household_id for s in subs if s.household_id)
        wave_data.append({
            "questionnaire_id": str(w.id),
            "wave_number": w.wave_number,
            "wave_label": w.wave_label or f"Wave {w.wave_number}",
            "total": len(subs),
            "unique_respondents": len(hh_ids),
            "household_ids": hh_ids,
        })

    transitions = []
    for i in range(len(wave_data) - 1):
        w1 = wave_data[i]
        w2 = wave_data[i + 1]
        retained = w1["household_ids"] & w2["household_ids"]
        lost = w1["household_ids"] - w2["household_ids"]
        new_in_w2 = w2["household_ids"] - w1["household_ids"]
        attrition_rate = round(len(lost) / max(len(w1["household_ids"]), 1) * 100, 1)
        transitions.append({
            "from_wave": w1["wave_label"],
            "to_wave": w2["wave_label"],
            "retained": len(retained),
            "lost": len(lost),
            "new_entrants": len(new_in_w2),
            "attrition_rate_pct": attrition_rate,
            "lost_ids": list(lost)[:100],
        })

    result_waves = [
        {k: v for k, v in w.items() if k != "household_ids"}
        for w in wave_data
    ]
    return {
        "is_panel_study": True,
        "program_name": prog.name,
        "waves": result_waves,
        "transitions": transitions,
    }


# ── Analyzer: Program-level data ─────────────────────────────────────────────

@router.get("/programs/{program_id}/analyzer-data")
def get_analyzer_data(
    program_id: str,
    user: dict = Depends(require_supervisor),
    db: Session = Depends(get_db),
):
    try:
        return _get_analyzer_data_inner(program_id, user, db)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Analyzer data error: {e}")


def _get_analyzer_data_inner(program_id, user, db):
    prog = db.query(Program).filter(
        Program.id == program_id, Program.tenant_id == user["tenant_id"]
    ).first()
    if not prog:
        raise HTTPException(404, "Program not found")

    questionnaires = db.query(ProgramQuestionnaire).filter(
        ProgramQuestionnaire.program_id == program_id,
        ProgramQuestionnaire.tenant_id == user["tenant_id"],
    ).all()

    form_ids = [str(q.form_id) for q in questionnaires if q.form_id]
    q_map = {str(q.form_id): q for q in questionnaires if q.form_id}

    # Load submissions — capped at 20k for performance; use aggregate queries for KPIs
    # Submission trend via SQL aggregation (avoids Python loop over all rows)
    trend_rows = db.execute(
        text("""
            SELECT DATE(server_received_at) AS d, COUNT(*) AS cnt
            FROM submissions
            WHERE program_id = :pid AND tenant_id = :tid
            GROUP BY DATE(server_received_at)
            ORDER BY d
        """), {"pid": str(program_id), "tid": str(user["tenant_id"])}
    ).fetchall()
    trend = [{"date": str(r.d), "count": r.cnt} for r in trend_rows]

    # Status breakdown via SQL
    status_rows = db.execute(
        text("""
            SELECT status, COUNT(*) AS cnt
            FROM submissions WHERE program_id = :pid AND tenant_id = :tid
            GROUP BY status
        """), {"pid": str(program_id), "tid": str(user["tenant_id"])}
    ).fetchall()
    status_counts: dict = {r.status: r.cnt for r in status_rows}

    # Load submissions (still needed for column detection — cap at 20k)
    subs = db.query(Submission).filter(
        Submission.program_id == program_id,
        Submission.tenant_id == user["tenant_id"],
    ).order_by(Submission.server_received_at.desc()).limit(20000).all()

    # Enumerator performance — load only relevant users
    enum_map: dict = defaultdict(lambda: {"name": "", "count": 0})
    enum_ids_set = list({str(s.enumerator_id) for s in subs if s.enumerator_id})
    enum_users = {}
    if enum_ids_set:
        for u in db.query(User).filter(User.id.in_([_uuid.UUID(eid) for eid in enum_ids_set])).all():
            enum_users[str(u.id)] = u.name
    for s in subs:
        eid = str(s.enumerator_id)
        enum_map[eid]["name"] = enum_users.get(eid, eid[:8])
        enum_map[eid]["count"] += 1
    enumerators = sorted(enum_map.values(), key=lambda x: -x["count"])

    # Wave breakdown
    wave_counts = []
    for q in sorted(questionnaires, key=lambda x: x.wave_number or 999):
        q_subs = [s for s in subs if s.questionnaire_id == q.id]
        wave_counts.append({
            "name": q.wave_label or q.name,
            "wave_number": q.wave_number,
            "count": len(q_subs),
            "form_id": str(q.form_id) if q.form_id else None,
        })

    # Collect all column headers from all forms in the program
    column_headers = []
    seen_cols: set = set()
    for fid in form_ids:
        form = db.query(Form).filter(Form.id == fid).first()
        if form and form.json_schema:
            for section in form.json_schema.get("sections", []):
                for field in section.get("fields", []):
                    col_id = field.get("id", "")
                    col_label = field.get("label", col_id)
                    col_type = field.get("type", "text")
                    if col_id and col_id not in seen_cols:
                        seen_cols.add(col_id)
                        column_headers.append({
                            "id": col_id,
                            "label": col_label,
                            "type": col_type,
                            "form_id": fid,
                            "options": field.get("options", []),
                        })

    # Quality stats
    total = len(subs)
    flagged = sum(1 for s in subs if s.status == "flagged")
    approved = sum(1 for s in subs if s.status == "approved")
    violations = sum(1 for s in subs if s.has_violations)

    # Sample rows for AI tabulation context (strip internal metadata keys)
    _internal = {"_gps_lat", "_gps_lng", "_gps_accuracy", "_duplicate_suspect", "_validation_violations"}
    sample_rows = [
        {k: v for k, v in s.data_json.items() if k not in _internal}
        for s in subs[:8] if s.data_json and isinstance(s.data_json, dict)
    ]

    return {
        "program_id": program_id,
        "program_name": prog.name,
        "scheme": prog.scheme_name,
        "is_panel_study": prog.is_panel_study or False,
        "total_submissions": total,
        "trend": trend,
        "status_counts": dict(status_counts),
        "enumerators": enumerators[:20],
        "wave_counts": wave_counts,
        "column_headers": column_headers,
        "sample_rows": sample_rows,
        "quality": {
            "total": total,
            "flagged": flagged,
            "approved": approved,
            "violations": violations,
            "quality_score": round((1 - violations / max(total, 1)) * 100, 1),
        },
    }


# ── Program summary — accurate stats, no row fetching ────────────────────────

@router.get("/programs/{program_id}/summary")
def get_program_summary(
    program_id: str,
    user: dict = Depends(require_supervisor),
    db: Session = Depends(get_db),
):
    from sqlalchemy import case as sa_case, func as sa_func

    prog = db.query(Program).filter(
        Program.id == program_id, Program.tenant_id == user["tenant_id"]
    ).first()
    if not prog:
        raise HTTPException(404, "Program not found")

    # Single aggregate query — no rows fetched
    agg = db.query(
        sa_func.count().label("total"),
        sa_func.sum(sa_case((Submission.status == "approved",  1), else_=0)).label("approved"),
        sa_func.sum(sa_case((Submission.status == "flagged",   1), else_=0)).label("flagged"),
        sa_func.sum(sa_case((Submission.status == "synced",    1), else_=0)).label("synced"),
        sa_func.sum(sa_case((Submission.has_violations == True, 1), else_=0)).label("violations"),
        sa_func.sum(sa_case((Submission.backcheck_required == True, 1), else_=0)).label("backcheck_required"),
        sa_func.min(Submission.server_received_at).label("first_date"),
        sa_func.max(Submission.server_received_at).label("last_date"),
    ).filter(
        Submission.program_id == _uuid.UUID(program_id),
        Submission.tenant_id == user["tenant_id"],
    ).one()

    total = agg.total or 0
    violations = agg.violations or 0
    quality_score = round((1 - violations / max(total, 1)) * 100, 1)

    # Enumerator breakdown
    enum_rows = (
        db.query(User.name, sa_func.count().label("cnt"))
        .join(Submission, Submission.enumerator_id == User.id)
        .filter(
            Submission.program_id == _uuid.UUID(program_id),
            Submission.tenant_id == user["tenant_id"],
        )
        .group_by(User.name)
        .order_by(sa_func.count().desc())
        .all()
    )
    enumerators = [{"name": r.name or "Unknown", "count": r.cnt} for r in enum_rows]

    # Wave/questionnaire breakdown
    questionnaires = db.query(ProgramQuestionnaire).filter(
        ProgramQuestionnaire.program_id == program_id,
        ProgramQuestionnaire.tenant_id == user["tenant_id"],
    ).order_by(ProgramQuestionnaire.wave_number).all()

    wave_counts = []
    for q in questionnaires:
        cnt = db.query(sa_func.count()).filter(
            Submission.questionnaire_id == q.id,
            Submission.tenant_id == user["tenant_id"],
        ).scalar() or 0
        wave_counts.append({
            "name": q.wave_label or q.name,
            "wave_number": q.wave_number,
            "count": cnt,
            "form_id": str(q.form_id) if q.form_id else None,
        })

    # Daily trend — aggregate, no rows
    trend_rows = db.execute(
        text("""
            SELECT DATE(server_received_at) AS d, COUNT(*) AS cnt
            FROM submissions
            WHERE program_id = :pid AND tenant_id = :tid
            GROUP BY DATE(server_received_at)
            ORDER BY d
        """), {"pid": str(program_id), "tid": str(user["tenant_id"])}
    ).fetchall()
    trend = [{"date": str(r.d), "count": r.cnt} for r in trend_rows]

    # Status counts
    status_rows = db.execute(
        text("""
            SELECT status, COUNT(*) AS cnt FROM submissions
            WHERE program_id = :pid AND tenant_id = :tid GROUP BY status
        """), {"pid": str(program_id), "tid": str(user["tenant_id"])}
    ).fetchall()
    status_counts = {r.status: r.cnt for r in status_rows}

    # Column count — from form schemas, no submission rows needed
    form_ids = [q.form_id for q in questionnaires if q.form_id]
    column_count = 0
    seen_cols: set = set()
    for fid in form_ids:
        form = db.query(Form).filter(Form.id == fid).first()
        if form and form.json_schema:
            for section in form.json_schema.get("sections", []):
                for field in section.get("fields", []):
                    fkey = field.get("field_id") or field.get("label", "")
                    if fkey and fkey not in seen_cols:
                        seen_cols.add(fkey)
                        column_count += 1

    return {
        "program_id": str(prog.id),
        "program_name": prog.name,
        "scheme": prog.scheme_name or "",
        "total_submissions": total,
        "approved": agg.approved or 0,
        "flagged": agg.flagged or 0,
        "synced": agg.synced or 0,
        "violations": violations,
        "backcheck_required": agg.backcheck_required or 0,
        "quality_score": quality_score,
        "enumerators": enumerators,
        "wave_counts": wave_counts,
        "trend": trend,
        "status_counts": status_counts,
        "column_count": column_count,
        "date_range": {
            "first": agg.first_date.strftime("%Y-%m-%d") if agg.first_date else None,
            "last": agg.last_date.strftime("%Y-%m-%d") if agg.last_date else None,
        },
    }


# ── AI Tabulation Suggest ─────────────────────────────────────────────────────

@router.post("/programs/{program_id}/tabulate/suggest")
async def suggest_tabulation(
    program_id: str,
    body: TabulateRequest,
    user: dict = Depends(require_supervisor),
    db: Session = Depends(get_db),
):
    try:
        result = await ai_service.suggest_tabulation(
            _get_global_ai_cfg(db),
            body.column_headers,
            body.sample_rows,
            body.user_prompt,
            body.research_type,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(503, f"AI error: {e}")
    return result


# ── AI Tabulation Polish (rename title, subtitle, column labels) ──────────────

@router.post("/programs/{program_id}/tabulate/polish")
async def polish_tabulation(
    program_id: str,
    body: PolishRequest,
    user: dict = Depends(require_supervisor),
    db: Session = Depends(get_db),
):
    prog = db.query(Program).filter(
        Program.id == program_id, Program.tenant_id == user["tenant_id"]
    ).first()
    if not prog:
        raise HTTPException(404, "Program not found")
    cfg = _get_global_ai_cfg(db)
    if not cfg.get("api_key"):
        raise HTTPException(400, "AI not configured. Contact your platform administrator.")
    try:
        result = await ai_service.polish_tabulation(
            cfg=cfg, title=body.title, groupby_field=body.groupby_field,
            value_field=body.value_field, aggregation=body.aggregation,
            rows=body.rows[:30], is_cross_tab=body.is_cross_tab, sub_keys=body.sub_keys,
        )
        return result
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(503, f"AI error: {e}")


# ── AI Tabulation Interpret (narrative below table) ───────────────────────────

@router.post("/programs/{program_id}/tabulate/interpret")
async def interpret_tabulation(
    program_id: str,
    body: InterpretRequest,
    user: dict = Depends(require_supervisor),
    db: Session = Depends(get_db),
):
    prog = db.query(Program).filter(
        Program.id == program_id, Program.tenant_id == user["tenant_id"]
    ).first()
    if not prog:
        raise HTTPException(404, "Program not found")
    cfg = _get_global_ai_cfg(db)
    if not cfg.get("api_key"):
        raise HTTPException(400, "AI not configured. Contact your platform administrator.")

    prog_context = prog.name
    if prog.scheme_name:
        prog_context += f" ({prog.scheme_name})"
    if prog.start_date or prog.end_date:
        prog_context += f", {prog.start_date or '?'} to {prog.end_date or '?'}"
    if body.extra_context:
        prog_context += f". {body.extra_context}"

    try:
        interpretation = await ai_service.interpret_tabulation(
            cfg=cfg, title=body.title, subtitle=body.subtitle,
            rows=body.rows, is_cross_tab=body.is_cross_tab, sub_keys=body.sub_keys,
            groupby_field=body.groupby_field, value_field=body.value_field,
            aggregation=body.aggregation, show_percent=body.show_percent,
            column_labels=body.column_labels, focus_prompt=body.focus_prompt,
            program_context=prog_context,
        )
        return {"interpretation": interpretation}
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(503, f"AI error: {e}")


# ── AI Tabulation Execute (run actual aggregation) ────────────────────────────

@router.post("/programs/{program_id}/tabulate/execute")
def execute_tabulation(
    program_id: str,
    body: TabulateExecuteRequest,
    user: dict = Depends(require_supervisor),
    db: Session = Depends(get_db),
):
    try:
        return _execute_tabulation_inner(program_id, body, user, db)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Tabulation error: {e}")


def _execute_tabulation_inner(program_id, body, user, db):
    prog = db.query(Program).filter(
        Program.id == program_id, Program.tenant_id == user["tenant_id"]
    ).first()
    if not prog:
        raise HTTPException(404, "Program not found")

    query = db.query(Submission).filter(
        Submission.program_id == program_id,
        Submission.tenant_id == user["tenant_id"],
    )
    if body.form_ids:
        query = query.filter(Submission.form_id.in_(body.form_ids))

    subs = query.all()

    groupby_field = body.groupby_field
    value_field = body.value_field
    aggregation = body.aggregation
    secondary_groupby = body.secondary_groupby or ""

    def _str_val(raw):
        if isinstance(raw, list):
            return ", ".join(str(v) for v in raw)
        return str(raw) if raw is not None else "__missing__"

    # Cross-tabulation path
    if secondary_groupby:
        cross: dict = defaultdict(lambda: defaultdict(int))
        for s in subs:
            if not s.data_json or not isinstance(s.data_json, dict):
                continue
            g1 = _str_val(s.data_json.get(groupby_field, "__missing__"))
            g2 = _str_val(s.data_json.get(secondary_groupby, "__missing__"))
            cross[g1][g2] += 1
        sub_keys = sorted({k for row in cross.values() for k in row})
        rows = []
        for g1, d in sorted(cross.items()):
            total_g1 = sum(d.values())
            row: dict = {"group": g1, "value": total_g1}
            for k in sub_keys:
                row[k] = d.get(k, 0)
            rows.append(row)
        rows.sort(key=lambda x: -x["value"])
        grand_total = sum(r["value"] for r in rows)
        if body.show_percent and grand_total:
            for r in rows:
                r["pct"] = round(r["value"] / grand_total * 100, 1)
        return {
            "rows": rows,
            "sub_keys": sub_keys,
            "is_cross_tab": True,
            "show_percent": body.show_percent,
            "total": len(subs),
            "groupby_field": groupby_field,
            "secondary_groupby": secondary_groupby,
            "aggregation": aggregation,
            "chart_type": body.chart_type,
            "title": body.title,
        }

    # Simple aggregation path
    groups: dict = defaultdict(list)
    for s in subs:
        if not s.data_json or not isinstance(s.data_json, dict):
            continue
        group_val = _str_val(s.data_json.get(groupby_field, "__missing__"))
        if value_field == "*" or aggregation == "count":
            groups[group_val].append(1)
        else:
            val = s.data_json.get(value_field)
            try:
                groups[group_val].append(float(val))
            except (TypeError, ValueError):
                pass

    rows = []
    for group, values in sorted(groups.items()):
        if aggregation == "count":
            agg_val = len(values)
        elif aggregation == "sum":
            agg_val = sum(values)
        elif aggregation == "mean":
            agg_val = round(sum(values) / len(values), 2) if values else 0
        else:
            agg_val = len(values)
        rows.append({"group": group, "value": agg_val})

    rows.sort(key=lambda x: -x["value"])

    if body.show_percent and aggregation == "count":
        grand_total = sum(r["value"] for r in rows)
        for r in rows:
            r["pct"] = round(r["value"] / grand_total * 100, 1) if grand_total else 0

    return {
        "rows": rows,
        "is_cross_tab": False,
        "show_percent": body.show_percent,
        "total": len(subs),
        "groupby_field": groupby_field,
        "value_field": value_field,
        "aggregation": aggregation,
        "chart_type": body.chart_type,
        "title": body.title,
    }


# ── CSV Tabulation (org_admin only, rows provided directly) ──────────────────

@router.post("/tabulate-csv")
def tabulate_csv(
    body: TabulateCsvRequest,
    user: dict = Depends(require_org_admin),
):
    rows = body.rows
    groupby_field = body.groupby_field
    value_field = body.value_field
    aggregation = body.aggregation
    secondary_groupby = body.secondary_groupby or ""

    def _str_val(raw):
        if isinstance(raw, list):
            return ", ".join(str(v) for v in raw)
        return str(raw) if raw is not None else "__missing__"

    if secondary_groupby:
        cross: dict = defaultdict(lambda: defaultdict(int))
        for row in rows:
            g1 = _str_val(row.get(groupby_field, "__missing__"))
            g2 = _str_val(row.get(secondary_groupby, "__missing__"))
            cross[g1][g2] += 1
        sub_keys = sorted({k for d in cross.values() for k in d})
        result_rows = []
        for g1, d in sorted(cross.items()):
            total_g1 = sum(d.values())
            r: dict = {"group": g1, "value": total_g1}
            for k in sub_keys:
                r[k] = d.get(k, 0)
            result_rows.append(r)
        result_rows.sort(key=lambda x: -x["value"])
        grand_total = sum(r["value"] for r in result_rows)
        if body.show_percent and grand_total:
            for r in result_rows:
                r["pct"] = round(r["value"] / grand_total * 100, 1)
        return {
            "rows": result_rows, "sub_keys": sub_keys, "is_cross_tab": True,
            "show_percent": body.show_percent, "total": len(rows),
            "groupby_field": groupby_field, "secondary_groupby": secondary_groupby,
            "aggregation": aggregation, "chart_type": body.chart_type, "title": body.title,
        }

    groups: dict = defaultdict(list)
    for row in rows:
        group_val = _str_val(row.get(groupby_field, "__missing__"))
        if value_field == "*" or aggregation == "count":
            groups[group_val].append(1)
        else:
            val = row.get(value_field)
            try:
                groups[group_val].append(float(val))
            except (TypeError, ValueError):
                pass

    result_rows = []
    for group, values in sorted(groups.items()):
        if aggregation == "count":
            agg_val = len(values)
        elif aggregation == "sum":
            agg_val = sum(values)
        elif aggregation == "mean":
            agg_val = round(sum(values) / len(values), 2) if values else 0
        else:
            agg_val = len(values)
        result_rows.append({"group": group, "value": agg_val})

    result_rows.sort(key=lambda x: -x["value"])

    if body.show_percent and aggregation == "count":
        grand_total = sum(r["value"] for r in result_rows)
        for r in result_rows:
            r["pct"] = round(r["value"] / grand_total * 100, 1) if grand_total else 0

    return {
        "rows": result_rows, "is_cross_tab": False,
        "show_percent": body.show_percent, "total": len(rows),
        "groupby_field": groupby_field, "value_field": value_field,
        "aggregation": aggregation, "chart_type": body.chart_type, "title": body.title,
    }


# ── Program Analysis: config persistence ─────────────────────────────────────

def _get_or_create_manual_analysis(program_id: str, tenant_id, user_id, db: Session) -> ProgramAnalysis:
    """Return the single manual analysis record for this program, creating it if absent."""
    rec = db.query(ProgramAnalysis).filter(
        ProgramAnalysis.program_id == program_id,
        ProgramAnalysis.tenant_id == tenant_id,
        ProgramAnalysis.source == "manual",
    ).order_by(ProgramAnalysis.updated_at.desc()).first()
    if not rec:
        rec = ProgramAnalysis(
            program_id=program_id,
            tenant_id=tenant_id,
            created_by=user_id,
            status="done",
            source="manual",
            table_configs=[],
        )
        db.add(rec)
        db.flush()
    return rec


@router.get("/programs/{program_id}/analysis")
def get_analysis(program_id: str, user: dict = Depends(require_supervisor), db: Session = Depends(get_db)):
    rec = db.query(ProgramAnalysis).filter(
        ProgramAnalysis.program_id == program_id,
        ProgramAnalysis.tenant_id == user["tenant_id"],
        ProgramAnalysis.source == "manual",
    ).order_by(ProgramAnalysis.updated_at.desc()).first()
    if not rec:
        return {"analysis_id": None, "table_configs": [], "status": "empty", "updated_at": None}
    return {
        "analysis_id": str(rec.id),
        "table_configs": rec.table_configs or [],
        "status": rec.status,
        "updated_at": rec.updated_at.isoformat() if rec.updated_at else None,
    }


@router.get("/programs/{program_id}/analysis/status")
def get_analysis_status(program_id: str, user: dict = Depends(require_supervisor), db: Session = Depends(get_db)):
    # Pending AI job takes priority
    pending_ai = db.query(ProgramAnalysis).filter(
        ProgramAnalysis.program_id == program_id,
        ProgramAnalysis.tenant_id == user["tenant_id"],
        ProgramAnalysis.source == "ai",
        ProgramAnalysis.status == "pending",
    ).order_by(ProgramAnalysis.created_at.desc()).first()
    if pending_ai:
        return {
            "status": "pending",
            "source": "ai",
            "analysis_id": str(pending_ai.id),
            "updated_at": pending_ai.updated_at.isoformat() if pending_ai.updated_at else None,
            "table_count": 0,
            "runs_today": None,
            "runs_remaining": None,
        }

    today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    runs_today = db.query(ProgramAnalysis).filter(
        ProgramAnalysis.program_id == program_id,
        ProgramAnalysis.tenant_id == user["tenant_id"],
        ProgramAnalysis.source == "ai",
        ProgramAnalysis.created_at >= today_start,
        ProgramAnalysis.status != "failed",
    ).count()

    rec = db.query(ProgramAnalysis).filter(
        ProgramAnalysis.program_id == program_id,
        ProgramAnalysis.tenant_id == user["tenant_id"],
        ProgramAnalysis.source == "manual",
    ).order_by(ProgramAnalysis.updated_at.desc()).first()
    table_count = len(rec.table_configs) if rec and rec.table_configs else 0
    return {
        "status": rec.status if rec else "empty",
        "source": "manual",
        "updated_at": rec.updated_at.isoformat() if rec and rec.updated_at else None,
        "table_count": table_count,
        "analysis_id": str(rec.id) if rec else None,
        "runs_today": runs_today,
        "runs_remaining": max(0, 2 - runs_today),
        "ai_rationale": rec.ai_rationale if rec else None,
    }


@router.get("/programs/{program_id}/analysis/history")
def get_analysis_history(program_id: str, user: dict = Depends(require_supervisor), db: Session = Depends(get_db)):
    records = db.query(ProgramAnalysis).filter(
        ProgramAnalysis.program_id == program_id,
        ProgramAnalysis.tenant_id == user["tenant_id"],
    ).order_by(ProgramAnalysis.created_at.desc()).limit(50).all()
    return [
        {
            "analysis_id": str(r.id),
            "source": r.source,
            "status": r.status,
            "objectives": r.objectives,
            "table_count": len(r.table_configs) if r.table_configs else 0,
            "created_at": r.created_at.isoformat() if r.created_at else None,
            "updated_at": r.updated_at.isoformat() if r.updated_at else None,
            "ai_rationale": r.ai_rationale,
            "cleaning_summary": r.cleaning_summary or {},
        }
        for r in records
    ]


@router.post("/programs/{program_id}/analysis/restore")
def restore_analysis(
    program_id: str,
    body: RestoreRequest,
    user: dict = Depends(require_supervisor),
    db: Session = Depends(get_db),
):
    source_rec = db.query(ProgramAnalysis).filter(
        ProgramAnalysis.id == body.analysis_id,
        ProgramAnalysis.program_id == program_id,
        ProgramAnalysis.tenant_id == user["tenant_id"],
    ).first()
    if not source_rec:
        raise HTTPException(404, "Analysis record not found")
    if not source_rec.table_configs:
        raise HTTPException(400, "Selected run has no table configs to restore")

    manual_rec = _get_or_create_manual_analysis(program_id, str(user["tenant_id"]), str(user["id"]), db)
    manual_rec.table_configs = source_rec.table_configs
    manual_rec.updated_at = datetime.now(timezone.utc)
    db.commit()

    return {"table_configs": source_rec.table_configs}


@router.patch("/programs/{program_id}/analysis/tabulations/{tab_id}/feedback")
def update_tabulation_feedback(
    program_id: str,
    tab_id: str,
    body: FeedbackRequest,
    user: dict = Depends(require_supervisor),
    db: Session = Depends(get_db),
):
    if body.vote not in (None, "up", "down"):
        raise HTTPException(400, "vote must be 'up', 'down', or null")

    rec = db.query(ProgramAnalysis).filter(
        ProgramAnalysis.program_id == program_id,
        ProgramAnalysis.tenant_id == user["tenant_id"],
        ProgramAnalysis.source == "manual",
    ).order_by(ProgramAnalysis.updated_at.desc()).first()
    if not rec or not rec.table_configs:
        raise HTTPException(404, "No analysis record found")

    new_configs = []
    found = False
    for cfg in rec.table_configs:
        if cfg.get("id") == tab_id:
            new_configs.append({**cfg, "feedback": body.vote})
            found = True
        else:
            new_configs.append(cfg)

    if not found:
        raise HTTPException(404, "Tabulation not found")

    rec.table_configs = new_configs
    db.commit()
    return {"ok": True}


class SaveTabulationRequest(BaseModel):
    tabulation: dict  # full SavedTabulation object from frontend


class AutoGenerateRequest(BaseModel):
    objectives: str = ""


@router.post("/programs/{program_id}/analysis/tabulations")
def save_tabulation(
    program_id: str,
    body: SaveTabulationRequest,
    user: dict = Depends(require_supervisor),
    db: Session = Depends(get_db),
):
    prog = db.query(Program).filter(
        Program.id == program_id, Program.tenant_id == user["tenant_id"]
    ).first()
    if not prog:
        raise HTTPException(404, "Program not found")

    rec = _get_or_create_manual_analysis(program_id, user["tenant_id"], user["id"], db)
    configs = list(rec.table_configs or [])
    tab = body.tabulation
    idx = next((i for i, t in enumerate(configs) if t.get("id") == tab.get("id")), -1)
    if idx >= 0:
        configs[idx] = tab
    else:
        configs.append(tab)
    rec.table_configs = configs
    rec.updated_at = func.now()
    db.commit()
    return {"analysis_id": str(rec.id), "table_configs": rec.table_configs}


@router.delete("/programs/{program_id}/analysis/tabulations/{tab_id}")
def delete_tabulation(
    program_id: str,
    tab_id: str,
    user: dict = Depends(require_supervisor),
    db: Session = Depends(get_db),
):
    rec = db.query(ProgramAnalysis).filter(
        ProgramAnalysis.program_id == program_id,
        ProgramAnalysis.tenant_id == user["tenant_id"],
        ProgramAnalysis.source == "manual",
    ).order_by(ProgramAnalysis.updated_at.desc()).first()
    if not rec:
        raise HTTPException(404, "No analysis found")
    rec.table_configs = [t for t in (rec.table_configs or []) if t.get("id") != tab_id]
    rec.updated_at = func.now()
    db.commit()
    return {"ok": True, "table_configs": rec.table_configs}


# ── AI Auto-Generate: background job ─────────────────────────────────────────

def _execute_config_rows(config: dict, subs: list) -> dict:
    """Execute one tabulation config against Submission objects, return rows."""
    groupby_field = config.get("groupby_field", "")
    value_field   = config.get("value_field", "*")
    aggregation   = config.get("aggregation", "count")
    secondary     = config.get("secondary_groupby", "")
    show_pct      = config.get("show_percent", False)

    def _sv(raw):
        if isinstance(raw, list): return ", ".join(str(v) for v in raw)
        return str(raw) if raw is not None else "__missing__"

    if secondary:
        cross: dict = defaultdict(lambda: defaultdict(int))
        for s in subs:
            if not s.data_json or not isinstance(s.data_json, dict): continue
            cross[_sv(s.data_json.get(groupby_field, "__missing__"))][_sv(s.data_json.get(secondary, "__missing__"))] += 1
        sub_keys = sorted({k for row in cross.values() for k in row})
        rows = []
        for g1, d in sorted(cross.items()):
            row: dict = {"group": g1, "value": sum(d.values())}
            for k in sub_keys: row[k] = d.get(k, 0)
            rows.append(row)
        rows.sort(key=lambda x: -x["value"])
        gt = sum(r["value"] for r in rows)
        if show_pct and gt:
            for r in rows: r["pct"] = round(r["value"] / gt * 100, 1)
        return {"rows": rows, "sub_keys": sub_keys, "is_cross_tab": True, "total": len(subs)}

    groups: dict = defaultdict(list)
    for s in subs:
        if not s.data_json or not isinstance(s.data_json, dict): continue
        gv = _sv(s.data_json.get(groupby_field, "__missing__"))
        if value_field == "*" or aggregation == "count":
            groups[gv].append(1)
        else:
            try: groups[gv].append(float(s.data_json.get(value_field)))
            except (TypeError, ValueError): pass
    rows = []
    for group, vals in sorted(groups.items()):
        if aggregation == "count":    av = len(vals)
        elif aggregation == "sum":    av = sum(vals)
        elif aggregation == "mean":   av = round(sum(vals) / len(vals), 2) if vals else 0
        else:                         av = len(vals)
        rows.append({"group": group, "value": av})
    rows.sort(key=lambda x: -x["value"])
    if show_pct and aggregation == "count":
        gt = sum(r["value"] for r in rows)
        for r in rows: r["pct"] = round(r["value"] / gt * 100, 1) if gt else 0
    return {"rows": rows, "is_cross_tab": False, "total": len(subs)}


def _fail_analysis(db: Session, analysis_id: str, error_text: str) -> None:
    try:
        rec = db.query(ProgramAnalysis).filter(ProgramAnalysis.id == analysis_id).first()
        if rec:
            rec.status = "failed"
            rec.error_text = error_text
            db.commit()
    except Exception as e:
        logger.warning("_fail_analysis: could not mark analysis %s as failed: %s", analysis_id, e)


async def _run_ai_generation(
    analysis_id: str, program_id: str, tenant_id: str, user_id: str, objectives: str,
) -> None:
    from app.core.database import SessionLocal
    db = SessionLocal()
    try:
        prog = db.query(Program).filter(Program.id == program_id).first()
        if not prog:
            _fail_analysis(db, analysis_id, "Program not found"); return

        tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
        if not tenant:
            _fail_analysis(db, analysis_id, "Tenant not found"); return

        questionnaires = db.query(ProgramQuestionnaire).filter(
            ProgramQuestionnaire.program_id == program_id,
            ProgramQuestionnaire.tenant_id == tenant_id,
        ).all()
        form_ids = [str(q.form_id) for q in questionnaires if q.form_id]

        subs = db.query(Submission).filter(
            Submission.program_id == program_id,
            Submission.tenant_id == tenant_id,
        ).all()

        # Build enriched column headers (categorical cols include values_seen)
        column_headers: list = []
        seen_cols: set = set()
        for fid in form_ids:
            form = db.query(Form).filter(Form.id == fid).first()
            if not (form and form.json_schema): continue
            for section in form.json_schema.get("sections", []):
                for field in section.get("fields", []):
                    col_id = field.get("id", "")
                    col_type = field.get("type", "text")
                    if not col_id or col_id in seen_cols: continue
                    seen_cols.add(col_id)
                    col: dict = {
                        "id": col_id, "label": field.get("label", col_id),
                        "type": col_type, "options": field.get("options", []),
                    }
                    if col_type in ("single_choice", "multiple_choice", "select", "radio", "checkbox"):
                        schema_vals = [
                            o.get("label", o) if isinstance(o, dict) else str(o)
                            for o in col.get("options", [])
                        ]
                        seen_vals: set = set()
                        actual_vals: list = []
                        for s in subs:
                            if len(actual_vals) >= 20: break
                            if not (s.data_json and col_id in s.data_json): continue
                            raw = s.data_json[col_id]
                            for v in (raw if isinstance(raw, list) else [raw]):
                                sv = str(v).strip()
                                if sv and sv not in seen_vals:
                                    seen_vals.add(sv); actual_vals.append(sv)
                        col["values_seen"] = (schema_vals or actual_vals)[:20]
                    column_headers.append(col)

        if not column_headers:
            _fail_analysis(db, analysis_id, "No form columns found for this program"); return

        # Cleaning summary
        total_subs = len(subs)
        skipped = sum(1 for s in subs if not s.data_json)
        cols_high_missing: dict = {}
        for col in column_headers:
            missing_ct = sum(1 for s in subs if s.data_json and not s.data_json.get(col["id"]))
            if total_subs and missing_ct / total_subs > 0.20:
                cols_high_missing[col["label"]] = round(missing_ct / total_subs * 100, 1)
        cleaning_summary = {"total": total_subs, "skipped": skipped, "cols_high_missing": cols_high_missing}

        _internal = {"_gps_lat", "_gps_lng", "_gps_accuracy", "_duplicate_suspect", "_validation_violations"}
        sample_rows = [
            {k: v for k, v in s.data_json.items() if k not in _internal}
            for s in subs[:8] if s.data_json
        ]

        user_prompt = objectives.strip() or "Suggest the most insightful tabulations for this dataset."
        try:
            result = await ai_service.suggest_tabulation(_get_global_ai_cfg(db), column_headers, sample_rows, user_prompt)
        except Exception as e:
            _fail_analysis(db, analysis_id, f"AI call failed: {e}"); return

        ai_suggestions = result.get("tables", [])
        ai_rationale_text = result.get("rationale", "")

        # Hallucination guardrail: drop configs with invalid column ids
        valid_col_ids = {c["id"] for c in column_headers}

        def _is_valid(cfg: dict) -> bool:
            g = cfg.get("groupby_field", "")
            v = cfg.get("value_field", "")
            sec = cfg.get("secondary_groupby", "")
            return (
                g in valid_col_ids
                and (not v or v == "*" or v in valid_col_ids)
                and (not sec or sec in valid_col_ids)
            )

        valid = [c for c in ai_suggestions if _is_valid(c)]

        # Retry once with stricter prompt if < 3 survived
        if len(valid) < 3 and ai_suggestions:
            strict = (
                f"{user_prompt}\n\nSTRICT: Only use these exact column ids: "
                f"{[c['id'] for c in column_headers[:30]]}. Do NOT guess or invent ids."
            )
            try:
                retry_result = await ai_service.suggest_tabulation(_get_global_ai_cfg(db), column_headers, sample_rows, strict)
                valid2 = [c for c in retry_result.get("tables", []) if _is_valid(c)]
                if len(valid2) > len(valid): valid = valid2
            except Exception as e:
                logger.debug("AI tabulation retry failed (non-fatal): %s", e)

        valid = valid[:10]  # cap at 10

        if not valid:
            _fail_analysis(db, analysis_id, "AI could not generate valid tabulations for this dataset."); return

        # Execute each config to get rows
        table_configs = []
        for cfg in valid:
            rd = _execute_config_rows(cfg, subs)
            table_configs.append({
                "id": str(_uuid.uuid4()),
                "title": cfg.get("title", f"{cfg.get('groupby_field', '')} breakdown"),
                "description": cfg.get("description", ""),
                "groupby_field": cfg.get("groupby_field", ""),
                "value_field": cfg.get("value_field", "*"),
                "aggregation": cfg.get("aggregation", "count"),
                "chart_type": cfg.get("chart_type", "bar"),
                "show_percent": cfg.get("show_percent", False),
                "secondary_groupby": cfg.get("secondary_groupby", ""),
                "rows": rd["rows"],
                "sub_keys": rd.get("sub_keys", []),
                "is_cross_tab": rd["is_cross_tab"],
                "total": rd["total"],
                "created_at": datetime.now(timezone.utc).isoformat(),
            })

        # Save to AI record
        ai_rec = db.query(ProgramAnalysis).filter(ProgramAnalysis.id == analysis_id).first()
        if not ai_rec: return
        ai_rec.status = "done"
        ai_rec.table_configs = table_configs
        ai_rec.cleaning_summary = cleaning_summary
        ai_rec.ai_rationale = ai_rationale_text or None

        # Mirror to manual record so GET /analysis picks up AI results immediately
        manual_rec = _get_or_create_manual_analysis(program_id, tenant_id, user_id, db)
        manual_rec.table_configs = table_configs

        db.commit()

    except Exception as e:
        _fail_analysis(db, analysis_id, str(e))
    finally:
        db.close()


@router.post("/programs/{program_id}/auto-generate")
async def auto_generate(
    program_id: str,
    body: AutoGenerateRequest,
    background_tasks: BackgroundTasks,
    user: dict = Depends(require_supervisor),
    db: Session = Depends(get_db),
):
    prog = db.query(Program).filter(
        Program.id == program_id, Program.tenant_id == user["tenant_id"]
    ).first()
    if not prog:
        raise HTTPException(404, "Program not found")

    today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    today_runs = db.query(ProgramAnalysis).filter(
        ProgramAnalysis.program_id == program_id,
        ProgramAnalysis.tenant_id == user["tenant_id"],
        ProgramAnalysis.source == "ai",
        ProgramAnalysis.created_at >= today_start,
        ProgramAnalysis.status != "failed",
    ).count()
    if today_runs >= 2:
        raise HTTPException(429, "Daily AI generation limit reached (2/day per program)")

    last_ai = db.query(ProgramAnalysis).filter(
        ProgramAnalysis.program_id == program_id,
        ProgramAnalysis.tenant_id == user["tenant_id"],
        ProgramAnalysis.source == "ai",
        ProgramAnalysis.status != "failed",
    ).order_by(ProgramAnalysis.created_at.desc()).first()
    if last_ai and last_ai.last_run_at:
        last_run = last_ai.last_run_at
        if last_run.tzinfo is None:
            last_run = last_run.replace(tzinfo=timezone.utc)
        gap = datetime.now(timezone.utc) - last_run
        if gap < timedelta(minutes=5):
            wait_mins = int((timedelta(minutes=5) - gap).total_seconds() / 60) + 1
            raise HTTPException(429, f"Please wait {wait_mins} more minute(s) between AI generations")

    now_utc = datetime.now(timezone.utc)
    ai_rec = ProgramAnalysis(
        program_id=program_id,
        tenant_id=user["tenant_id"],
        created_by=user["id"],
        status="pending",
        source="ai",
        objectives=body.objectives,
        table_configs=[],
        last_run_at=now_utc,
    )
    db.add(ai_rec)
    db.commit()
    db.refresh(ai_rec)
    analysis_id = str(ai_rec.id)

    background_tasks.add_task(
        _run_ai_generation,
        analysis_id=analysis_id,
        program_id=str(program_id),
        tenant_id=str(user["tenant_id"]),
        user_id=str(user["id"]),
        objectives=body.objectives,
    )

    return {
        "analysis_id": analysis_id,
        "status": "pending",
        "message": "AI is analyzing your dataset — check back in ~2 minutes",
        "runs_today": today_runs + 1,
        "runs_remaining": max(0, 2 - today_runs - 1),
    }


@router.post("/programs/{program_id}/analysis/refresh")
def refresh_analysis(
    program_id: str,
    user: dict = Depends(require_supervisor),
    db: Session = Depends(get_db),
):
    """Re-run all saved tabulation configs against fresh submissions (no AI call)."""
    rec = db.query(ProgramAnalysis).filter(
        ProgramAnalysis.program_id == program_id,
        ProgramAnalysis.tenant_id == user["tenant_id"],
        ProgramAnalysis.source == "manual",
    ).order_by(ProgramAnalysis.updated_at.desc()).first()

    if not rec or not rec.table_configs:
        return {"table_configs": [], "updated_at": None}

    subs = db.query(Submission).filter(
        Submission.program_id == program_id,
        Submission.tenant_id == user["tenant_id"],
    ).all()

    new_configs = []
    for cfg in rec.table_configs:
        result = _execute_config_rows(cfg, subs)
        new_configs.append({**cfg, **result})

    rec.table_configs = new_configs
    rec.updated_at = datetime.now(timezone.utc)
    db.commit()

    return {
        "table_configs": new_configs,
        "updated_at": rec.updated_at.isoformat(),
    }


# ── FG Cleaner: data quality view ────────────────────────────────────────────

@router.get("/programs/{program_id}/cleaner")
def get_cleaner_data(
    program_id: str,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    issue_type: str = Query("all"),
    user: dict = Depends(require_supervisor),
    db: Session = Depends(get_db),
):
    prog = db.query(Program).filter(
        Program.id == program_id, Program.tenant_id == user["tenant_id"]
    ).first()
    if not prog:
        raise HTTPException(404, "Program not found")

    # Load forms for this program — single query (avoid N+1)
    questionnaires = db.query(ProgramQuestionnaire).filter(
        ProgramQuestionnaire.program_id == program_id,
        ProgramQuestionnaire.tenant_id == user["tenant_id"],
    ).all()
    form_ids = [q.form_id for q in questionnaires if q.form_id]
    forms: dict = {}
    if form_ids:
        for form in db.query(Form).filter(Form.id.in_(form_ids)).all():
            forms[str(form.id)] = form

    subs = db.query(Submission).filter(
        Submission.program_id == program_id,
        Submission.tenant_id == user["tenant_id"],
    ).order_by(Submission.server_received_at.desc()).limit(10000).all()

    # Load only users referenced in these submissions (avoid full-tenant scan)
    enum_ids = list({str(s.enumerator_id) for s in subs if s.enumerator_id})
    if enum_ids:
        from sqlalchemy import cast as _cast
        from sqlalchemy.dialects.postgresql import UUID as PGUUID
        enum_users = {
            str(u.id): u.name
            for u in db.query(User).filter(User.id.in_([_uuid.UUID(eid) for eid in enum_ids])).all()
        }
    else:
        enum_users = {}

    # Build outlier thresholds per numeric field (mean ± 2σ) across all submissions
    import math
    numeric_fields: dict[str, list[float]] = {}
    for s in subs:
        for form in forms.values():
            for section in (form.json_schema or {}).get("sections", []):
                for f in section.get("fields", []):
                    if f.get("type") in ("number", "decimal") and f.get("id"):
                        fid = f["id"]
                        val = (s.data_json or {}).get(fid)
                        try:
                            numeric_fields.setdefault(fid, []).append(float(val))
                        except (TypeError, ValueError):
                            pass

    outlier_bounds: dict[str, tuple[float, float]] = {}
    for fid, vals in numeric_fields.items():
        if len(vals) >= 5:
            mean = sum(vals) / len(vals)
            variance = sum((v - mean) ** 2 for v in vals) / len(vals)
            sd = math.sqrt(variance)
            outlier_bounds[fid] = (mean - 2 * sd, mean + 2 * sd)

    def _is_outlier(data_json: dict) -> bool:
        for fid, (lo, hi) in outlier_bounds.items():
            val = data_json.get(fid)
            try:
                if not (lo <= float(val) <= hi):
                    return True
            except (TypeError, ValueError):
                pass
        return False

    # Detect issues for each submission
    issues_list = []
    for s in subs:
        sub_issues = []
        form = forms.get(str(s.form_id))

        # 1. Violations flag (QC)
        if s.has_violations:
            sub_issues.append("qc_violation")

        # 2. Fast completion (< 120 seconds)
        if s.local_created_at and s.server_received_at:
            diff = (s.server_received_at - s.local_created_at).total_seconds()
            if 0 < diff < 120:
                sub_issues.append("fast_completion")

        # 3. Missing required fields
        if form and s.data_json:
            required_ids = [
                f.get("id") for section in form.json_schema.get("sections", [])
                for f in section.get("fields", [])
                if f.get("required") and f.get("type") not in ("section_header", "info")
            ]
            missing = [fid for fid in required_ids if not s.data_json.get(fid)]
            if missing:
                sub_issues.append("missing_required")

        # 4. No GPS
        if not s.gps_submit:
            sub_issues.append("no_gps")

        # 5. Flagged by supervisor
        if s.status == "flagged":
            sub_issues.append("flagged")

        # 6. Numeric outlier (>2σ from mean on any field)
        if s.data_json and _is_outlier(s.data_json):
            sub_issues.append("outlier")

        if issue_type == "all" or issue_type in sub_issues or (issue_type == "issues_only" and sub_issues):
            issues_list.append({
                "id": str(s.id),
                "enumerator_name": enum_users.get(str(s.enumerator_id), "Unknown"),
                "form_title": form.title if form else "Unknown",
                "status": s.status,
                "serial_no": s.serial_no,
                "received": s.server_received_at.isoformat() if s.server_received_at else None,
                "issues": sub_issues,
                "has_issues": bool(sub_issues),
                "household_id": s.household_id,
            })

    total = len(issues_list)
    start = (page - 1) * page_size
    page_items = issues_list[start: start + page_size]

    quality_score = round(
        sum(1 for i in issues_list if not i["has_issues"]) / max(total, 1) * 100, 1
    )

    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "items": page_items,
        "quality_score": quality_score,
        "issue_summary": {
            "qc_violation":    sum(1 for i in issues_list if "qc_violation" in i["issues"]),
            "fast_completion": sum(1 for i in issues_list if "fast_completion" in i["issues"]),
            "missing_required": sum(1 for i in issues_list if "missing_required" in i["issues"]),
            "no_gps":          sum(1 for i in issues_list if "no_gps" in i["issues"]),
            "flagged":         sum(1 for i in issues_list if "flagged" in i["issues"]),
            "outlier":         sum(1 for i in issues_list if "outlier" in i["issues"]),
            "clean":           sum(1 for i in issues_list if not i["issues"]),
        },
    }


# ── AI Job store (uses UserToolProject with tool='ai_job') ──────────────────

from app.models.user_tool_project import UserToolProject

def _create_ai_job(db: Session, tenant_id: str, user_id: str, name: str, program_id: str | None = None) -> str:
    job = UserToolProject(
        tenant_id=_uuid.UUID(tenant_id),
        user_id=_uuid.UUID(user_id),
        tool="ai_job",
        name=name,
        program_id=_uuid.UUID(program_id) if program_id else None,
        data={"status": "pending", "steps": [], "result": None, "error": None},
    )
    db.add(job); db.commit(); db.refresh(job)
    return str(job.id)


def _update_ai_job(db: Session, job_id: str, status: str, step: str | None = None, result: str | None = None, error: str | None = None):
    from sqlalchemy.orm.attributes import flag_modified
    job = db.query(UserToolProject).filter(UserToolProject.id == job_id, UserToolProject.tool == "ai_job").first()
    if not job: return
    data = dict(job.data or {})
    data["status"] = status
    if step:
        data.setdefault("steps", []).append(step)
    if result is not None:
        data["result"] = result
    if error is not None:
        data["error"] = error
    job.data = data
    flag_modified(job, "data")
    db.commit()


@router.get("/ai-jobs/{job_id}")
def get_ai_job(job_id: str, user: dict = Depends(require_supervisor), db: Session = Depends(get_db)):
    job = db.query(UserToolProject).filter(
        UserToolProject.id == job_id,
        UserToolProject.tenant_id == user["tenant_id"],
        UserToolProject.tool == "ai_job",
    ).first()
    if not job:
        raise HTTPException(404, "Job not found")
    return job.data


# ── FG Writer: AI report from program data ───────────────────────────────────

@router.post("/programs/{program_id}/writer/generate")
async def generate_program_report(
    program_id: str,
    body: WriterRequest,
    background_tasks: BackgroundTasks,
    user: dict = Depends(require_supervisor),
    db: Session = Depends(get_db),
):
    from sqlalchemy import case as sa_case

    prog = db.query(Program).filter(
        Program.id == program_id, Program.tenant_id == user["tenant_id"]
    ).first()
    if not prog:
        raise HTTPException(404, "Program not found")

    if not _get_global_ai_cfg(db).get("api_key"):
        raise HTTPException(400, "AI not configured. Contact your platform administrator.")

    # Gather all DB data synchronously before returning job_id
    agg = db.query(
        func.count().label("total"),
        func.sum(sa_case((Submission.status == "approved", 1), else_=0)).label("approved"),
        func.sum(sa_case((Submission.status == "flagged",  1), else_=0)).label("flagged"),
        func.sum(sa_case((Submission.has_violations == True, 1), else_=0)).label("violations"),
        func.sum(sa_case((Submission.backcheck_required == True, 1), else_=0)).label("backcheck_required"),
    ).filter(
        Submission.program_id == _uuid.UUID(program_id),
        Submission.tenant_id == user["tenant_id"],
    ).one()

    total              = agg.total or 0
    approved           = agg.approved or 0
    flagged            = agg.flagged or 0
    violations         = agg.violations or 0
    backcheck_required = agg.backcheck_required or 0
    quality_score      = round((1 - violations / max(total, 1)) * 100, 1)
    dup_count = db.query(func.count()).filter(
        Submission.program_id == _uuid.UUID(program_id),
        Submission.tenant_id == user["tenant_id"],
        Submission.data_json["_duplicate_suspect"].astext == "true",
    ).scalar() or 0
    waves = db.query(ProgramQuestionnaire).filter(
        ProgramQuestionnaire.program_id == program_id,
        ProgramQuestionnaire.tenant_id == user["tenant_id"],
        ProgramQuestionnaire.wave_number.isnot(None),
    ).order_by(ProgramQuestionnaire.wave_number).all()
    wave_list = [{"wave_number": w.wave_number, "wave_label": w.wave_label or f"Wave {w.wave_number}"} for w in waves]
    start_d = prog.start_date.isoformat() if prog.start_date else "—"
    end_d   = prog.end_date.isoformat()   if prog.end_date   else "—"
    date_range = body.date_range or f"{start_d} to {end_d}"
    ai_cfg  = _get_global_ai_cfg(db)
    prog_name = prog.name

    job_id = _create_ai_job(db, str(user["tenant_id"]), str(user["sub"]), f"Writer: {prog_name}", program_id)

    async def _run():
        from app.core.database import SessionLocal
        with SessionLocal() as sess:
            _update_ai_job(sess, job_id, "running", "Preparing report context…")
            try:
                _update_ai_job(sess, job_id, "running", "Calling AI model — this may take 1–3 minutes…")
                report_md = await ai_service.generate_program_report(
                    cfg=ai_cfg, program_name=prog_name,
                    scheme=body.style, date_range=date_range,
                    sample_size=total, approved=approved, flagged=flagged,
                    violations=violations, backcheck_required=backcheck_required,
                    duplicate_suspects=dup_count, quality_score=quality_score,
                    waves=wave_list, tabulations=body.tabulation_data,
                    style=body.style, custom_context=body.custom_context,
                )
                _update_ai_job(sess, job_id, "done", "Report complete!", result=report_md)
            except Exception as e:
                _update_ai_job(sess, job_id, "failed", error=str(e))

    background_tasks.add_task(_run)
    return {"job_id": job_id}


# ── Program export (used by analyzer.fieldgovern.com and cleaner.fieldgovern.com) ──

@router.get("/programs/{program_id}/export.xlsx")
def export_program_xlsx(
    program_id: str,
    questionnaire_id: Optional[str] = None,
    user: dict = Depends(require_supervisor),
    db: Session = Depends(get_db),
):
    try:
        pid_uuid = _uuid.UUID(program_id)
    except ValueError:
        raise HTTPException(400, "Invalid program_id format")

    prog = db.query(Program).filter(
        Program.id == pid_uuid, Program.tenant_id == user["tenant_id"]
    ).first()
    if not prog:
        raise HTTPException(404, "Program not found")

    q = db.query(Submission).filter(
        Submission.program_id == pid_uuid,
        Submission.tenant_id == user["tenant_id"],
    )
    if questionnaire_id:
        try:
            q = q.filter(Submission.questionnaire_id == _uuid.UUID(questionnaire_id))
        except ValueError:
            raise HTTPException(400, "Invalid questionnaire_id format")
    subs = q.all()

    try:
        enum_map = _build_enumerator_map(db, user["tenant_id"])

        rows = []
        for s in subs:
            try:
                flat = _flatten(s.data_json or {})
            except Exception as e:
                logger.warning("_flatten failed for submission %s: %s", s.id, e)
                flat = {}
            rows.append({
                "serial_no": s.serial_no or "",
                "submission_id": str(s.id),
                "enumerator_name": enum_map.get(s.enumerator_id, ""),
                "status": s.status or "",
                "received_at": str(s.server_received_at) if s.server_received_at else "",
                "household_id": s.household_id or "",
                **{k: (str(v) if not isinstance(v, (str, int, float, bool, type(None))) else v)
                   for k, v in flat.items()},
            })

        if not rows:
            df = pd.DataFrame(columns=["serial_no", "submission_id", "enumerator_name", "status", "received_at", "household_id"])
        else:
            df = pd.DataFrame(rows)

        buf = io.BytesIO()
        with pd.ExcelWriter(buf, engine="openpyxl") as writer:
            df.to_excel(writer, index=False, sheet_name="Submissions")
        buf.seek(0)

    except Exception as exc:
        import traceback as _tb
        _tb.print_exc()
        raise HTTPException(500, f"Export failed: {exc}")

    safe_name = (prog.scheme_name or prog.name or "program").replace(" ", "_")
    date_str = datetime.now().strftime("%Y%m%d")
    filename = f"{safe_name}_{date_str}.xlsx"

    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
