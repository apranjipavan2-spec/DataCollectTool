from datetime import datetime, timezone
import math
import uuid as _uuid
from fastapi import APIRouter, BackgroundTasks, Depends, File, UploadFile, HTTPException, Request
from sqlalchemy import func as _func
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
from app.models.tenant import Tenant
from app.services.webhook import fire_webhooks
from app.services.whatsapp import notify as wa_notify
from app.services.telegram import notify as tg_notify
from app.services.sheets_sync import sync_submission
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
    last_modified_at: Optional[str] = None  # client-side edit timestamp for conflict resolution
    # Program tracking (optional — set when collecting under a program)
    program_id: Optional[str] = None
    participant_type_id: Optional[str] = None
    questionnaire_id: Optional[str] = None
    location_id: Optional[str] = None
    # DPDP consent
    consent_given: Optional[bool] = True
    consent_timestamp: Optional[str] = None


def _haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    R = 6_371_000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _run_validation(form_schema: dict, data_json: dict) -> list[dict]:
    import re
    rules = (form_schema.get("settings") or {}).get("validation_rules") or []
    violations = []
    for rule in rules:
        field_id = rule.get("field_id", "")
        operator = rule.get("operator", "")
        rule_val = rule.get("value", "")
        message = rule.get("message", f"Validation failed for {field_id}")
        val = data_json.get(field_id)
        failed = False
        if operator == "min":
            try:
                failed = val is None or float(val) < float(rule_val)
            except (TypeError, ValueError):
                failed = True
        elif operator == "max":
            try:
                failed = val is None or float(val) > float(rule_val)
            except (TypeError, ValueError):
                failed = True
        elif operator == "regex":
            try:
                failed = not re.fullmatch(rule_val, str(val or ""))
            except re.error:
                failed = False
        elif operator == "required_if_field":
            other_val = data_json.get(rule_val)
            if other_val not in (None, "", [], False):
                failed = val in (None, "", [], False)
        if failed:
            violations.append({"field_id": field_id, "rule": operator, "message": message})
    return violations


def _check_duplicate(db: Session, sub: Submission, data_json: dict, enumerator_id: str) -> bool:
    from sqlalchemy import func, cast, Date
    same_day_subs = (
        db.query(Submission)
        .filter(
            Submission.form_id == sub.form_id,
            Submission.tenant_id == sub.tenant_id,
            Submission.id != sub.id,
            cast(Submission.server_received_at, Date) == cast(func.now(), Date),
        )
        .all()
    )
    if not same_day_subs:
        return False

    gps_str = next(
        (v for v in data_json.values() if isinstance(v, str) and "," in v and _is_coord_string(v)),
        None,
    )
    if gps_str:
        try:
            lat1, lng1 = (float(x.strip()) for x in gps_str.split(",", 1))
            for other in same_day_subs:
                other_gps = next(
                    (v for v in (other.data_json or {}).values() if isinstance(v, str) and "," in v and _is_coord_string(v)),
                    None,
                )
                if other_gps:
                    try:
                        lat2, lng2 = (float(x.strip()) for x in other_gps.split(",", 1))
                        if _haversine_m(lat1, lng1, lat2, lng2) <= 50:
                            return True
                    except ValueError:
                        pass
        except ValueError:
            pass

    same_enum = any(str(s.enumerator_id) == str(enumerator_id) for s in same_day_subs)
    return same_enum


def _is_coord_string(s: str) -> bool:
    parts = s.split(",", 1)
    if len(parts) != 2:
        return False
    try:
        lat, lng = float(parts[0].strip()), float(parts[1].strip())
        return -90 <= lat <= 90 and -180 <= lng <= 180
    except ValueError:
        return False


class PushRequest(BaseModel):
    submissions: list[SubmissionPayload]


