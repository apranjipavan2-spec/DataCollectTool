from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from fastapi.responses import Response
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.core.deps import require_role
from app.models.system_setting import SystemSetting
from app.models.form import Form
from app.models.submission import Submission
from app.services import ai_service

router = APIRouter()
require_org_admin   = require_role("org_admin")
require_supervisor  = require_role("org_admin", "supervisor")
require_master      = require_role("master_admin")


def _get_global_ai_cfg(db: Session) -> dict:
    row = db.query(SystemSetting).filter(SystemSetting.key == "ai_config").first()
    return row.value if row else {}


# ── AI Config (global — set by master_admin, visible to all) ──────────────

@router.get("/config")
def get_ai_config(user: dict = Depends(require_org_admin), db: Session = Depends(get_db)):
    """Any org_admin/supervisor can see AI status (not the key)."""
    cfg = _get_global_ai_cfg(db)
    return {
        "provider": cfg.get("provider"),
        "model": cfg.get("model"),
        "configured": bool(cfg.get("provider") and cfg.get("api_key")),
    }


@router.patch("/config")
def update_ai_config(body: dict, user: dict = Depends(require_master), db: Session = Depends(get_db)):
    """Only master_admin can set the global AI key — applies to ALL organisations."""
    row = db.query(SystemSetting).filter(SystemSetting.key == "ai_config").first()
    if not row:
        row = SystemSetting(key="ai_config", value={})
        db.add(row)
    row.value = {
        "provider": body.get("provider"),
        "api_key": body.get("api_key"),
        "model": body.get("model"),
    }
    db.commit()
    return {"ok": True, "provider": body.get("provider")}


# ── AI Features ───────────────────────────────────────────────────────────

@router.post("/report/{form_id}")
async def generate_report(form_id: str, user: dict = Depends(require_supervisor), db: Session = Depends(get_db)):
    cfg = _get_global_ai_cfg(db)
    form = db.query(Form).filter(Form.id == form_id, Form.tenant_id == user["tenant_id"]).first()
    if not form:
        raise HTTPException(404, "Form not found")
    subs = db.query(Submission).filter(
        Submission.form_id == form_id, Submission.tenant_id == user["tenant_id"]
    ).limit(50).all()
    field_labels = [
        f.get("label", f.get("id", ""))
        for section in (form.json_schema or {}).get("sections", [])
        for f in section.get("fields", [])
    ]
    sub_data = [s.data_json for s in subs if s.data_json]
    try:
        report_md = await ai_service.generate_report(cfg, form.title or "Survey", field_labels, sub_data)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(503, f"AI provider error: {e}")
    return {"report_md": report_md}


@router.post("/suggest-skip-logic")
async def suggest_skip_logic(body: dict, user: dict = Depends(require_org_admin), db: Session = Depends(get_db)):
    cfg = _get_global_ai_cfg(db)
    try:
        suggestions = await ai_service.suggest_skip_logic(cfg, body.get("question_text", ""), body.get("form_fields", []))
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(503, f"AI provider error: {e}")
    return {"suggestions": suggestions}


@router.post("/translate")
async def translate_labels(body: dict, user: dict = Depends(require_org_admin), db: Session = Depends(get_db)):
    cfg = _get_global_ai_cfg(db)
    try:
        translated = await ai_service.translate_labels(cfg, body.get("labels", []), body.get("target_lang", "Hindi"))
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(503, f"AI provider error: {e}")
    return {"translated": translated}


