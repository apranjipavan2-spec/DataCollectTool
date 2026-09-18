"""DPDP data-principal rights: SLA/overdue computation. _serialize() is what
every list/detail response derives is_overdue from — if this drifts, either
overdue requests silently stop being flagged (compliance risk) or every
request gets wrongly flagged as overdue (alert fatigue)."""
from datetime import datetime, timedelta, timezone

from app.api.routes.data_rights import _serialize, SLA_TARGET_DAYS, SLA_OUTER_LIMIT_DAYS
from app.models.data_rights_request import DataRightsRequest


def _make(*, created_days_ago: int, status: str = "open") -> DataRightsRequest:
    now = datetime.now(timezone.utc)
    created_at = now - timedelta(days=created_days_ago)
    r = DataRightsRequest(
        request_type="access", requester_name="Test Respondent", requester_contact="+919999999999",
        status=status, identity_verified=False, linked_submission_ids=[],
        sla_due_at=created_at + timedelta(days=SLA_TARGET_DAYS),
        created_at=created_at,
    )
    r.id = "11111111-1111-1111-1111-111111111111"
    return r


def test_fresh_request_not_overdue():
    r = _make(created_days_ago=1)
    out = _serialize(r)
    assert out["is_overdue"] is False
    assert out["is_past_outer_limit"] is False


def test_past_target_sla_is_overdue_but_not_past_outer_limit():
    r = _make(created_days_ago=SLA_TARGET_DAYS + 1)
    out = _serialize(r)
    assert out["is_overdue"] is True
    assert out["is_past_outer_limit"] is False


def test_past_outer_limit_flags_both():
    r = _make(created_days_ago=SLA_OUTER_LIMIT_DAYS + 1)
    out = _serialize(r)
    assert out["is_overdue"] is True
    assert out["is_past_outer_limit"] is True


def test_closed_request_never_flagged_overdue_regardless_of_age():
    r = _make(created_days_ago=SLA_OUTER_LIMIT_DAYS + 100, status="closed")
    out = _serialize(r)
    assert out["is_overdue"] is False
    assert out["is_past_outer_limit"] is False
