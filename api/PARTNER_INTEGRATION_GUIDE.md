# FieldGovern Integration & Data Sharing Guide

Nov 4, 2026 · Shareable copy of the Claude Doc: https://claude.ai/artifact/SQefN2uFT48P3RNzpf81pr

FieldGovern can import forms and data from KoboToolbox, and can send data to other organisations as files, through an API key, or through real-time webhooks. Results can be shared with outsiders as a read-only link that shows totals only.

## At a glance

Nine channels are live.

| Channel | Direction | How it works | Who sets it up | Plans | Status |
| --- | --- | --- | --- | --- | --- |
| KoboToolbox import | In | Kobo API token; copies form + submissions | Org admin | All | Live |
| SurveyCTO / ODK Central import | In | Username + password; copies form + submissions | Org admin | All | Live |
| XLSForm file upload | In | Upload .xlsx / .xls | Org admin | All | Live |
| File export | Out | CSV, Excel, JSON, PDF, Stata, SPSS download | Org admin, supervisor | SPSS: Trial, Growth, Pro, Custom | Live |
| API pull | Out | Partner system calls the JSON export with an API key | Org admin creates key | Trial, Starter, Growth, Pro, Custom | Live |
| Webhooks | Out | FieldGovern POSTs each submission event to the partner's URL | Org admin | — | Live |
| Google Sheets | Out | Export to a new Sheet, or keep a Sheet in sync | Org admin | — | Live |
| Scheduled reports | Out | AI-written Word report emailed on a schedule | Org admin | — | Live |
| Results share link | Out | Read-only link with totals and charts only; no login | Org admin | All | Live |

## Importing from KoboToolbox

An org admin can copy any Kobo form and all its submissions into FieldGovern in one click; re-running it adds only new submissions.

1. In Kobo, open Account Settings → Security and copy the API key.
2. In FieldGovern, open Migration → KoboToolbox, enter the server URL and key, and press Connect.
3. Every Kobo survey project is listed with its submission count.
4. Press Import, ticking "Import submissions" to bring the data too.
5. The form lands as a draft, with any conversion warnings shown beside it.
6. Running Import again on the same form reuses it and skips submissions already copied.

Servers: `https://kf.kobotoolbox.org` (global), `https://eu.kobotoolbox.org` (EU), or a self-hosted Kobo over https.

| Kobo answer | Becomes in FieldGovern |
| --- | --- |
| Text, e.g. `ramesh kumar` | Same text |
| Integer / decimal, e.g. `"42"` | Number `42` |
| Select multiple, e.g. `rice wheat` | List `[rice, wheat]` |
| Select one, e.g. `1` | Choice code `1` |
| GPS, e.g. `12.97 77.59 900 5` | Latitude 12.97, longitude 77.59, accuracy 5 m |
| Repeat group | One row per repeat, all answers kept |
| Submission time | Kept as the original submission time |
| Kobo enumerator username | Kept in the submission's source details |
| Photos, audio, video | Not yet copied (file name only) |

The Kobo key is used only for the import and is not stored by FieldGovern. Use a Kobo account with access to only the projects you want to move.

## Exporting data to another organisation

Yes — data can go to a partner in four ways; pick by how often they need it and whether their system can call an API.

| Need | Use | Partner needs | Filters |
| --- | --- | --- | --- |
| A one-off file | File export: CSV (codes or labels), Excel, JSON, PDF summary, Stata .dta, SPSS .sav | Nothing; you send the file | Date range, status |
| Their system pulls data on its own schedule | API pull with an API key (section below) | A server or tool that can make HTTPS calls | Date range, status |
| Each new submission the moment it arrives | Webhook to their URL, signed with a shared secret | An HTTPS endpoint that accepts POST | Event type |
| A live spreadsheet | Google Sheets export or sync, shared from Google | A Google account | Per form |
| A written summary | Scheduled AI report (Word) by email | An email address | Per schedule |

Totals come two ways: outside partners get the results share link (small numbers hidden); the organisation's own systems get exact monthly totals through the API (below). Every export covers one form at a time.

## API reference for partners

A partner pulls one form's submissions with a single HTTPS call; base URL `https://app.fieldgovern.com/api/v1`.

**Get a key.** The org admin opens Settings → API keys, names the key after the partner, and copies it. It is shown once; revoke it there at any time. A key acts with the role of the admin who made it and counts toward the plan's monthly API-call limit.

**Pull submissions.**

```bash
curl -H "X-API-Key: <key>" \
  "https://app.fieldgovern.com/api/v1/export/submissions/<form_id>/json?date_from=2026-10-01&date_to=2026-10-31&status=synced"
```

| Parameter | Required | Meaning |
| --- | --- | --- |
| `form_id` (path) | Yes | The form's id, from its URL in FieldGovern |
| `date_from`, `date_to` | No | ISO date or date-time |
| `status` | No | `synced`, `flagged`, `approved`, `rejected` |
| `received_from`, `received_to` | No | Filter on when the server received it (catches interviews synced days late) |

