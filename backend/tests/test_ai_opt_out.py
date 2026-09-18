"""Org-level AI opt-out: check_feature() must block every ai_* feature when
Tenant.ai_config.enabled is explicitly False, regardless of plan tier — and
must default to allowed (True) when the org has never touched the toggle, so
existing customers aren't silently broken. Tests check_feature() directly
(monkeypatching plan lookup) rather than via full HTTP + billing fixtures,
since the new logic here is entirely in the ai_config gate, not plan lookup."""
import pytest
from types import SimpleNamespace
from .conftest import skip_no_db, make_tenant
from app.api.routes import billing as billing_routes


class _FakePlan:
    ai_writer = True


@pytest.fixture
def fake_plan(monkeypatch):
    monkeypatch.setattr(billing_routes, "get_org_plan", lambda tenant_id, db: _FakePlan())


@skip_no_db
class TestAiOptOut:
    def test_default_enabled_when_never_toggled(self, db_session, fake_plan):
        tenant = make_tenant(db_session)
        # No ai_config set at all — must not raise.
        billing_routes.check_feature(tenant.id, "ai_writer", db_session)

    def test_explicit_enabled_true_passes(self, db_session, fake_plan):
        tenant = make_tenant(db_session)
        tenant.ai_config = {"enabled": True}
        db_session.flush()
        billing_routes.check_feature(tenant.id, "ai_writer", db_session)

    def test_explicit_disabled_blocks_ai_feature(self, db_session, fake_plan):
        from fastapi import HTTPException
        tenant = make_tenant(db_session)
        tenant.ai_config = {"enabled": False}
        db_session.flush()
        with pytest.raises(HTTPException) as exc:
            billing_routes.check_feature(tenant.id, "ai_writer", db_session)
        assert exc.value.status_code == 403

    def test_non_ai_feature_ignores_ai_config(self, db_session, monkeypatch):
        """The ai_config gate must only apply to features prefixed ai_ — a
        disabled AI toggle must not block an unrelated plan feature."""
        class _PlanWithOther:
            spss_export = True
        monkeypatch.setattr(billing_routes, "get_org_plan", lambda tenant_id, db: _PlanWithOther())
        tenant = make_tenant(db_session)
        tenant.ai_config = {"enabled": False}
        db_session.flush()
        billing_routes.check_feature(tenant.id, "spss_export", db_session)
