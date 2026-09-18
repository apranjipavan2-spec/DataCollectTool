"""Single source of truth for writing an audit-log row, and for verifying the
tamper-evident hash chain those writes form (DPDP Rule 6: security safeguards
expect logs and monitoring; a plain append-only table doesn't prove nothing
was edited or deleted after the fact — a hash chain does).

Every route that needs an audit trail entry MUST call write_audit() here,
never construct AuditLog(...) directly — a direct construction skips the
chain and leaves an unverifiable gap.

Chain design: per-tenant, ordered by id. Each row's row_hash covers its own
content plus the immediately-preceding row's row_hash (within the same
tenant) — retroactively editing or deleting any historical row changes what
a later row's hash *should* be, so verify_audit_chain() catches it.

Known limitation, documented rather than silently ignored: two concurrent
writes for the same tenant can race on "what is the previous row," since
there's no row-level lock forcing serialization. Audit-log writes are
occasional admin/security actions, not a high-frequency hot path, so the
practical risk is low — a proper fix (SELECT ... FOR UPDATE on the tenant's
last row) is a reasonable follow-up if write volume ever grows.
"""
import hashlib
import json
from collections import defaultdict
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from app.models.audit_log import AuditLog

IST = timezone(timedelta(hours=5, minutes=30))
FAILED_LOGIN_THRESHOLD = 5
FAILED_LOGIN_WINDOW_MINUTES = 30
OFF_HOURS_START_IST = 23  # 23:00 IST
OFF_HOURS_END_IST = 6     # 06:00 IST — outside [6, 23) is flagged


def _compute_hash(tenant_id, user_id, action, resource, resource_id, detail, ip_address, created_at, prev_hash) -> str:
    """Deterministic content hash — the SAME formula is used at write time and
    at verify time, so any drift here would make every future write "invalid"
    against old rows. Change this only via a new migration + re-chaining plan,
    never casually."""
    payload = json.dumps({
        "tenant_id": str(tenant_id) if tenant_id else None,
        "user_id": str(user_id) if user_id else None,
        "action": action,
        "resource": resource,
        "resource_id": resource_id,
        "detail": detail or {},
        "ip_address": ip_address,
        "created_at": created_at.isoformat(),
        "prev_hash": prev_hash or "",
    }, sort_keys=True, default=str)
    return hashlib.sha256(payload.encode()).hexdigest()


def write_audit(
    db: Session, *, tenant_id, user_id=None, action: str,
    resource: str = None, resource_id: str = None, detail: dict = None, ip_address: str = None,
) -> AuditLog:
    """Insert one tamper-evident audit-log row. Caller is responsible for
    db.commit() (matches the existing call-site convention — some commit
    immediately, some batch with other changes in the same transaction)."""
    prev = (
        db.query(AuditLog)
        .filter(AuditLog.tenant_id == tenant_id)
        .order_by(AuditLog.id.desc())
        .first()
    )
    prev_hash = prev.row_hash if prev else ""
    created_at = datetime.now(timezone.utc)
    row_hash = _compute_hash(tenant_id, user_id, action, resource, resource_id, detail, ip_address, created_at, prev_hash)

    row = AuditLog(
        tenant_id=tenant_id, user_id=user_id, action=action,
        resource=resource, resource_id=resource_id, detail=detail or {},
        ip_address=ip_address, created_at=created_at,
        row_hash=row_hash, prev_hash=prev_hash,
    )
    db.add(row)
    return row


