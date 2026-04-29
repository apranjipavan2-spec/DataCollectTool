"""Auth flow tests — login, invalid credentials, inactive user."""
import pytest
from .conftest import skip_no_db, make_tenant, make_user


@skip_no_db
class TestLogin:
    def test_login_success(self, client, db_session):
        tenant = make_tenant(db_session)
        make_user(db_session, tenant.id, phone="+919111000001", password="Pass@123")

        r = client.post("/api/v1/auth/login", json={"phone": "+919111000001", "password": "Pass@123"})
        assert r.status_code == 200
        data = r.json()
        assert "access_token" in data
        assert data["role"] == "org_admin"

    def test_login_wrong_password(self, client, db_session):
        tenant = make_tenant(db_session)
        make_user(db_session, tenant.id, phone="+919111000002", password="Correct@1")

        r = client.post("/api/v1/auth/login", json={"phone": "+919111000002", "password": "Wrong@1"})
        assert r.status_code == 401

    def test_login_unknown_phone(self, client, db_session):
        r = client.post("/api/v1/auth/login", json={"phone": "+919000000000", "password": "anything"})
        assert r.status_code == 401

    def test_login_inactive_user(self, client, db_session):
        tenant = make_tenant(db_session)
        user = make_user(db_session, tenant.id, phone="+919111000003", password="Pass@123")
        user.is_active = False
        db_session.flush()

        r = client.post("/api/v1/auth/login", json={"phone": "+919111000003", "password": "Pass@123"})
        assert r.status_code == 401

    def test_login_missing_fields(self, client, db_session):
        r = client.post("/api/v1/auth/login", json={"phone": "+919111000001"})
        assert r.status_code == 422

    def test_token_used_for_auth(self, client, db_session):
        """Token from login must work on a protected endpoint."""
        tenant = make_tenant(db_session)
        make_user(db_session, tenant.id, phone="+919111000004", password="Pass@123")

        login = client.post("/api/v1/auth/login", json={"phone": "+919111000004", "password": "Pass@123"})
        token = login.json()["access_token"]

        r = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
        assert r.status_code == 200

    def test_invalid_token_rejected(self, client, db_session):
        r = client.get("/api/v1/auth/me", headers={"Authorization": "Bearer not-a-real-token"})
        assert r.status_code == 401
