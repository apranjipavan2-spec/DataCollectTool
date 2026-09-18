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
