# Breach Response Plan — FieldGovern

A written incident-response plan for personal-data breaches, per DPDP Act 2023 /
DPDP Rules 2025 and CERT-In's 2022 reporting directions. Fill in the bracketed
`[...]` contact details before this is a usable plan — they can't be filled in
from the codebase, only by the org.

---

## 1. What counts as a breach

Any of the following involving FieldGovern-held personal data (submission
answers, respondent names/phone/GPS, enumerator accounts, org admin accounts):

- Unauthorized access to the database, backups, or object storage
- Credential compromise (leaked API key, exposed password, compromised admin
  account) with evidence of actual or likely access
- A code or config change that exposed one tenant's data to another
  (tenant-isolation failure)
- Loss or theft of a device holding unsynced offline submissions
- A third-party processor (hosting, AI provider, SMS/WhatsApp gateway) reports
  a breach affecting FieldGovern data

**Not a breach on its own:** a failed login attempt, a blocked SQL-injection
probe, a 4xx/5xx error spike with no evidence of data access. Log it, but the
timelines below don't start until personal data is confirmed or reasonably
suspected to be compromised.

---

## 2. Severity levels

| Level | Definition | Example |
|-------|-----------|---------|
| **P0 — Critical** | Confirmed cross-tenant or public exposure of personal data, or an active attacker with data access | RLS bypass exposing all tenants' submissions; leaked DB credential with confirmed access logs |
| **P1 — High** | Confirmed unauthorized access to one tenant's data, contained | A single org_admin account compromised, submissions for that tenant read |
| **P2 — Medium** | Suspected but unconfirmed access, or a vulnerability found with no evidence of exploitation | A dependency CVE affecting an endpoint that handles personal data, patched before evidence of use |
| **P3 — Low** | No personal data involved, or fully mitigated before any access occurred | A test credential rotated proactively, no access logs |

P0/P1 trigger the full timeline below. P2 is assessed within 24h to confirm/
reclassify. P3 is logged, no external notification required.

---

## 3. Roles

Fill in names/contacts. One person can hold multiple roles in a small team.

| Role | Responsibility | Contact |
|------|----------------|---------|
| **Incident Commander** | Owns the response end-to-end, makes the call on severity and notification | `[name, phone, email]` |
| **Technical Lead** | Contains the incident, preserves logs, root-causes it | `[name, phone, email]` |
| **Grievance Officer** | Single point of contact for affected data principals — should already be published per DPDP Rules | `[name, phone, email]` |
| **Communications** | Drafts and sends customer/Board notifications | `[name, phone, email]` |
| **Legal / DPO** (if engaged) | Confirms notification obligations, reviews external communications | `[name/firm, phone, email]` |

---

## 4. Timeline

Clock starts at **confirmed or reasonably suspected** breach (not first alert —
triage first, but triage fast).

| Deadline | Action |
|----------|--------|
| **Immediately** | Incident Commander declares the incident, assigns severity, starts the incident log (see §6) |
| **≤ 6 hours** | Report to CERT-In (mandatory under the 2022 CERT-In directions for the categories they list — data breaches involving unauthorized access are in scope). Email `incident@cert-in.org.in`, use the template in §7. |
| **≤ 24 hours** | Notify affected customers (org admins of affected tenants) — so *they* can meet their own downstream notification obligations to their beneficiaries/donors/regulators. Use the template in §7. |
| **≤ 72 hours** | Submit the detailed report to the Data Protection Board of India, if the breach meets the Board's notification threshold. Use the template in §7. |
| **Ongoing** | Keep the incident log updated until closed; do a post-incident review within 2 weeks of closure. |

---

## 5. Containment checklist

Technical Lead works through this immediately, in parallel with the
notification clock above — containment is not blocked on notification, and
vice versa.

- [ ] Rotate the specific compromised credential (DB password, API key, JWT
      secret, admin password) — see `tasks/pending_owner_action.md` for the
      rotation steps already documented for known credential types
- [ ] If a specific tenant is affected, check `audit_log` for that
      `tenant_id` to scope exactly what was accessed (`verify_audit_chain()`
      confirms the log itself hasn't been tampered with — see
      `GET /audit/verify-chain`)
