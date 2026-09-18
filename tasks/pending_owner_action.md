# Pending — needs YOUR action (not code)

Items only you (owner/ops) can complete. Code side is done and validated; these
are decisions, secrets, server settings, and paperwork. See
`deploy/SECURITY_DPDP_RUNBOOK.md` for full context.

Status: created 2026-09-05 · code MERGED to main via PR #13 (2026-09-05).
The items below are the ONLY remaining steps, and none can be done from a dev
machine — they need the prod server / hosting console + a maintenance window.

> **Update 2026-09-18:** item 1 (DB-layer tenant isolation) is done — completed
> live via SSH, ~3s of app-container restart, no issues. The original deferral
> below was written when this still looked like it needed a bigger maintenance
> window; in practice it didn't. Items 2 and 3 (disk encryption, data-residency
> region) still need real planning — see their sections below, now updated with
> what was actually found on the server (region is EU, not India).

---

## 1. Turn ON database-level tenant isolation — ✅ DONE 2026-09-18
Completed live, via Contabo's SSH access (VNC console turned out not to be needed —
OpenSSH client is built into Windows and the VPS accepts root password auth directly).

What was actually done, since the original steps below undersold one part:
- Generated a strong password on the server itself (`openssl rand -base64 32`).
- **Set that password directly on the `fieldgovern_app` Postgres role** via
  `docker compose exec postgres psql -U fieldgovern -d fieldgovern` →
  `ALTER ROLE fieldgovern_app PASSWORD '...';` — this step was missing from the
  original checklist below. Migration 0048 only sets the role's password if
  `APP_DB_PASSWORD` was present in the environment at the moment it ran; it wasn't,
  so the role had no password until this manual step. Setting `APP_DB_PASSWORD` in
  `.env` alone (next step) would not have activated anything without this.
- Added `APP_DB_PASSWORD=...` to `.env` (`docker-compose.prod.yml` already derives
  the full `APP_DATABASE_URL` from this one variable — nothing else to add there).
- `docker compose up -d --no-deps --force-recreate app` — restarted clean, stayed
  up (no crash-loop).
- Smoke-tested: (a) normal user login ✅ sees only own org's data, (b) public
  survey submission — skipped by choice, not attempted, (c) master_admin login ✅
  still lists every tenant.

Net effect: PostgreSQL row-level security is now actually enforced at the database
layer, not just relied on via app-code `.filter(tenant_id==...)` calls.

## 2. Encryption + transport (server/hosting settings)
- [ ] **Disk encryption — CONFIRMED real gap, owner has a plan (2026-09-18).**
      `lsblk` on the live server shows plain partitions only, no `crypt` layer
      anywhere. Since the Docker uploads volume lives on this same disk, this
      single finding covers both the Postgres data volume and the media/uploads
      volume — neither is encrypted. **Owner's plan (stated 2026-09-18, timeline
      "a couple of days"):** take a fresh backup, then rebuild the server from
      scratch on an encrypted volume and reconfigure it — bundled with the
      region move below rather than two separate migrations. Tracked as pending
      with an owner-committed timeline, not an open unknown.
- [ ] Force TLS: add `?sslmode=require` to `DATABASE_URL` and `APP_DATABASE_URL`.
      **Not a quick .env edit** — the Postgres container has no TLS certificate
      configured yet; forcing this on without one first just refuses every
      connection. Needs cert generation + a compose-file change + redeploy.
- [x] **HTTPS-only — CONFIRMED 2026-09-18.** Visiting `http://app.fieldgovern.com`
      auto-redirects to `https://`. Also confirmed the Let's Encrypt cert itself
      is valid (31 days left) and genuinely auto-renews — via a `certbot.timer`
      systemd timer (not the cron job the old docs described; mechanism differs
      but it's real and running, last check ~4h before this was verified).
- [x] **Backup restore test — DONE 2026-09-18.** Confirmed live: the daily backup
      job is genuinely running (69 dated `.sql.gz` files in
      `/opt/fieldgovern/backups/`, most recent within the hour). Restored the
      latest one into a throwaway `fieldgovern_restore_test` database, verified
      real data landed (`SELECT count(*) FROM tenants` → 4, matching production),
      then dropped the test database. The backup mechanism itself works.
- [x] **Offsite backup — handled manually, owner's own process (2026-09-18).**
      `grep R2_BUCKET .env` found no automated R2 sync configured — that specific
      integration was never set up, and is intentionally parked (not being built).
      Owner's actual process: backups already land in local storage continuously
      (confirmed — see the restore test above), and the owner separately moves
      copies to Drive and downloads them manually on an ongoing basis. Recorded
      for accuracy: this is a real offsite copy, but a manual/human-dependent one
      rather than an automated pipeline — worth someone glancing at the Drive
      folder occasionally to confirm it's staying current, but not tracked here
      as an open gap needing engineering work.

## 3. Data residency (India) — confirmed gap, owner has committed to fixing it (2026-09-18)
Checked the Contabo control panel directly while doing item 1: the VPS's region
shows **EU**, not India (IP `178.238.227.32`). This contradicts DPDP data-
localisation expectations and several existing marketing claims ("India-hosted
by default", Mumbai servers). **Owner's plan, stated 2026-09-18: moving to an
India region "in a couple of days"** — bundled with the disk-encryption rebuild
above (item 2), one fresh server instead of two separate migrations. Tracked as
pending with an owner-committed timeline, not an open decision to make.

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
