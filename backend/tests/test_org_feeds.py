"""Organisation's own machine feeds (Saathi): exact totals, received-time filter, forms list.

All three accept the org's X-API-Key. Totals are exact (no <5 hiding) because the
same key can already read every raw row; identifier fields are still never read.
"""
import uuid
from datetime import datetime, timezone

import pytest

from app.services.results_aggregate import build_exact_totals

from .conftest import skip_no_db, make_tenant, make_user, make_form, auth_headers

SCHEMA = {"sections": [{"id": "s", "title": "Main", "fields": [
    {"id": "a", "name": "resp_name", "type": "text", "label": "Name", "is_identifier": True},
    {"id": "b", "name": "hh_size", "type": "number", "label": "Household size"},
    {"id": "c", "name": "income", "type": "decimal", "label": "Monthly income"},
    {"id": "d", "name": "gender", "type": "single_choice", "label": "Gender",
     "options": [{"value": "m", "label": "Male"}, {"value": "f", "label": "Female"}]},
    {"id": "e", "name": "aadhaar_no", "type": "number", "label": "ID number", "is_identifier": True},
    {"id": "f", "name": "notes", "type": "text", "label": "Notes"},
]}]}


def test_exact_totals_math_and_no_suppression():
    rows = [({"hh_size": "4", "income": 1000.5, "gender": "m"}, "2026-10"),
            ({"hh_size": 6, "income": "x", "gender": "f"}, "2026-10"),
            ({"hh_size": 3, "gender": "m"}, "2026-11")]
    r = build_exact_totals(SCHEMA, rows)
    oct_ = r["groups"][0]
    assert oct_["period"] == "2026-10" and oct_["count"] == 2
    assert oct_["numbers"]["hh_size"] == {"label": "Household size", "n": 2, "sum": 10.0, "average": 5.0, "min": 4.0, "max": 6.0}
    assert oct_["numbers"]["income"]["n"] == 1                 # "x" skipped, not counted as 0
    assert [o["count"] for o in oct_["choices"]["gender"]["options"]] == [1, 1]  # counts of 1 NOT hidden
    assert r["overall"]["count"] == 3 and r["overall"]["numbers"]["hh_size"]["sum"] == 13.0
    names = {q["name"] for q in r["questions"]}
    assert "resp_name" not in names and "aadhaar_no" not in names and "notes" not in names


