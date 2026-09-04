"""
Decrypt offline survey-backup capsules produced by the browser.

The public survey page (frontend/src/collect/surveyCrypto.ts) encrypts a response
with the platform's RSA **public** key so it can be saved to the respondent's device
and later recovered. Only this module — holding the **private** key — can read it.

Envelope (JSON, base64 fields), identical to what Web Crypto emits:
    { "v":1, "id":<uuid>, "token":<survey token>,
      "alg":"RSA-OAEP-256+A256GCM",
      "ek":<b64 RSA-OAEP-wrapped 32-byte AES key>,
      "iv":<b64 12-byte GCM nonce>,
      "ct":<b64 AES-256-GCM ciphertext WITH the 16-byte tag appended> }

Web Crypto's AES-GCM output is `ciphertext || tag`, which is exactly the layout
`cryptography`'s AESGCM.decrypt expects — so no tag juggling is needed.
"""
from __future__ import annotations

import base64
import json
from typing import Any

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

_OAEP = padding.OAEP(mgf=padding.MGF1(algorithm=hashes.SHA256()),
                     algorithm=hashes.SHA256(), label=None)


class CapsuleError(ValueError):
    """Raised when a capsule cannot be decrypted (wrong key, tampered, malformed)."""


def recovery_enabled() -> bool:
    from app.core.config import settings
    return bool(settings.SURVEY_RECOVERY_PUBLIC_KEY and settings.SURVEY_RECOVERY_PRIVATE_KEY)


def normalize_pem(value: str) -> str:
    """Accept a key as raw PEM or as single-line base64-of-PEM (easier in .env)."""
    if not value or "-----BEGIN" in value:
        return value
    try:
        return base64.b64decode(value).decode()
    except Exception:  # noqa: BLE001
        return value


def _b64d(s: str) -> bytes:
    try:
        return base64.b64decode(s)
    except Exception as e:  # noqa: BLE001
        raise CapsuleError(f"bad base64 field: {e}") from e


def decrypt_capsule(envelope: dict, private_key_pem: str | None = None) -> dict[str, Any]:
    """Decrypt one capsule envelope → the original data_json dict. Raises CapsuleError."""
    if private_key_pem is None:
        from app.core.config import settings
        private_key_pem = settings.SURVEY_RECOVERY_PRIVATE_KEY
    pem = normalize_pem(private_key_pem)
    if not pem:
        raise CapsuleError("recovery private key not configured")
    if not isinstance(envelope, dict) or "ek" not in envelope or "iv" not in envelope or "ct" not in envelope:
        raise CapsuleError("malformed capsule")

    try:
        private_key = serialization.load_pem_private_key(pem.encode(), password=None)
    except Exception as e:  # noqa: BLE001
        raise CapsuleError(f"cannot load private key: {e}") from e

    try:
        aes_key = private_key.decrypt(_b64d(envelope["ek"]), _OAEP)
    except Exception as e:  # noqa: BLE001
        raise CapsuleError("wrong key or corrupted capsule") from e

    try:
        plaintext = AESGCM(aes_key).decrypt(_b64d(envelope["iv"]), _b64d(envelope["ct"]), None)
    except Exception as e:  # noqa: BLE001
        raise CapsuleError("decryption failed (tampered or corrupted)") from e

    try:
        return json.loads(plaintext.decode("utf-8"))
    except Exception as e:  # noqa: BLE001
        raise CapsuleError(f"decrypted payload is not valid JSON: {e}") from e


# ── helpers used only by tests / the interop self-check ───────────────────────

def _encrypt_capsule(public_key_pem: str, data_json: dict, token: str = "", cid: str = "") -> dict:
    """Mirror of the browser's encryption — used by the self-check and interop test."""
    import os
    import uuid as _uuid
    public_key = serialization.load_pem_public_key(public_key_pem.encode())
    aes_key = os.urandom(32)
    iv = os.urandom(12)
    ct = AESGCM(aes_key).encrypt(iv, json.dumps(data_json).encode("utf-8"), None)
    ek = public_key.encrypt(aes_key, _OAEP)
    b64 = lambda b: base64.b64encode(b).decode()
    return {
        "v": 1, "id": cid or str(_uuid.uuid4()), "token": token,
        "alg": "RSA-OAEP-256+A256GCM",
        "ek": b64(ek), "iv": b64(iv), "ct": b64(ct),
    }


if __name__ == "__main__":
    from cryptography.hazmat.primitives.asymmetric import rsa

    key = rsa.generate_private_key(public_exponent=65537, key_size=3072)
    priv_pem = key.private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption()).decode()
    pub_pem = key.public_key().public_bytes(
        serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo).decode()

    sample = {"q_name": "Asha", "q_age": "34", "_photo": "data:image/png;base64,AAAA"}
    env = _encrypt_capsule(pub_pem, sample, token="tok123", cid="abc-1")
    out = decrypt_capsule(env, private_key_pem=priv_pem)
    assert out == sample, out

    # tamper → must fail, never silently return garbage
    bad = dict(env, ct=env["ct"][:-4] + "AAAA")
    try:
        decrypt_capsule(bad, private_key_pem=priv_pem)
        raise SystemExit("FAIL: tampered capsule decrypted")
    except CapsuleError:
        pass
    print("survey_crypto self-check: round-trip OK, tamper rejected")
