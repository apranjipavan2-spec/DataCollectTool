"""Encrypt/decrypt a tenant-supplied AI provider API key before it's stored in
Tenant.ai_config (BYO-key: an org brings and pays for its own OpenAI/Anthropic/
Gemini/DeepSeek key instead of using the platform's shared one).

Keyed from JWT_SECRET via HKDF rather than a new required env var — JWT_SECRET
is already a required, always-set production secret (see main.py's startup
guard), and HKDF derives an independent key for this specific purpose so a
JWT-signing compromise and an AI-key-encryption compromise aren't the same
failure. Fernet (AES-128-CBC + HMAC) is used because this is symmetric,
same-server encrypt/decrypt — no need for survey_crypto.py's asymmetric
RSA-OAEP scheme, which exists for a browser-encrypts/server-decrypts flow.
"""
import base64

from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF


class TenantKeyError(ValueError):
    """Raised when a stored API key cannot be decrypted (corrupted, or the
    server's JWT_SECRET changed since it was encrypted)."""


def _fernet() -> Fernet:
    from app.core.config import settings
    derived = HKDF(
        algorithm=hashes.SHA256(), length=32, salt=None,
        info=b"fieldgovern-tenant-ai-key-v1",
    ).derive(settings.JWT_SECRET.encode())
    return Fernet(base64.urlsafe_b64encode(derived))


def encrypt_api_key(plain: str) -> str:
    if not plain:
        return ""
    return _fernet().encrypt(plain.encode()).decode()


def decrypt_api_key(encrypted: str) -> str:
    if not encrypted:
        return ""
    try:
        return _fernet().decrypt(encrypted.encode()).decode()
    except InvalidToken as e:
        raise TenantKeyError("stored API key could not be decrypted") from e


if __name__ == "__main__":
    import os
    os.environ.setdefault("JWT_SECRET", "test-secret-for-self-check-only")

    plain = "sk-test-1234567890abcdef"
    enc = encrypt_api_key(plain)
    assert enc != plain
    assert decrypt_api_key(enc) == plain

    assert encrypt_api_key("") == "" and decrypt_api_key("") == ""

    try:
        decrypt_api_key("not-a-real-token")
        raise SystemExit("FAIL: garbage input should have raised TenantKeyError")
    except TenantKeyError:
        pass

    print("tenant_ai_crypto self-check: round-trip OK, empty-safe, tamper rejected")
