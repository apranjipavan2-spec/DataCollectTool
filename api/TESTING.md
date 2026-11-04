# Testing — Kobo import, partner API, webhooks

Last run: 2026-11-04, Windows 11, Python 3.11, Postgres 16 (throwaway Docker container).

## Run it yourself (no accounts or credentials needed)

1. Start Docker Desktop.
2. From the repo root: `bash api/run_tests.sh` — Kobo, partner API and results-link suites (or `bash api/run_tests.sh --all` for the whole backend).
3. Stop the test DB afterwards: `docker stop fg_test_pg`.

The script starts its own Postgres on port 55432, so your dev database is never touched.

## How Kobo is tested without a Kobo account

`backend/tests/test_kobo_migration.py` contains `FakeKobo`, a simulator of Kobo's API v2 built from Kobo's
published OpenAPI schema (`api/kobo_api_v2_schema_2026-11-04.json`, downloaded from
`https://kf.kobotoolbox.org/api/v2/schema/?format=json`). It answers only the real paths and parameters
(asset list with offset paging, `?format=xls` download, `/data/` with `start`/`limit` ≤ 1000, `Token` auth)
and returns 404 for anything else — so a wrong endpoint fails the test, the same as against real Kobo.
The real Kobo servers (kf + eu) were also called with an invalid token and returned the expected 401.

## Results

| Suite | Tests | Result |
| --- | --- | --- |
| `test_kobo_migration.py` — offline (client, paging, endpoint, SSRF, value mapping, ODK/SCTO shapes, legacy .xls) | 17 | 16 pass · 1 skips unless `xlwt` installed (passed when installed) |
| `test_kobo_migration.py` — DB routes (re-import idempotent 3 → +1 new / 3 skipped, bad token 401, internal URL 400) | 3 | 3 pass |
| `test_partner_api.py` (new `fgk_` key pulls JSON, forged/revoked key 401, legacy key works, suspended org 403, cross-org 404, webhook URL guard at save + send) | 8 | 8 pass |
| `test_dashboard_shares.py` (suppression + secondary suppression, <5 total hidden, no names/phones/ids/free text in output, multi-choice counted once, rating order; links: public totals, revoked/expired/unknown 404, past expiry 422, suspended org 404, other org blocked, enumerator 403) | 13 | 13 pass |
| Migration 0066 run twice on Postgres 16 (idempotent), RLS enabled + forced, policy present; `seed_dev` patches apply | — | pass |
| End to end: real backend + Vite page, 86 demo submissions → page shows 86, Female/Other hidden as <5 (secondary), Enumerators 3–4 <5, no PII in API; phone viewport 375 px has no horizontal overflow; WhatsApp chat hidden on results page | — | pass (`results_page_example_mobile.png`) |
| Mutation check: removed the suspended-org fix → its test failed; fix restored | 1 | confirmed |
| Live Kobo, invalid token (kf + eu) | 2 | 401 with readable message |
| Frontend `npx tsc --noEmit --skipLibCheck` | — | clean |
| Full backend suite on real Postgres | 217 | 191 pass · 25 fail (same as HEAD) · 1 skip |

### The 25 pre-existing failures

Proven unrelated: the same suite on a clean checkout of the last commit (`d907b08`) fails the **identical 25 tests**
(diffed — 0 new, 0 fixed). They had never run before because no test database was available.

| File | Failing |
| --- | --- |
| `test_sync.py` | 5 |
| `test_two_factor.py` | 5 |
| `test_form_schema.py` | 4 |
| `test_login_lockout.py` | 4 |
| `test_auth.py` | 3 |
| `test_admin_monitor.py`, `test_audit.py`, `test_programs.py`, `test_submissions.py` | 1 each |

Most `*_requires_auth` cases expect 403 but get 401 (FastAPI's `HTTPBearer` changed its status code).
Not investigated further in this pass.

## Still needs a real account

| Check | Needs | Time |
| --- | --- | --- |
| Live Kobo import end to end (checklist in `KOBO_INTEGRATION.md` §6) | A free Kobo account: sign up at https://kf.kobotoolbox.org, make one small form, submit 2–3 test entries, copy the API key | ~15 min |
| Partner API against production | One FieldGovern org on Trial/Starter+ and a created API key | ~5 min |
