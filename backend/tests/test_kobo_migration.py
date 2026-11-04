"""KoboToolbox migration: endpoints, value mapping, SSRF guard, idempotent re-import.

Kobo responses below follow the live API v2 schema
(https://kf.kobotoolbox.org/api/v2/schema/, checked 2026-11-04). The unit tests
run offline via httpx.MockTransport; the route tests need the test Postgres.
"""
import io
import socket

import httpx
import openpyxl
import pytest

from app.api.routes.migration import platform_clients as pc
from app.api.routes.migration import router as mig
from app.api.routes.migration.xlsform_parser import parse_xlsform

from .conftest import skip_no_db, make_tenant, make_user, auth_headers

SERVER = "https://kf.kobotoolbox.org"
UID = "aFormUid123"


# ── fixtures ───────────────────────────────────────────────────────────────────

def _xlsform_bytes() -> bytes:
    wb = openpyxl.Workbook()
    s = wb.active
    s.title = "survey"
    for row in [
        ["type", "name", "label"],
        ["begin_group", "grp", "Household"],
        ["text", "resp_name", "Name"],
        ["integer", "age", "Age"],
        ["decimal", "income", "Income"],
        ["select_multiple crops", "crops", "Crops"],
        ["select_one yn", "owns_land", "Owns land?"],
        ["geopoint", "loc", "Location"],
        ["begin_repeat", "hh", "Members"],
        ["text", "member", "Member name"],
        ["integer", "member_age", "Member age"],
        ["end_repeat", "", ""],
        ["end_group", "", ""],
    ]:
        s.append(row)
    c = wb.create_sheet("choices")
    for row in [["list_name", "name", "label"], ["crops", "rice", "Rice"], ["crops", "wheat", "Wheat"],
                ["yn", "1", "Yes"], ["yn", "2", "No"]]:
        c.append(row)
    st = wb.create_sheet("settings")
    st.append(["form_title", "form_id"])
    st.append(["Kobo HH Survey", "hh_survey"])
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def _kobo_row(i: int) -> dict:
    return {
        "_id": 1000 + i,
        "_uuid": f"uuid-{i}",
        "_submission_time": "2026-10-01T09:30:00",
        "_submitted_by": "enum_ravi",
        "_attachments": [],
        "formhub/uuid": "abc",
        "meta/instanceID": f"uuid:uuid-{i}",
        "grp/resp_name": "ramesh kumar",
        "grp/age": "42",
        "grp/income": "1500.50",
        "grp/crops": "rice wheat",
        "grp/owns_land": "1",
        "grp/loc": "12.9716 77.5946 900 5",
        "grp/hh": [
            {"grp/hh/member": "sita devi", "grp/hh/member_age": "38"},
            {"grp/hh/member": "arjun", "grp/hh/member_age": "12"},
        ],
    }


class FakeKobo:
    """Minimal Kobo API v2. Paths/params mirror the real schema; anything else → 404."""

    def __init__(self, n_subs=3, token="good", n_assets=150):
        self.n_subs, self.token, self.n_assets = n_subs, token, n_assets
        self.calls: list[str] = []

    def __call__(self, req: httpx.Request) -> httpx.Response:
        self.calls.append(str(req.url))
        if req.headers.get("Authorization") != f"Token {self.token}":
            return httpx.Response(401, json={"detail": "Invalid token."})
        p, q = req.url.path, req.url.params
        if p == "/api/v2/assets/":
            off, lim = int(q.get("offset", 0)), int(q.get("limit", 100))
            assets = [{"uid": f"a{i}", "name": f"Form {i}", "asset_type": "survey" if i % 3 else "block",
                       "deployment__submission_count": i, "date_modified": "2026-10-01T00:00:00Z"}
                      for i in range(self.n_assets)]
            page = assets[off:off + lim]
            nxt = f"{SERVER}/api/v2/assets/?offset={off + lim}" if off + lim < len(assets) else None
            return httpx.Response(200, json={"count": len(assets), "next": nxt, "results": page})
        if p == f"/api/v2/assets/{UID}/" and q.get("format") == "xls":
            return httpx.Response(200, content=_xlsform_bytes(), headers={
                "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"})
        if p == f"/api/v2/assets/{UID}/data/":
            start, lim = int(q.get("start", 0)), int(q.get("limit", 100))
            assert lim <= 1000, "Kobo caps limit at 1000"
            rows = [_kobo_row(i) for i in range(self.n_subs)][start:start + lim]
            nxt = "more" if start + lim < self.n_subs else None
            return httpx.Response(200, json={"count": self.n_subs, "next": nxt, "results": rows})
        return httpx.Response(404, json={"detail": "Not found."})


