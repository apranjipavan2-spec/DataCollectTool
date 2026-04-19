from datetime import datetime, timezone
import uuid as _uuid
from fastapi import APIRouter, Depends, File, UploadFile, HTTPException, Request
from fastapi.params import Form as FormParam
from pydantic import BaseModel
from typing import Any, Optional
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.core.deps import require_enumerator
from app.core.rate_limit import limiter
from app.models.submission import Submission
from app.models.media_file import MediaFile
from app.models.form import Form
from app.models.sync_log import SyncLog
from app.services.webhook import fire_webhooks
import logging

logger = logging.getLogger(__name__)
router = APIRouter()


class SubmissionPayload(BaseModel):
    local_id: str           # client-side UUID to correlate responses
    form_id: str
    form_version: int
    data_json: dict[str, Any]
    gps_open: Optional[dict] = None
    gps_submit: Optional[dict] = None
    local_created_at: str


class PushRequest(BaseModel):
    submissions: list[SubmissionPayload]


@router.post("/push")
@limiter.limit("60/minute")
def push(request: Request, body: PushRequest, user=Depends(require_enumerator), db: Session = Depends(get_db)):
    """Receive batched offline submissions from enumerator device."""
    # ── Plan enforcement — check before accepting any submissions ────────
    if body.submissions:
        from app.models.tenant import Tenant
        from app.services.plan_enforcement import check_submission_limit
        tenant = db.query(Tenant).filter(Tenant.id == user["tenant_id"]).first()
        plan_tier = tenant.plan_tier if tenant else "free"
        check = check_submission_limit(db, str(user["tenant_id"]), plan_tier)
        if not check["allowed"]:
            raise HTTPException(status_code=402, detail=check["reason"])

    results = []
    for item in body.submissions:
        # Idempotency: check if this local_id was already synced
        existing = db.query(Submission).filter(
            Submission.local_id == item.local_id,
            Submission.enumerator_id == user["sub"],
        ).first()
        if existing:
            results.append({"local_id": item.local_id, "server_id": str(existing.id), "status": "duplicate"})
            continue

        # Auto-assign next serial_no for this tenant
        from sqlalchemy import func as _func
        next_serial = (
            db.query(_func.coalesce(_func.max(Submission.serial_no), 0) + 1)
            .filter(Submission.tenant_id == user["tenant_id"])
            .scalar()
        ) or 1

        sub = Submission(
            tenant_id=user["tenant_id"],
            form_id=item.form_id,
            form_version=item.form_version,
            enumerator_id=user["sub"],
            local_id=item.local_id,
            data_json=item.data_json,
            gps_open=item.gps_open,
            gps_submit=item.gps_submit,
            local_created_at=datetime.fromisoformat(item.local_created_at),
            serial_no=next_serial,
        )
        db.add(sub)
        db.flush()  # get sub.id before commit
        results.append({"local_id": item.local_id, "server_id": str(sub.id), "status": "synced", "serial_no": next_serial})

    # Log sync event
    log = SyncLog(
        tenant_id=user["tenant_id"],
        enumerator_id=user["sub"],
        direction="push",
        records_count=len(body.submissions),
    )
    db.add(log)
    db.commit()

    # Fire webhooks for each synced submission (never blocks response)
    for item in body.submissions:
        matching = [r for r in results if r["local_id"] == item.local_id and r["status"] == "synced"]
        if matching:
            try:
                fire_webhooks(db, user["tenant_id"], "submission.created", {
                    "submission_id": matching[0]["server_id"],
                    "form_id": item.form_id,
                    "enumerator_id": str(user["sub"]),
                    "data_json": item.data_json,
                    "status": "synced",
                })
            except Exception:
                logger.warning("Webhook fire failed for synced submission %s", matching[0]["server_id"])

    return {"received": len(results), "results": results, "server_time": datetime.now(timezone.utc).isoformat()}


@router.post("/media")
@limiter.limit("60/minute")
async def upload_media(
    request: Request,
    submission_id: str = FormParam(...),
    field_name: str = FormParam(...),
    file_type: str = FormParam("photo"),            # 'photo' | 'audio'
    file: UploadFile = File(...),
    user=Depends(require_enumerator),
    db: Session = Depends(get_db),
):
    """Upload a single media file for a submission field.

    Called after /sync/push for each photo/audio field. Idempotent —
    re-uploading the same (submission_id, field_name) replaces the old file.
    """
    # Verify submission belongs to this user's tenant
    sub = db.query(Submission).filter(
        Submission.id == submission_id,
        Submission.tenant_id == user["tenant_id"],
    ).first()
    if not sub:
        raise HTTPException(status_code=404, detail="Submission not found")

    # Read file content
    content = await file.read()
    if len(content) > 10 * 1024 * 1024:  # 10MB safety limit (before compression)
        raise HTTPException(status_code=413, detail="File too large (max 10MB)")

    mime = file.content_type or "application/octet-stream"
    original_size = len(content)

    # ── Compress photos server-side before storage ────────────────
    if file_type == "photo" and mime.startswith("image/"):
        from app.core.image_compress import compress_image
        content, mime = compress_image(content, mime)

    ext = _guess_extension(mime)
    filename = f"{field_name}{ext}"
    tenant_id_str = str(user["tenant_id"])
    # ── Upload via modular storage backend ─────────────────────────
    from app.core.storage import get_storage
    storage = get_storage()
    key = f"{tenant_id_str}/{submission_id}/{filename}"
    cloud_url = storage.upload(content, key, mime)

    # ── Upsert media_file record ────────────────────────────────────
    existing = db.query(MediaFile).filter(
        MediaFile.submission_id == submission_id,
        MediaFile.field_name == field_name,
    ).first()

    if existing:
        existing.cloud_url = cloud_url
        existing.file_size_bytes = len(content)
        existing.mime_type = mime
        media_id = existing.id
    else:
        mf = MediaFile(
            tenant_id=user["tenant_id"],
            submission_id=submission_id,
            field_name=field_name,
            file_type=file_type,
            mime_type=mime,
            cloud_url=cloud_url,
            file_size_bytes=len(content),
        )
        db.add(mf)
        db.flush()
        media_id = mf.id

    # Update submission data_json — replace placeholder with media reference
    data = dict(sub.data_json or {})
    data[field_name] = f"media://{media_id}"
    sub.data_json = data
    db.commit()

    return {
        "media_id": str(media_id),
        "field_name": field_name,
        "original_size": original_size,
        "compressed_size": len(content),
        "cloud_url": cloud_url,
        "status": "uploaded",
    }


def _guess_extension(content_type: str) -> str:
    """Map MIME type to file extension."""
    mapping = {
        "image/jpeg": ".jpg",
        "image/png": ".png",
        "image/webp": ".webp",
        "audio/webm": ".webm",
        "audio/ogg": ".ogg",
        "audio/mp4": ".m4a",
        "audio/mpeg": ".mp3",
    }
    return mapping.get(content_type, ".bin")


@router.get("/pull")
def pull(last_sync: Optional[str] = None, user=Depends(require_enumerator), db: Session = Depends(get_db)):
    """Return active form definitions updated since last_sync."""
    q = db.query(Form).filter(Form.tenant_id == user["tenant_id"], Form.status == "active")

    if last_sync:
        since = datetime.fromisoformat(last_sync)
        q = q.filter(Form.updated_at > since)

    forms = q.all()
    return {
        "forms": [{"id": str(f.id), "title": f.title,
                   "json_schema": f.json_schema, "version": f.version} for f in forms],
        "server_time": datetime.now(timezone.utc).isoformat(),
    }
