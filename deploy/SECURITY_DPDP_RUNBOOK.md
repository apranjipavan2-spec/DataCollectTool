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

## 2. Tenant isolation at the DB layer (code done — LIVE in production since 2026-09-18)

Every tenant table has `FORCE ROW LEVEL SECURITY` with a `tenant_isolation`
policy, enforced via a restricted, non-superuser role `fieldgovern_app` — the
app no longer connects as the Postgres superuser (which bypasses RLS
entirely). Verified live via real smoke tests: normal-user tenant isolation
confirmed, master_admin cross-tenant visibility confirmed. New tables created
after migration `0048` don't automatically inherit this — see migration
`0059` for the pattern to extend it (`data_rights_requests` is the current
example).

Verify the policy logic anytime with `backend/tests/rls_policy_check.sql`
(needs only Docker — see the header in that file), or `GET /audit/
verify-chain` + `GET /audit/anomalies` for the tamper-evidence + anomaly
layer built on top of the audit log (item 11 of `tasks/dpdp_master_plan.md`).

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

1. **Consent:** itemised, versioned notice + per-purpose consent (photo/audio/
   GPS/follow-up) is built into form collection — see items 5-6 of
   `tasks/dpdp_master_plan.md`. Withdrawal by reference code (item 7): org
   admins can look up and withdraw via Settings → Security → Consent
   Withdrawal.
2. **Breach notification:** see the full written plan —
   `deploy/BREACH_RESPONSE_PLAN.md` — roles, severity levels, the CERT-In
   ≤6h / customer ≤24h / Board ≤72h timeline, pre-drafted templates, and a
   forensic-log-preservation checklist. Fill in the contact details there
   before it's usable.
3. **Erasure, correction & data-principal rights:** `POST /submissions/{id}/
   anonymize` (master_admin, single record), consent withdrawal by reference
   code (org_admin), and the full log/search/act/close workflow at
   `/data-rights` (org_admin) for access/correction/erasure/portability
   requests with SLA tracking — item 8 of `tasks/dpdp_master_plan.md`.
4. **Retention:** define how long data is kept and document it; the recycle bin
   holds soft-deleted items for 360 days (`RETENTION_DAYS`).
5. **Access & audit:** RBAC is enforced (org_admin/supervisor/enumerator);
   `audit_log` records sensitive admin actions. Review access periodically.

---

## Quick status

| Item | State |
|------|-------|
| Multi-tenant, one DB | ✅ in place |
| DB-layer RLS isolation | ✅ live in production |
| No hard delete | ✅ on by default |
| App-level encryption (pw/2FA/capsules) | ✅ in place |
| TLS 1.2+/HSTS | ✅ in place |
| Aadhaar minimisation at write time | ✅ in place |
| Audit-log tamper-evidence + anomaly alerts | ✅ in place |
| Consent notice + per-purpose consent + withdrawal | ✅ in place |
| Data-principal rights workflow (`/data-rights`) | ✅ in place |
| Field-level encryption for name/phone/other identifiers | ⛏ primitive built, not yet wired to live reads/writes |
| Disk / object-storage / backup encryption | ⛏ ops — owner has a server-rebuild timeline |
| India region residency | ⛏ ops — owner has a server-rebuild timeline |
| Breach response plan | ✅ written — `deploy/BREACH_RESPONSE_PLAN.md`, fill in contact details |
| Retention docs | ⛏ you to write |
