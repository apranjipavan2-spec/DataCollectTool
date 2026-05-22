// Guide content for every TableForge statistical tool.
// Each entry: when to use (data types), step-by-step, outputs, pitfalls, example.

export interface GuideEntry {
  id: string;
  title: string;
  category: string;
  icon: string;
  useWhen: string;
  requires: string[];
  steps: string[];
  outputs: string[];
  pitfalls: string[];
  example: string;
}

export const GUIDE_CATEGORIES = [
  'Getting Started',
  'Survey Design',
  'Survey Analyses',
  'Descriptive',
  'Relationships',
  'Hypothesis Tests',
  'Paired / Pre-Post',
  'Non-parametric',
  'Models',
  'Distribution',
];

export const GUIDES: GuideEntry[] = [
  {
    id: 'overview',
    title: 'Welcome to the Survey Analysis Studio',
    category: 'Getting Started',
    icon: '🎯',
    useWhen: 'Start here to understand the workflow. Read once; you can skip future popups.',
    requires: ['A dataset uploaded (CSV/XLSX).'],
    steps: [
      '1. Upload your data — TableForge imports CSV, XLSX, TSV.',
      '2. Open Statistics tab → Survey Design → Variables. Tag each column with a role (outcome/treatment/demographic/...) and a scale (continuous/binary/likert/...).',
      '3. Open Study Design. Pick design type (cross-sectional, pre/post, panel, ...), name your treatment column + value, mark pre/post pairs, strata.',
      '4. Click "Run Full" — the auto-battery picks the right tests, runs them in one pass, applies FDR correction, and lets you promote each result to a project table.',
      '5. For specific questions, open the individual tools (t-test, ANOVA, paired t-test, etc.) — each has its own dialog.',
    ],
    outputs: [
      'A complete metadata profile of your dataset.',
      'A publication-ready Analysis Pack (descriptives + inferential + effect sizes + CIs + interpretation).',
      'Word/Excel/PDF/CSV exports of every result.',
    ],
    pitfalls: [
      'Skipping the Variables/Study Design step makes Run Full guess. Tagging takes 2 minutes and makes results deterministic.',
      'A statistically significant test is not the same as a practically meaningful one — always read the effect size (Cohen\'s d, η², Cramér\'s V) and CI.',
    ],
    example: 'A beneficiary-vs-control rural survey: tag "Beneficiary" as treatment, "income_pre/income_post" as paired outcomes, "satisfaction" as Likert outcome → Run Full produces 30+ tests with effect sizes in 5 seconds.',
  },

  // ── Survey Design ─────────────────────────────────────────────
  {
    id: 'variable_metadata',
    title: 'Variables — Column Roles',
    category: 'Survey Design',
    icon: '🏷️',
    useWhen: 'First step in every project. Tells TableForge what each column means so tests are picked correctly.',
    requires: ['A loaded dataset.'],
    steps: [
      '1. Click "Variables" in the Statistics tab.',
      '2. Click "Auto-detect" to prefill roles + scales (binary 2-value, likert 4–7 integers, paired columns with _pre/_post suffixes).',
      '3. Review each row. Fix any wrong guesses by picking from the role dropdown (outcome / treatment / demographic / geographic / observer_rated / weight / ...).',
      '4. Set scale: continuous (numeric), binary (Yes/No), likert (1–5 / 1–7), nominal (categories), multi_response (comma-separated answers).',
      '5. For Likert items, click "Value Labels" and type {1: "Strongly Disagree", ..., 5: "Strongly Agree"}.',
      '6. For pre/post pairs, set "paired_with" on each side.',
      '7. Click Save.',
    ],
    outputs: [
      'Column-role map saved server-side and persisted into your .tableforge project file.',
      'Auto-Analyze and Likert/MR/Observer panels can now read this metadata.',
    ],
    pitfalls: [
      'Don\'t leave Likert items tagged as "continuous" — Cronbach\'s α expects scale items.',
      'A column with values 0/1 is binary, even if stored as numeric — set scale = binary.',
    ],
    example: 'Tag "income_pre" as outcome/continuous, paired_with=income_post; "Beneficiary" as treatment/binary; "Satisfaction" as outcome/likert.',
  },
  {
    id: 'study_design',
    title: 'Study Design',
    category: 'Survey Design',
    icon: '🧭',
    useWhen: 'After tagging Variables. Defines the overall study structure so the auto-battery knows what comparisons make sense.',
    requires: ['Variables already tagged.'],
    steps: [
      '1. Click "Study Design".',
      '2. Pick design type: cross_sectional (one snapshot), pre_post (before vs after), quasi_experimental (treatment vs control, no random assignment), panel (3+ waves), rcs (repeated cross-sections).',
      '3. Set treatment_col (e.g., "Beneficiary") and treatment_value (e.g., "Yes") — what counts as treated.',
      '4. Optional: weight_col (survey weights), cluster_col (design-based SE), panel_id_col + panel_wave_col.',
      '5. Add pre/post pairs (auto-filled from Variables paired_with).',
      '6. Add strata (e.g., district, block) for stratified summaries.',
      '7. Save.',
    ],
    outputs: [
      'Study design saved to the project. Auto-Analyze reads this and chooses paired tests, weighted SEs, and proper grouping.',
    ],
    pitfalls: [
      'Design type matters: a pre/post analysis on cross-sectional data will mislead.',
      'If you don\'t set treatment_value, the auto-battery uses the first observed value (may be wrong).',
    ],
    example: 'design_type=pre_post; treatment_col=Beneficiary, treatment_value=Yes; pre_post_pairs=[{pre: income_pre, post: income_post}]; strata=[district].',
  },

  // ── Survey Analyses ─────────────────────────────────────────────
  {
    id: 'auto_analyze',
    title: 'Run Full — One-Click Analysis Battery',
    category: 'Survey Analyses',
    icon: '⚡',
    useWhen: 'You have outcomes + predictors tagged and want every relevant test run with effect sizes + multi-test correction in one pass.',
    requires: ['Variables tagged (at least outcomes).', 'Optional: Study Design for paired tests, weighting, strata.'],
    steps: [
      '1. Click "Run Full".',
      '2. Outcomes auto-populate from columns where role=outcome. Add/remove as needed.',
      '3. Predictors auto-populate from treatment + demographic columns. Adjust.',
      '4. Pick correction method: FDR-BH (recommended for many tests), Bonferroni (strict), Holm (sequentially rejective), or None.',
      '5. Click "Preview plan" to see what tests will run (without executing).',
      '6. Click "Run Full Analysis". Watch live progress bar.',
      '7. Browse results grouped by outcome. Expand any card to see table + interpretation.',
      '8. Click "Promote to Project" on results you want in your final deck.',
    ],
    outputs: [
      'Analysis Pack: 10–60 tests with effect sizes, CIs, plain-English interpretation, significance stars (after correction).',
      'Each result can be promoted to a TableForge table → exported to Word/Excel/PDF.',
    ],
    pitfalls: [
      'Wider predictor sets = more tests = more p-values to correct. Stay focused.',
      'FDR-BH controls the false discovery rate, not the family-wise error rate; if you want zero false positives, use Bonferroni.',
    ],
    example: 'Outcomes=[income_post, satisfaction], Predictors=[Beneficiary, district, age], correction=fdr_bh → 12 tests including paired t-test, Welch t-test, Mann-Whitney, chi-square, Kruskal-Wallis.',
  },
  {
    id: 'likert',
    title: 'Likert Analysis',
    category: 'Survey Analyses',
    icon: '📊',
    useWhen: 'You have Likert-scale items (1–5 or 1–7) and want top-2/bottom-2 box, net agree, composite scores, or scale reliability.',
    requires: ['≥1 column tagged with scale=likert.', 'For composite/reliability: ≥3 Likert items measuring the same construct.'],
    steps: [
      '1. Click "Likert".',
      '2. Mode: Summary — pick items, see N/Mean/SD, Top-2-Box %, Bottom-2-Box %, Net Agree %, stacked-bar data.',
      '3. Mode: Composite — pick items, choose method (mean / sum / IRT), optionally reverse-code items, name the composite. TableForge computes Cronbach\'s α and creates a new column.',
      '4. Mode: Compare — pick items + a group column. Runs Mann-Whitney / Kruskal-Wallis per item with multi-test correction.',
      '5. Mode: Factor — pick items, see factor loadings / scree-plot data (PCA fallback if factor_analyzer not installed).',
    ],
    outputs: [
      'Per-item descriptives, top/bottom-box %, net agree %, NPS-style score.',
      'Composite score column added to dataset + Cronbach\'s α + item-rest correlations.',
      'Group-comparison matrix with corrected p-values.',
    ],
    pitfalls: [
      'Treating Likert as continuous is fine for composites and t-tests on 5+ items, but fragile for single-item parametric tests — use Mann-Whitney / Kruskal-Wallis for single Likert items.',
      'Cronbach\'s α below 0.7 = your items don\'t hang together; consider dropping the item shown in "item-rest correlations".',
    ],
    example: '5 empowerment items (Q1–Q5) → Composite "Empowerment Index", α=0.83. Compare by Beneficiary group → Mann-Whitney finds Q3 + Q4 differ significantly.',
  },
  {
    id: 'multi_response',
    title: 'Multi-Response (MR) Sets',
    category: 'Survey Analyses',
    icon: '☑️',
    useWhen: 'Questions where respondents pick multiple options (e.g., "Which crops do you grow?" → Rice, Wheat, Sugarcane).',
    requires: ['Either a single column with comma-separated values (auto-detected), or a group of dummy columns sharing mr_set_id (set in Variables).'],
    steps: [
      '1. Click "Multi-Resp".',
      '2. Mode: Frequencies — % of respondents who chose each option (denominator = N respondents, not N responses). Shows ranking.',
      '3. Mode: Co-occurrence — pairs frequently chosen together, with Jaccard similarity heat-map data.',
      '4. Mode: By group — MR × group cross-tab with per-option χ² + FDR correction.',
      '5. Mode: Exclusive — % of respondents who chose option X only (no other options).',
    ],
    outputs: [
      'Frequency table with N, %, rank.',
      'Co-occurrence (Jaccard) matrix.',
      'Per-option χ² with corrected p-values when comparing by group.',
    ],
    pitfalls: [
      'Don\'t treat the column as a regular categorical — % won\'t sum to 100 because respondents can pick multiple.',
      'For dummy columns, set "truthy values" (default Yes/1/true) so the panel knows what counts as "chosen".',
    ],
    example: '"Which crops?" with answers like "Rice, Wheat" → 67% Rice, 41% Wheat, 22% Sugarcane. Rice+Wheat co-occur in 38% of respondents.',
  },
  {
    id: 'observer',
    title: 'Observer vs Respondent — Concordance',
    category: 'Survey Analyses',
    icon: '👁️',
    useWhen: 'You collected both self-report and observer-verified versions of the same field (e.g., self-reported income vs observed assets).',
    requires: ['Pairs of columns: one self-reported, one observer-rated.', 'Optional: set role=observer_rated + paired_with in Variables for auto-suggestion.'],
    steps: [
      '1. Click "Observer".',
      '2. Mode: Concordance — add pairs (self_col, observer_col). Pick kind: binary, ordinal, continuous.',
      '3. Run to get % agreement, Cohen\'s κ (binary/ordinal), weighted κ (Likert), McNemar (paired binary), Bland-Altman summary (continuous).',
      '4. Mode: Discrepancies — pick a single self/observer pair + ID columns. Returns rows where they disagree, ordered by magnitude.',
    ],
    outputs: [
      'Concordance matrix: % agreement, κ, p-value per pair.',
      'Discrepancy table for follow-up / data-cleaning.',
    ],
    pitfalls: [
      'κ < 0.4 = poor agreement (your data has a measurement problem).',
      '% agreement alone is misleading when categories are imbalanced — always read κ.',
    ],
    example: 'Self-reported "Has bank account?" vs observed account documents → 87% agreement, κ=0.62 (substantial). Discrepancies list 13 rows where self-report disagrees with documents.',
  },

  // ── Descriptive ─────────────────────────────────────────────
  {
    id: 'stat_descriptive',
    title: 'Descriptive Summary (Table 1)',
    category: 'Descriptive',
    icon: '📋',
    useWhen: 'Always — first thing to run on any numeric variable. Provides the "Table 1" of any report.',
    requires: ['≥1 numeric column.'],
    steps: ['1. Click "Summary".', '2. Pick numeric columns.', '3. Run.'],
    outputs: ['N, Mean, SD, Median, Min, Max, Q1, Q3, Missing count per column.'],
    pitfalls: ['Mean is misleading for skewed variables — also report median.', 'Always check Missing column for data-quality issues.'],
    example: 'Pick income_pre, income_post, age → N=200, mean income_pre=₹12,400 (SD=4,800), median=₹11,200.',
  },
  {
    id: 'stat_frequency',
    title: 'Frequency Distribution',
    category: 'Descriptive',
    icon: '📊',
    useWhen: 'For categorical or ordinal columns — counts and percentages of each value.',
    requires: ['≥1 column of any type.'],
    steps: ['1. Click "Frequency".', '2. Pick column(s).', '3. Run.'],
    outputs: ['Value, Count, % per column.'],
    pitfalls: ['For multi-response columns, use the MR panel instead (counts will be wrong here).'],
    example: 'Pick district → A: 67 (33.5%), B: 80 (40%), C: 53 (26.5%).',
  },

  // ── Relationships ─────────────────────────────────────────────
  {
    id: 'stat_correlation',
    title: 'Pearson Correlation Matrix',
    category: 'Relationships',
    icon: '📐',
    useWhen: 'Both variables are continuous + roughly normal + linear relationship.',
    requires: ['≥2 numeric columns.'],
    steps: ['1. Click "Correlation".', '2. Pick 2+ numeric columns.', '3. Run.'],
    outputs: ['Pairwise Pearson r matrix with heat-map shading.', '95% CIs (Fisher z).'],
    pitfalls: [
      'Pearson assumes linearity — use Spearman/Kendall for monotonic-but-not-linear data.',
      'Outliers can flip the sign — also run Outlier detection first.',
      'Correlation ≠ causation; r=0.6 still means 64% of variance is unexplained.',
    ],
    example: 'income_post vs age → r=0.18 (weak +), p=0.04, 95% CI [0.01, 0.34].',
  },
  {
    id: 'stat_regression',
    title: 'OLS Regression (single)',
    category: 'Relationships',
    icon: '📈',
    useWhen: 'You want to model how Y depends on one or more numeric Xs. For categorical predictors or multi-IV models, use Multi-Reg instead.',
    requires: ['First column = numeric Y. Rest = numeric X(s).'],
    steps: ['1. Click "Regression".', '2. Pick Y first, then X(s).', '3. Run.'],
    outputs: ['β coefficients, t, p, R², adjusted R², residual diagnostics.'],
    pitfalls: [
      'OLS assumes linearity, independence, homoscedasticity, normal residuals. Check Normality + Outlier first.',
      'For categorical Xs use Multi-Reg (auto one-hot encoding + VIF).',
    ],
    example: 'Y=income_post, X=age → β=85.4, R²=0.03 (age explains only 3% of income variance).',
  },

  // ── Hypothesis Tests ─────────────────────────────────────────────
  {
    id: 'stat_ttest',
    title: 't-Test (Welch) + Cohen\'s d',
    category: 'Hypothesis Tests',
    icon: '𝑡',
    useWhen: 'You want to compare the mean of a continuous variable between exactly 2 independent groups.',
    requires: ['1 grouping column with 2 categories.', '1 numeric outcome column.'],
    steps: [
      '1. Click "t-Test".',
      '2. Pick the grouping column first (e.g., Beneficiary).',
      '3. Pick the numeric outcome (e.g., income_post).',
      '4. Run — Welch\'s t-test by default (does not assume equal variance).',
    ],
    outputs: ['t, df (Welch-Satterthwaite), p, mean of each group, mean difference, 95% CI on difference, Cohen\'s d (effect size).'],
    pitfalls: [
      '>2 groups → use ANOVA / Kruskal-Wallis.',
      'Strong skew or small N → use Mann-Whitney (the panel will auto-suggest based on Shapiro normality).',
      'Cohen\'s d magnitudes: 0.2=small, 0.5=medium, 0.8=large.',
    ],
    example: 'Beneficiary vs Non → income_post: mean ₹14,300 vs ₹11,800, t=3.42, p=0.001, d=0.48 (medium).',
  },
  {
    id: 'stat_anova',
    title: 'One-Way ANOVA + η²/ω²',
    category: 'Hypothesis Tests',
    icon: 'F',
    useWhen: 'Comparing a continuous variable across 3+ independent groups.',
    requires: ['1 grouping column with 3+ categories.', '1 numeric outcome column.'],
    steps: ['1. Click "ANOVA".', '2. Pick the grouping column first.', '3. Pick the numeric outcome.', '4. Run.'],
    outputs: ['F, df1/df2, p, η² (variance explained), ω² (less biased), per-group means + 95% CI. If Levene\'s test fails, Welch\'s ANOVA is reported too.'],
    pitfalls: [
      'A significant ANOVA only says *some* group differs — run Post-hoc for which pair(s).',
      'η² ranges 0–1: 0.01=small, 0.06=medium, 0.14=large.',
      'For non-normal / heteroscedastic data, use Kruskal-Wallis instead.',
    ],
    example: 'income_post by district A/B/C → F=4.21, p=0.016, η²=0.04. Post-hoc shows B>A (p=0.012); B vs C ns.',
  },
  {
    id: 'stat_crosstab',
    title: 'Cross-Tab + χ² + Cramér\'s V',
    category: 'Hypothesis Tests',
    icon: 'χ²',
    useWhen: 'Both variables are categorical and you want to test if they\'re associated.',
    requires: ['2 categorical columns.'],
    steps: ['1. Click "Cross-tab".', '2. Pick 2 categorical columns.', '3. Run.'],
    outputs: ['Contingency table, χ², df, p, Cramér\'s V (effect size 0–1), Fisher\'s exact (for 2×2 small N), standardized residuals.'],
    pitfalls: [
      'χ² needs expected cell counts ≥5; the panel falls back to Fisher\'s exact for 2×2 with small cells.',
      'Cramér\'s V interpretation: 0.1=weak, 0.3=moderate, 0.5=strong association.',
      'Read standardized residuals to see *which* cells drive the χ² result.',
    ],
    example: 'Beneficiary × district → χ²=2.1, p=0.35, V=0.10 — no association (treatment evenly distributed).',
  },

  // ── Paired / Pre-Post ─────────────────────────────────────────────
  {
    id: 'stat_paired_ttest',
    title: 'Paired t-Test (Pre vs Post)',
    category: 'Paired / Pre-Post',
    icon: '↔',
    useWhen: 'Same respondents measured twice (before/after) on a continuous variable.',
    requires: ['Two numeric columns from the same respondents (e.g., income_pre, income_post).'],
    steps: ['1. Click "Paired t".', '2. Pick PRE first.', '3. Pick POST second.', '4. Run.'],
    outputs: ['t, df, p, mean difference, 95% CI on difference, Cohen\'s d_z (paired effect size).'],
    pitfalls: [
      'Order matters — PRE first.',
      'Strongly non-normal change scores → use Wilcoxon signed-rank.',
      'd_z is computed on change scores; it is NOT comparable to Cohen\'s d from independent t-test.',
    ],
    example: 'income_pre vs income_post → mean change +₹2,150, t=8.4, p<0.001, d_z=0.84 (large within-respondent effect).',
  },
  {
    id: 'stat_wilcoxon',
    title: 'Wilcoxon Signed-Rank (paired, non-parametric)',
    category: 'Paired / Pre-Post',
    icon: 'W',
    useWhen: 'Paired before/after data where change scores are skewed or contain outliers.',
    requires: ['Two numeric columns from the same respondents.'],
    steps: ['1. Click "Wilcoxon".', '2. Pick PRE first.', '3. Pick POST second.', '4. Run.'],
    outputs: ['W statistic, p-value, median change, rank-biserial r (effect size).'],
    pitfalls: ['Less powerful than paired t when the t-test\'s assumptions hold — use only when paired t-test is inappropriate.'],
    example: 'satisfaction_pre vs satisfaction_post (Likert 1–5) → W=820, p=0.003, r=0.42.',
  },
  {
    id: 'stat_mcnemar',
    title: 'McNemar\'s Test (paired binary)',
    category: 'Paired / Pre-Post',
    icon: '±',
    useWhen: 'Same respondents, binary outcome before vs after (Yes→No or No→Yes shifts).',
    requires: ['Two binary columns (Yes/No or 0/1) from the same respondents.'],
    steps: ['1. Click "McNemar".', '2. Pick PRE binary column.', '3. Pick POST binary column.', '4. Run.'],
    outputs: ['χ² (McNemar), p-value, discordant cell counts (No→Yes vs Yes→No).'],
    pitfalls: [
      'Concordant pairs (No→No, Yes→Yes) carry no information for this test — only discordant counts matter.',
      'For exact test with small discordant counts (<25), the panel uses exact binomial.',
    ],
    example: '"Has irrigation?" pre vs post → No→Yes: 38, Yes→No: 6 → p<0.001, net adoption +32 respondents.',
  },

  // ── Non-parametric ─────────────────────────────────────────────
  {
    id: 'stat_kruskal',
    title: 'Kruskal-Wallis (non-parametric ANOVA)',
    category: 'Non-parametric',
    icon: 'K',
    useWhen: '3+ groups, continuous outcome, but data is skewed, ordinal, or has outliers.',
    requires: ['1 grouping column with 3+ categories.', '1 numeric/ordinal outcome.'],
    steps: ['1. Click "Kruskal".', '2. Pick grouping column first.', '3. Pick outcome second.', '4. Run.'],
    outputs: ['H statistic, df, p-value, η²_H (effect size), per-group medians + IQR.'],
    pitfalls: [
      'Significant H only says *some* group differs — run pairwise Mann-Whitney with FDR correction for which.',
      'For Likert outcomes with 3+ groups, this is usually the right test.',
    ],
    example: 'satisfaction (Likert 1–5) by district A/B/C → H=8.4, p=0.015, η²_H=0.05.',
  },
  {
    id: 'stat_friedman',
    title: 'Friedman Test (repeated measures)',
    category: 'Non-parametric',
    icon: 'Fr',
    useWhen: 'Same respondents measured 3+ times on the same outcome — non-parametric repeated measures.',
    requires: ['3+ numeric/ordinal columns measuring the same construct at different timepoints.'],
    steps: ['1. Click "Friedman".', '2. Pick measures in time order.', '3. Run.'],
    outputs: ['χ²_F, df, p-value, Kendall\'s W (concordance/effect size).'],
    pitfalls: ['Rows with any missing measure are dropped — handle missing data first or expect a small N.'],
    example: 'wave1, wave2, wave3 satisfaction → χ²_F=12.1, p=0.002, W=0.18 — satisfaction changes across waves.',
  },
  {
    id: 'stat_spearman',
    title: 'Spearman Rank Correlation',
    category: 'Non-parametric',
    icon: 'ρ',
    useWhen: 'Two variables, monotonic but not linear, or one is ordinal (Likert).',
    requires: ['≥2 numeric/ordinal columns.'],
    steps: ['1. Click "Spearman".', '2. Pick columns.', '3. Run.'],
    outputs: ['Pairwise ρ matrix with p-values and 95% CIs.'],
    pitfalls: ['Use Spearman when Pearson assumes too much linearity. Use Kendall when ties are heavy.'],
    example: 'satisfaction (Likert) vs age → ρ=-0.21, p=0.02.',
  },
  {
    id: 'stat_kendall',
    title: 'Kendall\'s τ Correlation',
    category: 'Non-parametric',
    icon: 'τ',
    useWhen: 'Ordinal data with many tied ranks (e.g., Likert with small N).',
    requires: ['≥2 ordinal/numeric columns.'],
    steps: ['1. Click "Kendall".', '2. Pick columns.', '3. Run.'],
    outputs: ['Pairwise Kendall τ matrix with p-values.'],
    pitfalls: ['τ is generally smaller in magnitude than Spearman ρ — interpret cautiously across reports.'],
    example: 'satisfaction (1-5) vs trust (1-5) → τ=0.34, p<0.001.',
  },

  // ── Models ─────────────────────────────────────────────
  {
    id: 'stat_multiple_regression',
    title: 'Multiple Regression (OLS + VIF)',
    category: 'Models',
    icon: '📐',
    useWhen: 'You want to model a numeric outcome from multiple predictors, possibly with categorical predictors.',
    requires: ['First column = numeric Y. Rest = numeric or categorical X(s) (auto one-hot encoded).'],
    steps: [
      '1. Click "Multi-Reg".',
      '2. Pick Y first (numeric).',
      '3. Pick predictors (any mix of numeric + categorical).',
      '4. Run.',
    ],
    outputs: ['β coefficients with SE, t, p, 95% CI per predictor; R², adjusted R²; VIF per predictor (collinearity); residual diagnostics; influence (Cook\'s D).'],
    pitfalls: [
      'VIF > 5 = predictors are too correlated; consider dropping one or combining.',
      'High R² doesn\'t mean good predictions — check residual plots and Cook\'s D for influential outliers.',
      'Categorical predictors are auto-encoded as C(col) dummies; the first level is the reference.',
    ],
    example: 'income_post ~ Beneficiary + age + district → Beneficiary β=+2,150, p<0.001, 95% CI [+1,420, +2,880]; R²=0.22.',
  },
  {
    id: 'stat_logistic_regression',
    title: 'Logistic Regression (binary outcome)',
    category: 'Models',
    icon: 'OR',
    useWhen: 'Outcome is binary (Yes/No, 0/1) — you want to model probability + report odds ratios.',
    requires: ['First column = binary outcome. Rest = predictors (numeric + categorical OK).'],
    steps: [
      '1. Click "Logistic".',
      '2. Pick binary outcome first.',
      '3. Pick predictors.',
      '4. Run.',
    ],
    outputs: ['Odds ratios + 95% CI + Wald p-values per predictor; pseudo-R² (McFadden); Hosmer-Lemeshow goodness-of-fit.'],
    pitfalls: [
      'Outcome must be binary — if you have 3+ outcome categories, use multinomial logit (not yet supported).',
      'OR > 1 = predictor increases odds of "Yes"; OR < 1 = decreases.',
      'Pseudo-R² < 0.1 = weak model. McFadden 0.2–0.4 is good fit.',
    ],
    example: 'Has bank account ~ Beneficiary + income + literacy → Beneficiary OR=2.8 [1.6, 4.9], p<0.001.',
  },
  {
    id: 'stat_posthoc',
    title: 'Post-Hoc Pairwise (after ANOVA)',
    category: 'Models',
    icon: '⇄',
    useWhen: 'You ran ANOVA / Kruskal-Wallis and got significant p — now you need to know *which* pairs differ.',
    requires: ['1 grouping column with 3+ categories.', '1 numeric outcome.'],
    steps: ['1. Click "Post-hoc".', '2. Pick grouping column first.', '3. Pick outcome second.', '4. Run.'],
    outputs: ['Pairwise comparisons (default Tukey HSD), mean difference, p-adjusted, 95% CI. Bonferroni and Games-Howell available.'],
    pitfalls: [
      'Tukey HSD assumes equal variances — use Games-Howell when Levene fails (auto-suggested).',
      'Always run post-hoc AFTER a significant ANOVA, not instead of it.',
    ],
    example: 'income_post by district (post-ANOVA) → A vs B: p=0.012; A vs C: p=0.38; B vs C: p=0.04.',
  },
  {
    id: 'stat_reliability',
    title: 'Cronbach\'s α (scale reliability)',
    category: 'Models',
    icon: 'α',
    useWhen: 'You have a multi-item scale (3+ Likert items measuring the same construct) and want to test if items hang together.',
    requires: ['≥2 Likert/numeric scale items (ideally 3+).'],
    steps: ['1. Click "Reliability".', '2. Pick the items in the scale.', '3. Run.'],
    outputs: ['Cronbach\'s α (0–1), item-rest correlations, "α if item dropped" per item.'],
    pitfalls: [
      'α < 0.7 = scale has reliability issues.',
      '"α if item dropped" tells you which item is dragging α down — consider removing it.',
      'High α (>0.95) can also signal redundant items.',
    ],
    example: 'Empowerment items Q1–Q5 → α=0.83. Q3 has lowest item-rest (0.32); dropping Q3 raises α to 0.86.',
  },

  // ── Distribution ─────────────────────────────────────────────
  {
    id: 'stat_normality',
    title: 'Normality Tests',
    category: 'Distribution',
    icon: '📉',
    useWhen: 'Before running t-test / ANOVA / OLS, check whether your continuous variable is normally distributed.',
    requires: ['≥1 numeric column.'],
    steps: ['1. Click "Normality".', '2. Pick numeric columns.', '3. Run.'],
    outputs: ['Shapiro-Wilk W + p, Kolmogorov-Smirnov D + p, skewness, kurtosis per column.'],
    pitfalls: [
      'With N > 300, Shapiro-Wilk is over-sensitive — eyeball a histogram too.',
      'p > 0.05 = fail to reject normality (data could be normal). p < 0.05 = significantly non-normal.',
      'Mildly non-normal continuous variables (skewness < 1) are usually fine for t-test / ANOVA via CLT when N > 30.',
    ],
    example: 'income_pre → Shapiro W=0.94, p<0.001 (significantly right-skewed) → use Mann-Whitney instead of t-test.',
  },
  {
    id: 'stat_outlier',
    title: 'Outlier Detection',
    category: 'Distribution',
    icon: '⚠',
    useWhen: 'Before running any parametric test or correlation — outliers can flip results.',
    requires: ['≥1 numeric column.'],
    steps: ['1. Click "Outliers".', '2. Pick numeric columns.', '3. Run.'],
    outputs: ['Count of outliers per column by IQR rule (>1.5×IQR) and Z-score (|z|>3); list of flagged row indices.'],
    pitfalls: [
      'Don\'t auto-delete outliers — investigate. A "5x average income" row may be a real wealthy respondent, or a data-entry error.',
      'IQR rule is more robust than Z-score for skewed data.',
    ],
    example: 'income_post → 7 IQR outliers, 2 Z-score outliers (|z|>3). Inspect rows 14, 33, 89.',
  },
];

export const GUIDE_INDEX: Record<string, GuideEntry> = GUIDES.reduce((acc, g) => {
  acc[g.id] = g; return acc;
}, {} as Record<string, GuideEntry>);
