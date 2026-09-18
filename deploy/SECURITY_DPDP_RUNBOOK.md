# Security & DPDP Runbook — FieldGovern

Practical checklist for running FieldGovern for paying clients under India's
Digital Personal Data Protection Act (DPDP). Split into **what the code already
does**, **what you switch on**, and **what you (ops) must do on the server**.

---

## 1. Architecture decision: one server, many tenants (NOT a DB per client)

Keep **one** application + one PostgreSQL database with multi-tenancy. Every row
carries `tenant_id`, and PostgreSQL row-level security (RLS) enforces isolation
at the database layer (see §2). This is the model paid SaaS uses at scale.

- **Do not** build a separate database or VDS per client. It multiplies patching,
  backups, migrations, and cost for isolation you already have.
- A dedicated DB/VDS is justified only for a specific enterprise client that
  contractually requires physical separation — and pays for it.
- **Data residency:** host everything (app, DB, media, backups) in **one India
  region** (e.g. AWS Mumbai `ap-south-1`). Do not scatter across providers.

---

## 2. Tenant isolation at the DB layer (code — DONE, switch to enable)

Every tenant table has `FORCE ROW LEVEL SECURITY` with a `tenant_isolation`
policy. **But a superuser bypasses RLS**, and the app was connecting as the
Postgres superuser — so isolation rested on app-code filters alone.

Migration `0048` fixes this:
- completes a restricted, non-superuser role `fieldgovern_app`;
- rewrites the policies so context-less paths (login, public surveys,
  master_admin dashboards) still work, while authenticated tenant users get
  strict isolation.

**To enable enforcement:**
1. Set a strong `APP_DB_PASSWORD` in `.env`.
2. Set `APP_DATABASE_URL=postgresql://fieldgovern_app:<APP_DB_PASSWORD>@postgres:5432/fieldgovern`
   (already wired in `deploy/docker-compose.prod.yml`).
3. Redeploy. Migrations/seeds keep using the superuser `DATABASE_URL`.

**Smoke-test after enabling:**
- a normal user logs in and sees ONLY their tenant's submissions;
- a public survey link submits successfully;
- the master_admin platform dashboard still lists all tenants.

Verify the policy logic anytime with `backend/tests/rls_policy_check.sql`
(needs only Docker — see the header in that file).

---

## 3. No data deletion (code — DONE, on by default)

`ALLOW_HARD_DELETE=false` (default) means the recycle-bin purge paths never
physically delete rows. Submissions have no delete endpoint; forms/programs
archive. Client data is retained.

**DPDP erasure requests** (a data principal asks to be deleted) are served by
**anonymize** (`POST /submissions/{id}/anonymize`), not row deletion — this
strips personal data while keeping aggregate integrity. Do not set
`ALLOW_HARD_DELETE=true` except for a deliberate, logged ops cleanup.

---

## 4. Encryption (code done + ops to enable)

Already in code: bcrypt password hashing, JWT auth, 2FA TOTP, RSA-3072 +
AES-256-GCM for offline survey capsules.

Ops must enable:
- **At rest:** turn on volume encryption for the Postgres data volume and the
  media/uploads volume (managed DB: it's a checkbox; self-hosted: encrypted disk).
- **In transit:** force TLS. Add `?sslmode=require` to `DATABASE_URL` /
  `APP_DATABASE_URL`, and ensure the public site is HTTPS-only (nginx + certbot,
  already in the compose stack).
- **Backups:** automated, **encrypted**, in-region, and periodically restore-tested.
  `backend/scripts/backup_db.py` produces a logical JSON dump — store its output
  on an encrypted volume; do not keep unencrypted backups.

---

## 5. DPDP process (paperwork — you own this)

Compliance is partly process, not code:

1. **Consent:** record consent when collecting personal data from beneficiaries;
   keep it purpose-limited and withdrawable.
2. **Breach notification:** have a written path to detect and notify the Data
   Protection Board of India + affected people, targeting **within 72 hours**.
3. **Erasure & correction:** honour data-principal requests — use anonymize for
   erasure; the master_admin/org_admin panels for correction.
4. **Retention:** define how long data is kept and document it; the recycle bin
   holds soft-deleted items for 360 days (`RETENTION_DAYS`).
5. **Access & audit:** RBAC is enforced (org_admin/supervisor/enumerator);
   `audit_log` records sensitive admin actions. Review access periodically.

---

## Quick status

| Item | State |
|------|-------|
| Multi-tenant, one DB | ✅ in place |
| DB-layer RLS isolation | ✅ code done — set `APP_DATABASE_URL` to enable |
| No hard delete | ✅ on by default |
| App-level encryption (pw/2FA/capsules) | ✅ in place |
| Encryption at rest / TLS / encrypted backups | ⛏ ops to enable |
| India region residency | ⛏ ops to confirm |
| Consent / breach / retention docs | ⛏ you to write |
