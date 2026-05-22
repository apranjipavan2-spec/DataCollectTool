# FieldGovern

## Workflow
- Plan mode for 3+ step tasks. Verify: `npx tsc --noEmit --skipLibCheck` (fe), routes in `router.py` (be)
- Bug → fix + update `tasks/lessons.md`. Track in `tasks/todo.md`.

## Stack
Frontend: React 18+TS+Vite+Tailwind 4 · PWA: vite-plugin-pwa, OPFS+wa-sqlite (Chrome), IndexedDB (Safari)
Backend: FastAPI 0.111+SQLAlchemy 2.0+Alembic · DB: PostgreSQL 16+Redis 7 · Auth: JWT HS256+bcrypt
Deploy: Node 20 build → Python 3.13. wait_and_stamp.py → alembic upgrade → seed_dev → uvicorn

## Key Rules
1. New migration → patch `seed_dev.py _PATCHES` + detect in `wait_and_stamp.py`
2. New route → import + `include_router` in `app/api/router.py`
3. New nav → `<Route>` in `App.tsx`
4. User dep is dict: `user["tenant_id"]` not `user.tenant_id`
5. TopNav breadcrumbs: `path` not `href`
6. localStorage: namespace `fg_tabs_{programId}`
7. No `CREATE INDEX CONCURRENTLY` in Alembic. Use `CREATE INDEX IF NOT EXISTS`
8. Idempotent migrations: `ADD COLUMN IF NOT EXISTS` via `op.get_bind().execute(sa.text(...))`
9. Vite manualChunks: vendor only. App code → TDZ crash. Use `React.lazy()`
10. Leaflet: npm only, no CDN. Tiles need `*.tile.openstreetmap.org` in CSP img-src
11. Marketing site: edit `website/` ONLY. CI (`.github/workflows/deploy-website.yml`) auto-syncs `website/ → docs/` on push. Never edit `docs/` directly — it gets overwritten. `website/status.html` is excluded from sync.

## Paths
`backend/app/api/routes/`, `frontend/src/programs/` (FgAnalyzer, FgCleaner, FieldGovern), `frontend/src/dashboard/`, `tasks/` (todo.md, lessons.md)
Current DB: 0035. Repo: https://github.com/apranjipavan2-spec/DataCollectTool


## Auto-generated signatures
<!-- Updated by gen-context.js -->
# Code signatures

## website

### website\404.html
```
title: Page Not Found (404) — FieldGovern
```

### website\best-survey-app-india.html
```
title: Best Survey App in India (2026) — Honest Buyer's Guide | FieldGovern
```

### website\capi-software-india.html
```
title: Best CAPI Software for India (2026) — FieldGovern
```

### website\dpdp-compliant-survey-software.html
```
title: DPDP-Compliant Survey Software in India (2026) — FieldGovern
```

### website\features.html
```
title: Features (2026) — FieldGovern | Offline PWA, AI Form Builder, Back-Check, DPDP
nav#navbar
button#hamburgerBtn
div#mobileMenu
div#pgProgress
span#uploadPct
span#sheetCount
div#langQ
div#langHint
div#lo1
div#lo2
div#lo3
div#lo4
```

### website\googleforms-alternative.html
```
title: The Best Google Forms Alternative for Field Research in India (2026) — FieldGovern
```

### website\index.html
```
title: FieldGovern (2026) — India's Offline-First Survey App + AI Analysis | From ₹6,499/mo
nav#navbar
button#hamburgerBtn
div#mobileMenu
canvas#particleCanvas
div#mockBars
span#syncPct
div#syncBar
section#features
section#compare
div#scoreGrid
div#aiMsg
div#aiCards
section#pipeline
section#analytics
section#about
```

### website\integrations.html
```
title: Integrations — FieldGovern
nav#navbar
button#hamburgerBtn
div#mobileMenu
```

### website\magpi-alternative.html
```
title: The Best Magpi Alternative for India (2026) — FieldGovern
```

### website\offline-survey-app-india.html
```
title: Best Offline Survey App for India (2026) — FieldGovern
```

### website\pricing.html
```
title: Pricing (2026) — FieldGovern | From ₹6,499/mo · UPI Billing
nav#navbar
button#hamburgerBtn
div#mobileMenu
```

### website\qualtrics-alternative.html
```
title: The Best Qualtrics Alternative for India (2026) — FieldGovern
```

### website\security.html
```
title: Security — FieldGovern
nav#navbar
button#hamburgerBtn
div#mobileMenu
```

### website\sitemap.xml
```
root urlset
```

### website\survey-tool-for-ngos-india.html
```
title: Best Survey Tool for NGOs in India (2026) — FieldGovern
```

### website\surveycto-alternative.html
```
title: The Best SurveyCTO Alternative for India (2026) — FieldGovern
```

### website\surveymonkey-alternative.html
```
title: The Best SurveyMonkey Alternative for India (2026) — FieldGovern
```

### website\use-cases.html
```
title: Use Cases — FieldGovern
nav#navbar
button#hamburgerBtn
div#mobileMenu
```
