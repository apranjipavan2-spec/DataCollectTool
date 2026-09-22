"""Schema-aware envelope encryption for is_identifier fields (name, phone, and
similar direct identifiers) in a submission's data_json — DPDP Rule 6
encryption-at-rest for direct identifiers. See tasks/dpdp_master_plan.md item 10.

Transparent backward-compat by construction: decrypt_identifiers() tries to
decrypt every is_identifier field and silently falls back to the stored value
if it isn't a valid Fernet token. Every row written before this was wired in
(or any row for a form with no is_identifier fields) keeps reading exactly as
before — no backfill required for the app to keep working correctly. A
backfill script can still run later so old rows are actually encrypted at
rest, not just newly-written ones (see backend/scripts/backfill_field_encrypt.py).

Aadhaar-shaped values are NOT covered here — pii_redact.mask_aadhaar() already
irreversibly minimises them at write time, a stronger fix for that one field
than reversible encryption would be.
"""
from app.core.field_crypto import encrypt_field, decrypt_field, FieldCryptoError
from app.services.pii_redact import identifier_field_ids


def encrypt_identifiers(data: dict, form_schema: dict) -> dict:
    """Encrypt every is_identifier field's string value in `data` before write.
    No-op (zero extra work) for forms with no is_identifier fields — the
    common case."""
    if not isinstance(data, dict):
        return data
    ids = identifier_field_ids(form_schema)
    if not ids:
        return data
    out = dict(data)
    for k in ids:
        v = out.get(k)
        if isinstance(v, str) and v:
            out[k] = encrypt_field(v)
    return out


def decrypt_identifiers(data: dict, form_schema: dict) -> dict:
    """Decrypt every is_identifier field's value for display/export. Never
    raises: a value that isn't valid ciphertext (any row written before this
    was wired in, or any other legacy/plaintext value) passes through
    unchanged rather than breaking the read."""
    if not isinstance(data, dict):
        return data
    ids = identifier_field_ids(form_schema)
    if not ids:
        return data
    out = dict(data)
    for k in ids:
        v = out.get(k)
        if isinstance(v, str) and v:
            try:
                out[k] = decrypt_field(v)
            except FieldCryptoError:
                pass
    return out


def encrypt_identifiers_for_form_id(db, tenant_id, form_id, data: dict) -> dict:
    """Convenience wrapper for write sites that don't already have a loaded
    `Form` object in scope. One extra query, only taken when needed."""
    if not isinstance(data, dict) or not form_id:
        return data
    from app.models.form import Form
    form = db.query(Form).filter(Form.id == form_id, Form.tenant_id == tenant_id).first()
    if not form:
        return data
    return encrypt_identifiers(data, form.json_schema)


if __name__ == "__main__":
    import os
    os.environ.setdefault("JWT_SECRET", "test-secret-for-self-check-only")

    schema = {"sections": [{"fields": [
        {"id": "q_name", "type": "text", "is_identifier": True},
        {"id": "q_phone", "type": "text", "is_identifier": True},
        {"id": "q_age", "type": "number"},
    ]}]}
    data = {"q_name": "Asha Devi", "q_phone": "+919876543210", "q_age": 34}

    enc = encrypt_identifiers(data, schema)
    assert enc["q_name"] != "Asha Devi"
    assert enc["q_phone"] != "+919876543210"
    assert enc["q_age"] == 34  # non-identifier field untouched

    dec = decrypt_identifiers(enc, schema)
    assert dec["q_name"] == "Asha Devi"
    assert dec["q_phone"] == "+919876543210"

    # Backward compat: a legacy plaintext row (written before this was wired in)
    # must decrypt to itself unchanged, not raise or corrupt the value.
    legacy = {"q_name": "Ramesh Kumar", "q_phone": "9998887776", "q_age": 40}
    dec_legacy = decrypt_identifiers(legacy, schema)
    assert dec_legacy == legacy

    # No is_identifier fields at all -> true no-op, same dict semantics
    no_id_schema = {"sections": [{"fields": [{"id": "q_age", "type": "number"}]}]}
    assert encrypt_identifiers(data, no_id_schema) == data
    assert decrypt_identifiers(data, no_id_schema) == data

    print("field_encrypt self-check: encrypt/decrypt round-trip OK, legacy-plaintext-safe, no-op-safe")
