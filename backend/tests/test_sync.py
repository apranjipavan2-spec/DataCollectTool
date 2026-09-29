"""Sync push tests — size guards, batch limits, auth enforcement."""
import json
import uuid
import pytest
from .conftest import skip_no_db, make_tenant, make_user


def _login(client, phone, password):
    r = client.post("/api/v1/auth/login", json={"phone": phone, "password": password})
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


def _push_body(form_id: str, n: int = 1) -> dict:
    return {
        "form_id": str(form_id),
        "submissions": [
            {
                "local_id": str(uuid.uuid4()),
                "submitted_at": "2025-01-01T10:00:00Z",
                "data_json": {"q1": "answer"},
            }
            for _ in range(n)
        ],
    }


@skip_no_db
class TestSyncPush:
    def _setup(self, db_session, client):
        from app.models.form import Form
        tenant = make_tenant(db_session)
        user = make_user(db_session, tenant.id, phone="+919222000001", password="Test@1234")
        token = _login(client, "+919222000001", "Test@1234")
        # Create a minimal form so the push has a valid form_id
        form = Form(
            id=uuid.uuid4(),
            tenant_id=tenant.id,
            title="Test Form",
            status="active",
            json_schema={"sections": [], "version": 1},
            version=1,
        )
        db_session.add(form)
        db_session.flush()
        return token, form.id

    def test_push_requires_auth(self, client, db_session):
        r = client.post("/api/v1/sync/push", json=_push_body(uuid.uuid4()))
        assert r.status_code == 401

    def test_push_accepts_valid_batch(self, client, db_session):
        token, form_id = self._setup(db_session, client)
        r = client.post(
            "/api/v1/sync/push",
            json=_push_body(form_id, n=5),
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r.status_code == 200
        assert r.json().get("accepted", 0) == 5

    def test_push_rejects_oversized_batch(self, client, db_session):
        token, form_id = self._setup(db_session, client)
        r = client.post(
            "/api/v1/sync/push",
            json=_push_body(form_id, n=501),
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r.status_code == 400
        assert "500" in r.json()["detail"]

    def test_push_rejects_oversized_payload(self, client, db_session):
        """Content-Length guard: payloads > 5MB must be rejected."""
        token, form_id = self._setup(db_session, client)
        # Build a submission with a large data_json to exceed 5MB
        big_value = "x" * (5 * 1024 * 1024 + 100)
        body = {
            "form_id": str(form_id),
            "submissions": [
                {"local_id": str(uuid.uuid4()), "submitted_at": "2025-01-01T10:00:00Z",
                 "data_json": {"q1": big_value}}
            ],
        }
        r = client.post(
            "/api/v1/sync/push",
            content=json.dumps(body).encode(),
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
            },
        )
        assert r.status_code == 413


@skip_no_db
class TestSyncVerify:
    """The phone's "all sent?" check: only ids with NO server row come back as missing."""

    def test_reports_only_missing_ids(self, client, db_session):
        from datetime import datetime, timezone
        from .conftest import make_form, make_submission, auth_headers
        tenant = make_tenant(db_session)
        enum = make_user(db_session, tenant.id, role="enumerator", phone="+919222000101")
        other = make_user(db_session, tenant.id, role="enumerator", phone="+919222000102")
        form = make_form(db_session, tenant.id)
        mine, binned, shared_phone = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
        for lid, who in ((mine, enum), (binned, enum), (shared_phone, other)):
            s = make_submission(db_session, tenant.id, form.id, who.id)
            s.local_id = lid
        b = db_session.query(type(s)).filter_by(local_id=binned).one()
        b.deleted_at = datetime.now(timezone.utc)   # in the Recycle Bin — still counts as received
        db_session.flush()
        lost = str(uuid.uuid4())

        r = client.post("/api/v1/sync/verify",
                        json={"local_ids": [mine, binned, shared_phone, lost]},
                        headers=auth_headers(enum.id, tenant.id, "enumerator"))
        assert r.status_code == 200, r.text
        assert r.json() == {"checked": 4, "missing": [lost]}

    def test_requires_auth(self, client, db_session):
        assert client.post("/api/v1/sync/verify", json={"local_ids": []}).status_code == 401


@skip_no_db
class TestSyncClosedForm:
    """An interview collected offline on a form that was archived before sync is
    SAVED and flagged — never refused (refusing lost it on older app versions)."""

    def test_archived_form_submission_saved_and_flagged(self, client, db_session):
        from app.models.submission import Submission
        from .conftest import make_form, auth_headers
        tenant = make_tenant(db_session)
        enum = make_user(db_session, tenant.id, role="enumerator", phone="+919222000201")
        form = make_form(db_session, tenant.id)
        form.status = "archived"
        db_session.flush()
        lid = str(uuid.uuid4())
        r = client.post("/api/v1/sync/push", json={"submissions": [{
            "local_id": lid, "form_id": str(form.id), "form_version": 1,
            "data_json": {"q1": "answer"}, "local_created_at": "2026-09-20T10:00:00+00:00",
        }]}, headers=auth_headers(enum.id, tenant.id, "enumerator"))
        assert r.status_code == 200, r.text
        assert r.json()["results"][0]["status"] == "synced"
        sub = db_session.query(Submission).filter_by(local_id=lid).one()
        assert sub.status == "flagged" and "archived" in sub.flag_note