@pytest.fixture(autouse=True)
def public_dns(monkeypatch):
    """Resolve every host to a public IP offline; tests opt in to private IPs."""
    real = socket.getaddrinfo

    def fake(host, *a, **k):
        ip = {"localhost": "127.0.0.1", "internal.corp": "10.0.0.5", "metadata.cloud": "169.254.169.254"}.get(host, "93.184.216.34")
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (ip, 443))]

    monkeypatch.setattr(socket, "getaddrinfo", fake)
    yield
    monkeypatch.setattr(socket, "getaddrinfo", real)


def _client(fake: FakeKobo, token="good") -> pc.KoboClient:
    return pc.KoboClient(SERVER, token, transport=httpx.MockTransport(fake))


def _fields():
    return mig._extract_fields(parse_xlsform(_xlsform_bytes())["json_schema"]["sections"])


# ── Kobo API client ────────────────────────────────────────────────────────────

async def test_list_forms_follows_all_pages_and_keeps_only_surveys():
    fake = FakeKobo(n_assets=150)
    forms = await _client(fake).list_forms()
    assert len(forms) == 100  # 150 assets, 1/3 are blocks
    assert {"uid", "name", "submission_count", "date_modified"} <= forms[0].keys()
    assert sum("/api/v2/assets/" in c for c in fake.calls) == 2


async def test_xlsform_download_uses_real_kobo_endpoint():
    fake = FakeKobo()
    data = await _client(fake).get_xlsform_bytes(UID)
    assert parse_xlsform(data)["title"] == "Kobo HH Survey"
    assert fake.calls[-1] == f"{SERVER}/api/v2/assets/{UID}/?format=xls"


async def test_submissions_paged_until_count():
    fake = FakeKobo(n_subs=1203)
    pages = [p async for p in _client(fake).iter_submissions(UID)]
    assert [len(p) for p in pages] == [500, 500, 203]


async def test_bad_token_maps_to_401_message():
    with pytest.raises(httpx.HTTPStatusError) as ei:
        await _client(FakeKobo(), token="wrong").list_forms()
    err = mig._upstream_error("KoboToolbox", ei.value)
    assert err.status_code == 401 and "token" in err.detail


# ── SSRF guard ─────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("url", [
    "http://kf.kobotoolbox.org", "https://localhost", "https://internal.corp",
    "https://metadata.cloud", "ftp://x.org", "kf.kobotoolbox.org",
])
def test_unsafe_server_urls_rejected(url):
    with pytest.raises(pc.UnsafeServerURL):
        pc.check_server_url(url)


def test_public_https_server_allowed():
    assert pc.check_server_url("https://eu.kobotoolbox.org/ ") == "https://eu.kobotoolbox.org"


# ── value mapping ──────────────────────────────────────────────────────────────

def test_map_submission_types():
    d = pc.map_submission_data(_kobo_row(0), _fields())
    assert d["resp_name"] == "ramesh kumar"            # text NOT split (was a bug)
    assert d["age"] == 42 and d["income"] == 1500.5    # numbers coerced
    assert d["crops"] == ["rice", "wheat"]             # select_multiple split
    assert d["owns_land"] == "1"                       # select_one stays a code
    assert d["loc"] == {"lat": 12.9716, "lng": 77.5946, "accuracy": 5.0}
    assert [m["member"] for m in d["hh"]] == ["sita devi", "arjun"]
    assert d["hh"][0]["member_age"] == 38 and d["hh"][0]["_id"]
    assert not any(k.startswith(("_", "meta", "formhub")) for k in d)


