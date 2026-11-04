# Saathi ↔ FieldGovern feed contract

Answers Saathi's 4 asks (2026-11-04). Paste this file into the Saathi session. Saathi should NOT edit the
FieldGovern repo; ask the FieldGovern session for changes.

Base URL: `https://app.fieldgovern.com/api/v1` · Auth header on every call: `X-API-Key: fgk_…`
(key: FieldGovern → Settings → API keys, org admin; shown once). Goes live when this commit is pushed to `main` (auto-deploy).

| # | Saathi ask | Status | Endpoint |
| --- | --- | --- | --- |
| 1 | Totals endpoint | ✅ Built | `GET /export/totals/{form_id}` |
| 2 | Filter on server-received time | ✅ Built | `received_from` / `received_to` on totals and on `/export/submissions/{form_id}/json`; each JSON row now has `received_at` |
| 3 | Monthly API-call limit | ✅ Answered | Trial/Starter 20 · Growth 200 · Pro 1,000 · Custom unlimited. One call = one request. 402 when exceeded. |
| 4 | Forms list for API keys | ✅ Built | `GET /export/forms` |

## 1. Forms list

```
GET /export/forms[?status=active]
→ [{ "id", "title", "status", "version", "created_at", "updated_at",
     "questions": [{ "name", "label", "type" }] }]
```

## 2. Totals

```
GET /export/totals/{form_id}?group_by=month&time_basis=received&tz=Asia/Kolkata
    [&received_from=2026-10-01T00:00:00Z&received_to=…&date_from=…&date_to=…&status=…]
```

| Param | Default | Values |
| --- | --- | --- |
| `group_by` | `month` | `month` (`2026-10`), `week` (`2026-W44`), `day` (`2026-10-30`), `none` (`all`) |
| `time_basis` | `received` | `received` (server_received_at) · `collected` (phone time, falls back to received) |
| `tz` | `Asia/Kolkata` | any IANA zone; decides which month a 00:30 IST submission falls in |
| `status` | all except `draft`, `rejected` | one status |

Response:

```json
{
  "form_id": "…", "form_title": "…", "generated_at": "…",
  "group_by": "month", "time_basis": "received", "tz": "Asia/Kolkata", "filters": { … },
  "questions": [{ "name": "hh_size", "label": "Household size", "type": "number" }, …],
  "overall": { "count": 3, "numbers": { … }, "choices": { … } },
  "groups": [
    { "period": "2026-10", "count": 1,
      "numbers": { "hh_size": { "label": "Household size", "n": 1, "sum": 3.0, "average": 3.0, "min": 3.0, "max": 3.0 } },
      "choices": { "gender": { "label": "Gender", "n": 1,
                   "options": [{ "value": "m", "label": "Male", "count": 1 }, { "value": "f", "label": "Female", "count": 0 }] } } }
  ]
}
```

- Exact numbers — no "<5" hiding (that only applies to public share links).
- `numbers`: question types `number`, `decimal`, `rating`. Non-numeric answers are skipped (not counted in `n`).
- `choices`: `single_choice`, `multiple_choice`, `rating`. Multiple-choice counts each option once per submission, so option counts can sum to more than `n`.
- Never included: identifier questions, free text, GPS, photos. Confirmed duplicates are always excluded.
- Periods with no submissions are not listed — fill gaps with 0 on the Saathi side.

## 3. Raw rows (only if still needed)

`GET /export/submissions/{form_id}/json?received_from=<last received_at seen>` — incremental pull; store the
newest `received_at` from each batch as the next checkpoint.

## Call budget

A daily run = 1 forms call + 1 totals call per form. 3 forms ≈ 4 calls/day ≈ 120/month → needs **Growth (200)** or above.
On Starter (20/month) run weekly at most, or ask FieldGovern to change the plan/limit.
