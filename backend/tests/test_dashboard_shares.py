"""Aggregate-only results share links: privacy rules + link lifecycle.

Rules (services/results_aggregate.py): enumerators anonymised, counts 1-4 hidden
(+ secondary hiding so they can't be subtracted out), only choice/rating
questions summarised, identifier and free-text fields never read.
"""
import json
from datetime import datetime, timedelta, timezone

import pytest

from app.services.results_aggregate import MIN_CELL, build_results, suppress

from .conftest import skip_no_db, make_tenant, make_user, make_form, auth_headers

SCHEMA = {"sections": [{"id": "s1", "title": "Main", "fields": [
    {"id": "f1", "name": "resp_name", "type": "text", "label": "Name", "is_identifier": True},
    {"id": "f2", "name": "phone", "type": "text", "label": "Phone"},
    {"id": "f3", "name": "gender", "type": "single_choice", "label": "Gender",
     "options": [{"value": "m", "label": "Male"}, {"value": "f", "label": "Female"}, {"value": "o", "label": "Other"}]},
    {"id": "f4", "name": "crops", "type": "multiple_choice", "label": "Crops",
     "options": [{"value": "rice", "label": "Rice"}, {"value": "wheat", "label": "Wheat"}]},
    {"id": "f5", "name": "score", "type": "rating", "label": "Satisfaction"},
    {"id": "f6", "name": "caste", "type": "single_choice", "label": "Rarely answered",
     "options": [{"value": "a", "label": "A"}]},
]}]}


def _row(i, gender, crops=("rice",), score=4, enum="e1", day="2026-10-01"):
    data = {"resp_name": f"Person {i}", "phone": f"98765{i:05d}", "gender": gender,
            "crops": list(crops), "score": score}
    if i < 2:
        data["caste"] = "a"
    return (data, enum, day)


# ── unit: suppression ──────────────────────────────────────────────────────────

def test_small_cells_hidden_with_secondary_suppression():
    out = suppress([("Male", 20), ("Female", 9), ("Other", 2)], 31)
    hidden = [c["label"] for c in out if c["suppressed"]]
    assert "Other" in hidden and "Female" in hidden      # 2 → hidden; 9 hidden too so 31-20 ≠ answer
    assert out[0] == {"label": "Male", "count": 20, "pct": 64.5, "suppressed": False}


def test_zero_counts_are_shown_and_two_hidden_cells_need_no_extra():
    out = suppress([("A", 10), ("B", 0), ("C", 3), ("D", 4)], 17)
    assert [c["suppressed"] for c in out] == [False, False, True, True]
    assert out[1]["count"] == 0


def test_whole_result_hidden_below_min_cell():
    r = build_results(SCHEMA, [_row(i, "m") for i in range(MIN_CELL - 1)])
    assert r["total"] is None and r["total_suppressed"] and r["questions"] == []


def test_build_results_never_contains_personal_data():
    rows = [_row(i, "m" if i < 12 else "f", enum="e1" if i < 10 else "e2") for i in range(20)]
    r = build_results(SCHEMA, rows)
    blob = json.dumps(r)
    for leaked in ("Person", "98765", "e1", "e2"):
        assert leaked not in blob
    assert [q["label"] for q in r["questions"]] == ["Gender", "Crops", "Satisfaction", "Rarely answered"]
    assert [e["label"] for e in r["by_enumerator"]] == ["Enumerator 1", "Enumerator 2"]
    assert r["total"] == 20


def test_question_with_few_answers_is_fully_hidden():
    r = build_results(SCHEMA, [_row(i, "m") for i in range(10)])
    rare = next(q for q in r["questions"] if q["label"] == "Rarely answered")
    assert rare["suppressed"] and rare["options"] == [] and rare["answered"] is None


def test_multi_choice_counts_each_option_once_per_respondent():
    rows = [_row(i, "m", crops=("rice", "wheat", "rice")) for i in range(6)]
    crops = next(q for q in build_results(SCHEMA, rows)["questions"] if q["label"] == "Crops")
    assert [(o["label"], o["count"], o["pct"]) for o in crops["options"]] == [("Rice", 6, 100.0), ("Wheat", 6, 100.0)]


def test_rating_values_sorted_numerically():
    rows = [_row(i, "m", score=s) for i, s in enumerate([10] * 5 + [2] * 5 + [1] * 5)]
    sat = next(q for q in build_results(SCHEMA, rows)["questions"] if q["label"] == "Satisfaction")
    assert [o["label"] for o in sat["options"]] == ["1", "2", "10"]


# ── routes (need test Postgres) ────────────────────────────────────────────────

