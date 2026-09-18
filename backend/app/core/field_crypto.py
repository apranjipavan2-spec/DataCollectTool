"""Envelope encryption for direct-identifier field values (DPDP encryption-
at-rest: name, phone, and other is_identifier=True fields — not GPS/Aadhaar,
which are handled separately: exact GPS stays out of scope here pending a
managed KMS, per tasks/dpdp_master_plan.md item 10; Aadhaar is minimised at
write time in pii_redact.mask_aadhaar rather than stored reversibly at all).

Same shape as tenant_ai_crypto.py: Fernet keyed via HKDF from JWT_SECRET, no
new required env var, independent derived key via a distinct HKDF info
string so a compromise of one purpose's key doesn't expose the other.

This module is the encrypt/decrypt primitive only. Wiring it into
Submission.data_json writes/reads for every is_identifier field is a larger,
staged retrofit — existing unencrypted rows need a backfill, and every read
path (exports, analyzer, dashboards, duplicate detection, AI redaction...)
needs to keep working during the transition — tracked as a deliberate
follow-up in the master plan rather than attempted as a single risky pass
against live production data.
"""
import base64

from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF


class FieldCryptoError(ValueError):
    """Raised when an encrypted field value cannot be decrypted (corrupted,
    or the server's JWT_SECRET changed since it was encrypted)."""


def _fernet() -> Fernet:
    from app.core.config import settings
    derived = HKDF(
        algorithm=hashes.SHA256(), length=32, salt=None,
        info=b"fieldgovern-identifier-field-v1",
    ).derive(settings.JWT_SECRET.encode())
    return Fernet(base64.urlsafe_b64encode(derived))


def encrypt_field(plain: str) -> str:
    if not plain:
        return ""
    return _fernet().encrypt(plain.encode()).decode()


def decrypt_field(encrypted: str) -> str:
    if not encrypted:
        return ""
    try:
        return _fernet().decrypt(encrypted.encode()).decode()
    except InvalidToken as e:
        raise FieldCryptoError("stored field value could not be decrypted") from e


if __name__ == "__main__":
    import os
    os.environ.setdefault("JWT_SECRET", "test-secret-for-self-check-only")

    plain = "Asha Devi, +919876543210"
    enc = encrypt_field(plain)
    assert enc != plain
    assert decrypt_field(enc) == plain

    assert encrypt_field("") == "" and decrypt_field("") == ""

    try:
        decrypt_field("not-a-real-token")
        raise SystemExit("FAIL: garbage input should have raised FieldCryptoError")
    except FieldCryptoError:
        pass

    print("field_crypto self-check: round-trip OK, empty-safe, tamper rejected")
