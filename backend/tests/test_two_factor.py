"""TOTP 2FA round trip — setup, enroll, login-time challenge, confirm, disable.

This exercises the exact contract the frontend depends on (LoginPage.tsx's
2fa_required/method/temp_token branch, UserProfile.tsx's setup/verify/disable
calls) — if a field name here drifts from what the frontend expects, this is
what should catch it before the login page silently breaks for 2FA users."""
import pyotp
import pytest
from .conftest import skip_no_db, make_tenant, make_user, auth_headers


@skip_no_db
class TestTwoFactor:
    def test_setup_then_verify_enables_2fa(self, client, db_session):
        tenant = make_tenant(db_session)
        user = make_user(db_session, tenant.id, phone="+919111000010", password="Pass@123")
        headers = auth_headers(str(user.id), str(tenant.id), user.role)

        setup = client.post("/api/v1/auth/2fa/setup", headers=headers)
        assert setup.status_code == 200
        secret = setup.json()["secret"]
        assert setup.json()["qr_data_url"].startswith("data:image/png;base64,")

        code = pyotp.TOTP(secret).now()
        verify = client.post("/api/v1/auth/2fa/verify", json={"code": code}, headers=headers)
        assert verify.status_code == 200

        me = client.get("/api/v1/users/me", headers=headers)
        assert me.json()["totp_enabled"] is True

    def test_login_returns_totp_challenge_shape(self, client, db_session):
        """Exact response shape the frontend's handleLogin branches on."""
        tenant = make_tenant(db_session)
        user = make_user(db_session, tenant.id, phone="+919111000011", password="Pass@123")
        headers = auth_headers(str(user.id), str(tenant.id), user.role)

        secret = client.post("/api/v1/auth/2fa/setup", headers=headers).json()["secret"]
        client.post("/api/v1/auth/2fa/verify", json={"code": pyotp.TOTP(secret).now()}, headers=headers)

        login = client.post("/api/v1/auth/login", json={"phone": "+919111000011", "password": "Pass@123"})
        assert login.status_code == 200
        data = login.json()
        assert data["2fa_required"] is True
        assert data["method"] == "totp"
        assert "temp_token" in data and data["temp_token"]

    def test_confirm_completes_login_with_full_tokens(self, client, db_session):
        tenant = make_tenant(db_session)
        user = make_user(db_session, tenant.id, phone="+919111000012", password="Pass@123")
        headers = auth_headers(str(user.id), str(tenant.id), user.role)

        secret = client.post("/api/v1/auth/2fa/setup", headers=headers).json()["secret"]
        client.post("/api/v1/auth/2fa/verify", json={"code": pyotp.TOTP(secret).now()}, headers=headers)

        login = client.post("/api/v1/auth/login", json={"phone": "+919111000012", "password": "Pass@123"})
        temp_token = login.json()["temp_token"]

        confirm = client.post("/api/v1/auth/2fa/confirm", json={"temp_token": temp_token, "code": pyotp.TOTP(secret).now()})
        assert confirm.status_code == 200
        data = confirm.json()
        assert "access_token" in data and "refresh_token" in data
        assert data["role"] == user.role

    def test_confirm_rejects_wrong_code(self, client, db_session):
        tenant = make_tenant(db_session)
        user = make_user(db_session, tenant.id, phone="+919111000013", password="Pass@123")
        headers = auth_headers(str(user.id), str(tenant.id), user.role)

        secret = client.post("/api/v1/auth/2fa/setup", headers=headers).json()["secret"]
        client.post("/api/v1/auth/2fa/verify", json={"code": pyotp.TOTP(secret).now()}, headers=headers)
        temp_token = client.post("/api/v1/auth/login", json={"phone": "+919111000013", "password": "Pass@123"}).json()["temp_token"]

        confirm = client.post("/api/v1/auth/2fa/confirm", json={"temp_token": temp_token, "code": "000000"})
        assert confirm.status_code == 401

    def test_disable_requires_valid_code_then_login_is_direct_again(self, client, db_session):
        tenant = make_tenant(db_session)
        user = make_user(db_session, tenant.id, phone="+919111000014", password="Pass@123")
        headers = auth_headers(str(user.id), str(tenant.id), user.role)

        secret = client.post("/api/v1/auth/2fa/setup", headers=headers).json()["secret"]
        client.post("/api/v1/auth/2fa/verify", json={"code": pyotp.TOTP(secret).now()}, headers=headers)

        bad = client.post("/api/v1/auth/2fa/disable", json={"code": "000000"}, headers=headers)
        assert bad.status_code == 400

        good = client.post("/api/v1/auth/2fa/disable", json={"code": pyotp.TOTP(secret).now()}, headers=headers)
        assert good.status_code == 200

        me = client.get("/api/v1/users/me", headers=headers)
        assert me.json()["totp_enabled"] is False

        login = client.post("/api/v1/auth/login", json={"phone": "+919111000014", "password": "Pass@123"})
        assert login.status_code == 200
        assert "access_token" in login.json()
        assert "2fa_required" not in login.json()
