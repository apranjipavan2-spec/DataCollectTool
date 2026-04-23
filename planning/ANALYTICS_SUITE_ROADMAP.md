# Analytics Suite Roadmap
<!-- Data Cleaning · Tabulation · Charting · Report Writing -->
<!-- Updated: 2026-04-23 -->

---

## Current State

| Tool | Status | Location |
|------|--------|----------|
| Data Cleaning Tool | ✅ Built (separate) | External tool — needs integration |
| Tabulation Tool | ✅ Built (separate) | External tool — needs charting + integration |
| Charting Tool | ⬜ Not built | To be built inside Tabulation Tool |
| Report Writing Tool | ⬜ Not built | To be built in FieldGovern (uses existing AI) |

---

## Architecture Vision

```
FieldGovern Submissions (raw data)
         │
         ▼
  [1] Data Cleaning Tool ──────────────────── (already built, separate)
         │ cleaned dataset
         ▼
  [2] Tabulation Tool + Charting ─────────── (already built + charting to add)
         │ tables + charts
         ▼
  [3] Report Writing Tool ─────────────────── (to build in FieldGovern)
         │ formatted report (Word / PDF)
         ▼
  Supervisor / Admin downloads & shares
```

---

## Phase 1 — Integration: Connect Existing Tools to FieldGovern

**Goal:** Pull FieldGovern submission data directly into your existing Data Cleaning and Tabulation tools — no manual CSV export/import.

### What to build (FieldGovern side)
- `GET /export/submissions/{form_id}/json` — returns cleaned flat JSON array of all submissions (supervisor+)
- `GET /api-docs` — document the existing CSV and future JSON endpoints for your tools to consume
- API key auth already exists — your external tools authenticate with an org API key

### What to do (your tools side)
- Add a "Connect FieldGovern" option: enter API base URL + API key
- Pull data via `GET /export/submissions/{form_id}/json`
- Treat it as the source dataset

**Effort:** Low (1–2 days). No structural changes to either tool.

---

## Phase 2 — Charting Tool (integrate into Tabulation Tool)

**Goal:** Add chart generation inside the Tabulation Tool, with export for use in reports.

### Chart types needed
| Chart | Use case |
|-------|----------|
| Bar chart (grouped + stacked) | Category comparisons, cross-tabs |
| Pie / Donut | Proportion of responses |
| Line chart | Trends over time / progress |
| Histogram | Distribution of numeric fields |
| Choropleth map | District/Taluka-level data (uses location hierarchy) |
| Heatmap table | Cross-tab with colour intensity |

