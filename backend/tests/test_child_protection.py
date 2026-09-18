"""Children's-data protection: age computation, guardian-consent detection,
and the two enforcement points (hidden from list_submissions by default,
excluded from AI report queries). If this regresses, a minor's submission
can silently reach an AI call or an enumerator's default submission list."""
import pytest
from datetime import date
from app.services.child_protection import compute_child_protection_status
from .conftest import skip_no_db, make_tenant, make_user, make_form, auth_headers


# ── Pure logic (no DB needed) ──────────────────────────────────────────────

SCHEMA = {
    "sections": [{
        "fields": [
            {"id": "f1", "name": "dob", "type": "date", "is_dob_for_screening": True},
            {"id": "f2", "name": "guardian_ok", "type": "single_choice", "is_guardian_consent": True},
        ]
    }]
}
REF = date(2026, 9, 18)


def test_adult_not_flagged():
    r = compute_child_protection_status(SCHEMA, {"dob": "2000-01-01"}, as_of=REF)
    assert r == {"is_minor": False, "guardian_consent_given": None}


def test_minor_with_consent():
    r = compute_child_protection_status(SCHEMA, {"dob": "2015-01-01", "guardian_ok": "Yes"}, as_of=REF)
    assert r == {"is_minor": True, "guardian_consent_given": True}


def test_minor_without_consent():
    r = compute_child_protection_status(SCHEMA, {"dob": "2015-01-01"}, as_of=REF)
    assert r == {"is_minor": True, "guardian_consent_given": False}


def test_form_without_screening_field_is_untouched():
    plain = {"sections": [{"fields": [{"id": "f1", "name": "name", "type": "text"}]}]}
    r = compute_child_protection_status(plain, {"name": "Asha"}, as_of=REF)
    assert r == {"is_minor": False, "guardian_consent_given": None}


# ── Enforcement points (need a real DB) ────────────────────────────────────

CHILD_FORM_SCHEMA = {
    "sections": [{
        "id": "s1",
        "title": "Screening",
        "fields": [
            {"id": "f1", "name": "dob", "label": "Date of birth", "type": "date", "is_dob_for_screening": True},
            {"id": "f2", "name": "guardian_ok", "label": "Guardian consents", "type": "single_choice",
             "is_guardian_consent": True, "options": [{"value": "yes", "label": "Yes"}]},
        ],
    }]
}


@skip_no_db
class TestChildProtectionEndToEnd:
    def test_create_submission_sets_minor_and_consent_flags(self, client, db_session):
        tenant = make_tenant(db_session)
        enum = make_user(db_session, tenant.id, role="enumerator", phone="+919111000030", password="Pass@123")
        form = make_form(db_session, tenant.id, title="Child Screening Form")
        form.json_schema = CHILD_FORM_SCHEMA
        db_session.flush()
        headers = auth_headers(str(enum.id), str(tenant.id), enum.role)

        r = client.post("/api/v1/submissions/", json={
            "form_id": str(form.id), "form_version": 1,
            "data_json": {"dob": "2015-01-01", "guardian_ok": "yes"},
        }, headers=headers)
        assert r.status_code == 201, r.text
        sub_id = r.json()["id"]

        from app.models.submission import Submission
        sub = db_session.query(Submission).filter(Submission.id == sub_id).first()
        assert sub.is_minor is True
        assert sub.guardian_consent_given is True

    def test_adult_submission_not_flagged(self, client, db_session):
        tenant = make_tenant(db_session)
        enum = make_user(db_session, tenant.id, role="enumerator", phone="+919111000031", password="Pass@123")
        form = make_form(db_session, tenant.id, title="Child Screening Form 2")
        form.json_schema = CHILD_FORM_SCHEMA
        db_session.flush()
        headers = auth_headers(str(enum.id), str(tenant.id), enum.role)

        r = client.post("/api/v1/submissions/", json={
            "form_id": str(form.id), "form_version": 1,
            "data_json": {"dob": "1990-01-01"},
        }, headers=headers)
        assert r.status_code == 201, r.text

        from app.models.submission import Submission
        sub = db_session.query(Submission).filter(Submission.id == r.json()["id"]).first()
        assert sub.is_minor is False
        assert sub.guardian_consent_given is None

    def test_minor_hidden_from_enumerator_list_by_default(self, client, db_session):
        tenant = make_tenant(db_session)
        enum = make_user(db_session, tenant.id, role="enumerator", phone="+919111000032", password="Pass@123")
        form = make_form(db_session, tenant.id, title="Child Screening Form 3")
        form.json_schema = CHILD_FORM_SCHEMA
        db_session.flush()
        headers = auth_headers(str(enum.id), str(tenant.id), enum.role)

        client.post("/api/v1/submissions/", json={
            "form_id": str(form.id), "form_version": 1,
            "data_json": {"dob": "2015-01-01", "guardian_ok": "yes"},
        }, headers=headers)

        r = client.get("/api/v1/submissions/", headers=headers)
        assert r.status_code == 200
        assert r.json()["total"] == 0  # hidden even though this enumerator created it

    def test_minor_hidden_from_org_admin_by_default_but_visible_with_include_minors(self, client, db_session):
        tenant = make_tenant(db_session)
        enum = make_user(db_session, tenant.id, role="enumerator", phone="+919111000033", password="Pass@123")
        admin = make_user(db_session, tenant.id, role="org_admin", phone="+919111000034", password="Pass@123")
        form = make_form(db_session, tenant.id, title="Child Screening Form 4")
        form.json_schema = CHILD_FORM_SCHEMA
        db_session.flush()
        enum_headers = auth_headers(str(enum.id), str(tenant.id), enum.role)
        admin_headers = auth_headers(str(admin.id), str(tenant.id), admin.role)

        client.post("/api/v1/submissions/", json={
            "form_id": str(form.id), "form_version": 1,
            "data_json": {"dob": "2015-01-01", "guardian_ok": "yes"},
        }, headers=enum_headers)

        default_view = client.get("/api/v1/submissions/", headers=admin_headers)
        assert default_view.json()["total"] == 0

        with_minors = client.get("/api/v1/submissions/?include_minors=true", headers=admin_headers)
        assert with_minors.json()["total"] == 1
        assert with_minors.json()["items"][0]["is_minor"] is True
