"""Admin monitor endpoint tests — master_admin RBAC, overview, programs, platform-usage."""
import pytest
from .conftest import skip_no_db, make_tenant, make_user, make_form, make_submission, auth_headers


@skip_no_db
class TestAdminMonitorAuth:
    """All monitor endpoints must reject non-master-admin roles."""

    def _org_headers(self, db_session):
        t = make_tenant(db_session)
        u = make_user(db_session, t.id, role="org_admin", phone="+919305000001")
        return auth_headers(u.id, t.id, "org_admin")

    def test_overview_rejects_org_admin(self, client, db_session):
        r = client.get("/api/v1/admin/monitor/overview", headers=self._org_headers(db_session))
        assert r.status_code == 403

    def test_programs_rejects_org_admin(self, client, db_session):
        r = client.get("/api/v1/admin/monitor/programs", headers=self._org_headers(db_session))
        assert r.status_code == 403

    def test_platform_usage_rejects_org_admin(self, client, db_session):
        r = client.get("/api/v1/admin/monitor/platform-usage", headers=self._org_headers(db_session))
        assert r.status_code == 403

    def test_overview_requires_auth(self, client, db_session):
        r = client.get("/api/v1/admin/monitor/overview")
        assert r.status_code == 401


@skip_no_db
class TestAdminMonitorOverview:
    def _master_headers(self, db_session):
        t = make_tenant(db_session, name="Platform")
        u = make_user(db_session, t.id, role="master_admin", phone="+919306000001")
        return auth_headers(u.id, t.id, "master_admin")

    def test_overview_returns_list(self, client, db_session):
        headers = self._master_headers(db_session)
        r = client.get("/api/v1/admin/monitor/overview", headers=headers)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_overview_includes_created_tenant(self, client, db_session):
        headers = self._master_headers(db_session)
        make_tenant(db_session, name="Karnataka NGO")

        r = client.get("/api/v1/admin/monitor/overview", headers=headers)
        assert r.status_code == 200
        tenant_names = [row["tenant_name"] for row in r.json()]
        assert "Karnataka NGO" in tenant_names

    def test_overview_response_shape(self, client, db_session):
        make_tenant(db_session, name="Shape Check Org")
        headers = self._master_headers(db_session)

        r = client.get("/api/v1/admin/monitor/overview", headers=headers)
        assert r.status_code == 200
        required = {"tenant_id", "tenant_name", "plan_tier", "user_count",
                    "program_count", "questionnaire_count", "total_target",
                    "total_collected", "pct"}
        for row in r.json():
            assert required.issubset(row.keys()), f"Missing keys: {required - row.keys()}"

    def test_overview_counts_are_correct(self, client, db_session):
        headers = self._master_headers(db_session)
        tenant = make_tenant(db_session, name="Count Test Org")
        admin  = make_user(db_session, tenant.id, role="org_admin", phone="+919306000002")
        form   = make_form(db_session, tenant.id)
        make_submission(db_session, tenant.id, form.id, admin.id)
        make_submission(db_session, tenant.id, form.id, admin.id)

        r = client.get("/api/v1/admin/monitor/overview", headers=headers)
        assert r.status_code == 200
        row = next((x for x in r.json() if x["tenant_name"] == "Count Test Org"), None)
        assert row is not None
        assert row["user_count"] == 1


@skip_no_db
class TestAdminMonitorPrograms:
    def _master_headers(self, db_session):
        t = make_tenant(db_session, name="Platform")
        u = make_user(db_session, t.id, role="master_admin", phone="+919307000001")
        return auth_headers(u.id, t.id, "master_admin")

    def test_all_programs_returns_list(self, client, db_session):
        headers = self._master_headers(db_session)
        r = client.get("/api/v1/admin/monitor/programs", headers=headers)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_all_programs_response_shape(self, client, db_session):
        headers = self._master_headers(db_session)
        tenant = make_tenant(db_session, name="Shape Org 2")
        admin  = make_user(db_session, tenant.id, role="org_admin", phone="+919307000002")

        # Create a program via the API so it appears in monitor
        client.post("/api/v1/programs/", json={"name": "Monitor Test Prog"},
                    headers=auth_headers(admin.id, tenant.id, "org_admin"))

        r = client.get("/api/v1/admin/monitor/programs", headers=headers)
        assert r.status_code == 200
        required = {"id", "tenant_id", "tenant_name", "name", "status",
                    "questionnaire_count", "total_target", "total_collected", "pct"}
        for row in r.json():
            assert required.issubset(row.keys())

    def test_filter_by_tenant_id(self, client, db_session):
        headers = self._master_headers(db_session)
        tenant_a = make_tenant(db_session, name="Org A for filter")
        tenant_b = make_tenant(db_session, name="Org B for filter")
        admin_a = make_user(db_session, tenant_a.id, role="org_admin", phone="+919307000003")
        admin_b = make_user(db_session, tenant_b.id, role="org_admin", phone="+919307000004")

        client.post("/api/v1/programs/", json={"name": "A Program"},
                    headers=auth_headers(admin_a.id, tenant_a.id, "org_admin"))
        client.post("/api/v1/programs/", json={"name": "B Program"},
                    headers=auth_headers(admin_b.id, tenant_b.id, "org_admin"))

        r = client.get(f"/api/v1/admin/monitor/programs?tenant_id={tenant_a.id}", headers=headers)
        assert r.status_code == 200
        names = [p["name"] for p in r.json()]
        assert "A Program" in names
        assert "B Program" not in names


@skip_no_db
class TestPlatformUsage:
    def _master_headers(self, db_session):
        t = make_tenant(db_session, name="Platform")
        u = make_user(db_session, t.id, role="master_admin", phone="+919308000001")
        return auth_headers(u.id, t.id, "master_admin")

    def test_platform_usage_response_shape(self, client, db_session):
        headers = self._master_headers(db_session)
        r = client.get("/api/v1/admin/monitor/platform-usage", headers=headers)
        assert r.status_code == 200
        data = r.json()
        assert "platform_totals" in data
        assert "tenants" in data
        totals = data["platform_totals"]
        assert {"tenants", "submissions_this_month", "total_submissions", "total_users"}.issubset(totals.keys())

    def test_platform_usage_tenant_row_shape(self, client, db_session):
        headers = self._master_headers(db_session)
        make_tenant(db_session, name="Usage Org")

        r = client.get("/api/v1/admin/monitor/platform-usage", headers=headers)
        assert r.status_code == 200
        required = {"tenant_id", "tenant_name", "total_submissions",
                    "submissions_this_month", "total_users", "total_forms"}
        for row in r.json()["tenants"]:
            assert required.issubset(row.keys())
