"""
One-time backfill: encrypt is_identifier-flagged fields in existing
Submission/SubmissionDraft rows that were written before field_encrypt.py was
wired into the write paths (see app/services/field_encrypt.py's docstring).

Safe to run repeatedly — each field value is checked with decrypt_field first;
if it already decrypts cleanly it's left alone (never double-encrypted, which
would break decrypt_identifiers' single-pass decrypt). Includes soft-deleted
(binned) rows too, since they still hold plaintext PII until purged.

Usage:
    python scripts/backfill_field_encrypt.py           # dry run (shows changes)
    python scripts/backfill_field_encrypt.py --apply   # write changes
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import app.models  # noqa
from app.core.database import SessionLocal
from app.core.field_crypto import decrypt_field, FieldCryptoError
from app.services.pii_redact import identifier_field_ids
from app.models.submission import Submission
from app.models.submission_draft import SubmissionDraft
from app.models.form import Form

apply = "--apply" in sys.argv
BATCH_SIZE = 500


def _already_encrypted(v) -> bool:
    if not isinstance(v, str) or not v:
        return True  # nothing to do — empty/non-string values are never identifier ciphertext
    try:
        decrypt_field(v)
        return True
    except FieldCryptoError:
        return False


def _backfill_model(db, model, label: str) -> tuple[int, int]:
    """Batch over `model` rows (id-ordered), encrypt any plaintext identifier
    field found using each row's own form schema. Returns (changed, skipped)."""
    from app.core.field_crypto import encrypt_field

    schema_cache: dict = {}

    def _field_ids_for(form_id):
        if form_id not in schema_cache:
            form = db.query(Form).filter(Form.id == form_id).first()
            schema_cache[form_id] = identifier_field_ids(form.json_schema) if form else set()
        return schema_cache[form_id]

    changed = 0
    skipped = 0
    last_id = None
    while True:
        q = (
            db.query(model)
            .execution_options(include_deleted=True)
            .order_by(model.id)
        )
        if last_id is not None:
            q = q.filter(model.id > last_id)
        rows = q.limit(BATCH_SIZE).all()
        if not rows:
            break

        for row in rows:
            last_id = row.id
            data = row.data_json
            if not isinstance(data, dict):
                skipped += 1
                continue
            field_ids = _field_ids_for(row.form_id)
            if not field_ids:
                skipped += 1
                continue

            new_data = None
            touched = []
            for fid in field_ids:
                v = data.get(fid)
                if _already_encrypted(v):
                    continue
                if new_data is None:
                    new_data = dict(data)
                new_data[fid] = encrypt_field(v)
                touched.append(fid)

            if new_data is None:
                skipped += 1
                continue

            print(f"  {'✓' if apply else '·'} {label} {row.id}  encrypted {touched}")
            if apply:
                row.data_json = new_data  # reassign (not in-place mutate) so SQLAlchemy tracks the JSONB change
            changed += 1

        if apply:
            db.commit()

    return changed, skipped


db = SessionLocal()
try:
    total_changed = 0
    total_skipped = 0
    for model, label in ((Submission, "submission"), (SubmissionDraft, "draft")):
        changed, skipped = _backfill_model(db, model, label)
        total_changed += changed
        total_skipped += skipped

    if apply:
        print(f"\nDone — {total_changed} rows encrypted, {total_skipped} skipped (already encrypted / no identifier fields).")
    else:
        print(f"\nDry run — {total_changed} rows would be encrypted, {total_skipped} would be skipped.")
        print("Re-run with --apply to write changes.")
finally:
    db.close()
