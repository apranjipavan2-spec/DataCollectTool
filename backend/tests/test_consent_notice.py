"""DPDP notice versioning: _reconcile_consent_notice_version must assign the
consent notice a stable version number, bumping only when the notice's own
content changes — not on every question edit — and must never trust a
client-supplied version (which would let a form owner silently change the
notice text without respondents ever seeing an updated version marker)."""
from app.api.routes.forms import _reconcile_consent_notice_version


def test_first_save_assigns_version_1():
    schema = {"sections": [], "settings": {"consent_notice": {"org_name": "Acme NGO", "purpose": "Research"}}}
    _reconcile_consent_notice_version(None, schema)
    assert schema["settings"]["consent_notice"]["version"] == 1


def test_unrelated_schema_edit_does_not_bump_version():
    old = {"sections": [{"fields": []}], "settings": {"consent_notice": {"org_name": "Acme NGO", "version": 3}}}
    new = {"sections": [{"fields": [{"id": "f1"}]}], "settings": {"consent_notice": {"org_name": "Acme NGO"}}}
    _reconcile_consent_notice_version(old, new)
    assert new["settings"]["consent_notice"]["version"] == 3


def test_notice_content_change_bumps_version():
    old = {"settings": {"consent_notice": {"org_name": "Acme NGO", "purpose": "Research", "version": 3}}}
    new = {"settings": {"consent_notice": {"org_name": "Acme NGO", "purpose": "Research, updated"}}}
    _reconcile_consent_notice_version(old, new)
    assert new["settings"]["consent_notice"]["version"] == 4


def test_client_supplied_version_is_ignored():
    old = {"settings": {"consent_notice": {"org_name": "Acme NGO", "version": 3}}}
    new = {"settings": {"consent_notice": {"org_name": "Acme NGO", "version": 999}}}  # forged
    _reconcile_consent_notice_version(old, new)
    assert new["settings"]["consent_notice"]["version"] == 3  # unchanged content → stays at 3, forgery ignored


def test_no_notice_present_is_a_noop():
    old = {"settings": {}}
    new = {"settings": {}}
    _reconcile_consent_notice_version(old, new)
    assert "consent_notice" not in new["settings"]


def test_missing_settings_key_does_not_crash():
    old = None
    new = {"sections": []}
    _reconcile_consent_notice_version(old, new)
    assert "consent_notice" not in new.get("settings", {})
