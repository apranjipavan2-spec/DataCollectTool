# Roadmap: TableForge → Survey Analysis Studio

> Companion to the plan at `C:\Users\apran\.claude\plans\zany-spinning-wren.md`. This file is the repo-checked-in working version. Keep them in sync.

## Why this exists

A Ganga Kalyana evaluation was produced on TableForge. Three independent reviewers (statistician, methodologist, professor) returned the same critique: the report shows patterns but does not prove them — no inferential tests, no effect sizes, no triangulation, no qualitative integration, no observer-vs-respondent cross-verification.

**Target:** Turn TableForge into a backend-driven survey analysis service. The user maps columns to roles once, picks outcomes, clicks **Run Full Analysis**, gets a publication-ready pack of tables + tests + effect sizes + benchmarks + observer reconciliations + qualitative themes.

Scope: TableForge (`tools/tableforge/`). FgAnalyzer (embedded in FieldGovern) mirrors endpoints in a later sprint.

---

## Three architectural concepts that thread through every phase

1. **Column roles** — per-column metadata beyond `type`: `role` (treatment/outcome/demographic/observer_rated/qualitative/weight), `scale` (nominal/ordinal/likert/binary/multi_response/etc), `value_labels`, `units`, `paired_with`, `mr_set_id`, `benchmark_link`.
2. **Study Design** — per-project: `design_type` (cross-sectional / pre-post / quasi-experimental / panel), `treatment_col`, `weight_col`, `cluster_col`, `panel_id_col`, `pre_post_pairs`, `strata`.
3. **Analysis Pack** — output of the auto-battery: list of `AnalysisResult` objects, each promotable to a TableForge `tables[]` entry.

Column roles + study design = enough metadata for the backend to pick the right tests autonomously.

---

## Phases

### Phase 0 — Variable Metadata layer (foundation)
**Backend:** `routers/metadata.py` (new). Extend `shared.py` with `column_roles` and `study_designs` dicts. Persist into `.tableforge` file via existing `projects.py` config blob.

Endpoints:
- `POST /api/metadata/column/set` — write/update a `ColumnRole`
- `GET /api/metadata/column/{dataset_id}`
- `POST /api/metadata/study_design/save`
- `GET /api/metadata/study_design/{dataset_id}`
- `POST /api/metadata/auto_detect_roles` — heuristic prefill (binary, likert, paired pairs by name, mr sets by prefix, geographic by name)

**Frontend:** `VariableMetadataPanel.tsx` (per-column editor), `StudyDesignWizard.tsx` (4-step). Role badges in `SourcePanel.tsx`. Ribbon buttons in `RibbonBar.tsx`.