@skip_no_db
class TestShareLinks:
    def _org(self, db_session, phone="+919111000990"):
        from app.models.submission import Submission
        import uuid
        t = make_tenant(db_session)
        admin = make_user(db_session, t.id, role="org_admin", phone=phone)
        form = make_form(db_session, t.id)
        form.json_schema = SCHEMA
        form.title = "HH Survey"
        for i, (data, _, _) in enumerate(_row(i, "m" if i < 7 else "f") for i in range(12)):
            db_session.add(Submission(id=uuid.uuid4(), tenant_id=t.id, form_id=form.id,
                                      enumerator_id=admin.id, data_json=data, status="synced"))
        db_session.add(Submission(id=uuid.uuid4(), tenant_id=t.id, form_id=form.id, enumerator_id=admin.id,
                                  data_json={"gender": "o"}, status="rejected"))  # never counted
        db_session.flush()
        return t, admin, form, auth_headers(str(admin.id), str(t.id), admin.role)

    def _create(self, client, form, h, **extra):
        r = client.post("/api/v1/dashboard-shares", json={"form_id": str(form.id), **extra}, headers=h)
        assert r.status_code == 201, r.text
        return r.json()

    def test_public_link_shows_totals_only(self, client, db_session):
        t, admin, form, h = self._org(db_session)
        share = self._create(client, form, h, label="Donor Q3")
        token = share["url"].rsplit("/", 1)[1]

        r = client.get(f"/api/v1/public/results/{token}")  # no auth header
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["total"] == 12 and body["label"] == "Donor Q3"
        gender = next(q for q in body["questions"] if q["label"] == "Gender")
        assert [(o["label"], o["count"]) for o in gender["options"]] == [("Male", 7), ("Female", 5), ("Other", 0)]
        blob = json.dumps(body)
        for leaked in ("Person", "98765", str(admin.id), admin.phone, *([admin.name] if admin.name else [])):
            assert leaked not in blob, leaked

        listed = client.get(f"/api/v1/dashboard-shares?form_id={form.id}", headers=h).json()
        assert listed[0]["view_count"] == 1

    def test_revoked_expired_and_unknown_links_all_404(self, client, db_session):
        from app.models.dashboard_share import DashboardShare
        t, admin, form, h = self._org(db_session)
        s1 = self._create(client, form, h)
        client.delete(f"/api/v1/dashboard-shares/{s1['id']}", headers=h)
        s2 = self._create(client, form, h, expires_at=(datetime.now(timezone.utc) + timedelta(days=1)).isoformat())
        row = db_session.query(DashboardShare).filter(DashboardShare.id == s2["id"]).first()
        row.expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
        db_session.flush()
        for token in (s1["url"].rsplit("/", 1)[1], s2["url"].rsplit("/", 1)[1], "no-such-token"):
            assert client.get(f"/api/v1/public/results/{token}").status_code == 404

    def test_past_expiry_rejected(self, client, db_session):
        t, admin, form, h = self._org(db_session)
        past = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
        r = client.post("/api/v1/dashboard-shares", json={"form_id": str(form.id), "expires_at": past}, headers=h)
        assert r.status_code == 422

    def test_suspended_org_link_stops_working(self, client, db_session):
        t, admin, form, h = self._org(db_session)
        token = self._create(client, form, h)["url"].rsplit("/", 1)[1]
        t.subscription_status = "suspended"
        db_session.flush()
        assert client.get(f"/api/v1/public/results/{token}").status_code == 404

    def test_other_org_cannot_share_or_revoke(self, client, db_session):
        t, admin, form, h = self._org(db_session)
        share = self._create(client, form, h)
        t2 = make_tenant(db_session, name="Other")
        a2 = make_user(db_session, t2.id, role="org_admin", phone="+919111000991")
        h2 = auth_headers(str(a2.id), str(t2.id), a2.role)
        assert client.post("/api/v1/dashboard-shares", json={"form_id": str(form.id)}, headers=h2).status_code == 404
        assert client.delete(f"/api/v1/dashboard-shares/{share['id']}", headers=h2).status_code == 404
        assert client.get("/api/v1/dashboard-shares", headers=h2).json() == []

    def test_enumerator_cannot_create_links(self, client, db_session):
        t, admin, form, h = self._org(db_session)
        enum = make_user(db_session, t.id, role="enumerator", phone="+919111000992")
        r = client.post("/api/v1/dashboard-shares", json={"form_id": str(form.id)},
                        headers=auth_headers(str(enum.id), str(t.id), enum.role))
        assert r.status_code == 403
