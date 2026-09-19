"""Per-form DPDP retention policy date math (item 23). If is_past_retention
drifts, submissions either never expire (data-minimisation violation) or
expire early (data loss before the promised retention window). If
is_reminder_due drifts, admins either never get warned or get warned every
single day the job runs."""
from datetime import datetime, timedelta, timezone

from app.services.retention import is_past_retention, is_reminder_due, REMINDER_DAYS_BEFORE


NOW = datetime(2026, 9, 19, tzinfo=timezone.utc)


def test_not_past_retention_when_within_window():
    received = NOW - timedelta(days=10)
    assert is_past_retention(received, retention_days=30, now=NOW) is False


def test_past_retention_once_older_than_window():
    received = NOW - timedelta(days=31)
    assert is_past_retention(received, retention_days=30, now=NOW) is True


def test_not_past_retention_on_exact_boundary_day():
    # Exactly at the boundary — "older than" the window means strictly past it.
    received = NOW - timedelta(days=30)
    assert is_past_retention(received, retention_days=30, now=NOW) is False


def test_past_retention_handles_missing_timestamp():
    assert is_past_retention(None, retention_days=30, now=NOW) is False


def test_reminder_due_exactly_at_threshold():
    # 30-day retention, reminder 7 days before -> due when the submission is 23 days old.
    received = NOW - timedelta(days=30 - REMINDER_DAYS_BEFORE)
    assert is_reminder_due(received, retention_days=30, now=NOW) is True


def test_reminder_not_due_before_threshold():
    received = NOW - timedelta(days=10)  # 20 days left, threshold is 7
    assert is_reminder_due(received, retention_days=30, now=NOW) is False


def test_reminder_not_due_after_threshold_already_passed():
    # One day later than the reminder window — already past it, shouldn't refire.
    received = NOW - timedelta(days=30 - REMINDER_DAYS_BEFORE + 1)
    assert is_reminder_due(received, retention_days=30, now=NOW) is False


def test_reminder_not_due_once_already_past_retention():
    received = NOW - timedelta(days=31)
    assert is_reminder_due(received, retention_days=30, now=NOW) is False


def test_reminder_due_handles_missing_timestamp():
    assert is_reminder_due(None, retention_days=30, now=NOW) is False