### Implementation approach
- Use **Recharts** (React) or **Chart.js** inside your Tabulation Tool (whichever stack it's built on)
- Each tabulation output → "Generate Chart" button → chart panel appears
- Export options: PNG, SVG, copy-to-clipboard (for pasting into reports)
- Store chart config alongside the tabulation so it's reproducible

### Integration with FieldGovern
- Charts can be embedded in the Report Writing Tool (Phase 3)
- Supervisor in FieldGovern dashboard → "Open in Tabulation" button → passes form_id + API key → tabulation tool opens pre-loaded

**Effort:** Medium (3–5 days in your tabulation tool).

---

## Phase 3 — Report Writing Tool (build in FieldGovern)

**Goal:** Generate publication-ready reports in multiple styles directly from submission data + tabulation output + charts. Uses the multi-LLM AI already integrated.

### Report styles

| Style | Audience | Sections |
|-------|----------|----------|
| **Progress Report** | Donor / org management | Summary, target vs achieved, enumerator performance, issues |
| **Field Survey Report** | Internal / research team | Methodology, sample description, key findings, data quality |
| **Medical / Clinical** | ICMR, health departments | CONSORT/STROBE-style: background, methods, results, discussion |
| **Research Paper** | Academic publication | Abstract, intro, methods, results, conclusion, references |
| **Government / Administrative** | State departments, NITI Aayog | Executive summary, objectives, findings, recommendations |
| **NGO / Donor Report** | Funders, CSR teams | Impact summary, stories, indicators, financial context |

### How it works
1. Supervisor selects a form → "Generate Report"
2. Chooses report style
3. Optionally pastes tabulation output (CSV/JSON) and uploads charts (PNG)
4. AI generates structured report in chosen style
5. User edits in-browser (rich text editor)
6. Downloads as Word (.docx) or PDF

### AI prompt structure (already built for `generate_report`, needs extending)
```
You are writing a [STYLE] report for [AUDIENCE].
Form: [form_title]. Study period: [date range]. Sample: [N respondents].
Fields collected: [field_labels].
Key data: [tabulation_data].
Charts attached: [chart_descriptions].

Write a complete [STYLE] report with these sections: [section_list].
Use formal/technical language appropriate for [audience].
```

### What to build in FieldGovern

#### Backend
- Extend `POST /ai/report/{form_id}` to accept:
  - `style`: progress | field_survey | medical | research | government | ngo
  - `tabulation_data`: optional JSON/CSV from tabulation tool
  - `chart_descriptions`: optional text descriptions of charts
  - `date_from`, `date_to`: filter submissions
  - `custom_sections`: org can add/remove sections
- `POST /reports/save` — save a generated report (title, style, content_md, form_id)
- `GET /reports/?form_id=` — list saved reports
- `GET /reports/{id}/export/docx` — download as Word using `python-docx`
- `GET /reports/{id}/export/pdf` — download as PDF using `weasyprint` or `reportlab`

#### Frontend
- `frontend/src/reports/ReportStudio.tsx` — full-page report editor:
  - Step 1: Pick form + date range + report style
  - Step 2: Paste tabulation data (optional) + upload charts (optional)
  - Step 3: AI generates report → shows in rich text editor (use `@uiw/react-md-editor` or `quill`)
  - Step 4: Edit, add org logo/letterhead, download Word/PDF
- Accessible from: Dashboard → Reports tab (supervisor+)
- `frontend/src/reports/ReportTemplates.tsx` — saved reports list, re-open/re-generate

#### Report letterhead / branding
- Use tenant branding (logo already in tenant settings)
- Word export: inject logo at top, org name, report date, FieldGovern watermark (optional)

---

## Phase 4 — Admin / Supervisor Integration in FieldGovern

### Dashboard additions (supervisor)
| Feature | Location | What it shows |
|---------|----------|---------------|
| Reports tab | Dashboard | List of generated reports, create new |
| Analytics tab | Dashboard | Quick charts: submissions per day, enumerator performance, completion % |
| Data Quality tab | Dashboard | Violations, duplicates, back-check queue |
| Open in Tabulation | Per form | Button that opens external tabulation tool with data pre-loaded |

### Org Admin additions
| Feature | Location |
|---------|----------|
| Report Templates | Org Settings → Reports — custom section templates per style |
| Branding for reports | Org Settings → Branding — logo used in exported reports |
| AI config | Org Settings → AI — already built (provider + key) |

---

## Phase 5 — Data Cleaning Integration (future)

Once the Data Cleaning Tool has an API or embeddable UI:
- Add "Clean Data" step between export and tabulation
- Rules: flag outliers, impute missing values, standardize text (capitalisation, spelling)
- Write cleaned dataset back to FieldGovern as a "cleaned snapshot" alongside raw submissions
- Audit log of what was changed and by whom

---

## Build Order (recommended)

| # | Task | Effort | Dependency |
|---|------|--------|------------|
| 1 | JSON export endpoint in FieldGovern | 0.5 day | None |
| 2 | Charting in Tabulation Tool | 3–5 days | Your tabulation codebase |
| 3 | Report Writing Tool — backend (style prompts + save + docx export) | 3 days | AI already wired |
| 4 | Report Studio UI (frontend) | 3 days | Backend above |
| 5 | Dashboard: Reports tab + Analytics charts | 2 days | Report backend |
| 6 | Data Cleaning API integration | 2 days | Your cleaning tool |

**Total: ~2–3 weeks for full suite.**

---

## Tech choices

| Need | Library | Why |
|------|---------|-----|
| Charts (frontend) | Recharts | React-native, no D3 complexity |
| Word export | python-docx | Pure Python, no LibreOffice dependency |
| PDF export | weasyprint | HTML→PDF, supports CSS styling |
| Rich text editor | @uiw/react-md-editor | Markdown, lightweight, export-friendly |
| Maps | react-leaflet (already used) | Choropleth with GeoJSON India districts |

---

## What you need to share with me to proceed

1. **Tabulation Tool stack** — React? Vue? Plain JS? So I can advise on charting library
2. **Data Cleaning Tool** — Does it have an API? Or is it a standalone desktop/web app?
3. **Report priority** — Which style first? (Progress report is fastest/highest value for field orgs)
4. **Word template** — Do you have a letterhead / branded Word template to match?
