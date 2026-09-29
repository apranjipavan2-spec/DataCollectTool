"""Crux check for sync-time exact-duplicate detection: two answer sets count as
the same interview iff their question answers match, regardless of key order or
_-prefixed bookkeeping. If this breaks, _find_exact_duplicate mis-fires."""
from app.api.routes.submissions import _content_fingerprint


def test_key_order_and_bookkeeping_ignored():
    a = {"q1": "Female", "n2": "No", "_duration_sec": 817, "_gps": "1,2"}
    b = {"n2": "No", "q1": "Female", "_duration_sec": 42, "_conflict_resolved": True}
    assert _content_fingerprint(a) == _content_fingerprint(b)  # same answers → same


def test_different_answers_differ():
    a = {"q1": "Female", "n2": "No"}
    b = {"q1": "Male", "n2": "No"}
    assert _content_fingerprint(a) != _content_fingerprint(b)


def test_multiselect_order_ignored():
    a = {"n12": ["x", "y"]}
    b = {"n12": ["y", "x"]}
    assert _content_fingerprint(a) == _content_fingerprint(b)


# ── Re-upload of one interview: audio ids differ, answers identical ──────────
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from app.api.routes.submissions import _cluster_same_interview, _cluster_similar, _recommend_keep


def test_media_ids_ignored():
    a = {"q1": "Female", "consent_audio": "media://aaa", "photos": ["media://p1"]}
    b = {"q1": "Female", "consent_audio": "__audio_pending__", "photos": ["media://p2"]}
    assert _content_fingerprint(a) == _content_fingerprint(b)


def _sub(sid, enum, started, received=None, data=None):
    return SimpleNamespace(id=sid, enumerator_id=enum, local_created_at=started,
                           server_received_at=received, data_json=data or {},
                           has_violations=False, backcheck_completed=False)


T0 = datetime(2026, 9, 20, 16, 14, 9, tzinfo=timezone.utc)


def test_same_interview_within_seconds():
    subs = [_sub("a", "u", T0), _sub("b", "u", T0 + timedelta(seconds=3)),
            _sub("c", "u", T0 + timedelta(minutes=25))]
    assert [[s.id for s in c] for c in _cluster_same_interview(subs)] == [["a", "b"]]


def test_offline_batch_synced_together_not_duplicate():
    # Started 30 min apart, all received by the server in the same second.
    subs = [_sub(str(i), "u", T0 + timedelta(minutes=30 * i), received=T0 + timedelta(hours=5))
            for i in range(4)]
    assert _cluster_same_interview(subs) == []


def test_different_enumerators_same_second_not_duplicate():
    assert _cluster_same_interview([_sub("a", "u1", T0), _sub("b", "u2", T0)]) == []


def test_similar_groups_one_respondent_not_whole_day():
    base = {f"q{i}": "x" for i in range(40)}
    other = {f"q{i}": "y" for i in range(40)}
    subs = [_sub("a", "u", T0), _sub("b", "u", T0), _sub("c", "u", T0)]
    answers = {"a": base, "b": dict(base, q0="z"), "c": other}  # b = 39/40 same as a
    assert [sorted(s.id for s in c) for c in _cluster_similar(subs, answers)] == [["a", "b"]]


def test_recommend_keep_prefers_uploaded_audio():
    pending = _sub("p", "u", T0, received=T0, data={"q1": "x", "consent_audio": "__audio_pending__"})
    uploaded = _sub("m", "u", T0, received=T0, data={"q1": "x", "consent_audio": "media://m"})
    assert _recommend_keep([pending, uploaded]) == "m"


# ── Sync-time auto-mark: only when provably the same interview ──────────────
from app.api.routes.sync import _is_certain_same_interview


def test_auto_mark_certain_same_start_with_audio():
    other = _sub("k", "u", T0, data={"q1": "x", "consent_audio": "media://a"})
    assert _is_certain_same_interview(T0 + timedelta(seconds=2), other)


def test_auto_mark_not_certain_different_start():
    # Identical answers but started 20 min apart = could be a second respondent.
    other = _sub("k", "u", T0, data={"q1": "x"})
    assert not _is_certain_same_interview(T0 + timedelta(minutes=20), other)


def test_auto_mark_not_certain_when_kept_copy_lacks_audio():
    other = _sub("k", "u", T0, data={"q1": "x", "consent_audio": "__audio_pending__"})
    assert not _is_certain_same_interview(T0, other)


def test_auto_mark_not_certain_without_start_time():
    assert not _is_certain_same_interview(None, _sub("k", "u", T0))
