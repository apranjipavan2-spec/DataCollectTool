"""Google Sheets sync must redact is_identifier fields by default before a
row ever leaves FieldGovern — once synced, a row is outside FieldGovern's
audit log, access control, and erasure tools, so this is the only chance to
protect it. If this defaults to False or breaks, an org's respondent names/
phones land in a spreadsheet with no further protection."""
from types import SimpleNamespace
from app.services.sheets_sync import _redact_identifiers_if_configured
from app.services.pii_redact import REDACTED

SCHEMA = {
    "sections": [{
        "fields": [
            {"id": "f1", "name": "name", "type": "text", "is_identifier": True},
            {"id": "f2", "name": "age", "type": "number"},
        ]
    }]
}


def _form():
    return SimpleNamespace(json_schema=SCHEMA)


def test_excludes_identifiers_by_default():
    row = {"name": "Priya Sharma", "age": 34}
    out = _redact_identifiers_if_configured(_form(), {}, row)
    assert out == {"name": REDACTED, "age": 34}


def test_can_be_explicitly_disabled():
    row = {"name": "Priya Sharma", "age": 34}
    out = _redact_identifiers_if_configured(_form(), {"exclude_identifiers": False}, row)
    assert out == {"name": "Priya Sharma", "age": 34}


def test_explicit_true_matches_default():
    row = {"name": "Priya Sharma", "age": 34}
    out = _redact_identifiers_if_configured(_form(), {"exclude_identifiers": True}, row)
    assert out == {"name": REDACTED, "age": 34}
