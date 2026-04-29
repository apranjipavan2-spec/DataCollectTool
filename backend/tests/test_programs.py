"""Programs CRUD tests — create, list, update, delete programs and locations."""
import uuid
import pytest
from .conftest import skip_no_db, make_tenant, make_user, auth_headers


@skip_no_db
class TestPrograms:
    def _setup(self, db_session):
        tenant = make_tenant(db_session)
        admin = make_user(db_session, tenant.id, role="org_admin", phone="+919301000001")
        enum  = make_user(db_session, tenant.id, role="enumerator", phone="+919301000002")
        return tenant, admin, enum

    # ── Auth ──────────────────────────────────────────────────────────────────

    def test_list_programs_requires_auth(self, client, db_session):
        r = client.get("/api/v1/programs/")
        assert r.status_code == 401

    def test_create_program_requires_supervisor(self, client, db_session):
        tenant, _, enum = self._setup(db_session)
        r = client.post(
            "/api/v1/programs/",
            json={"name": "Prog A", "scheme_name": "MGNREGA"},
            headers=auth_headers(enum.id, tenant.id, "enumerator"),
        )
        assert r.status_code == 403

    # ── Create / List ─────────────────────────────────────────────────────────

    def test_create_program_success(self, client, db_session):
        tenant, admin, _ = self._setup(db_session)
        r = client.post(
            "/api/v1/programs/",
            json={"name": "Karnataka Road Survey", "scheme_name": "PMGSY", "status": "active"},
            headers=auth_headers(admin.id, tenant.id, "org_admin"),
        )
        assert r.status_code == 200
        assert "id" in r.json()

    def test_list_programs_empty(self, client, db_session):
        tenant, admin, _ = self._setup(db_session)
        r = client.get("/api/v1/programs/", headers=auth_headers(admin.id, tenant.id, "org_admin"))
        assert r.status_code == 200
        assert isinstance(r.json(), list)
        assert len(r.json()) == 0

    def test_list_programs_returns_created(self, client, db_session):
        tenant, admin, _ = self._setup(db_session)
        headers = auth_headers(admin.id, tenant.id, "org_admin")

        client.post("/api/v1/programs/", json={"name": "Survey A"}, headers=headers)
        client.post("/api/v1/programs/", json={"name": "Survey B"}, headers=headers)

        r = client.get("/api/v1/programs/", headers=headers)
        assert r.status_code == 200
        names = [p["name"] for p in r.json()]
        assert "Survey A" in names
        assert "Survey B" in names

    def test_list_programs_tenant_isolated(self, client, db_session):
        """Programs from tenant A must not appear for tenant B."""
        tenant_a, admin_a, _ = self._setup(db_session)
        tenant_b = make_tenant(db_session, name="Org B")
        admin_b = make_user(db_session, tenant_b.id, role="org_admin", phone="+919301000003")

        client.post("/api/v1/programs/", json={"name": "Tenant A Program"},
                    headers=auth_headers(admin_a.id, tenant_a.id, "org_admin"))

        r = client.get("/api/v1/programs/", headers=auth_headers(admin_b.id, tenant_b.id, "org_admin"))
        assert r.status_code == 200
        assert len(r.json()) == 0

    # ── Update / Delete ───────────────────────────────────────────────────────

    def test_update_program(self, client, db_session):
        tenant, admin, _ = self._setup(db_session)
        headers = auth_headers(admin.id, tenant.id, "org_admin")

        create = client.post("/api/v1/programs/", json={"name": "Old Name"}, headers=headers)
        prog_id = create.json()["id"]

        r = client.patch(f"/api/v1/programs/{prog_id}", json={"name": "New Name", "status": "completed"}, headers=headers)
        assert r.status_code == 200

        detail = client.get(f"/api/v1/programs/{prog_id}", headers=headers)
        assert detail.json()["name"] == "New Name"
        assert detail.json()["status"] == "completed"

    def test_delete_program(self, client, db_session):
        tenant, admin, _ = self._setup(db_session)
        headers = auth_headers(admin.id, tenant.id, "org_admin")

        create = client.post("/api/v1/programs/", json={"name": "To Delete"}, headers=headers)
        prog_id = create.json()["id"]

        r = client.delete(f"/api/v1/programs/{prog_id}", headers=headers)
        assert r.status_code == 200

        detail = client.get(f"/api/v1/programs/{prog_id}", headers=headers)
        assert detail.status_code == 404

    # ── Locations ────────────────────────────────────────────────────────────

    def test_create_location(self, client, db_session):
        tenant, admin, _ = self._setup(db_session)
        r = client.post(
            "/api/v1/programs/locations",
            json={"district": "Gulbarga", "block": "Afzalpur", "village": "Chittapur"},
            headers=auth_headers(admin.id, tenant.id, "org_admin"),
        )
        assert r.status_code == 200
        assert "id" in r.json()

    def test_list_locations(self, client, db_session):
        tenant, admin, _ = self._setup(db_session)
        headers = auth_headers(admin.id, tenant.id, "org_admin")
        client.post("/api/v1/programs/locations", json={"district": "Bidar"}, headers=headers)
        r = client.get("/api/v1/programs/locations", headers=headers)
        assert r.status_code == 200
        assert any(l["district"] == "Bidar" for l in r.json())

    def test_create_location_missing_district(self, client, db_session):
        tenant, admin, _ = self._setup(db_session)
        r = client.post(
            "/api/v1/programs/locations",
            json={"block": "Afzalpur"},
            headers=auth_headers(admin.id, tenant.id, "org_admin"),
        )
        assert r.status_code == 422
