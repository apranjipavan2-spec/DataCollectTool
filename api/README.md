# api/ — Integrations, data sharing & credentials

Everything about moving data in and out of FieldGovern, in one place. Updated 2026-11-04.

| File | What it is | Share outside? |
| --- | --- | --- |
| `PARTNER_INTEGRATION_GUIDE.md` | Partner-facing guide: Kobo import, exports, API, webhooks, dashboard sharing, data protection. Same content as the Claude Doc https://claude.ai/artifact/SQefN2uFT48P3RNzpf81pr | **Yes** |
| `KOBO_INTEGRATION.md` | Master plan, 18 audit findings + status, process steps, Kobo API v2 reference, value mapping | Internal |
| `API_KEYS_INVENTORY.md` | Every credential the platform uses (names, purpose, local status, rotation risk) + 8 findings. No values. **Git-ignored — the repo is public; this file stays on this machine only.** | **No** |
| `SAATHI_INTEGRATION.md` | Feed contract for the Saathi app: forms list, exact monthly totals, received-time filter, call budget | Internal (Saathi team) |
| `TESTING.md` | How to test without accounts, latest results, what still needs a real account | Internal |
| `run_tests.sh` | One command: throwaway Postgres + the integration test suites | Internal |
| `results_page_example_mobile.png` | What a partner sees on a results link (demo data, phone width) | Yes |
| `kobo_api_v2_schema_2026-11-04.json` | Snapshot of Kobo's official OpenAPI schema used to verify every endpoint | Internal |

## Code touched (all uncommitted on `main`)

| Area | Files |
| --- | --- |
| Kobo / SurveyCTO / ODK import | `backend/app/api/routes/migration/{platform_clients,router,xlsform_parser}.py`, `frontend/src/migration/MigrationPage.tsx` |
| SSRF guard (shared) | `backend/app/core/url_guard.py` (new) |
| API keys | `backend/app/core/deps.py` (`find_api_key`), `backend/app/api/routes/api_keys.py`, `backend/app/api/routes/export.py`, `frontend/src/admin/ApiKeyManager.tsx` |
| Webhooks | `backend/app/api/routes/webhooks.py`, `backend/app/services/webhook.py` |
| Results share link (aggregate-only) | migration `backend/alembic/versions/0066_dashboard_shares.py` (+ `scripts/seed_dev.py`, `scripts/wait_and_stamp.py`), `backend/app/models/dashboard_share.py`, `backend/app/services/results_aggregate.py`, `backend/app/api/routes/dashboard_shares.py`, `frontend/src/dashboard/ResultsShareSection.tsx`, `frontend/src/collect/PublicResultsPage.tsx`, route in `frontend/src/App.tsx` |
| Org feeds for Saathi (API key) | `backend/app/api/routes/export.py` (`/export/forms`, `/export/totals/{id}`, `received_from/received_to`, `received_at`), `backend/app/services/results_aggregate.py` (`build_exact_totals`) |
| Tests | `backend/tests/test_kobo_migration.py`, `test_partner_api.py`, `test_dashboard_shares.py`, `test_org_feeds.py` (new) |
| Docs | this folder, `tasks/lessons.md` (L032), `tasks/todo.md`, `planning/MIGRATION_SPEC.md` |

One new database table: `dashboard_shares` (migration 0066, tenant-isolation RLS). Deploy runs it automatically.

## Status

- **Done + tested:** the 18 Kobo audit items (except media and background import), plus API-key findings K1–K4.
- **Done + tested:** results share link — totals only, enumerators numbered, counts under 5 hidden (+ secondary hiding), expiry + revoke, view count.
- **Done + tested:** Saathi's 4 asks — exact totals endpoint, server-received-time filter, call limits documented, forms list via API key (`SAATHI_INTEGRATION.md`).
- **Open, your decision:** API-call allowance for Starter (20/month) is too low for a daily feed.
- **Open, needs an account:** live Kobo import test (`TESTING.md`).
- **Open, later:** K5–K7 in `API_KEYS_INVENTORY.md`, webhook retries, Kobo photo import, the 25 pre-existing test failures.
