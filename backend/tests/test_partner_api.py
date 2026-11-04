"""Partner data-sharing channels: API-key pull of the JSON export, and webhooks.

Covers the 2026-11-04 audit fixes (api/README.md): prefixed keys looked up by id,
legacy keys still accepted, suspended orgs lose API access, the key manager's
documented header actually works, and webhook URLs can't target internal hosts.
"""
import socket
import uuid

import pytest

from .conftest import skip_no_db, make_tenant, make_user, make_form, make_submission, auth_headers


@pytest.fixture(autouse=True)
def offline_dns(monkeypatch):
    def fake(host, *a, **k):
        ip = {"localhost": "127.0.0.1", "internal.corp": "10.0.0.5"}.get(host, "93.184.216.34")
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (ip, 443))]
    monkeypatch.setattr(socket, "getaddrinfo", fake)


@pytest.fixture
def paid_plan(monkeypatch):
    """Test DB has no Plan rows — treat every org as on a plan with API + webhooks."""
    from app.api.routes import billing
    from app.services import plan_enforcement
    monkeypatch.setattr(billing, "check_feature", lambda *a, **k: None)
    monkeypatch.setattr(plan_enforcement, "check_api_calls_limit", lambda *a, **k: {"allowed": True, "reason": ""})
    monkeypatch.setattr(plan_enforcement, "increment_api_calls", lambda *a, **k: None)


def test_url_guard_unit():
    from app.core.url_guard import UnsafeURL, check_public_https_url
    assert check_public_https_url(" https://hooks.partner.org/fg/ ") == "https://hooks.partner.org/fg"
    for bad in ("http://hooks.partner.org", "https://localhost/x", "https://internal.corp"):
        with pytest.raises(UnsafeURL):
            check_public_https_url(bad)


@skip_no_db
class TestApiKeyPull:
    def _setup(self, db_session):
        t = make_tenant(db_session)
        admin = make_user(db_session, t.id, role="org_admin", phone="+919111000881")
        form = make_form(db_session, t.id)
        make_submission(db_session, t.id, form.id, admin.id, {"q1": "a"})
        make_submission(db_session, t.id, form.id, admin.id, {"q1": "b"})
        return t, admin, form

    def _new_key(self, client, admin, t):
        r = client.post("/api/v1/api-keys/", json={"name": "Partner X"},
                        headers=auth_headers(str(admin.id), str(t.id), admin.role))
        assert r.status_code == 201, r.text
        return r.json()

    def test_new_key_pulls_json_export(self, client, db_session, paid_plan):
        t, admin, form = self._setup(db_session)
        key = self._new_key(client, admin, t)["key"]
        assert key.startswith("fgk_") and len(key) == 4 + 32 + 1 + 32

        r = client.get(f"/api/v1/export/submissions/{form.id}/json", headers={"X-API-Key": key})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body[0]["_meta"] and body[0]["submission_count"] == 2
        assert sorted(row["q1"] for row in body[1:]) == ["a", "b"]

    def test_wrong_secret_and_revoked_key_rejected(self, client, db_session, paid_plan):
        t, admin, form = self._setup(db_session)
        created = self._new_key(client, admin, t)
        url = f"/api/v1/export/submissions/{form.id}/json"
        forged = created["key"][:-4] + "0000"
        assert client.get(url, headers={"X-API-Key": forged}).status_code == 401
        assert client.get(url, headers={"X-API-Key": "fgk_not-a-uuid_x"}).status_code == 401

        client.delete(f"/api/v1/api-keys/{created['id']}", headers=auth_headers(str(admin.id), str(t.id), admin.role))
        assert client.get(url, headers={"X-API-Key": created["key"]}).status_code == 401

    def test_legacy_unprefixed_key_still_works(self, client, db_session, paid_plan):
        from app.core.security import hash_api_key
        from app.models.api_key import ApiKey
        t, admin, form = self._setup(db_session)
        legacy = uuid.uuid4().hex
        db_session.add(ApiKey(tenant_id=t.id, created_by_id=admin.id, name="old", key_hash=hash_api_key(legacy)))
        db_session.flush()
        r = client.get(f"/api/v1/export/submissions/{form.id}/json", headers={"X-API-Key": legacy})
        assert r.status_code == 200, r.text

    def test_suspended_org_loses_api_access(self, client, db_session, paid_plan):
        t, admin, form = self._setup(db_session)
        key = self._new_key(client, admin, t)["key"]
        t.subscription_status = "suspended"
        db_session.flush()
        r = client.get(f"/api/v1/export/submissions/{form.id}/json", headers={"X-API-Key": key})
        assert r.status_code == 403

    def test_key_from_other_org_cannot_read_form(self, client, db_session, paid_plan):
        t, admin, form = self._setup(db_session)
        t2 = make_tenant(db_session, name="Other Org")
        admin2 = make_user(db_session, t2.id, role="org_admin", phone="+919111000882")
        key2 = self._new_key(client, admin2, t2)["key"]
        r = client.get(f"/api/v1/export/submissions/{form.id}/json", headers={"X-API-Key": key2})
        assert r.status_code == 404


@skip_no_db
class TestWebhookGuard:
    def test_internal_webhook_url_rejected_public_allowed(self, client, db_session, paid_plan):
        t = make_tenant(db_session)
        admin = make_user(db_session, t.id, role="org_admin", phone="+919111000883")
        h = auth_headers(str(admin.id), str(t.id), admin.role)
        for bad in ("http://hooks.partner.org", "https://localhost/hook", "https://internal.corp/hook"):
            r = client.post("/api/v1/webhooks/", json={"name": "x", "url": bad}, headers=h)
            assert r.status_code == 422, (bad, r.text)
        r = client.post("/api/v1/webhooks/", json={"name": "ok", "url": "https://hooks.partner.org/fg"}, headers=h)
        assert r.status_code == 201, r.text

    def test_fire_skips_unsafe_hook_saved_before_guard(self, db_session, monkeypatch):
        import httpx
        from app.models.webhook import Webhook
        from app.services.webhook import fire_webhooks
        t = make_tenant(db_session)
        db_session.add(Webhook(tenant_id=t.id, name="old", url="https://localhost/admin", events=[], is_active=True))
        db_session.flush()

        def boom(*a, **k):
            raise AssertionError("request must not be sent to an internal host")
        monkeypatch.setattr(httpx.Client, "post", boom)
        assert fire_webhooks(db_session, str(t.id), "submission.created", {"x": 1}) == 0
