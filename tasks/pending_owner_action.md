# Pending — needs YOUR action (not code)

Items only you (owner/ops) can complete. Code side is done and validated; these
are decisions, secrets, server settings, and paperwork. See
`deploy/SECURITY_DPDP_RUNBOOK.md` for full context.

Status: created 2026-09-05 · code MERGED to main via PR #13 (2026-09-05).
The items below are the ONLY remaining steps, and none can be done from a dev
machine — they need the prod server / hosting console + a maintenance window.

> **DEFERRED (owner decision 2026-09-05):** platform has active live users, so
> these changes are held until a low-traffic window / planned maintenance.
> NOT urgent-unsafe: tenant isolation already works via app-code filters today;
> the items below are defense-in-depth + compliance, not an open hole.
> Sequence when resuming: (a) seconds of downtime — encrypted backups, then
> DB isolation (#1), then sslmode=require; (b) real downtime, announce first —
> volume encryption (#2 first row) only.

---

## 1. Turn ON database-level tenant isolation  ⚠️ highest value
- [ ] Set a strong `APP_DB_PASSWORD` in prod `.env`.
- [ ] Set `APP_DATABASE_URL=postgresql://fieldgovern_app:<APP_DB_PASSWORD>@postgres:5432/fieldgovern`
      (already wired in `deploy/docker-compose.prod.yml`).
- [ ] Redeploy.
- [ ] Smoke-test: (a) normal user logs in, (b) sees ONLY their tenant's data,
      (c) public survey link submits, (d) master_admin dashboard lists all tenants.
Why: until this is set, the app runs as the DB superuser and row-level security
is bypassed — isolation relies on app-code filters alone.

## 2. Encryption + transport (server/hosting settings)
- [ ] Encrypt the Postgres data volume (managed DB = checkbox; self-host = encrypted disk).
- [ ] Encrypt the media/uploads volume.
- [ ] Force TLS: add `?sslmode=require` to `DATABASE_URL` and `APP_DATABASE_URL`.
- [ ] Confirm the public site is HTTPS-only (nginx + certbot already in the stack).
- [ ] Automated, encrypted, in-region backups — and do one restore test.

## 3. Data residency (India)
- [ ] Confirm app, DB, media, and backups all live in one India region (e.g. AWS
      Mumbai `ap-south-1`). Do not scatter across providers.

## 4. DPDP paperwork (you own these)
- [ ] Consent capture text for beneficiary personal data (purpose-limited, withdrawable).
- [ ] Written breach-notification path (Data Protection Board + affected people, target 72h).
- [ ] Retention policy doc (recycle bin holds soft-deleted items 360 days).
- [ ] Confirm erasure process = anonymize (`POST /submissions/{id}/anonymize`), not deletion.

## 5. Architecture decision (confirm)
- [ ] Confirm: stay on ONE server + multi-tenant DB (recommended). Per-client
      DB/VDS only for a future enterprise client who requires and pays for it.

---

## Decision waiting on you now
- [ ] Commit the code changes to a branch? (nothing pushed yet)

---

## Already DONE (code side — no action needed, for reference)
- App startup crash fixed (DEEPSEEK env vars ignored by config).
- Migration 0048: restricted role + RLS policies; verified vs Postgres 16
  (`backend/tests/rls_policy_check.sql`, 7 assertions pass).
- Hard-delete off by default (`ALLOW_HARD_DELETE=false`); data retained.
- App-level encryption confirmed in place (bcrypt, JWT, 2FA, survey capsules).
- Runbook written: `deploy/SECURITY_DPDP_RUNBOOK.md`.