def test_map_keeps_unparseable_values():
    f = _fields()
    d = pc.map_submission_data({"grp/age": "n/a", "grp/loc": "bad"}, f)
    assert d == {"age": "n/a", "loc": "bad"}


def test_map_odk_odata_shape():
    raw = {"__id": "uuid:x", "grp": {"age": 7, "loc": {"type": "Point", "coordinates": [77.5, 12.9, 0],
                                                       "properties": {"accuracy": 4}}}, "meta": {"instanceID": "x"}}
    assert pc.map_submission_data(raw, _fields()) == {"age": 7, "loc": {"lat": 12.9, "lng": 77.5, "accuracy": 4}}


def test_source_meta_kobo():
    key, when, src = mig._source_meta("kobo", _kobo_row(3))
    assert key == "kobo:uuid-3"
    assert when.isoformat() == "2026-10-01T09:30:00+00:00"
    assert src == {"platform": "kobo", "id": 1003, "submitted_by": "enum_ravi"}


def test_source_meta_surveycto_date_format():
    key, when, _ = mig._source_meta("surveycto", {"KEY": "uuid:k", "SubmissionDate": "Nov 4, 2026 10:05:00 AM"})
    assert key == "surveycto:uuid:k" and when.hour == 10


def test_legacy_xls_upload_parses():
    xlwt = pytest.importorskip("xlwt")
    wb = xlwt.Workbook()
    s = wb.add_sheet("survey")
    for r, row in enumerate([["type", "name", "label"], ["select_one yn", "q1", "Q1"]]):
        for c, v in enumerate(row):
            s.write(r, c, v)
    ch = wb.add_sheet("choices")
    for r, row in enumerate([["list_name", "name", "label"], ["yn", 1, "Yes"]]):
        for c, v in enumerate(row):
            ch.write(r, c, v)
    buf = io.BytesIO()
    wb.save(buf)
    f = parse_xlsform(buf.getvalue())["json_schema"]["sections"][0]["fields"][0]
    assert f["options"][0]["value"] == "1"


# ── routes (need test Postgres) ────────────────────────────────────────────────

@skip_no_db
class TestKoboImportRoute:
    @pytest.fixture
    def fake(self, monkeypatch):
        fake = FakeKobo(n_subs=3)
        monkeypatch.setattr(mig, "KoboClient",
                            lambda server, token: pc.KoboClient(server, token, transport=httpx.MockTransport(fake)))
        return fake

    def _admin(self, db_session):
        t = make_tenant(db_session)
        u = make_user(db_session, t.id, role="org_admin", phone="+919111000777")
        return auth_headers(str(u.id), str(t.id), u.role)

    def test_import_then_reimport_is_idempotent(self, client, db_session, fake):
        from app.models.submission import Submission
        h = self._admin(db_session)
        body = {"server": SERVER, "token": "good", "asset_uid": UID, "import_submissions": True}

        r1 = client.post("/api/v1/migration/kobo/import", json=body, headers=h)
        assert r1.status_code == 200, r1.text
        assert r1.json()["submissions_imported"] == 3 and not r1.json()["reused_form"]

        fake.n_subs = 4  # one new submission on Kobo since last import
        r2 = client.post("/api/v1/migration/kobo/import", json=body, headers=h).json()
        assert r2["form_id"] == r1.json()["form_id"] and r2["reused_form"]
        assert (r2["submissions_imported"], r2["submissions_skipped"]) == (1, 3)

        subs = db_session.query(Submission).filter(Submission.form_id == r2["form_id"]).all()
        assert len(subs) == 4
        assert all(s.local_id.startswith("kobo:") and s.local_created_at for s in subs)

    def test_bad_token_returns_401(self, client, db_session, fake):
        r = client.post("/api/v1/migration/kobo/connect", json={"server": SERVER, "token": "bad"},
                        headers=self._admin(db_session))
        assert r.status_code == 401

    def test_internal_server_rejected(self, client, db_session, fake):
        r = client.post("/api/v1/migration/kobo/connect", json={"server": "https://localhost", "token": "good"},
                        headers=self._admin(db_session))
        assert r.status_code == 400
