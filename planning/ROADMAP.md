# FieldGovern — Future Scope Roadmap
<!-- token-efficient: no prose, structured tables only -->

## Priority Queue

| # | Feature | Bundle | Effort | Impact | Status |
|---|---------|--------|--------|--------|--------|
| 1 | Repeat groups (nested field sets) | Research | High | Critical — blocks most serious surveys | planned |
| 2 | XLSForm / ODK / Kobo / SurveyCTO import | Migration | Med | Acquisition — converts competitor users | **done** |
| 3 | Google Sheets live sync | Integrations | Low | High demand from NGOs | **done** |
| 4 | WhatsApp notifications (MSG91) | Comms | Low | High daily-use value | **done** |
| 5 | Public survey URL (no login) | Collection | Med | Opens new user segment | planned |
| 6 | Multi-LLM AI report writer | Analytics | Med | Pricing tier differentiator | planned |
| 7 | Back-check / QC audit forms | QC | Med | Unique vs competitors | planned |
| 8 | DPDP compliance bundle | Compliance | Med | Government contract unlock | planned |
| 9 | Digital consent + signature | Research | Low | Ethics requirement for funded research | planned |
| 10 | Randomization / arm assignment | Research | Low | RCT support | planned |
| 11 | Field scheduling / respondent roster | Field Mgmt | Med | Track completion vs target | planned |
| 12 | Geofencing (restrict by GPS zone) | Field Mgmt | Med | Prevent fake fieldwork | planned |
| 13 | Daily progress tracker | Field Mgmt | Low | Supervisor overview | planned |
| 14 | DHIS2 push integration | Integrations | High | Government health contracts | planned |
| 15 | Stata / SPSS / R export (.dta/.sav) | Analytics | Low | Funder requirement | planned |
| 16 | Server-side validation rules | QC | Med | Define rules in form builder | planned |
| 17 | Duplicate detection | QC | Low | Same GPS + name = flag | planned |
| 18 | Multi-LLM AI form builder assistant | AI | Low | Skip logic from plain English | planned |
| 19 | Multi-LLM auto-translate form labels | AI | Low | Regional languages in one click | planned |
| 20 | QR code login for enumerators | Auth | Low | No-password field access | planned |
| 21 | Respondent incentive management | Field Mgmt | Med | Track payments to respondents | planned |

**Dropped:** SMS OTP login (deprioritised), Power BI connector (not required), CATI mode (separate product), Peer-to-peer sync (hardware constraint)

---

## Bundle Definitions

### Migration Bundle ✅ done
Parse XLSForm standard → FieldGovern schema. Pull forms + submissions from Kobo, SurveyCTO, ODK Central via API.

### Research Workflow Bundle
- Repeat groups: nested field arrays in builder + renderer + sync + export
- Randomization: arm assignment on form open, configurable in form settings
- Digital consent: signature-pad field type, stored as base64 image

### Comms Bundle ✅ WhatsApp done
- WhatsApp: MSG91 WABA — pending MSG91 account + Meta approval
- ~~SMS OTP~~ — dropped

### QC Bundle
- Back-check: supervisor marks X% for re-interview; system creates linked audit form
- Server-side rules: org_admin defines constraints applied on sync, flags violation submissions
- Duplicate detection: same form + GPS within 50m + same day = flag

### AI Bundle (Multi-LLM)
Providers supported: OpenAI (GPT-4o), Anthropic (Claude), Google (Gemini).
Org configures provider + API key in Org Settings → AI. Falls back gracefully if no key set.
- AI report writer: summarises submissions → Word/PDF export
- AI form builder: skip logic + question wording from plain English
- Auto-translate labels: one-click to Hindi/Kannada/Telugu/Telugu

### Analytics Bundle
- Cross-tabulation: pivot table builder in browser
- Advanced exports: .dta (Stata), .sav (SPSS), R-ready .csv with codebook

### Compliance Bundle
- DPDP 2023: consent audit log, data erasure endpoint (anonymise submission data_json)
- Audit trail: all data-access events logged per user per submission
- Purpose field on forms: what data is collected for

### Integrations ✅ Sheets done
- Google Sheets: Apps Script webhook, per-form config — done
- DHIS2: push submission data to government DHIS2 instance
- Webhooks: already live
- REST API + API keys: already live
