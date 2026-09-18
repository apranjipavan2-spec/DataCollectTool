"""BYO AI key resolution: must return the tenant's own decrypted key only when
byo_enabled=True and a valid encrypted key is stored. When BYO is simply not
enabled, return {} so the caller falls back to the platform's shared key —
but when BYO IS enabled and broken (no key saved, bad provider, corrupted
key), must raise TenantByoMisconfigured rather than silently falling back:
a silent fallback would bill the platform for usage an org believes is on
their own account, which is exactly the trust/billing problem BYO exists to
prevent."""
import pytest
from types import SimpleNamespace
from unittest.mock import MagicMock
from app.services.tenant_ai_key import resolve_tenant_byo_cfg, TenantByoMisconfigured
from app.core.tenant_ai_crypto import encrypt_api_key


def _db_with_tenant(ai_config):
    tenant = SimpleNamespace(ai_config=ai_config)
    db = MagicMock()
    db.query.return_value.filter.return_value.first.return_value = tenant
    return db


def test_no_tenant_id_returns_empty():
    assert resolve_tenant_byo_cfg(MagicMock(), None) == {}


def test_tenant_not_found_returns_empty():
    db = MagicMock()
    db.query.return_value.filter.return_value.first.return_value = None
    assert resolve_tenant_byo_cfg(db, "t1") == {}


def test_byo_not_enabled_returns_empty_even_with_stored_key():
    enc = encrypt_api_key("sk-real-key")
    db = _db_with_tenant({"byo_enabled": False, "byo_provider": "openai", "byo_api_key_encrypted": enc})
    assert resolve_tenant_byo_cfg(db, "t1") == {}


def test_byo_enabled_but_no_key_stored_raises_misconfigured():
    db = _db_with_tenant({"byo_enabled": True, "byo_provider": "openai", "byo_api_key_encrypted": ""})
    with pytest.raises(TenantByoMisconfigured):
        resolve_tenant_byo_cfg(db, "t1")


def test_byo_enabled_unknown_provider_raises_misconfigured():
    enc = encrypt_api_key("sk-real-key")
    db = _db_with_tenant({"byo_enabled": True, "byo_provider": "not-a-real-provider", "byo_api_key_encrypted": enc})
    with pytest.raises(TenantByoMisconfigured):
        resolve_tenant_byo_cfg(db, "t1")


def test_byo_enabled_corrupted_key_raises_misconfigured_not_generic_error():
    db = _db_with_tenant({"byo_enabled": True, "byo_provider": "openai", "byo_api_key_encrypted": "garbage-not-a-token"})
    with pytest.raises(TenantByoMisconfigured):
        resolve_tenant_byo_cfg(db, "t1")


def test_byo_fully_configured_returns_decrypted_key():
    enc = encrypt_api_key("sk-real-tenant-key")
    db = _db_with_tenant({
        "byo_enabled": True, "byo_provider": "anthropic",
        "byo_api_key_encrypted": enc, "byo_model": "claude-sonnet-4-6",
    })
    result = resolve_tenant_byo_cfg(db, "t1")
    assert result == {"provider": "anthropic", "api_key": "sk-real-tenant-key", "model": "claude-sonnet-4-6"}


def test_no_ai_config_at_all_returns_empty():
    db = _db_with_tenant(None)
    assert resolve_tenant_byo_cfg(db, "t1") == {}


def test_byo_disabled_falls_back_cleanly_even_with_stale_broken_config():
    """Turning BYO off must not get stuck raising just because leftover
    byo_provider/byo_api_key_encrypted fields from a prior attempt are still
    present but incomplete — byo_enabled=False must short-circuit first."""
    db = _db_with_tenant({"byo_enabled": False, "byo_provider": "not-a-real-provider", "byo_api_key_encrypted": ""})
    assert resolve_tenant_byo_cfg(db, "t1") == {}