def _post_push_side_effects(
    tenant_id: str,
    enumerator_id: str,
    enumerator_name: str,
    synced_data: list,  # [{form_id, data_json, server_id, serial_no}]
):
    """Webhooks, WA/TG notifications, and Sheets sync — runs after response is sent."""
    from app.core.database import SessionLocal
    db = SessionLocal()
    try:
        tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
        for item in synced_data:
            try:
                fire_webhooks(db, tenant_id, "submission.created", {
                    "submission_id": item["server_id"],
                    "form_id": item["form_id"],
                    "enumerator_id": enumerator_id,
                    "data_json": item["data_json"],
                    "status": "synced",
                })
            except Exception:
                logger.warning("Webhook fire failed for submission %s", item["server_id"])

        if synced_data and tenant:
            first_form_id = synced_data[0]["form_id"]
            form_obj = db.query(Form).filter(Form.id == first_form_id).first()
            notify_params = {
                "count": len(synced_data),
                "form_title": form_obj.title if form_obj else first_form_id,
                "enumerator": enumerator_name,
            }
            wa_notify(tenant, "submission.created", notify_params)
            import asyncio as _asyncio
            try:
                _asyncio.run(tg_notify(tenant, "submission.created", notify_params))
            except Exception as e:
                logger.debug("Telegram notification failed (non-fatal): %s", e)

        for item in synced_data:
            form_obj = db.query(Form).filter(Form.id == item["form_id"]).first()
            if form_obj:
                try:
                    sync_submission(form_obj, item["data_json"], {
                        "_sheet": form_obj.title,
                        "_submission_id": item["server_id"],
                        "_serial_no": item["serial_no"],
                        "_synced_at": datetime.now(timezone.utc).isoformat(),
                    })
                except Exception:
                    logger.warning("Sheets sync failed for submission %s", item["server_id"])
    finally:
        db.close()


