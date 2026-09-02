import hashlib
import re
from fastapi import APIRouter, Depends, HTTPException, Request, status
from app.core.rate_limit import limiter
from pydantic import BaseModel
from typing import Any, Optional
from sqlalchemy import func
from sqlalchemy.orm import Session, load_only
from app.core.database import get_db
from app.core.deps import require_org_admin, require_enumerator
from app.models.form import Form
from app.models.form_assignment import FormAssignment
from app.models.form_version import FormVersion
from app.models.submission import Submission
from app.models.tenant import Tenant

router = APIRouter()


# ── Request / Response schemas ───────────────────────────────────────────────


class FormCreate(BaseModel):
    title: str
    json_schema: dict[str, Any]


class FormUpdate(BaseModel):
    title: Optional[str] = None
    json_schema: Optional[dict[str, Any]] = None
    status: Optional[str] = None
    allow_enumerator_edit: Optional[bool] = None  # None = clear override (use org default)


class BulkEditSettingRequest(BaseModel):
    allow_enumerator_edit: Optional[bool]  # None = reset to org default


class AssignArmRequest(BaseModel):
    respondent_key: str


class MigrateRequest(BaseModel):
    from_version: int
    to_version: int


class ApplyMigrateRequest(BaseModel):
    from_version: int
    to_version: int


# ── Helpers ──────────────────────────────────────────────────────────────────


