# Migration Feature Spec
<!-- XLSForm + Kobo + SurveyCTO + ODK Central import -->

## Supported Sources

| Source | Forms | Submissions | Auth |
|--------|-------|-------------|------|
| XLSForm file (.xlsx/.xls) | ✅ parse to schema | ❌ n/a | none |
| KoboToolbox | ✅ via API | ✅ via API | Token |
| SurveyCTO | ✅ XLSForm download | ✅ CSV/JSON API | Basic auth |
| ODK Central | ✅ XLSForm download | ✅ OData API | Basic auth |
| Generic ODK (XLSForm file) | ✅ same as XLSForm | ❌ n/a | none |

## XLSForm → FieldGovern Type Map

| XLSForm type | FieldGovern type | Notes |
|---|---|---|
| text, string | text | |
| integer, int | number | |
| decimal | decimal | |
| date | date | |
| time | time | |
| dateTime | date | time portion dropped |
| select_one {list} | single_choice | options from choices sheet |
| select_multiple {list} | multiple_choice | options from choices sheet |
| geopoint, geotrace, geoshape | gps | geotrace/shape → gps (first point) |
| image, photo | photo | |
| audio | audio | |
| video | audio | warn user |
| barcode, qrcode | barcode | |
| calculate | calculated | formula stored verbatim |
| note | note | label → hint |
| range | number or rating | rating if appearance=rating |
| begin_group / end_group | new section | |
| begin_repeat / end_repeat | repeat_group | |

## Relevant Expression → Skip Logic

XLSForm XPath → FieldGovern skipLogic:

| XLSForm | FieldGovern operator |
|---|---|
| `${f} = 'v'` | eq |
| `${f} != 'v'` | neq |
| `${f} > n` | gt |
| `${f} >= n` | gte |
| `${f} < n` | lt |
| `${f} <= n` | lte |
| `${f} = ''` | is_empty |
| `${f} != ''` | is_not_empty |
| `selected(${f}, 'v')` | contains |
| `and` | logic: AND |
| `or` | logic: OR |

Complex nested XPath → stored as raw string in `skipLogicRaw` (best-effort, UI shows warning).

## API Endpoints

```
POST /api/v1/migration/xlsform/parse       multipart file → preview schema + warnings
POST /api/v1/migration/xlsform/save        body: {schema, title} → creates draft form
POST /api/v1/migration/kobo/connect        body: {server, token} → form list
POST /api/v1/migration/kobo/import         body: {server, token, asset_uid, import_data} → form + optional submissions
POST /api/v1/migration/surveycto/connect   body: {server, username, password} → form list
POST /api/v1/migration/surveycto/import    body: {server, username, password, form_id, import_data}
POST /api/v1/migration/odk/connect         body: {server, username, password, project_id} → form list
POST /api/v1/migration/odk/import          body: {server, username, password, project_id, form_id, import_data}
```

## Files

```
backend/app/api/routes/migration/
  __init__.py
  xlsform_parser.py     parse XLSForm Excel → FieldGovern json_schema
  relevant_parser.py    XPath relevant → skipLogic
  platform_clients.py   async HTTP clients for Kobo / SurveyCTO / ODK
  router.py             FastAPI router

frontend/src/migration/
  MigrationPage.tsx     tabbed UI: XLSForm | Kobo | SurveyCTO | ODK
  FormPreview.tsx       schema preview + warnings before saving
```

## Submission Import Format

Imported submissions get:
- `status: synced`
- `data_json`: mapped using original field names → FieldGovern field names
- metadata: `source_platform` tag stored in submission (future field)
- Historical submissions paginated (100 per request, loop until done)