@router.post("/push")
@limiter.limit("60/minute")
def push(request: Request, body: PushRequest, background_tasks: BackgroundTasks, user=Depends(require_enumerator), db: Session = Depends(get_db)):
    """Receive batched offline submissions from enumerator device."""
    # ── Payload size guards ──────────────────────────────────────────────
    content_length = request.headers.get("content-length")
    if content_length and int(content_length) > 5 * 1024 * 1024:  # 5 MB JSON cap
        raise HTTPException(status_code=413, detail="Request payload too large (max 5MB)")
    if len(body.submissions) > 500:
        raise HTTPException(status_code=400, detail="Batch too large (max 500 submissions per push)")

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
    # Compute starting serial_no once (avoids N+1 queries in the batch loop)
    serial_counter = (
        db.query(_func.coalesce(_func.max(Submission.serial_no), 0))
        .filter(Submission.tenant_id == user["tenant_id"])
        .scalar()
    ) or 0

    for item in body.submissions:
        # Idempotency: check if this local_id was already synced
        existing = db.query(Submission).filter(
            Submission.local_id == item.local_id,
            Submission.enumerator_id == user["sub"],
        ).first()
        if existing:
            # Last-write-wins: if client reports a newer edit timestamp, update the stored submission
            if item.last_modified_at:
                try:
                    incoming_dt = datetime.fromisoformat(item.last_modified_at.replace("Z", "+00:00")).replace(tzinfo=None)
                    reference_dt = getattr(existing, "updated_at", None) or existing.local_created_at
                    existing_dt = reference_dt.replace(tzinfo=None) if reference_dt else None
                    if existing_dt is None or incoming_dt > existing_dt:
                        new_data = dict(item.data_json)
                        new_data["_conflict_resolved"] = True
                        existing.data_json = new_data
                        existing.form_version = item.form_version
                        db.flush()
                        results.append({"local_id": item.local_id, "server_id": str(existing.id), "status": "conflict_resolved"})
                        continue
                except (ValueError, TypeError, AttributeError):
                    pass
            results.append({"local_id": item.local_id, "server_id": str(existing.id), "status": "duplicate"})
            continue

        serial_counter += 1
        next_serial = serial_counter

        consent_ts = None
        if item.consent_timestamp:
            try:
                consent_ts = datetime.fromisoformat(item.consent_timestamp)
            except ValueError:
                pass

        data_for_storage = dict(item.data_json)
        roster_id = data_for_storage.pop("_roster_id", None)

        # Auto-inject location hierarchy from the linked ProgramLocation (zero burden on enumerator)
        if item.location_id:
            from app.models.program import ProgramLocation
            _loc = db.query(ProgramLocation).filter(ProgramLocation.id == item.location_id).first()
            if _loc:
                data_for_storage["_location_state"]    = _loc.state or ""
                data_for_storage["_location_district"] = _loc.district or ""
                data_for_storage["_location_block"]    = _loc.block or ""
                data_for_storage["_location_village"]  = _loc.village or ""

        sub = Submission(
            tenant_id=user["tenant_id"],
            form_id=item.form_id,
            form_version=item.form_version,
            enumerator_id=user["sub"],
            local_id=item.local_id,
            data_json=data_for_storage,
            gps_open=item.gps_open,
            gps_submit=item.gps_submit,
            local_created_at=datetime.fromisoformat(item.local_created_at),
            serial_no=next_serial,
            program_id=item.program_id,
            participant_type_id=item.participant_type_id,
            questionnaire_id=item.questionnaire_id,
            location_id=item.location_id,
            consent_given=item.consent_given if item.consent_given is not None else True,
            consent_timestamp=consent_ts,
            roster_id=roster_id,
        )
        db.add(sub)
        db.flush()  # get sub.id before commit

        if roster_id:
            from app.models.roster import RespondentRoster
            roster_entry = db.query(RespondentRoster).filter(
                RespondentRoster.id == roster_id,
                RespondentRoster.tenant_id == user["tenant_id"],
            ).first()
            if roster_entry and roster_entry.status in ("pending", "visited"):
                roster_entry.status = "completed"

        # Validation rules
        form_obj_for_val = db.query(Form).filter(Form.id == item.form_id).first()
        if form_obj_for_val and form_obj_for_val.json_schema:
            violations = _run_validation(form_obj_for_val.json_schema, data_for_storage)
            if violations:
                data = dict(sub.data_json or {})
                data["_validation_violations"] = violations
                sub.data_json = data
                sub.has_violations = True

        # Duplicate detection
        is_dup = _check_duplicate(db, sub, data_for_storage, str(user["sub"]))
        if is_dup:
            data = dict(sub.data_json or {})
            data["_duplicate_suspect"] = True
            sub.data_json = data

        # Geofence check
        if form_obj_for_val:
            geo = (form_obj_for_val.json_schema or {}).get("settings", {}).get("geofence", {})
            if geo.get("enabled") and geo.get("lat") is not None and geo.get("lng") is not None and geo.get("radius_meters"):
                gps_val = next(
                    (v for v in data_for_storage.values() if isinstance(v, str) and "," in v and _is_coord_string(v)),
                    None,
                )
                if gps_val:
                    try:
                        slat, slng = (float(x.strip()) for x in gps_val.split(",", 1))
                        dist = _haversine_m(geo["lat"], geo["lng"], slat, slng)
                        if dist > geo["radius_meters"]:
                            d = dict(sub.data_json or {})
                            d["geofence_violation"] = True
                            sub.data_json = d
                    except ValueError:
                        pass

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

    # Schedule webhooks + notifications + Sheets sync as a background task so the
    # response is returned immediately after the DB commit.
    synced_data = [
        {
            "form_id": item.form_id,
            "data_json": dict(item.data_json),
            "server_id": r["server_id"],
            "serial_no": r.get("serial_no", ""),
        }
        for item in body.submissions
        for r in results
        if r["local_id"] == item.local_id and r["status"] == "synced"
    ]
    if synced_data:
        background_tasks.add_task(
            _post_push_side_effects,
            str(user["tenant_id"]),
            str(user["sub"]),
            user.get("name", str(user["sub"])),
            synced_data,
        )

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

    # Enforce storage limit before accepting the upload
    from app.services.plan_enforcement import check_storage_limit
    from app.models.tenant import Tenant
    tenant = db.query(Tenant).filter(Tenant.id == user["tenant_id"]).first()
    if tenant:
        storage_result = check_storage_limit(db, str(user["tenant_id"]), tenant.plan_tier)
        if not storage_result["allowed"]:
            raise HTTPException(status_code=402, detail=storage_result["reason"])

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
    base = content_type.split(";")[0].strip().lower()  # drop codec params, e.g. "audio/webm;codecs=opus"
    return mapping.get(base, ".bin")


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