def verify_audit_chain(db: Session, tenant_id) -> dict:
    """Walk one tenant's audit log in id order and confirm every row's hash
    matches what write_audit() would have computed, and that prev_hash
    correctly links to the row before it. Only covers rows written after
    migration 0057 (row_hash IS NOT NULL) — older rows predate the chain and
    can't be retroactively verified, so they're skipped, not treated as
    tampered.

    Returns {"valid": bool, "checked": int, "skipped_unchained": int,
             "broken_at_id": int | None, "reason": str | None}."""
    rows = (
        db.query(AuditLog)
        .filter(AuditLog.tenant_id == tenant_id)
        .order_by(AuditLog.id.asc())
        .all()
    )
    skipped = sum(1 for r in rows if r.row_hash is None)
    chained = [r for r in rows if r.row_hash is not None]

    expected_prev = ""
    for row in chained:
        if (row.prev_hash or "") != expected_prev:
            return {"valid": False, "checked": chained.index(row), "skipped_unchained": skipped,
                    "broken_at_id": row.id, "reason": "prev_hash does not link to the prior row"}
        recomputed = _compute_hash(
            row.tenant_id, row.user_id, row.action, row.resource, row.resource_id,
            row.detail, row.ip_address, row.created_at, row.prev_hash,
        )
        if recomputed != row.row_hash:
            return {"valid": False, "checked": chained.index(row), "skipped_unchained": skipped,
                    "broken_at_id": row.id, "reason": "row content does not match its stored hash"}
        expected_prev = row.row_hash

    return {"valid": True, "checked": len(chained), "skipped_unchained": skipped,
            "broken_at_id": None, "reason": None}


def detect_anomalies(db: Session, tenant_id, since: datetime = None) -> list[dict]:
    """Surface two of the three anomaly patterns the DPDP audit named:
    repeated failed logins against a specific account, and successful
    password checks outside business hours (IST). Both operate on
    login_failed / login_password_verified events (see auth.py's /login).

    The third named pattern, "mass export," has no underlying data yet — no
    export route writes an audit entry today, and instrumenting all ~9 of
    them is separate, sizeable follow-up work — so it's intentionally not
    attempted here rather than half-built against data that doesn't exist.

    Returns a list of {"type", "user_id", "count"|"created_at", "detail"}."""
    since = since or (datetime.now(timezone.utc) - timedelta(days=1))
    rows = (
        db.query(AuditLog)
        .filter(
            AuditLog.tenant_id == tenant_id,
            AuditLog.created_at >= since,
            AuditLog.action.in_(["login_failed", "login_password_verified"]),
        )
        .order_by(AuditLog.created_at.asc())
        .all()
    )

    findings: list[dict] = []

    # Repeated failed logins: >= threshold failures for the same user within
    # a rolling window (sliding, not fixed buckets — a burst spanning a
    # bucket boundary must still be caught).
    failures_by_user: dict = defaultdict(list)
    for r in rows:
        if r.action == "login_failed" and r.user_id:
            failures_by_user[r.user_id].append(r.created_at)
    window = timedelta(minutes=FAILED_LOGIN_WINDOW_MINUTES)
    for user_id, times in failures_by_user.items():
        times.sort()
        for i, t in enumerate(times):
            count_in_window = sum(1 for other in times[i:] if other - t <= window)
            if count_in_window >= FAILED_LOGIN_THRESHOLD:
                findings.append({
                    "type": "repeated_failed_logins", "user_id": str(user_id),
                    "count": count_in_window,
                    "detail": f"{count_in_window} failed logins within {FAILED_LOGIN_WINDOW_MINUTES} minutes, starting {t.isoformat()}",
                })
                break  # one finding per user is enough, don't report every overlapping window

    # Off-hours successful password checks (IST).
    for r in rows:
        if r.action != "login_password_verified":
            continue
        ist_hour = r.created_at.astimezone(IST).hour
        if ist_hour >= OFF_HOURS_START_IST or ist_hour < OFF_HOURS_END_IST:
            findings.append({
                "type": "off_hours_access", "user_id": str(r.user_id) if r.user_id else None,
                "created_at": r.created_at.isoformat(),
                "detail": f"Successful login at {r.created_at.astimezone(IST).strftime('%H:%M')} IST",
            })

    return findings


