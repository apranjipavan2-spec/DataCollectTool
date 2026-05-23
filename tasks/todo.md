# FieldGovern — Task Board

## ✅ Just shipped — TableForge Phase 6 (Causal + Power + Codebook + AI Summary + Mixed-LM + Roster)

- **Causal** `routers/causal.py`: `/api/causal/did` (DiD OLS with `treatment:post` interaction), `/api/causal/psm` (logit-propensity + 1-NN matching + SMD balance), `/api/causal/mixed_lm` (random-intercept mixed-effects via `statsmodels.mixedlm`, optional random slope, returns ICC + fixed effects)
- **Power planner** `routers/power.py` (5 endpoints): `two_sample_t`, `paired_t`, `proportions`, `anova`, `curve` — each supports `solve_for: n|power|effect` via `statsmodels.stats.power`
- **Codebook** `routers/codebook.py`: `POST /api/export/codebook` → DOCX data dictionary (title page, dataset summary, study design block, per-variable directory with descriptives + value labels + frequencies)
- **AI exec summary** in `routers/auto_analyze.py`: `POST /api/analyze/exec-summary` — markdown one-pager (Headline / Key findings / Caveats / Next steps) with executive (250w) / general (400w) / technical (600w) audience presets, reuses `_call_llm` from `routers/ai.py`
- **Survey weights wired through inferential tests**: `stat_logistic_regression` → `glm(family=Binomial, freq_weights=…)`; `stat_multiple_regression` → `wls(weights=…)` when `StudyDesign.weight_col` is set
- **Household roster helpers** in `routers/metadata.py`: `POST /api/metadata/roster/to_wide` (long → wide pivot with `{col}_1`, `{col}_2`…), `POST /api/metadata/roster/to_long` (reverse), supports member-id collapse via mean/sum/median/etc.
- **Frontend wiring**: new `AdvancedAnalysisPanel.tsx` (6 modal forms: DiD, PSM, MixedLM, Power, Codebook, AI Summary); "Advanced Analysis" ribbon group in `RibbonBar.tsx` Statistics tab; `App.tsx` dispatches the 6 actions to `setAdvancedKind`; `AutoAnalyzePanel` now exposes `onPackReady` so the AI Summary form auto-fills the latest pack
- Route count: 146 → 158. TS clean.

## ✅ Just shipped — TableForge Phase 4 backend (Triangulation library)

- New router `routers/triangulate.py` (6 endpoints): `/api/benchmarks/list`, `/api/benchmarks/{id}`, `/api/benchmarks/meta/topics`, `/api/triangulate` (single value vs indicator), `/api/triangulate/auto` (pull value from dataset column + weights), `/api/triangulate/pack` (batch), `/api/benchmarks/contribute` (analyst extension via `user_extensions.json`)
- Seed library `tools/tableforge/benchmarks/india_2024.json` — 30 indicators across Census 2011, NFHS-5, NSSO 77, PLFS 2022-23, CGWB, NITI Aayog SDG, PMKSY-PDMC
- `tools/tableforge/benchmarks/sources.md` — citation manifest + indicator schema + curation rules
- Verified: backend boots with 146 routes (up from 144); library loads 30 indicators across 13 topics; one-sample z test on a proportion returns expected z = -3.68, p = 0.0002 on a 92%/95.9% smoke case
- Frontend `TriangulationPanel.tsx` deferred (user instruction)

## ✅ Earlier — TableForge Survey Analysis Studio (Phases 0 + 1 + 2 + 3)
Roadmap: `tasks/roadmap_survey_analysis_studio.md` · Plan: `~/.claude/plans/zany-spinning-wren.md`

**Phase 0 — Variable Metadata layer**
- `column_roles` + `study_designs` shared state, persisted via project file
- Router `routers/metadata.py` (7 endpoints): set/bulk_set/get/delete roles, study design save/get, heuristic auto-detect
- Frontend: `VariableMetadataPanel.tsx`, `StudyDesignWizard.tsx`, "Survey Design" ribbon group, role badges on SourcePanel

**Phase 1 — Inferential test backfill**
- New router `routers/inferential.py` (12 endpoints): paired_ttest, wilcoxon, mcnemar, kruskal, friedman, spearman, kendall, logistic_regression, multiple_regression, posthoc (tukey/bonferroni/games-howell), reliability (Cronbach's α), multitest_correction (Bonferroni/Holm/BH-FDR)
- New `routers/inferential_utils.py`: Cohen's d, Hedges' g, d_z, Cramér's V, η², ω², rank-biserial r, CIs, Cronbach's α, multitest correction
- Augmented `stats.py`: crosstab → Cramér's V + Fisher's exact + small-N warning; ttest → Welch by default + Cohen's d + Hedges' g + CI; anova → η² + ω² + Welch's F + Levene; correlation → method param (Pearson/Spearman/Kendall)
- Frontend: `StatisticalTables` extended (20 test types), `RibbonBar` Statistics tab gains Paired/Pre-Post, Non-parametric, Models ribbon groups
- Backend deps: added `statsmodels>=0.14`, `scipy>=1.11`
- Verified: backend boots with 105 routes (up from 93); frontend `tsc --noEmit` clean; 10 endpoints smoke-tested end-to-end

Next: Phase 2 (Likert / Multi-Response / Observer modules) — see roadmap.

## 🔴 Blocked / Needs external action
- [ ] Sentry DSN env vars (`SENTRY_DSN`, `VITE_SENTRY_DSN`) — see `planning/PENDING_MANUAL.md`
- [ ] Each org needs AI keys set via Org Settings → AI (master_admin assigns)

## 📋 Next sprint candidates (low priority)
- [ ] DHIS2 push integration
- [ ] ODK Central compatibility layer — import ODK XLS form, export ODK-compatible submissions

## 🌐 SEO / marketing site (zero-budget plan)
Full plan in `tasks/seo_actions.md`. Top 3 do-this-week tasks:
- [ ] GSC verification + sitemap submit + URL-inspect 21 URLs (30 min)
- [ ] GA4 setup → send me the Measurement ID (15 min)
- [ ] Product Hunt scheduled launch (Tue/Wed) (30 min)

Programmatic SEO shipped (commit `125f8e2`): 8 competitor comparisons · 5 long-tail landings · 21-URL sitemap · 404 · Product+Offer JSON-LD on pricing · lazy-loaded images · CTR-optimised titles.

## Review notes
- FG Analyzer/Cleaner/Writer use program-picker (not URL params); program selection synced via localStorage
- FG Writer reads saved tabulations from FG Analyzer via `fgStorage.ts` (no extra API)
- All FG backend endpoints filter by `tenant_id` on every query
- CORS: `allow_origins=settings.cors_origins` (env: `CORS_ORIGINS`)
- RLS: `set_tenant_context()` called in `deps.py` on every authenticated request
- `IntegrationsPanel.tsx`: pre-existing `allow_enumerator_edit` missing on `ProgramListItem` — fixed by adding the optional field to `frontend/src/types/api.ts:54`
