"""Resolve which AI credentials to use for a request: an org's own BYO key if
they've enabled BYO, otherwise the platform's shared key (the existing
system_settings.ai_config global).

Important distinction: `{}` means "BYO not enabled — use the platform key",
which is a normal, expected case the caller should fall back on. A tenant
that has explicitly turned BYO *on* but hasn't finished configuring it (no
key saved yet, bad provider, corrupted key) must NOT silently fall back to
the platform key — that would bill the platform for usage the org believes
is on their own account, which is exactly the trust/billing problem BYO
exists to avoid. That case raises TenantByoMisconfigured instead; callers
must surface it as an error, not swallow it into a fallback.
"""
from sqlalchemy.orm import Session

BYO_PROVIDERS = {"openai", "anthropic", "gemini", "deepseek"}


class TenantByoMisconfigured(ValueError):
    """Org has byo_enabled=True but no usable key — must block the AI call,
    never silently fall back to the platform-paid key."""


def resolve_tenant_byo_cfg(db: Session, tenant_id) -> dict:
    """{'provider', 'api_key', 'model'} if BYO is enabled and configured.
    {} if BYO is simply not enabled (caller falls back to the platform key).
    Raises TenantByoMisconfigured if BYO is enabled but broken."""
    if not tenant_id:
        return {}
    from app.models.tenant import Tenant
    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if not tenant:
        return {}
    cfg = tenant.ai_config or {}
    if not cfg.get("byo_enabled"):
        return {}

    provider = cfg.get("byo_provider", "")
    encrypted = cfg.get("byo_api_key_encrypted", "")
    if provider not in BYO_PROVIDERS:
        raise TenantByoMisconfigured("BYO is enabled but no valid provider is selected.")
    if not encrypted:
        raise TenantByoMisconfigured("BYO is enabled but no API key has been saved.")

    from app.core.tenant_ai_crypto import decrypt_api_key, TenantKeyError
    try:
        api_key = decrypt_api_key(encrypted)
    except TenantKeyError:
        raise TenantByoMisconfigured("The stored API key could not be decrypted. Re-enter it in Settings.")
    if not api_key:
        raise TenantByoMisconfigured("BYO is enabled but no API key has been saved.")
    return {"provider": provider, "api_key": api_key, "model": cfg.get("byo_model", "")}
