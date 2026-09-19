# Data Processing Agreement (DPA) — Template

This is a starting-point template, not a finished legal document. **Have an
Indian data-protection lawyer review and finalise this before using it with
real customers** — see item 20 of `tasks/dpdp_master_plan.md`. Every
`[bracketed]` field needs filling in.

---

**DATA PROCESSING AGREEMENT**

This Data Processing Agreement ("**DPA**") is entered into between:

**[Customer legal name]** ("**Data Fiduciary**" / "**Customer**"), and

**[FieldGovern operating entity legal name]** ("**Data Processor**" /
"**FieldGovern**"),

collectively the "**Parties**", and forms part of the underlying services
agreement between the Parties (the "**Agreement**").

## 1. Definitions

Terms used in this DPA (Personal Data, Data Principal, Processing, Data
Fiduciary, Data Processor, Consent, Data Protection Board) carry the
meanings given to them in the Digital Personal Data Protection Act, 2023
("**DPDP Act**") and its rules.

## 2. Scope and Purpose

FieldGovern processes Personal Data on behalf of Customer solely to provide
the field data collection, cleaning, analysis, and reporting services
described in the Agreement (the "**Services**"). FieldGovern does not
process Personal Data for any purpose outside Customer's documented
instructions, except where required by applicable law.

## 3. Categories of Data and Data Principals

- **Data Principals**: Customer's field enumerators/staff (accounts), and
  respondents/beneficiaries whose data Customer collects via FieldGovern
  forms.
- **Categories of Personal Data**: names, phone numbers, email addresses,
  GPS coordinates, photographs, audio recordings, and any other data
  fields Customer's forms are configured to collect. The specific
  categories are determined entirely by Customer's own form design —
  FieldGovern has no visibility into what a given form collects beyond
  what Customer configures.

## 4. Customer's Obligations

Customer is the Data Fiduciary and is responsible for:
- Obtaining valid consent from Data Principals before collecting their
  Personal Data via FieldGovern.
- Configuring forms to accurately reflect the actual purpose and scope of
  data collection (FieldGovern's consent-notice and per-purpose consent
  features exist to support this — see `tasks/dpdp_master_plan.md` items
  5-6 — but Customer is responsible for the actual notice content).
- Responding to data-principal rights requests using the tools FieldGovern
  provides (`/data-rights`), or directing such requests to FieldGovern's
  Grievance Officer if Customer cannot act on them directly.

## 5. FieldGovern's Obligations

FieldGovern will:
- Process Personal Data only on Customer's documented instructions (as
  expressed through Customer's use of the Services) and applicable law.
- Implement the technical and organisational measures described in
  `deploy/SECURITY_DPDP_RUNBOOK.md`, including but not limited to:
  database-level tenant isolation (row-level security), encryption in
  transit, tamper-evident audit logging, and PII redaction before any
  third-party AI call.
- Assist Customer in responding to data-principal rights requests and
  breach notifications, per the process in
  `deploy/BREACH_RESPONSE_PLAN.md`.
- Not engage a new sub-processor without notifying Customer and giving a
  reasonable opportunity to object — see `deploy/SUB_PROCESSORS.md`.
- Delete or anonymise Customer's Personal Data upon termination of the
  Agreement, within **[X days — to be agreed]**, and provide a deletion
  certificate confirming this (`GET /data-rights/{id}/certificate` covers
  individual erasure requests during the contract term; a full
  contract-end deletion process is tracked as a real, not-yet-built gap —
  see item 23 of `tasks/dpdp_master_plan.md`).

## 6. Sub-processors

FieldGovern's current sub-processor list is maintained at
`deploy/SUB_PROCESSORS.md` (and should be published at a stable URL, e.g.
the Trust Centre page). FieldGovern will notify Customer before adding a
new sub-processor that will process Customer's Personal Data.

## 7. Data Breach Notification

FieldGovern will notify Customer without undue delay, and in any event
within **[X hours — recommend 24, matching the breach-response plan's own
customer-notification timeline]** of becoming aware of a Personal Data
breach affecting Customer's data, per the process in
`deploy/BREACH_RESPONSE_PLAN.md`.

## 8. Data Residency

**[State the actual current hosting region and any commitments — do not
overstate. As of 2026-09-18, hosting is in an EU region with a committed
move to an India region — see `tasks/pending_owner_action.md` §3. Do not
sign a DPA claiming India-only residency until that move is actually
complete.]**

## 9. Audit Rights

**[Negotiate: typically a right for Customer to request evidence of
compliance (e.g., the audit-chain verification output, `GET
/audit/verify-chain`) rather than a full on-site audit, given FieldGovern's
multi-tenant architecture.]**

## 10. Term and Termination

This DPA remains in effect for the duration of the Agreement. Obligations
in Sections 5 (deletion on termination) and 7 (breach notification) survive
termination.

---

*This template does not constitute legal advice. Engage qualified counsel
before executing any DPA with a customer.*