@skip_no_db
class TestOrgFeeds:
    @pytest.fixture
    def paid_plan(self, monkeypatch):
        from app.api.routes import billing
        from app.services import plan_enforcement
        monkeypatch.setattr(billing, "check_feature", lambda *a, **k: None)
        monkeypatch.setattr(plan_enforcement, "check_api_calls_limit", lambda *a, **k: {"allowed": True, "reason": ""})
        monkeypatch.setattr(plan_enforcement, "increment_api_calls", lambda *a, **k: None)

    def _org(self, client, db_session):
        from app.models.submission import Submission
        t = make_tenant(db_session)
        admin = make_user(db_session, t.id, role="org_admin", phone="+919111000771")
        form = make_form(db_session, t.id, title="Saathi HH")
        form.json_schema = SCHEMA

        def sub(received, collected, data, status="synced"):
            db_session.add(Submission(id=uuid.uuid4(), tenant_id=t.id, form_id=form.id, enumerator_id=admin.id,
                                      data_json=data, status=status, server_received_at=received,
                                      local_created_at=collected))
        utc = timezone.utc
        # collected 30 Oct offline, received 2 Nov → "received" basis puts it in November
        sub(datetime(2026, 11, 2, 6, tzinfo=utc), datetime(2026, 10, 30, 6, tzinfo=utc), {"hh_size": 5, "gender": "f"})
        sub(datetime(2026, 10, 10, 6, tzinfo=utc), datetime(2026, 10, 10, 6, tzinfo=utc), {"hh_size": 3, "gender": "m"})
        # 31 Oct 20:00 UTC = 1 Nov 01:30 IST → November in IST
        sub(datetime(2026, 10, 31, 20, tzinfo=utc), datetime(2026, 10, 31, 20, tzinfo=utc), {"hh_size": 2, "gender": "m"})
        sub(datetime(2026, 10, 12, tzinfo=utc), datetime(2026, 10, 12, tzinfo=utc), {"hh_size": 99}, status="rejected")
        db_session.flush()
        r = client.post("/api/v1/api-keys/", json={"name": "Saathi"},
                        headers=auth_headers(str(admin.id), str(t.id), admin.role))
        assert r.status_code == 201, r.text
        return form, {"X-API-Key": r.json()["key"]}

    def test_totals_by_received_month_in_ist(self, client, db_session, paid_plan):
        form, h = self._org(client, db_session)
        r = client.get(f"/api/v1/export/totals/{form.id}?group_by=month", headers=h)
        assert r.status_code == 200, r.text
        body = r.json()
        by = {g["period"]: g for g in body["groups"]}
        assert {p: g["count"] for p, g in by.items()} == {"2026-10": 1, "2026-11": 2}   # rejected excluded
        assert by["2026-11"]["numbers"]["hh_size"]["sum"] == 7.0
        assert body["overall"]["count"] == 3 and body["time_basis"] == "received"

    def test_totals_by_collected_time_and_utc(self, client, db_session, paid_plan):
        form, h = self._org(client, db_session)
        body = client.get(f"/api/v1/export/totals/{form.id}?time_basis=collected&tz=UTC", headers=h).json()
        assert {g["period"]: g["count"] for g in body["groups"]} == {"2026-10": 3}

    def test_received_from_filter_catches_late_sync(self, client, db_session, paid_plan):
        form, h = self._org(client, db_session)
        rows = client.get(f"/api/v1/export/submissions/{form.id}/json?received_from=2026-11-01T00:00:00Z", headers=h).json()
        assert rows[0]["submission_count"] == 1 and rows[1]["hh_size"] == 5 and rows[1]["received_at"].startswith("2026-11-02")
        # the old phone-time filter misses it — that's the bug received_from fixes
        old = client.get(f"/api/v1/export/submissions/{form.id}/json?date_from=2026-11-01", headers=h).json()
        assert all(r.get("hh_size") != 5 for r in old[1:])

    def test_bad_params_rejected(self, client, db_session, paid_plan):
        form, h = self._org(client, db_session)
        assert client.get(f"/api/v1/export/totals/{form.id}?group_by=year", headers=h).status_code == 422
        assert client.get(f"/api/v1/export/totals/{form.id}?received_from=oct", headers=h).status_code == 422
        assert client.get(f"/api/v1/export/totals/{form.id}?tz=Mars/Base", headers=h).status_code == 422

    def test_forms_list_with_api_key(self, client, db_session, paid_plan):
        form, h = self._org(client, db_session)
        forms = client.get("/api/v1/export/forms", headers=h).json()
        assert [f["id"] for f in forms] == [str(form.id)]
        assert {"name": "hh_size", "label": "Household size", "type": "number"} in forms[0]["questions"]
        assert client.get("/api/v1/export/forms").status_code == 401

    def test_other_org_key_cannot_read_totals(self, client, db_session, paid_plan):
        form, _ = self._org(client, db_session)
        t2 = make_tenant(db_session, name="Other")
        a2 = make_user(db_session, t2.id, role="org_admin", phone="+919111000772")
        k2 = client.post("/api/v1/api-keys/", json={"name": "x"},
                         headers=auth_headers(str(a2.id), str(t2.id), a2.role)).json()["key"]
        assert client.get(f"/api/v1/export/totals/{form.id}", headers={"X-API-Key": k2}).status_code == 404
        assert client.get("/api/v1/export/forms", headers={"X-API-Key": k2}).json() == []
