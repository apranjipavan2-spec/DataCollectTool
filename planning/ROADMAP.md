# FieldGovern — Future Scope Roadmap
<!-- token-efficient: no prose, structured tables only -->

## Priority Queue

| # | Feature | Bundle | Effort | Impact | Status |
|---|---------|--------|--------|--------|--------|
| 1 | Repeat groups (nested field sets) | Research | High | Critical — blocks most serious surveys | planned |
| 2 | XLSForm / ODK / Kobo / SurveyCTO import | Migration | Med | Acquisition — converts competitor users | **in-progress** |
| 3 | Google Sheets live sync | Integrations | Low | High demand from NGOs | planned |
| 4 | WhatsApp notifications (MSG91) | Comms | Low | High daily-use value | planned |
| 5 | Public survey URL (no login) | Collection | Med | Opens new user segment | planned |
| 6 | AI report writer (Claude API) | Analytics | Med | Pricing tier differentiator | planned |
| 7 | Back-check / QC audit forms | QC | Med | Unique vs competitors | planned |
| 8 | DPDP compliance bundle | Compliance | Med | Government contract unlock | planned |
| 9 | SMS OTP login (MSG91) | Comms | Med | Field-friendly auth | planned |
| 10 | Digital consent + signature | Research | Low | Ethics requirement for funded research | planned |
| 11 | Randomization / arm assignment | Research | Low | RCT support | planned |
| 12 | Field scheduling / respondent roster | Field Mgmt | Med | Track completion vs target | planned |
| 13 | Geofencing (restrict by GPS zone) | Field Mgmt | Med | Prevent fake fieldwork | planned |
| 14 | Daily progress tracker | Field Mgmt | Low | Supervisor overview | planned |
| 15 | DHIS2 push integration | Integrations | High | Government health contracts | planned |
| 16 | Power BI / Tableau connector | Integrations | Med | Enterprise research | planned |
| 17 | Stata / SPSS / R export (.dta/.sav) | Analytics | Low | Funder requirement | planned |
| 18 | Server-side validation rules | QC | Med | Define rules in form builder | planned |
| 19 | Duplicate detection | QC | Low | Same GPS + name = flag | planned |
| 20 | AI form builder assistant | AI | Low | Skip logic from plain English | planned |
| 21 | Auto-translate form labels | AI | Low | Regional languages in one click | planned |
| 22 | CATI mode (phone survey) | Collection | High | New channel | planned |
| 23 | QR code login for enumerators | Auth | Low | No-password field access | planned |
| 24 | Peer-to-peer sync (no internet) | Offline | High | Extreme remote areas | planned |
| 25 | Respondent incentive management | Field Mgmt | Med | Track payments to respondents | planned |

---

## Bundle Definitions

### Migration Bundle (in-progress)
Parse XLSForm standard → FieldGovern schema. Pull forms + submissions from Kobo, SurveyCTO, ODK Central via API.
See `planning/MIGRATION_SPEC.md` for full spec.

### Research Workflow Bundle
- Repeat groups: nested field arrays in builder + renderer + sync + export
- Randomization: arm assignment on form open, configurable in form settings
- Digital consent: signature-pad field type, stored as base64 image

### India Comms Bundle
- WhatsApp: MSG91 WABA template API → org settings: events + numbers
- SMS OTP: Redis-backed 5-min OTP, fallback to password

### QC Bundle
- Back-check: supervisor marks X% for re-interview; system creates linked audit form
- Server-side rules: org_admin defines constraints applied on sync, flags violation submissions
- Duplicate detection: same form + GPS within 50m + same day = flag

### Analytics Bundle
- Cross-tabulation: already on roadmap (mentioned on landing page)
- AI report: Claude API summarises submissions → Word/PDF export
- Advanced exports: .dta (Stata), .sav (SPSS), R-ready .csv with codebook

### Compliance Bundle
- DPDP 2023: consent audit log, data erasure endpoint (anonymise submission data_json)
- Audit trail: all data-access events logged per user per submission
- Purpose field on forms: what data is collected for
