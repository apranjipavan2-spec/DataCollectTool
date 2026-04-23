from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.core.deps import require_role
from app.models.tenant import Tenant
from app.models.form import Form
from app.models.submission import Submission
from app.services import ai_service

router = APIRouter()
require_org_admin = require_role("org_admin")
require_supervisor = require_role("supervisor")


@router.get("/config")
def get_ai_config(user: dict = Depends(require_org_admin), db: Session = Depends(get_db)):
    tenant = db.query(Tenant).filter(Tenant.id == user["tenant_id"]).first()
    cfg = tenant.ai_config or {} if tenant else {}
    return {
        "provider": cfg.get("provider"),
        "model": cfg.get("model"),
        "configured": bool(cfg.get("provider") and cfg.get("api_key")),
    }


@router.patch("/config")
def update_ai_config(body: dict, user: dict = Depends(require_org_admin), db: Session = Depends(get_db)):
    tenant = db.query(Tenant).filter(Tenant.id == user["tenant_id"]).first()
    if not tenant:
        raise HTTPException(404, "Tenant not found")
    tenant.ai_config = {
        "provider": body.get("provider"),
        "api_key": body.get("api_key"),
        "model": body.get("model"),
    }
    db.commit()
    return {"ok": True}


@router.post("/report/{form_id}")
async def generate_report(form_id: str, user: dict = Depends(require_supervisor), db: Session = Depends(get_db)):
    tenant = db.query(Tenant).filter(Tenant.id == user["tenant_id"]).first()
    form = db.query(Form).filter(Form.id == form_id, Form.tenant_id == user["tenant_id"]).first()
    if not form:
        raise HTTPException(404, "Form not found")
    subs = db.query(Submission).filter(
        Submission.form_id == form_id,
        Submission.tenant_id == user["tenant_id"]
    ).limit(50).all()
    field_labels = [
        f.get("label", f.get("id", ""))
        for section in (form.json_schema or {}).get("sections", [])
        for f in section.get("fields", [])
    ]
    sub_data = [s.data_json for s in subs if s.data_json]
    try:
        report_md = await ai_service.generate_report(tenant, form.title or "Survey", field_labels, sub_data)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(503, f"AI provider error: {e}")
    return {"report_md": report_md}


@router.post("/suggest-skip-logic")
async def suggest_skip_logic(body: dict, user: dict = Depends(require_org_admin), db: Session = Depends(get_db)):
    tenant = db.query(Tenant).filter(Tenant.id == user["tenant_id"]).first()
    try:
        suggestions = await ai_service.suggest_skip_logic(
            tenant, body.get("question_text", ""), body.get("form_fields", [])
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(503, f"AI provider error: {e}")
    return {"suggestions": suggestions}


@router.post("/translate")
async def translate_labels(body: dict, user: dict = Depends(require_org_admin), db: Session = Depends(get_db)):
    tenant = db.query(Tenant).filter(Tenant.id == user["tenant_id"]).first()
    try:
        translated = await ai_service.translate_labels(
            tenant, body.get("labels", []), body.get("target_lang", "Hindi")
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(503, f"AI provider error: {e}")
    return {"translated": translated}
