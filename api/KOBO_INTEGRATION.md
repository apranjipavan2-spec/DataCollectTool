# KoboToolbox Integration — Master Plan, Audit & API Reference

Owner: FieldGovern · Started: 2026-11-04 · Related: `planning/MIGRATION_SPEC.md`, `api/README.md`

Code:
- `backend/app/api/routes/migration/platform_clients.py` — `KoboClient`, `map_submission_data`
- `backend/app/api/routes/migration/router.py` — `/migration/kobo/*` routes
- `backend/app/api/routes/migration/xlsform_parser.py` — XLSForm → `json_schema`
- `frontend/src/migration/MigrationPage.tsx` — `KoboTab`
- `backend/tests/test_kobo_migration.py` — validation suite (16 offline + 3 DB)

---

## 1. Process (end to end)

| # | Step | Who | Endpoint |
|---|------|-----|----------|
| 1 | Org admin copies API token from Kobo (Account Settings → Security → API Key) | user | — |
| 2 | Enters server URL + token in Settings → Migration → KoboToolbox | user | — |
| 3 | Connect: FG validates token, lists survey assets (all pages) | FG → Kobo | `GET /api/v2/assets/` |
| 4 | Import: FG downloads the XLSForm | FG → Kobo | `GET /api/v2/assets/{uid}/?format=xls` |
| 5 | FG parses XLSForm → draft form (warnings shown) | FG | — |
| 6 | (optional) FG pages through submissions, maps each to FG format, saves | FG → Kobo | `GET /api/v2/assets/{uid}/data/?start=&limit=` |
| 7 | Hooks: WhatsApp/Telegram notify + Sheets sync | FG | — |
| 8 | Re-import same Kobo form: updates the existing FG form's data, skips already-imported submissions | FG | — |

---

## 2. Audit findings (2026-11-04)

Status key: ✅ fixed · ⏳ planned · ➖ accepted limitation

| # | Sev | Finding | Status |
|---|-----|---------|--------|
| A1 | Critical | Form download used `/api/v2/assets/{uid}/export.xls` — that path does not exist in Kobo's live OpenAPI schema. Every form import would fail with 404. Correct: `/api/v2/assets/{uid}/?format=xls` (returns .xlsx) | ✅ |
| A2 | Critical | Any space-separated text answer (e.g. `"ramesh kumar"`) was split into a list — heuristic ignored field type | ✅ type-aware |
| A3 | High | Repeat-group answers (`grp/child` keys inside lists) dropped | ✅ |
| A4 | High | GPS answers stored as raw `"lat lon alt acc"` string; FG renderer expects `{lat,lng,accuracy}` | ✅ |
| A5 | High | Numbers stored as strings (`"25"`) → breaks analytics/validation | ✅ |
| A6 | High | Re-import created a duplicate form + duplicate submissions (no idempotency) | ✅ `local_id = kobo:{_uuid}`, reuse form by source uid |
| A7 | Medium | Original submission time lost (`server_received_at` = import time) | ✅ `_submission_time` → `local_created_at` |
| A8 | Medium | Form list read only first page (≈100 assets) | ✅ follows `next` |
| A9 | Medium | Server URL unrestricted → SSRF (admin could make FG call internal hosts) | ✅ https-only + private/loopback IP block |
| A10 | Medium | UI showed axios `"Request failed with status code 400"` instead of backend reason (e.g. bad token) | ✅ shows `detail` |
| A11 | Medium | 401/403/404 from Kobo surfaced as raw httpx exception text | ✅ friendly messages |
| A12 | Low | Uploaded legacy `.xls` files accepted by `/xlsform/parse` but openpyxl can't read them | ✅ xlrd fallback |
| A13 | Low | Original Kobo enumerator (`_submitted_by`) lost — all rows attributed to importing admin | ✅ kept in `data_json._source` |
| A14 | Medium | Photos/audio (`_attachments`) not downloaded — field holds only the filename | ⏳ Phase 3 |
| A15 | Low | Import runs inside the HTTP request — very large forms (>20k rows) may hit proxy timeout | ⏳ Phase 3 (background job) |
| A16 | Low | Nested groups flattened into sections (group-in-group loses parent title) | ➖ |
| A18 | Medium | Concurrent imports of the same form could both pass the dedupe check (lessons L031) | ✅ `pg_advisory_lock` per form |
| A17 | Info | Token never stored server-side; sent per request over HTTPS; never logged | ✅ verified |

Shared code note: A2/A3/A4/A5 fixes live in `map_submission_data`, so SurveyCTO and ODK imports benefit too.

---

## 3. Master plan

**Phase 1 — Correctness (this pass, ~2h)**: A1–A5, A8, A10–A12
**Phase 2 — Safety & idempotency (this pass, ~1h)**: A6, A7, A9, A13
**Phase 3 — Media + scale (~1–2 days, needs decision on storage)**:
- download `_attachments[].download_url` with the token → store via existing photo storage → replace filename with FG URL
- move submission import to a background job with progress polling
- "Sync new submissions" button (incremental, uses A6 dedupe + `query={"_submission_time":{"$gt":...}}`)