@router.post("/writer")
async def ai_writer(body: dict, user: dict = Depends(require_supervisor), db: Session = Depends(get_db)):
    cfg = _get_global_ai_cfg(db)
    try:
        report_md = await ai_service.generate_styled_report(
            cfg=cfg,
            style=body.get("style", "field_survey"),
            form_title=body.get("form_title", "Survey"),
            date_range=body.get("date_range", ""),
            sample_size=body.get("sample_size", 0),
            table_data=body.get("table_data", ""),
            chart_descriptions=body.get("chart_descriptions", ""),
            custom_context=body.get("custom_context", ""),
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(503, f"AI error: {e}")
    return {"report_md": report_md}


@router.post("/writer/export-docx")
def export_docx(body: dict, user: dict = Depends(require_supervisor)):
    import io, re
    try:
        from docx import Document
        from docx.shared import Pt
        from docx.enum.text import WD_ALIGN_PARAGRAPH
    except ImportError:
        raise HTTPException(503, "python-docx not installed")

    md = body.get("report_md", "")
    title = body.get("title", "Report")
    doc = Document()
    t = doc.add_heading(title, 0)
    t.alignment = WD_ALIGN_PARAGRAPH.CENTER
    for line in md.split('\n'):
        line = line.strip()
        if not line:
            doc.add_paragraph('')
        elif line.startswith('## '):
            doc.add_heading(line[3:], level=1)
        elif line.startswith('### '):
            doc.add_heading(line[4:], level=2)
        elif line.startswith('# '):
            doc.add_heading(line[2:], level=1)
        else:
            p = doc.add_paragraph()
            for part in re.split(r'(\*\*.*?\*\*)', line):
                if part.startswith('**') and part.endswith('**'):
                    p.add_run(part[2:-2]).bold = True
                else:
                    p.add_run(part)
    buf = io.BytesIO()
    doc.save(buf)
    buf.seek(0)
    return Response(
        content=buf.read(),
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": f'attachment; filename="{title}.docx"'},
    )


# ── AI Form Generation ────────────────────────────────────────────────────

@router.post("/generate-form")
async def generate_form(
    body: dict,
    background_tasks: BackgroundTasks,
    user: dict = Depends(require_org_admin),
    db: Session = Depends(get_db),
):
    """
    Generate a complete form schema from study objectives.
    Returns immediately with form_id + status='pending'.
    Client polls GET /forms/{form_id}/generation-status.
    Body: { objectives, study_type, reference_form_ids?, notify_email? }
    """
    import uuid as _uuid
    from app.core.database import SessionLocal

    cfg = _get_global_ai_cfg(db)
    if not cfg.get("api_key"):
        raise HTTPException(400, "AI not configured. Contact your platform administrator.")

    objectives = body.get("objectives", "").strip()
    if not objectives:
        raise HTTPException(400, "objectives is required")

    study_type = body.get("study_type", "field_survey")
    reference_form_ids = body.get("reference_form_ids", [])

    # Fetch reference form schemas for context (max 3 to keep prompt manageable)
    ref_schemas = []
    for fid in reference_form_ids[:3]:
        ref = db.query(Form).filter(Form.id == fid, Form.tenant_id == user["tenant_id"]).first()
        if ref and ref.json_schema:
            ref_schemas.append({"title": ref.title, "schema": ref.json_schema})

    # Create placeholder form with pending status
    new_form = Form(
        tenant_id=user["tenant_id"],
        title=f"[Generating…] {study_type.replace('_', ' ').title()} Form",
        json_schema={"title": "", "sections": [], "version": 1},
        version=1,
        status="draft",
        created_by=user.get("sub"),
        generation_status="pending",
    )
    db.add(new_form)
    db.commit()
    db.refresh(new_form)
    form_id = str(new_form.id)
    tenant_id = str(user["tenant_id"])

    async def _run():
        from app.core.database import SessionLocal
        with SessionLocal() as sess:
            form_rec = sess.query(Form).filter(Form.id == form_id).first()
            if not form_rec:
                return
            try:
                result = await ai_service.generate_form_schema(
                    cfg=cfg,
                    objectives=objectives,
                    study_type=study_type,
                    reference_schemas=ref_schemas,
                )
                form_rec.json_schema = result["schema"]
                form_rec.title = result.get("title", "Generated Form")
                form_rec.generation_status = "done"
                form_rec.generation_error = None
            except Exception as e:
                form_rec.generation_status = "failed"
                form_rec.generation_error = str(e)
            sess.commit()

    background_tasks.add_task(_run)
    return {"form_id": form_id, "status": "pending", "message": "Form generation started. Check back in ~1–2 minutes."}