def _extract_field_keys(schema: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """Return a flat mapping of field_key -> field_definition from a FieldGovern
    form JSON schema.  Handles both top-level ``fields`` lists and
    ``sections[].fields`` lists."""
    fields: dict[str, dict[str, Any]] = {}
    # Top-level fields
    for f in schema.get("fields", []):
        key = f.get("key") or f.get("name") or f.get("id")
        if key:
            fields[key] = f
    # Section-level fields
    for section in schema.get("sections", []):
        for f in section.get("fields", []):
            key = f.get("key") or f.get("name") or f.get("id")
            if key:
                fields[key] = f
    return fields


def _compute_schema_diff(
    old_schema: dict[str, Any],
    new_schema: dict[str, Any],
) -> dict[str, Any]:
    """Compare two form schemas and return a structured diff."""
    old_fields = _extract_field_keys(old_schema)
    new_fields = _extract_field_keys(new_schema)

    old_keys = set(old_fields.keys())
    new_keys = set(new_fields.keys())

    added = sorted(new_keys - old_keys)
    removed = sorted(old_keys - new_keys)

    # Detect possible renames: removed field whose label matches an added field
    rename_map: dict[str, str] = {}  # old_key -> new_key
    if removed and added:
        old_labels: dict[str, str] = {}
        for k in removed:
            label = old_fields[k].get("label", "").strip().lower()
            if label:
                old_labels[label] = k

        for k in added:
            label = new_fields[k].get("label", "").strip().lower()
            if label and label in old_labels:
                rename_map[old_labels[label]] = k

        # Clean up: don't list renamed fields as added/removed
        for old_k, new_k in rename_map.items():
            removed = [r for r in removed if r != old_k]
            added = [a for a in added if a != new_k]

    # Detect type changes on fields that exist in both versions
    type_changes: list[dict[str, Any]] = []
    for key in sorted(old_keys & new_keys):
        old_type = old_fields[key].get("type")
        new_type = new_fields[key].get("type")
        if old_type != new_type:
            type_changes.append({"key": key, "old_type": old_type, "new_type": new_type})

    return {
        "added": added,
        "removed": removed,
        "renamed": rename_map,
        "type_changes": type_changes,
    }


def _snapshot_version(db: Session, form: Form) -> FormVersion:
    """Persist the form's *current* schema as a FormVersion record."""
    fv = FormVersion(
        form_id=form.id,
        version=form.version,
        json_schema=form.json_schema,
    )
    db.add(fv)
    return fv


# Mirrors the grammar frontend's evalFormula (frontend/src/lib/formUtils.ts)
# actually supports — kept in sync manually if that grammar changes.
_FORMULA_ALLOWED_CHARS = re.compile(r'^[\w\s()+\-*/%.,<>=!&|"\'?:]*$')
_FORMULA_KNOWN_FUNCS = {"if", "sum", "round", "abs", "max", "min", "concat", "len", "contains", "num", "text", "age", "ageAtLeast"}
_FORMULA_FUNC_CALL = re.compile(r'([A-Za-z_][A-Za-z0-9_]*)\s*\(')


def _validate_schema_formulas(schema: dict[str, Any]) -> None:
    """Reject a save if any calculated-field formula is malformed.

    The builder UI only ever produces well-formed formulas (validated client-side
    via expr-eval), but this route accepts json_schema directly, so a raw API call
    could push a broken formula that silently fails for every enumerator who
    later opens the form. This isn't a sandboxing check — expr-eval already runs
    formulas safely — it's a guard against corrupt schemas reaching the renderer.
    """
    for key, field in _extract_field_keys(schema).items():
        if field.get("type") != "calculated":
            continue
        formula = field.get("formula")
        if not formula:
            continue
        if not isinstance(formula, str) or not formula.strip():
            raise ValueError(f"Field '{key}': formula must be a non-empty string")
        if not _FORMULA_ALLOWED_CHARS.match(formula):
            raise ValueError(f"Field '{key}': formula contains disallowed characters")
        if formula.count("(") != formula.count(")"):
            raise ValueError(f"Field '{key}': unbalanced parentheses in formula")
        for fn in _FORMULA_FUNC_CALL.findall(formula):
            if fn not in _FORMULA_KNOWN_FUNCS:
                raise ValueError(f"Field '{key}': unknown function '{fn}()' in formula")


def _get_form_for_tenant(db: Session, form_id: str, tenant_id: str) -> Form:
    form = db.query(Form).filter(
        Form.id == form_id, Form.tenant_id == tenant_id
    ).first()
    if not form:
        raise HTTPException(status_code=404, detail="Form not found")
    return form


# ── CRUD routes ──────────────────────────────────────────────────────────────


@router.get("/")
def list_forms(
    status: Optional[str] = None,
    user=Depends(require_enumerator),
    db: Session = Depends(get_db),
):
    q = db.query(Form).filter(Form.tenant_id == user["tenant_id"])
    if status:
        q = q.filter(Form.status == status)
    else:
        # Hide archived (soft-deleted) forms from the default list; they remain
        # fetchable via ?status=archived.
        q = q.filter(Form.status != "archived")

    # Enumerators only see forms assigned to them; admins/supervisors see all
    if user.get("role") == "enumerator":
        assigned_ids = db.query(FormAssignment.form_id).filter(
            FormAssignment.enumerator_id == user["sub"],
            FormAssignment.tenant_id == user["tenant_id"],
        ).subquery()
        q = q.filter(Form.id.in_(assigned_ids))

    forms = q.options(load_only(Form.id, Form.title, Form.version, Form.status, Form.updated_at, Form.allow_enumerator_edit)).order_by(Form.title).all()
    return [{"id": str(f.id), "title": f.title, "version": f.version,
             "status": f.status, "updated_at": f.updated_at,
             "allow_enumerator_edit": f.allow_enumerator_edit} for f in forms]


@router.post("/", status_code=status.HTTP_201_CREATED)
@limiter.limit("20/minute")
def create_form(request: Request, body: FormCreate, user=Depends(require_org_admin), db: Session = Depends(get_db)):
    try:
        _validate_schema_formulas(body.json_schema)
    except ValueError as e:
        raise HTTPException(422, str(e))
    # Forms are created as drafts — the active-forms limit is checked at activation time.
    form = Form(
        tenant_id=user["tenant_id"],
        title=body.title,
        json_schema=body.json_schema,
        created_by=user["sub"],
    )
    db.add(form)
    db.flush()  # get form.id before creating version snapshot

    # Save the initial schema as version 1
    _snapshot_version(db, form)

    db.commit()
    db.refresh(form)
    return {"id": str(form.id), "version": form.version, "status": form.status}


@router.get("/{form_id}")
def get_form(form_id: str, user=Depends(require_enumerator), db: Session = Depends(get_db)):
    form = _get_form_for_tenant(db, form_id, user["tenant_id"])
    return {"id": str(form.id), "title": form.title, "json_schema": form.json_schema,
            "version": form.version, "status": form.status}


@router.get("/{form_id}/generation-status")
def get_generation_status(form_id: str, user=Depends(require_org_admin), db: Session = Depends(get_db)):
    """Poll AI form generation progress."""
    form = _get_form_for_tenant(db, form_id, user["tenant_id"])
    return {
        "form_id": str(form.id),
        "status": form.generation_status or "done",
        "title": form.title,
        "error": form.generation_error,
    }


@router.put("/{form_id}")
def update_form(form_id: str, body: FormUpdate, user=Depends(require_org_admin), db: Session = Depends(get_db)):
    form = _get_form_for_tenant(db, form_id, user["tenant_id"])

    if body.title is not None:
        form.title = body.title

    if body.json_schema is not None:
        try:
            _validate_schema_formulas(body.json_schema)
        except ValueError as e:
            raise HTTPException(422, str(e))
        # Increment version and snapshot the new schema
        form.version += 1
        form.json_schema = body.json_schema
        _snapshot_version(db, form)

    if body.status is not None:
        # Enforce active-forms limit when activating a non-active form
        if body.status == "active" and form.status != "active":
            from app.services.plan_enforcement import check_active_forms_limit
            tenant = db.query(Tenant).filter(Tenant.id == user["tenant_id"]).first()
            if tenant:
                result = check_active_forms_limit(db, str(user["tenant_id"]), tenant.plan_tier)
                if not result["allowed"]:
                    raise HTTPException(status_code=402, detail=result["reason"])
        form.status = body.status

    if "allow_enumerator_edit" in body.model_fields_set:
        form.allow_enumerator_edit = body.allow_enumerator_edit

    db.commit()
    db.refresh(form)
    return {"id": str(form.id), "version": form.version, "status": form.status}


@router.patch("/bulk-edit-setting")
def bulk_update_edit_setting(body: BulkEditSettingRequest, user=Depends(require_org_admin), db: Session = Depends(get_db)):
    db.query(Form).filter(Form.tenant_id == user["tenant_id"]).update(
        {"allow_enumerator_edit": body.allow_enumerator_edit}
    )
    db.commit()
    return {"updated": True}


@router.delete("/{form_id}", status_code=status.HTTP_204_NO_CONTENT)
def archive_form(form_id: str, user=Depends(require_org_admin), db: Session = Depends(get_db)):
    form = _get_form_for_tenant(db, form_id, user["tenant_id"])
    form.status = "archived"
    db.commit()


# ── Version history routes ───────────────────────────────────────────────────


@router.get("/{form_id}/versions")
def list_form_versions(
    form_id: str,
    user=Depends(require_enumerator),
    db: Session = Depends(get_db),
):
    """Return all schema versions for a form, newest first."""
    # Verify form exists and belongs to tenant
    _get_form_for_tenant(db, form_id, user["tenant_id"])

    versions = (
        db.query(FormVersion)
        .filter(FormVersion.form_id == form_id)
        .order_by(FormVersion.version.desc())
        .all()
    )
    return [
        {
            "id": str(v.id),
            "form_id": str(v.form_id),
            "version": v.version,
            "created_at": v.created_at,
        }
        for v in versions
    ]


@router.get("/{form_id}/versions/{version}")
def get_form_version(
    form_id: str,
    version: int,
    user=Depends(require_enumerator),
    db: Session = Depends(get_db),
):
    """Return the full schema snapshot for a specific version."""
    _get_form_for_tenant(db, form_id, user["tenant_id"])

    fv = (
        db.query(FormVersion)
        .filter(FormVersion.form_id == form_id, FormVersion.version == version)
        .first()
    )
    if not fv:
        raise HTTPException(status_code=404, detail=f"Version {version} not found")

    return {
        "id": str(fv.id),
        "form_id": str(fv.form_id),
        "version": fv.version,
        "json_schema": fv.json_schema,
        "created_at": fv.created_at,
    }


# ── Submission migration preview ─────────────────────────────────────────────


@router.post("/{form_id}/migrate")
def preview_submission_migration(
    form_id: str,
    body: MigrateRequest,
    user=Depends(require_org_admin),
    db: Session = Depends(get_db),
):
    """Compare two schema versions and preview how submissions collected with
    ``from_version`` would be migrated to ``to_version``.

    Returns:
      - diff: structural changes between the two schemas
      - affected_count: number of submissions that would change
      - preview: first 20 submissions with their proposed new data_json
    """
    form = _get_form_for_tenant(db, form_id, user["tenant_id"])

    if body.from_version == body.to_version:
        raise HTTPException(status_code=400, detail="from_version and to_version must differ")

    # Fetch both version snapshots
    old_fv = (
        db.query(FormVersion)
        .filter(FormVersion.form_id == form_id, FormVersion.version == body.from_version)
        .first()
    )
    new_fv = (
        db.query(FormVersion)
        .filter(FormVersion.form_id == form_id, FormVersion.version == body.to_version)
        .first()
    )

    # If to_version equals current form version, use live schema (it may not
    # have been snapshotted yet since it's the active version)
    if not new_fv and body.to_version == form.version:
        new_schema = form.json_schema
    elif new_fv:
        new_schema = new_fv.json_schema
    else:
        raise HTTPException(status_code=404, detail=f"Version {body.to_version} not found")

    if not old_fv:
        raise HTTPException(status_code=404, detail=f"Version {body.from_version} not found")

    old_schema = old_fv.json_schema
    diff = _compute_schema_diff(old_schema, new_schema)

    # Find submissions collected with the old version
    submissions = (
        db.query(Submission)
        .filter(
            Submission.form_id == form_id,
            Submission.tenant_id == user["tenant_id"],
            Submission.form_version == body.from_version,
        )
        .all()
    )

    # Build migration preview for each submission
    previews: list[dict[str, Any]] = []
    for sub in submissions[:20]:
        original = dict(sub.data_json) if sub.data_json else {}
        migrated = dict(original)

        # Apply renames
        for old_key, new_key in diff["renamed"].items():
            if old_key in migrated:
                migrated[new_key] = migrated.pop(old_key)

        # Mark removed fields (keep values but flag them)
        removed_fields = {k: migrated[k] for k in diff["removed"] if k in migrated}

        # Add placeholders for new fields
        added_fields = [k for k in diff["added"] if k not in migrated]

        previews.append({
            "submission_id": str(sub.id),
            "original_data": original,
            "migrated_data": migrated,
            "removed_fields": removed_fields,
            "added_fields_missing": added_fields,
        })

    return {
        "form_id": str(form_id),
        "from_version": body.from_version,
        "to_version": body.to_version,
        "diff": diff,
        "affected_count": len(submissions),
        "preview": previews,
    }


# ── Apply submission migration ────────────────────────────────────────────


@router.post("/{form_id}/migrate/apply")
def apply_submission_migration(
    form_id: str,
    body: ApplyMigrateRequest,
    user=Depends(require_org_admin),
    db: Session = Depends(get_db),
):
    """Actually apply the migration: rename fields in data_json and update
    form_version on all submissions collected with from_version."""
    form = _get_form_for_tenant(db, form_id, user["tenant_id"])

    if body.from_version == body.to_version:
        raise HTTPException(status_code=400, detail="from_version and to_version must differ")

    # Fetch both version snapshots
    old_fv = (
        db.query(FormVersion)
        .filter(FormVersion.form_id == form_id, FormVersion.version == body.from_version)
        .first()
    )
    new_fv = (
        db.query(FormVersion)
        .filter(FormVersion.form_id == form_id, FormVersion.version == body.to_version)
        .first()
    )

    # If to_version equals current form version, use live schema
    if not new_fv and body.to_version == form.version:
        new_schema = form.json_schema
    elif new_fv:
        new_schema = new_fv.json_schema
    else:
        raise HTTPException(status_code=404, detail=f"Version {body.to_version} not found")

    if not old_fv:
        raise HTTPException(status_code=404, detail=f"Version {body.from_version} not found")

    old_schema = old_fv.json_schema
    diff = _compute_schema_diff(old_schema, new_schema)

    # Find and update submissions
    submissions = (
        db.query(Submission)
        .filter(
            Submission.form_id == form_id,
            Submission.tenant_id == user["tenant_id"],
            Submission.form_version == body.from_version,
        )
        .all()
    )

    migrated_count = 0
    for sub in submissions:
        original = dict(sub.data_json) if sub.data_json else {}
        migrated = dict(original)
        changed = False

        # Apply renames
        for old_key, new_key in diff["renamed"].items():
            if old_key in migrated:
                migrated[new_key] = migrated.pop(old_key)
                changed = True

        if changed or diff["renamed"]:
            sub.data_json = migrated
        sub.form_version = body.to_version
        migrated_count += 1

    db.commit()

    return {
        "form_id": str(form_id),
        "from_version": body.from_version,
        "to_version": body.to_version,
        "migrated_count": migrated_count,
        "renames_applied": diff["renamed"],
    }


# ── Consent log ───────────────────────────────────────────────────────────


@router.get("/{form_id}/consent-log")
def consent_log(
    form_id: str,
    user=Depends(require_org_admin),
    db: Session = Depends(get_db),
):
    form = _get_form_for_tenant(db, form_id, user["tenant_id"])

    sig_fields: list[str] = []
    for section in (form.json_schema or {}).get("sections", []):
        for f in section.get("fields", []):
            if f.get("type") == "signature":
                sig_fields.append(f.get("name") or f.get("id") or "")

    subs = db.query(Submission).filter(
        Submission.form_id == form_id,
        Submission.tenant_id == user["tenant_id"],
    ).all()

    results = []
    for sub in subs:
        data = sub.data_json or {}
        has_sig = any(data.get(k) for k in sig_fields) if sig_fields else any(
            isinstance(v, str) and v.startswith("data:image/") for v in data.values()
        )
        if has_sig:
            results.append({
                "submission_id": str(sub.id),
                "enumerator_id": str(sub.enumerator_id),
                "signed_at": sub.server_received_at.isoformat() if sub.server_received_at else None,
            })

    return results


# ── Arm assignment ─────────────────────────────────────────────────────────


@router.post("/{form_id}/assign-arm")
def assign_arm(
    form_id: str,
    body: AssignArmRequest,
    user=Depends(require_enumerator),
    db: Session = Depends(get_db),
):
    form = _get_form_for_tenant(db, form_id, user["tenant_id"])
    rand_cfg = (form.json_schema or {}).get("settings", {}).get("randomization", {})
    arms: list[str] = rand_cfg.get("arms", [])
    if not arms:
        raise HTTPException(status_code=400, detail="No arms configured for this form")
    idx = hashlib.md5(body.respondent_key.encode()).digest()[0] % len(arms)
    return {"arm": arms[idx]}
