"""Live Kobo import check against a real Kobo account (opt-in, hits the network).

Run: KOBO_LIVE_UID=<asset uid> KOBO_LIVE_SERVER=https://eu.kobotoolbox.org \
     KOBO_LIVE_ROWS=<expected repeat rows> pytest tests/test_kobo_live.py -s
Token is read from ~/.kobo_token. Needs the test Postgres (see conftest).
"""
import os
from pathlib import Path

import pytest

from .conftest import skip_no_db, make_tenant, make_user, auth_headers

UID = os.environ.get("KOBO_LIVE_UID")
SERVER = os.environ.get("KOBO_LIVE_SERVER", "https://kf.kobotoolbox.org")
TOKEN_FILE = Path.home() / ".kobo_token"

pytestmark = [skip_no_db, pytest.mark.skipif(not UID or not TOKEN_FILE.exists(), reason="set KOBO_LIVE_UID + ~/.kobo_token")]


def test_live_import_matches_kobo(client, db_session):
    import httpx
    from app.models.submission import Submission

    token = TOKEN_FILE.read_text().strip()
    kobo = httpx.get(f"{SERVER}/api/v2/assets/{UID}/data/", headers={"Authorization": f"Token {token}"},
                     params={"limit": 30000}, timeout=120).json()["results"]

    t = make_tenant(db_session)
    u = make_user(db_session, t.id, role="org_admin", phone="+919111000888")
    h = auth_headers(str(u.id), str(t.id), u.role)
    body = {"server": SERVER, "token": token, "asset_uid": UID, "import_submissions": True}

    r1 = client.post("/api/v1/migration/kobo/import", json=body, headers=h)
    assert r1.status_code == 200, r1.text
    j1 = r1.json()
    print("\nimport 1:", {k: j1[k] for k in ("submissions_imported", "submissions_skipped", "reused_form")})
    print("warnings:", j1["warnings"])
    assert j1["submissions_imported"] == len(kobo)

    subs = {s.local_id: s for s in db_session.query(Submission).filter(Submission.form_id == j1["form_id"])}
    assert len(subs) == len(kobo)

    # Field-by-field: every answer Kobo holds must be in FieldGovern with the same value.
    def norm(v):
        if isinstance(v, list):
            return sorted(str(x) for x in v)
        return str(v).strip()

    def kobo_val(v, fg):
        return sorted(str(v).split()) if isinstance(fg, list) else str(v).strip()

    mismatches, compared, rows = [], 0, 0
    meta_fields = ("start", "end", "today", "username", "deviceid", "phonenumber")
    for rec in kobo:
        sub = subs.get(f"kobo:{rec['_uuid']}")
        assert sub, f"missing submission {rec['_uuid']}"
        data = sub.data_json or {}
        for k, v in rec.items():
            if k.startswith(("_", "meta/", "formhub/")) or k == "__version__":
                continue
            name = k.rsplit("/", 1)[-1]
            if name in meta_fields:
                got = (data.get("_source") or {}).get("device", {}).get(name)
                if str(got) != str(v):
                    mismatches.append((rec["_uuid"], name, v, got))
                compared += 1
                continue
            if isinstance(v, list):  # repeat group
                fg_rows = data.get(name) or []
                rows += len(v)
                if len(fg_rows) != len(v):
                    mismatches.append((rec["_uuid"], name, f"{len(v)} rows", f"{len(fg_rows)} rows"))
                    continue
                for kr, fr in zip(v, fg_rows):
                    for ck, cv in kr.items():
                        cn = ck.rsplit("/", 1)[-1]
                        compared += 1
                        if kobo_val(cv, fr.get(cn)) != norm(fr.get(cn)):
                            mismatches.append((rec["_uuid"], f"{name}.{cn}", cv, fr.get(cn)))
                continue
            compared += 1
            if kobo_val(v, data.get(name)) != norm(data.get(name)):
                mismatches.append((rec["_uuid"], name, v, data.get(name)))
    print(f"values compared: {compared} | repeat rows: {rows} | mismatches: {len(mismatches)}")
    for m in mismatches[:15]:
        print("  MISMATCH", m)
    assert not mismatches
    if os.environ.get("KOBO_LIVE_ROWS"):
        assert rows == int(os.environ["KOBO_LIVE_ROWS"])

    r2 = client.post("/api/v1/migration/kobo/import", json=body, headers=h).json()
    print("import 2:", {k: r2[k] for k in ("submissions_imported", "submissions_skipped", "reused_form")})
    assert (r2["submissions_imported"], r2["submissions_skipped"], r2["reused_form"]) == (0, len(kobo), True)