**Phase 4 — Validation**
- Offline: `pytest backend/tests/test_kobo_migration.py` (mocked Kobo via `httpx.MockTransport`, real XLSForm workbook)
- Live: one Kobo test account + token → connect, import form, import data, re-import (expect 0 new) — checklist in §5

---

## 4. API reference

### 4a. FieldGovern endpoints (all require `org_admin` JWT)

| Method | Path | Body | Returns |
|--------|------|------|---------|
| POST | `/api/v1/migration/kobo/connect` | `{server, token}` | `{forms:[{uid,name,submission_count,modified,asset_type}]}` |
| POST | `/api/v1/migration/kobo/import` | `{server, token, asset_uid, import_submissions}` | `{form_id,title,warnings[],submissions_imported,submissions_skipped,reused_form}` |

Errors: `400` bad server URL / unreachable · `401` invalid token · `403` token lacks access to asset · `404` asset not found · `422` XLSForm unparsable.

### 4b. Upstream Kobo API v2 (verified against `https://kf.kobotoolbox.org/api/v2/schema/` on 2026-11-04)

| Use | Request | Notes |
|-----|---------|-------|
| Auth | header `Authorization: Token <key>` | `TokenAuth` scheme in schema |
| List assets | `GET /api/v2/assets/?limit=&offset=` | paginated, follow `next`; filter `asset_type == survey` |
| Download XLSForm | `GET /api/v2/assets/{uid}/?format=xls` | content-type `…spreadsheetml.sheet` (.xlsx) |
| Submissions | `GET /api/v2/assets/{uid}/data/?format=json&start=&limit=` | max `limit` 1000; response `{count,next,results}` |
| Attachment | `GET /api/v2/assets/{uid}/data/{id}/attachments/{att_id}/` | Phase 3 |
| Servers | `https://kf.kobotoolbox.org` (global), `https://eu.kobotoolbox.org` (EU), self-hosted | |
| Deprecated | `/api/v1/*`, `kc.kobotoolbox.org` | do not use |

### 4c. Credentials ("API keys")

| Credential | Where it comes from | Stored by FG? | Scope |
|------------|---------------------|---------------|-------|
| Kobo API token | Kobo → Account Settings → Security → API Key | **No** — held in browser state only, sent per request | full access to that Kobo user's assets — advise a dedicated read-only Kobo user |
| SurveyCTO user/password | SurveyCTO server users | No | same pattern |
| ODK Central user/password | ODK Central web users | No | same pattern |

No env vars or server secrets are needed for this integration.

### 4d. Kobo submission → FG data mapping

| Kobo value | FG field type | Stored as |
|------------|---------------|-----------|
| `"grp/age": "25"` | number / decimal | `"age": 25` / `25.0` |
| `"opt_a opt_b"` | multiple_choice | `["opt_a","opt_b"]` |
| `"ramesh kumar"` | text | `"ramesh kumar"` (unchanged) |
| `"12.97 77.59 900 5"` | gps | `{lat:12.97,lng:77.59,accuracy:5}` |
| `"hh": [{"hh/name":"A"}]` | repeat_group | `[{"_id":…, "name":"A"}]` |
| `_uuid` | — | `local_id = "kobo:<uuid>"` (dedupe key) |
| `_submission_time` | — | `local_created_at` |
| `_submitted_by`, `_id` | — | `data_json._source = {platform, id, submitted_by}` |
| other `_*`, `meta/*`, `formhub/*` | — | dropped |

---

## 5. Validation results (2026-11-04)

- ✅ 16/16 offline tests (`pytest tests/test_kobo_migration.py`): pagination, endpoint URL, 1000-limit, 401 mapping, SSRF (6 bad URLs), all value types, ODK shape, SCTO dates, legacy .xls
- ✅ Live Kobo servers (kf + eu) with an invalid token → 401 "Invalid KoboToolbox credentials / API token"
- ✅ `tsc --noEmit` clean · all 10 migration routes registered
- ✅ 3 DB route tests on real Postgres 16 (idempotent re-import 3→+1 new/3 skipped, 401, SSRF via HTTP)
- ✅ Full backend suite on real Postgres: 178 passed; the 25 failures are identical on clean HEAD (pre-existing, unrelated — see `TESTING.md`)
- ⏳ Live import with a real token — checklist below

## 6. Live validation checklist (needs a Kobo test token)

- [ ] Connect with wrong token → "Invalid Kobo API token" (401)
- [ ] Connect with valid token → all survey projects listed
- [ ] Import form only → draft form appears in Forms; warnings readable
- [ ] Import form + data → count matches Kobo's count; spot-check text, multi-select, GPS, number, repeat
- [ ] Re-import → same form reused, `submissions_skipped == count`, 0 new
- [ ] `server = http://localhost` → rejected (SSRF guard)
