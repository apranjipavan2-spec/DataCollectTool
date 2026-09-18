"""Form schema validation tests — create, retrieve, check schema integrity."""
import uuid
import pytest
from .conftest import skip_no_db, make_tenant, make_user


def _login(client, phone, password):
    r = client.post("/api/v1/auth/login", json={"phone": phone, "password": password})
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


VALID_SCHEMA = {
    "sections": [
        {
            "id": "s1",
            "title": "Basics",
            "fields": [
                {"id": "name", "name": "name", "type": "text", "label": "Full Name", "required": True},
                {"id": "age", "name": "age", "type": "number", "label": "Age", "required": True, "min": 0, "max": 120},
                {
                    "id": "gender",
                    "name": "gender",
                    "type": "single_choice",
                    "label": "Gender",
                    "required": True,
                    "options": [{"value": "male", "label": "Male"}, {"value": "female", "label": "Female"}],
                },
            ],
        }
    ],
    "version": 1,
}


@skip_no_db
class TestFormSchema:
    def _auth_headers(self, client, db_session):
        tenant = make_tenant(db_session)
        make_user(db_session, tenant.id, phone="+919333000001", password="Test@1234", role="org_admin")
        token = _login(client, "+919333000001", "Test@1234")
        return {"Authorization": f"Bearer {token}"}

    def test_create_form_with_valid_schema(self, client, db_session):
        headers = self._auth_headers(client, db_session)
        r = client.post("/api/v1/forms/", json={"title": "My Survey", "schema": VALID_SCHEMA}, headers=headers)
        assert r.status_code == 200
        data = r.json()
        assert data["title"] == "My Survey"
        assert "id" in data

    def test_create_form_missing_title_rejected(self, client, db_session):
        headers = self._auth_headers(client, db_session)
        r = client.post("/api/v1/forms/", json={"schema": VALID_SCHEMA}, headers=headers)
        assert r.status_code == 422

    def test_form_schema_round_trips_intact(self, client, db_session):
        """Schema written to DB must come back identical."""
        headers = self._auth_headers(client, db_session)
        r = client.post("/api/v1/forms/", json={"title": "Round Trip", "schema": VALID_SCHEMA}, headers=headers)
        form_id = r.json()["id"]

        r2 = client.get(f"/api/v1/forms/{form_id}", headers=headers)
        assert r2.status_code == 200
        schema = r2.json()["schema"]
        assert len(schema["sections"]) == 1
        fields = schema["sections"][0]["fields"]
        assert len(fields) == 3
        field_ids = {f["id"] for f in fields}
        assert {"name", "age", "gender"} == field_ids

    def test_form_requires_auth(self, client, db_session):
        r = client.get(f"/api/v1/forms/{uuid.uuid4()}")
        assert r.status_code == 401

    def test_choice_field_preserves_options(self, client, db_session):
        headers = self._auth_headers(client, db_session)
        r = client.post("/api/v1/forms/", json={"title": "Options Test", "schema": VALID_SCHEMA}, headers=headers)
        form_id = r.json()["id"]

        r2 = client.get(f"/api/v1/forms/{form_id}", headers=headers)
        sections = r2.json()["schema"]["sections"]
        gender_field = next(f for f in sections[0]["fields"] if f["id"] == "gender")
        option_values = {o["value"] for o in gender_field["options"]}
        assert option_values == {"male", "female"}
