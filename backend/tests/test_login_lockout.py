"""Login lockout after repeated failed attempts (item 16). If the threshold
check or the lock-check ordering drifts, either a brute-force attacker gets
unlimited attempts (lockout never triggers) or a legitimate user gets
permanently locked out (counter never resets on success)."""
from .conftest import skip_no_db, make_tenant, make_user


@skip_no_db
class TestLoginLockout:
    def test_locks_after_threshold_failed_attempts(self, client, db_session):
        tenant = make_tenant(db_session)
        make_user(db_session, tenant.id, role="org_admin", phone="+919222000001", password="Correct@123")

        for _ in range(5):
            r = client.post("/api/v1/auth/login", json={"phone": "+919222000001", "password": "wrong"})
            assert r.status_code == 401

        # 6th attempt, even with the CORRECT password, must be rejected — locked.
        r = client.post("/api/v1/auth/login", json={"phone": "+919222000001", "password": "Correct@123"})
        assert r.status_code == 423
        assert "minute" in r.json()["detail"].lower()

    def test_successful_login_resets_the_counter(self, client, db_session):
        tenant = make_tenant(db_session)
        make_user(db_session, tenant.id, role="org_admin", phone="+919222000002", password="Correct@123")

        for _ in range(3):  # below threshold
            client.post("/api/v1/auth/login", json={"phone": "+919222000002", "password": "wrong"})

        r = client.post("/api/v1/auth/login", json={"phone": "+919222000002", "password": "Correct@123"})
        assert r.status_code in (200, 401)  # 200 unless 2FA/OTP is required by test tenant defaults

        from app.models.user import User
        user = db_session.query(User).filter(User.phone == "+919222000002").first()
        assert user.failed_login_count == 0
        assert user.locked_until is None

    def test_unlocked_account_accepts_correct_password_normally(self, client, db_session):
        tenant = make_tenant(db_session)
        make_user(db_session, tenant.id, role="org_admin", phone="+919222000003", password="Correct@123")

        r = client.post("/api/v1/auth/login", json={"phone": "+919222000003", "password": "Correct@123"})
        assert r.status_code == 200
        assert "access_token" in r.json()
