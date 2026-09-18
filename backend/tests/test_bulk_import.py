"""Bulk-import password generation: a row without a CSV password must get a
unique random one, never a shared/guessable default. If this regresses, every
bulk-imported user without an explicit password silently shares one weak,
publicly-documented credential again."""
import io
import pytest
from .conftest import skip_no_db, make_tenant, make_user, auth_headers


@skip_no_db
class TestBulkImportPasswords:
    def test_missing_password_gets_unique_generated_one(self, client, db_session):
        tenant = make_tenant(db_session)
        admin = make_user(db_session, tenant.id, role="org_admin", phone="+919111000020", password="Pass@123")
        headers = auth_headers(str(admin.id), str(tenant.id), admin.role)

        csv_content = "phone,name,role\n+919222000001,Alice,enumerator\n+919222000002,Bob,enumerator\n"
        files = {"file": ("users.csv", io.BytesIO(csv_content.encode()), "text/csv")}
        r = client.post("/api/v1/users/bulk-import", files=files, headers=headers)

        assert r.status_code == 200, r.text
        data = r.json()
        assert data["created"] == 2
        assert len(data["generated_passwords"]) == 2

        pw1 = data["generated_passwords"][0]["password"]
        pw2 = data["generated_passwords"][1]["password"]
        assert pw1 != pw2                       # never the same shared default
        assert pw1 != "fieldgovern123"           # never the old hardcoded value
        assert len(pw1) >= 12

    def test_explicit_csv_password_is_used_and_not_reported_as_generated(self, client, db_session):
        tenant = make_tenant(db_session)
        admin = make_user(db_session, tenant.id, role="org_admin", phone="+919111000021", password="Pass@123")
        headers = auth_headers(str(admin.id), str(tenant.id), admin.role)

        csv_content = "phone,name,role,password\n+919222000003,Carol,enumerator,MyOwnPass1\n"
        files = {"file": ("users.csv", io.BytesIO(csv_content.encode()), "text/csv")}
        r = client.post("/api/v1/users/bulk-import", files=files, headers=headers)

        assert r.status_code == 200, r.text
        data = r.json()
        assert data["created"] == 1
        assert data["generated_passwords"] == []  # explicit password -> nothing to surface

        login = client.post("/api/v1/auth/login", json={"phone": "+919222000003", "password": "MyOwnPass1"})
        assert login.status_code == 200

    def test_generated_password_actually_logs_in(self, client, db_session):
        tenant = make_tenant(db_session)
        admin = make_user(db_session, tenant.id, role="org_admin", phone="+919111000022", password="Pass@123")
        headers = auth_headers(str(admin.id), str(tenant.id), admin.role)

        csv_content = "phone,name,role\n+919222000004,Dave,enumerator\n"
        files = {"file": ("users.csv", io.BytesIO(csv_content.encode()), "text/csv")}
        data = client.post("/api/v1/users/bulk-import", files=files, headers=headers).json()
        generated_pw = data["generated_passwords"][0]["password"]

        login = client.post("/api/v1/auth/login", json={"phone": "+919222000004", "password": generated_pw})
        assert login.status_code == 200
