"""Submission list, status update, and bulk update tests."""
import uuid
import pytest
from .conftest import skip_no_db, make_tenant, make_user, make_form, make_submission, auth_headers


@skip_no_db
class TestSubmissionList:
    def _setup(self, db_session):
        tenant = make_tenant(db_session)
        admin = make_user(db_session, tenant.id, role="org_admin", phone="+919302000001")
        enum  = make_user(db_session, tenant.id, role="enumerator", phone="+919302000002")
        form  = make_form(db_session, tenant.id)
        return tenant, admin, enum, form

    def test_list_requires_auth(self, client, db_session):
        r = client.get("/api/v1/submissions/")
        assert r.status_code == 401

    def test_list_returns_empty_initially(self, client, db_session):
        tenant, admin, _, _ = self._setup(db_session)
        r = client.get("/api/v1/submissions/", headers=auth_headers(admin.id, tenant.id, "org_admin"))
        assert r.status_code == 200
        assert r.json()["total"] == 0

    def test_list_returns_submissions(self, client, db_session):
        tenant, admin, enum, form = self._setup(db_session)
        make_submission(db_session, tenant.id, form.id, enum.id, data={"name": "Ramu"})
        make_submission(db_session, tenant.id, form.id, enum.id, data={"name": "Sita"})

        r = client.get("/api/v1/submissions/", headers=auth_headers(admin.id, tenant.id, "org_admin"))
        assert r.status_code == 200
        assert r.json()["total"] == 2

    def test_list_filter_by_form_id(self, client, db_session):
        tenant, admin, enum, form = self._setup(db_session)
        form2 = make_form(db_session, tenant.id, title="Other Form")
        make_submission(db_session, tenant.id, form.id, enum.id)
        make_submission(db_session, tenant.id, form2.id, enum.id)

        r = client.get(f"/api/v1/submissions/?form_id={form.id}", headers=auth_headers(admin.id, tenant.id, "org_admin"))
        assert r.status_code == 200
        assert r.json()["total"] == 1

    def test_enumerator_sees_only_own(self, client, db_session):
        tenant, admin, enum, form = self._setup(db_session)
        enum2 = make_user(db_session, tenant.id, role="enumerator", phone="+919302000003")
        make_submission(db_session, tenant.id, form.id, enum.id)
        make_submission(db_session, tenant.id, form.id, enum2.id)

        r = client.get("/api/v1/submissions/", headers=auth_headers(enum.id, tenant.id, "enumerator"))
        assert r.status_code == 200
        assert r.json()["total"] == 1

    def test_list_tenant_isolated(self, client, db_session):
        tenant_a, admin_a, enum_a, form_a = self._setup(db_session)
        tenant_b = make_tenant(db_session, name="Org B")
        admin_b  = make_user(db_session, tenant_b.id, role="org_admin", phone="+919302000004")
        form_b   = make_form(db_session, tenant_b.id)
        make_submission(db_session, tenant_b.id, form_b.id, admin_b.id)

        r = client.get("/api/v1/submissions/", headers=auth_headers(admin_a.id, tenant_a.id, "org_admin"))
        assert r.status_code == 200
        assert r.json()["total"] == 0


@skip_no_db
class TestSubmissionStatusUpdate:
    def _setup(self, db_session):
        tenant = make_tenant(db_session)
        admin = make_user(db_session, tenant.id, role="org_admin", phone="+919303000001")
        enum  = make_user(db_session, tenant.id, role="enumerator", phone="+919303000002")
        form  = make_form(db_session, tenant.id)
        sub   = make_submission(db_session, tenant.id, form.id, enum.id)
        return tenant, admin, enum, sub

    def test_update_status_requires_supervisor(self, client, db_session):
        tenant, _, enum, sub = self._setup(db_session)
        r = client.patch(
            f"/api/v1/submissions/{sub.id}",
            json={"status": "approved"},
            headers=auth_headers(enum.id, tenant.id, "enumerator"),
        )
        assert r.status_code == 403

    def test_flag_submission(self, client, db_session):
        tenant, admin, _, sub = self._setup(db_session)
        r = client.patch(
            f"/api/v1/submissions/{sub.id}",
            json={"status": "flagged", "flag_note": "GPS mismatch"},
            headers=auth_headers(admin.id, tenant.id, "org_admin"),
        )
        assert r.status_code == 200

    def test_approve_submission(self, client, db_session):
        tenant, admin, _, sub = self._setup(db_session)
        r = client.patch(
            f"/api/v1/submissions/{sub.id}",
            json={"status": "approved"},
            headers=auth_headers(admin.id, tenant.id, "org_admin"),
        )
        assert r.status_code == 200

    def test_update_nonexistent_submission(self, client, db_session):
        tenant, admin, _, _ = self._setup(db_session)
        r = client.patch(
            f"/api/v1/submissions/{uuid.uuid4()}",
            json={"status": "approved"},
            headers=auth_headers(admin.id, tenant.id, "org_admin"),
        )
        assert r.status_code == 404

    def test_cannot_update_other_tenants_submission(self, client, db_session):
        tenant_a, admin_a, _, sub_a = self._setup(db_session)
        tenant_b = make_tenant(db_session, name="Org B")
        admin_b  = make_user(db_session, tenant_b.id, role="org_admin", phone="+919303000003")

        r = client.patch(
            f"/api/v1/submissions/{sub_a.id}",
            json={"status": "approved"},
            headers=auth_headers(admin_b.id, tenant_b.id, "org_admin"),
        )
        assert r.status_code == 404


@skip_no_db
class TestBulkUpdate:
    def _setup(self, db_session):
        tenant = make_tenant(db_session)
        admin = make_user(db_session, tenant.id, role="org_admin", phone="+919304000001")
        enum  = make_user(db_session, tenant.id, role="enumerator", phone="+919304000002")
        form  = make_form(db_session, tenant.id)
        subs  = [make_submission(db_session, tenant.id, form.id, enum.id) for _ in range(3)]
        return tenant, admin, subs

    def test_bulk_update_requires_supervisor(self, client, db_session):
        tenant = make_tenant(db_session)
        enum   = make_user(db_session, tenant.id, role="enumerator", phone="+919304000003")
        r = client.post(
            "/api/v1/submissions/bulk",
            json={"ids": [], "status": "approved"},
            headers=auth_headers(enum.id, tenant.id, "enumerator"),
        )
        assert r.status_code == 403

    def test_bulk_approve(self, client, db_session):
        tenant, admin, subs = self._setup(db_session)
        ids = [str(s.id) for s in subs]
        r = client.post(
            "/api/v1/submissions/bulk",
            json={"ids": ids, "status": "approved"},
            headers=auth_headers(admin.id, tenant.id, "org_admin"),
        )
        assert r.status_code == 200
        data = r.json()
        assert data.get("updated", 0) == 3

    def test_bulk_flag_with_note(self, client, db_session):
        tenant, admin, subs = self._setup(db_session)
        ids = [str(s.id) for s in subs[:2]]
        r = client.post(
            "/api/v1/submissions/bulk",
            json={"ids": ids, "status": "flagged", "flag_note": "Duplicate suspect"},
            headers=auth_headers(admin.id, tenant.id, "org_admin"),
        )
        assert r.status_code == 200

    def test_bulk_empty_ids_rejected(self, client, db_session):
        tenant, admin, _ = self._setup(db_session)
        r = client.post(
            "/api/v1/submissions/bulk",
            json={"ids": [], "status": "approved"},
            headers=auth_headers(admin.id, tenant.id, "org_admin"),
        )
        assert r.status_code == 422
