"""Audit-log tamper-evidence: write_audit() must chain hashes so that
verify_audit_chain() can detect any retroactive edit or deletion, and
detect_anomalies() must surface repeated failed logins / off-hours access
from real DB rows. If write_audit()'s hash formula drifts from what
verify_audit_chain() recomputes, every chain looks "broken" even when
nothing was tampered with — these tests pin both sides to the same DB."""
from datetime import datetime, timedelta, timezone

from app.services.audit import write_audit, verify_audit_chain, detect_anomalies
from app.models.audit_log import AuditLog
from .conftest import skip_no_db, make_tenant


@skip_no_db
class TestAuditHashChain:
    def test_chain_is_valid_after_sequential_writes(self, db_session):
        tenant = make_tenant(db_session)
        write_audit(db_session, tenant_id=tenant.id, action="login", ip_address="1.2.3.4")
        write_audit(db_session, tenant_id=tenant.id, action="export", detail={"rows": 10})
        db_session.flush()

        result = verify_audit_chain(db_session, tenant.id)
        assert result == {"valid": True, "checked": 2, "skipped_unchained": 0,
                           "broken_at_id": None, "reason": None}

    def test_tampering_with_row_content_breaks_the_chain(self, db_session):
        tenant = make_tenant(db_session)
        write_audit(db_session, tenant_id=tenant.id, action="login")
        row2 = write_audit(db_session, tenant_id=tenant.id, action="export", detail={"rows": 10})
        db_session.flush()

        row2.detail = {"rows": 99999}
        db_session.flush()

        result = verify_audit_chain(db_session, tenant.id)
        assert result["valid"] is False
        assert result["broken_at_id"] == row2.id

    def test_pre_chain_legacy_rows_are_skipped_not_flagged(self, db_session):
        tenant = make_tenant(db_session)
        legacy = AuditLog(tenant_id=tenant.id, action="legacy_action", row_hash=None, prev_hash=None)
        db_session.add(legacy)
        db_session.flush()
        write_audit(db_session, tenant_id=tenant.id, action="new_action")
        db_session.flush()

        result = verify_audit_chain(db_session, tenant.id)
        assert result["valid"] is True
        assert result["skipped_unchained"] == 1
        assert result["checked"] == 1


@skip_no_db
class TestAuditAnomalies:
    def test_repeated_failed_logins_flagged(self, db_session):
        tenant = make_tenant(db_session)
        now = datetime.now(timezone.utc)
        for i in range(5):
            row = AuditLog(tenant_id=tenant.id, user_id="00000000-0000-0000-0000-00000000aaaa",
                            action="login_failed", created_at=now + timedelta(minutes=i))
            db_session.add(row)
        db_session.flush()

        findings = detect_anomalies(db_session, tenant.id, since=now - timedelta(minutes=1))
        kinds = [f for f in findings if f["type"] == "repeated_failed_logins"]
        assert len(kinds) == 1
        assert kinds[0]["count"] == 5

    def test_single_daytime_login_not_flagged(self, db_session):
        tenant = make_tenant(db_session)
        daytime_utc = datetime.now(timezone.utc).replace(hour=6, minute=0, second=0, microsecond=0)  # 11:30 IST
        row = AuditLog(tenant_id=tenant.id, user_id="00000000-0000-0000-0000-00000000bbbb",
                        action="login_password_verified", created_at=daytime_utc)
        db_session.add(row)
        db_session.flush()

        findings = detect_anomalies(db_session, tenant.id, since=daytime_utc - timedelta(minutes=1))
        assert findings == []