if __name__ == "__main__":
    from unittest.mock import MagicMock

    class _FakeQuery:
        def __init__(self, rows):
            self.rows = rows

        def filter(self, *a, **k):
            return self

        def order_by(self, *a, **k):
            return self

        def first(self):
            return self.rows[-1] if self.rows else None

        def all(self):
            return list(self.rows)

    class _FakeDB:
        def __init__(self):
            self.rows = []

        def query(self, model):
            return _FakeQuery(self.rows)

        def add(self, row):
            row.id = len(self.rows) + 1
            self.rows.append(row)

    db = _FakeDB()

    r1 = write_audit(db, tenant_id="t1", user_id="u1", action="login", ip_address="1.2.3.4")
    r2 = write_audit(db, tenant_id="t1", user_id="u1", action="export", detail={"rows": 500})
    r3 = write_audit(db, tenant_id="t1", user_id="u2", action="logout")

    assert r1.prev_hash == "", "first row in a tenant's chain has no predecessor"
    assert r2.prev_hash == r1.row_hash
    assert r3.prev_hash == r2.row_hash
    assert len({r1.row_hash, r2.row_hash, r3.row_hash}) == 3, "hashes must be distinct"

    result = verify_audit_chain(db, "t1")
    assert result == {"valid": True, "checked": 3, "skipped_unchained": 0, "broken_at_id": None, "reason": None}, result

    # Tamper with row 2's content after the fact — chain must catch it.
    r2.detail = {"rows": 999999}
    tampered = verify_audit_chain(db, "t1")
    assert tampered["valid"] is False and tampered["broken_at_id"] == r2.id, tampered

    # Restore, then tamper with prev_hash directly (simulating a deleted-and-
    # reinserted row) — must also be caught.
    r2.detail = {"rows": 500}
    assert verify_audit_chain(db, "t1")["valid"] is True
    r3.prev_hash = "0" * 64
    broken_link = verify_audit_chain(db, "t1")
    assert broken_link["valid"] is False and broken_link["broken_at_id"] == r3.id, broken_link

    # Pre-chain rows (row_hash=None) are skipped, not flagged as tampered.
    db2 = _FakeDB()
    old = AuditLog(tenant_id="t2", action="legacy_action")
    old.id = 1
    old.row_hash = None
    old.prev_hash = None
    db2.rows.append(old)
    write_audit(db2, tenant_id="t2", action="new_action")
    legacy_result = verify_audit_chain(db2, "t2")
    assert legacy_result == {"valid": True, "checked": 1, "skipped_unchained": 1, "broken_at_id": None, "reason": None}, legacy_result

    # detect_anomalies: repeated failed logins + off-hours access.
    # _FakeQuery.filter() is a no-op, so every row placed in db3.rows is
    # exactly what detect_anomalies() sees — the test builds rows that are
    # already what the real DB query would have returned.
    db3 = _FakeDB()
    base = datetime(2026, 9, 18, 10, 0, tzinfo=timezone.utc)  # 15:30 IST — daytime
    for i in range(5):
        row = AuditLog(tenant_id="t3", user_id="attacker", action="login_failed",
                        created_at=base + timedelta(minutes=i * 2))
        row.id = 100 + i
        db3.rows.append(row)
    off_hours = AuditLog(tenant_id="t3", user_id="night-owl", action="login_password_verified",
                          created_at=datetime(2026, 9, 18, 19, 0, tzinfo=timezone.utc))  # 00:30 IST
    off_hours.id = 200
    db3.rows.append(off_hours)
    normal = AuditLog(tenant_id="t3", user_id="regular", action="login_password_verified",
                       created_at=datetime(2026, 9, 18, 5, 0, tzinfo=timezone.utc))  # 10:30 IST
    normal.id = 201
    db3.rows.append(normal)

    findings = detect_anomalies(db3, "t3")
    kinds = {f["type"] for f in findings}
    assert "repeated_failed_logins" in kinds, findings
    failed = next(f for f in findings if f["type"] == "repeated_failed_logins")
    assert failed["user_id"] == "attacker" and failed["count"] == 5, failed

    assert "off_hours_access" in kinds, findings
    off = [f for f in findings if f["type"] == "off_hours_access"]
    assert len(off) == 1 and off[0]["user_id"] == "night-owl", off

    normal_flags = [f for f in findings if f.get("user_id") == "regular"]
    assert normal_flags == [], "daytime single login must not be flagged"

    print("audit self-check: OK")