The response is a JSON array. Item 0 is a summary (`form_title`, `field_count`, `submission_count`, `exported_at`); each later item is one submission with `submission_id`, `serial_no`, `enumerator_name`, `submitted_at` (phone time), `received_at` (server time), `status` and one key per question. For incremental pulls, store the newest `received_at` and pass it as `received_from` next time.

| Code | Meaning |
| --- | --- |
| 401 | Key missing, wrong or revoked |
| 402 | Monthly API-call limit reached |
| 403 | Plan has no API access, organisation suspended, or key owner is not an admin or supervisor |
| 404 | Form not in this organisation |

**List forms.** `GET /api/v1/export/forms` (same `X-API-Key`) returns every form's `id`, `title`, `status`, `version` and its questions (`name`, `label`, `type`).

**Exact totals (the organisation's own systems).** `GET /api/v1/export/totals/<form_id>` returns counts, not rows, so one call covers any number of months.

| Parameter | Default | Meaning |
| --- | --- | --- |
| `group_by` | `month` | `month`, `week`, `day` or `none` |
| `time_basis` | `received` | `received` = server time; `collected` = phone time |
| `tz` | `Asia/Kolkata` | Time zone for month and day boundaries |
| `date_from`, `date_to`, `received_from`, `received_to` | — | Same filters as the JSON pull |
| `status` | all except draft and rejected | One status only |

Each period (and `overall`) gives `count`; for each number, decimal or rating question `n`, `sum`, `average`, `min`, `max`; and for each choice or rating question the count per answer. Numbers are exact, with no "<5" hiding, because the same key can already read every row. Identifier questions and free text are never included.

**Monthly API-call allowance.** Every call made with a key counts once (the forms list, a JSON pull, a totals call).

| Plan | Calls per month |
| --- | --- |
| Trial, Starter | 20 |
| Growth | 200 |
| Pro | 1,000 |
| Custom | Unlimited |

Past the allowance, calls return 402 until the next month.

**Webhooks.** FieldGovern POSTs JSON to the partner's URL on `submission.created`, `submission.synced`, `submission.flagged`, `submission.approved` and `submission.rejected`. The URL must be public https. Headers: `X-FieldGovern-Event`, `X-FieldGovern-Timestamp`, and, when a secret is set, `X-FieldGovern-Signature: sha256=<hex>`. The partner checks the signature like this:

```python
import hmac, hashlib
expected = "sha256=" + hmac.new(SECRET.encode(), raw_body, hashlib.sha256).hexdigest()
assert hmac.compare_digest(expected, request.headers["X-FieldGovern-Signature"])
```

A failed delivery is logged and not retried, so the partner should run a daily API pull to catch anything missed.

## Sharing dashboards and stats

Yes — an org admin can share a form's results as a read-only link that shows totals and charts only; no login is needed to view it.

1. Open the form's Share button on the Dashboard.
2. Under "Share results (totals only)", say who it is for and pick an expiry: 30 days, 90 days, 1 year or never.
3. Press Create link; it is copied, ready to send.
4. Revoke it there at any time; a revoked or expired link shows "expired or turned off".

| The page shows | The page never shows |
| --- | --- |
| Total responses | Names, phone numbers or any identifier field |
| Responses by day | Free-text answers, numbers, GPS points, photos |
| Responses by field team member, as "Enumerator 1, 2, 3…" | Enumerator names or phones |
| Counts and percentages for each choice and rating question | Individual submissions |

Any count from 1 to 4 appears as "<5". When that would let a reader work a hidden number out by subtracting from the total, the next-smallest number is hidden too. A form with fewer than 5 responses shows only "<5". Rejected and duplicate submissions are not counted. Each link records how many times it was viewed.

Example (demo data): `results_page_example_mobile.png`.

## Data protection

File exports, the API pull and webhooks all carry full answers, including names, phone numbers and other personal data; Aadhaar numbers stay masked.

Before sharing with another organisation:

- [ ] Respondents' consent covers sharing with this partner, for this purpose (DPDP Act 2023)
- [ ] A data-sharing agreement names the purpose, retention period and deletion on request
- [ ] Share only the forms the partner needs; one API key per partner, named after them
- [ ] Webhook URL is https and has a secret set
- [ ] A date is set to revoke the key or stop the webhook

Credentials: FieldGovern stores only a hash of each API key, so a lost key cannot be recovered — revoke it and create a new one. Kobo, SurveyCTO and ODK passwords or tokens entered for an import are never stored.

## Known limits

| Limit | Workaround today | Planned fix |
| --- | --- | --- |
| Results link summarises choice and rating questions only | File export or API pull for other question types | — |
| One form per API call | One call per form; use totals to cover many months in one call | — |
| Webhook deliveries are not retried | Daily API pull as a backstop | Retry with backoff |
| Kobo photos, audio and video not copied | Download from Kobo directly | Attachment import |
| Kobo imports of 20,000+ submissions may time out | Import in batches by re-running (duplicates are skipped) | Background import with progress |