### Phase 1 — Inferential test backfill
**Backend:** `routers/inferential.py` (new) + augment existing `stats.py`. Adds:
- `paired_ttest`, `wilcoxon`, `mcnemar`, `kruskal`, `friedman`
- `spearman`, `kendall` (extend correlation endpoint)
- `logistic_regression`, `multiple_regression` (with C() dummy coding, VIF)
- `posthoc` (Tukey HSD, Bonferroni, Games-Howell)
- `reliability` (Cronbach's α + item-total correlations)
- `multitest_correction` (Bonferroni / BH-FDR / Holm)

Augment existing: Cramér's V on crosstab, Cohen's d + Hedges' g + CI on ttest, η² + ω² on ANOVA, VIF + residual diagnostics on regression.

**Dep:** add `statsmodels>=0.14`.

**Frontend:** extend `StatisticalTables.tsx` StatType union + maps; add Inferential ribbon sub-tab.

### Phase 2 — Survey-specific modules
- **2A Likert** (`routers/likert.py` + `LikertPanel.tsx`): summary (top-2-box, NPS), composite builder, compare-across-groups, EFA.
- **2B Multi-Response** (`routers/multi_response.py` + `MultiResponsePanel.tsx`): frequencies, co-occurrence (Jaccard), MR × group, exclusive-choice.
- **2C Observer-vs-Respondent** (`routers/observer.py` + `ObserverPanel.tsx`): concordance (κ, weighted κ, McNemar, Bland-Altman), discrepancy report.

### Phase 3 — Auto-Analyze wizard ("one-click")
**Backend:** `routers/auto_analyze.py` + `routers/test_chooser.py` (pure function — unit-testable). SSE-streaming `POST /api/analyze/auto-battery`. Decision matrix maps (outcome scale × predictor scale × design) → test.

**Frontend:** `AutoAnalyzePanel.tsx` + `AnalysisPackView.tsx`. Progress modal mirrors `ai.py` auto-generate. "Promote to project" pushes pack tables into main `tables[]`.

### Phase 4 — Triangulation & benchmarks
**Backend (shipped):** `routers/triangulate.py` + `benchmarks/india_2024.json` (seed: Census 2011, NFHS-5, NSSO 77, CGWB, PLFS, NITI Aayog).

**Frontend:** _Skipped — TriangulationPanel.tsx deferred._

### Phase 5 — Qualitative coding
_Skipped per maintainer call — open-ended row-level coding already lives in `verbatim.py`/`VerbatimPanel.tsx`. The richer hierarchical-codes workbench (`QualitativePanel.tsx`, `CodeTree.tsx`, `QuoteEditor.tsx`) is not on the build list._

### Phase 6 — Platform polish
DiD, propensity score matching, survey-weighted SEs, power & sample-size planner, codebook PDF export, mixed-effects (village random effects), household roster handling, AI-narrated executive summary.

---

## Sprint mapping

| Sprint | Duration | Contents | Why |
|--------|----------|----------|-----|
| 1 | 2 wks | Phase 0 + Phase 1 (+ augmentations) | Largest *correctness* lift |
| 2 | 2 wks | Phase 2 + Phase 3 | Largest *workflow* lift |
| 3 | 2 wks | Phase 4 + Phase 5 | Differentiators that make it a survey-research platform |
| 4 | 1 wk | Phase 6 cherry-picks (DiD, PSM, weighted SEs, codebook) | Impact-eval upgrade |

---

## Cross-cutting

- **Deps:** `statsmodels>=0.14` (Phase 1), `factor_analyzer>=0.5` (Phase 2, optional).
- **Tests:** `backend/tests/` pytest, seeded fixture CSV with known properties (one sig χ², one paired d=0.5, etc.). `test_chooser.py` gets a table-driven test.
- **Performance:** Auto-battery sequential by default (SSE shows progress); parallelize if >30s wall. Logistic/EFA expose `max_rows=50000` downsample.
- **Project file:** nest new state into existing `config` blob in `projects.py:save_project` — no migration; old projects open with empty maps.
- **Audit:** every endpoint calls `shared.add_audit_log()`.
- **Marketing:** after Phase 3 ships, update `website/features.html` Analyzer section. CLAUDE.md rule 11: edit `website/` only, CI syncs to `docs/`.

---

## Verification gates per sprint

Use `tools/tableforge/test_data.xlsx` (extend with known pre/post pair, MR column, Likert block, observer-paired column).

- **Sprint 1:** open Variable Metadata → roles auto-detected → set study design → run paired t-test → Cohen's d_z + CI present, p matches scipy shell.
- **Sprint 2:** Likert composite with Cronbach α → MR frequency table → Observer discrepancy list → Auto-Analyze SSE runs → Pack shows 30+ tests → Promote → Word export.
- **Sprint 3:** Triangulation attaches Census benchmark → Qualitative tags 3 quotes → Word export embeds quotes as footnotes.
- **Sprint 4:** DiD ATE returned for pre/post × treatment → survey-weighted t-test SE differs from unweighted.

Type/build: `cd frontend && npx tsc --noEmit && npm run build`, `cd backend && python -c "from backend.main import app"`.

---

## Open questions for implementation time

- Per-test result caching keyed by `(dataset_id, test_id, params_hash)`. Recommended: yes, in `shared.analysis_cache`, invalidated on dataset modification.
- Benchmark library maintenance — seed JSON + `POST /api/benchmarks/contribute` for analyst additions.
- Multi-tenant in-memory state: `shared.datasets[]` is process-global. Out of scope here; flag for FgAnalyzer mirror sprint when multi-tenant matters.
