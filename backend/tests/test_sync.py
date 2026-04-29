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