- [ ] Check `GET /audit/anomalies` for related suspicious activity
      (repeated failed logins, off-hours access) around the incident window
- [ ] If the vector was a code vulnerability, patch and deploy before
      any public disclosure
- [ ] If a device was lost/stolen, remotely deauthorize its session
      (short-lived tokens already limit this window — see item 16 of
      `tasks/dpdp_master_plan.md` for the not-yet-built session-revocation
      piece)
- [ ] Preserve evidence before remediating where possible — see §6

---

## 6. Forensic log preservation

Before rotating credentials or patching (or immediately after, if containment
can't wait):

1. Export the relevant `audit_log` rows for the affected tenant(s) and time
   window: `GET /audit/export.csv` (org_admin) or query directly.
2. Run `GET /audit/verify-chain` for each affected tenant and record the
   result in the incident log — this is your evidence the log itself wasn't
   altered.
3. Snapshot server logs (nginx access/error, application logs) covering the
   incident window before log rotation could remove them.
4. Note exact timestamps (UTC) of detection, containment actions, and any
   credential rotations in the incident log — these timestamps are what the
   CERT-In/Board reports will reference.
5. Keep this evidence for at least 1 year (matches the ≥1-year audit-log
   retention target in `tasks/dpdp_master_plan.md` item 11).

---

## 7. Notification templates

### 7a. CERT-In initial report (≤6h)

```
To: incident@cert-in.org.in
Subject: Security Incident Report — FieldGovern — [severity] — [date]

1. Reporting organisation: [org legal name], operator of FieldGovern
2. Point of contact: [name, phone, email]
3. Date/time incident detected: [UTC timestamp]
4. Date/time incident occurred (if known): [UTC timestamp]
5. Nature of incident: [brief factual description — what happened, not speculation]
6. Systems/data affected: [which service, approx. number of affected data
   principals if known, categories of data involved]
7. Current status: [ongoing / contained]
8. Actions taken so far: [containment steps from §5]
9. This is an initial report; a detailed follow-up will be provided as the
   investigation progresses.
```

### 7b. Customer (org admin) notification (≤24h)

```
Subject: Security Incident Notice — Action may be required

Dear [org name] team,

We're writing to inform you of a security incident that affected your
FieldGovern account. We take this seriously and want to be transparent
with you as soon as we have confirmed facts.

What happened: [factual, plain-language description]
When: [date/time window]
What data was involved: [be specific — which forms/submissions/fields,
or "no evidence your data was accessed" if that's the honest assessment]
What we've done: [containment steps already taken]
What you should do: [e.g. "no action needed" / "consider notifying your
own beneficiaries" / "rotate your account password as a precaution"]

We will follow up with any further findings. Contact our Grievance Officer
at [contact] with any questions.

[Communications lead name]
```

### 7c. Data Protection Board detailed report (≤72h)

```
To: [Data Protection Board of India — submission channel per their current process]
Subject: Detailed Breach Report — FieldGovern — [incident ID] — [date]

1. Organisation and DPO/Grievance Officer contact: [details]
2. Incident timeline: detection, containment, and notification timestamps
   (from the incident log, §6)
3. Root cause: [technical explanation]
4. Categories and approximate number of data principals affected
5. Categories of personal data involved
6. Consequences of the breach (assessed impact)
7. Measures taken or proposed to address the breach and mitigate adverse
   effects
8. Whether affected data principals were notified, and how (attach §7b
   template as sent)
9. Measures taken to prevent recurrence
```

---

## 8. Tabletop exercise

Run twice a year (e.g. alongside the compliance review), walking through one
plausible scenario end-to-end without touching production:

1. Pick a scenario (compromised admin credential; lost enumerator device;
   third-party processor breach notification received)
2. Walk the team through §2-§7 as if it were real — who declares severity,
   who drafts which notification, where the evidence would come from
3. Time each step against the deadlines in §4
4. Note gaps (missing contact info, unclear ownership, a step that took too
   long) and fix them before the next exercise
5. Log the exercise date and findings here: `[date] — [scenario] — [findings]`
