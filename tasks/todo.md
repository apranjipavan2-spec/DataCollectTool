# FieldGovern — Task Board

## ✅ Just shipped — TableForge Survey Analysis Studio (Phases 0 + 1)
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
- `IntegrationsPanel.tsx:114` has a pre-existing TS syntax error (unrelated to sprint work)
