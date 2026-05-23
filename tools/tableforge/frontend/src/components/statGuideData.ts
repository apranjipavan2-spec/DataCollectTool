// Guide content. Each bullet = short primary line, with (parenthetical detail) for deeper reading.
// Examples use GENERIC placeholders (Y, X, Group, Outcome) — never project-specific column names.

export interface GuideEntry {
  id: string;
  title: string;
  category: string;
  icon: string;
  useWhen: string;
  /** The distinguishing assumptions / conditions that make this test the right pick. Different from `requires` (data shape) — these are the *criteria* (e.g. independence, normality, 2 groups vs 3+). */
  criteria?: string[];
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
    title: 'Welcome',
    category: 'Getting Started',
    icon: '🎯',
    useWhen: 'Read once to understand the flow. (You can tick "don\'t show again" at the bottom — every popup has it.)',
    criteria: [
      'You have a dataset and want guided analysis. (No criteria — this is the entry tutorial.)',
    ],
    requires: [
      'A loaded dataset. (Upload CSV / XLSX / TSV from the File ribbon.)',
    ],
    steps: [
      'Tag your columns. (Statistics tab → Variables. Sets role + scale per column.)',
      'Describe your study. (Statistics tab → Study Design. Pre/post, treatment column, strata.)',
      'Click Run Full. (Auto-battery picks the right tests, applies multi-test correction, returns a ready Analysis Pack.)',
      'Or pick individual tools for one-off questions. (t-Test, ANOVA, Cross-tab, etc. — guide pops on first click.)',
    ],
    outputs: [
      'Analysis Pack. (Descriptives + inferential tests + effect sizes + CIs + plain-English interpretation.)',
      'Word / Excel / PDF / CSV exports. (One click; tables and formats are preserved.)',
    ],
    pitfalls: [
      'Significance ≠ importance. (Always read the effect size — Cohen\'s d / η² / Cramér\'s V — and the confidence interval.)',
      'Skipping the metadata step makes Run Full guess. (A few minutes of tagging saves a lot of re-runs.)',
    ],
    example: 'Tag outcomes + treatment → Run Full → many tests with effect sizes returned in seconds.',
  },

  // ── Survey Design ─────────────────────────────────────────────
  {
    id: 'variable_metadata',
    title: 'Variables (Column Roles)',
    category: 'Survey Design',
    icon: '🏷️',
    useWhen: 'First thing to do on every project. (Without roles, the auto-battery falls back to type-based guesses.)',
    criteria: [
      'You want auto-battery and Likert/Observer panels to pre-fill correctly. (Tagging once = correct tests later.)',
      'Likert items, paired pre/post columns, or multi-response sets exist. (These need explicit tagging — auto-detect only suggests.)',
    ],
    requires: [
      'A loaded dataset. (Visible in the Source panel on the left.)',
    ],
    steps: [
      'Click Auto-detect. (Heuristics: 2-value numeric → binary; 4–7 integer values → likert; _pre/_post suffixes → paired pair.)',
      'Set Role per column. (outcome / treatment / demographic / geographic / observer_rated / weight / panel_wave / id.)',
      'Set Scale per column. (continuous / binary / likert / nominal / ordinal / count / multi_response.)',
      'Add value labels for Likert. (e.g. {1: "Strongly Disagree", 5: "Strongly Agree"} — improves chart labels and reports.)',
      'Set paired_with for any pre/post columns. (Each pre column points to its matching post column, and vice-versa.)',
      'Click Save.',
    ],
    outputs: [
      'A role+scale map per column. (Stored server-side and saved into your .tableforge project file.)',
      'Smarter defaults in every other panel. (Likert / Run Full / Observer pre-fill from these tags.)',
    ],
    pitfalls: [
      'Likert tagged as continuous. (Cronbach α and the auto-battery want scale=likert — they treat it differently.)',
      'Binary numeric (0/1) tagged as continuous. (Set scale=binary so t-test vs χ² is chosen correctly.)',
    ],
    example: 'Pre column → outcome / continuous / paired_with=post column. Treatment indicator → treatment / binary.',
  },
  {
    id: 'study_design',
    title: 'Study Design',
    category: 'Survey Design',
    icon: '🧭',
    useWhen: 'After Variables. Defines the study\'s overall shape so tests are picked correctly.',
    criteria: [
      'You know the study type. (cross-sectional, pre/post, quasi-experimental, panel, repeated cross-sections.)',
      'A treatment/group variable exists. (Required for inferential comparisons in the auto-battery.)',
      'Optional: survey weights / clusters / panel ID. (Needed only if you want design-based SEs or paired tests across waves.)',
    ],
    requires: [
      'Variables tagged. (Otherwise the wizard can\'t pre-fill outcomes and treatment.)',
    ],
    steps: [
      'Pick design type. (cross_sectional = one snapshot; pre_post = before/after same respondents; quasi_experimental = treatment vs control without randomisation; panel = 3+ waves; rcs = repeated cross-sections.)',
      'Set treatment column + value. (Tells the engine who is "treated" — e.g. the value that marks beneficiaries / intervention recipients.)',
      'Optional: weight / cluster / panel-ID columns. (Weight enables design-based SE; cluster enables clustered SE; panel-ID enables paired tests across waves.)',
      'Confirm pre/post pairs. (Auto-filled from Variables; edit if needed.)',
      'Add strata for subgroup reports. (Any geographic / demographic split — TableForge will report by stratum.)',
      'Save.',
    ],
    outputs: [
      'A study profile saved in the project. (Run Full reads it; survey-weighted SEs and paired tests rely on it.)',
    ],
    pitfalls: [
      'Wrong design type. (A pre/post analysis on cross-sectional data treats different respondents as the same — biases everything.)',
      'Missing treatment_value. (Engine uses the first observed value as the treated category — may not be what you want.)',
    ],
    example: 'pre_post design; treatment column = "Group", value = "Treated"; pairs from Variables; strata = a geographic column.',
  },

  // ── Survey Analyses ─────────────────────────────────────────────
  {
    id: 'auto_analyze',
    title: 'Run Full Analysis',
    category: 'Survey Analyses',
    icon: '⚡',
    useWhen: 'You want every relevant test run with effect sizes and corrected p-values in one pass.',
    criteria: [
      'Outcomes are tagged. (role=outcome — drives which columns to analyse.)',
      'Predictors are identifiable. (role=treatment + role=demographic; can be edited before running.)',
      'You want multi-test correction. (FDR-BH, Bonferroni, or Holm — pick one before running.)',
    ],
    requires: [
      'At least one column with role=outcome. (Otherwise nothing to analyse.)',
      'Optional: Study Design saved. (Enables paired tests, weighted SEs, and stratified breakdowns.)',
    ],
    steps: [
      'Outcomes auto-fill from role=outcome columns. (Tick / untick to adjust.)',
      'Predictors auto-fill from role=treatment + role=demographic. (Add geographic, age bands, etc., as needed.)',
      'Pick correction method. (FDR-BH = recommended for many tests; Bonferroni = strictest; Holm = sequential; None = raw p only.)',
      'Click Preview plan to see the test list first. (No execution — useful sanity check.)',
      'Click Run Full Analysis. (Live progress bar; cancel anytime.)',
      'Promote results to project tables. (Each result has a button — lands in your tables list, exportable to Word.)',
    ],
    outputs: [
      'Analysis Pack: many tests with effect sizes + CIs. (Grouped by outcome; expandable cards show table + interpretation.)',
      'Significance stars after correction. (* = p_adj < 0.05, ** < 0.01, *** < 0.001.)',
    ],
    pitfalls: [
      'Too many predictors → too many tests. (More tests means more p-values to correct, which weakens power. Stay focused.)',
      'FDR ≠ FWER. (FDR-BH controls the *rate* of false discoveries; Bonferroni controls the *probability* of any false discovery. Pick by use case.)',
    ],
    example: 'A few outcomes × a few predictors + FDR-BH correction → a complete pack of tests with effect sizes in seconds.',
  },
  {
    id: 'likert',
    title: 'Likert Analysis',
    category: 'Survey Analyses',
    icon: '📊',
    useWhen: 'You have rating-scale items (1–5 or 1–7) and want box scores, composites, or scale reliability.',
    criteria: [
      'Items are ordinal rating scales. (Typically 5- or 7-point; tag as scale=likert in Variables.)',
      'For composites/α: 3+ items measure the *same* construct. (Mixing constructs makes α meaningless.)',
      'Direction is consistent across items. (Reverse-code opposite-direction items before composite/α.)',
    ],
    requires: [
      'At least one column with scale=likert. (Tag in Variables panel first.)',
      'For composites / reliability: 3+ items measuring the same idea. (Cronbach α below this is meaningless.)',
    ],
    steps: [
      'Summary mode. (N, Mean, SD, Top-2-Box %, Bottom-2-Box %, Net Agree % per item; ready-to-render stacked-bar data.)',
      'Composite mode. (Pick items, choose mean / sum / IRT, reverse-code items measured in the opposite direction; produces a new column + Cronbach α.)',
      'Compare mode. (Pick items + a group column → Mann-Whitney / Kruskal-Wallis per item with FDR correction.)',
      'Factor mode. (Loadings matrix + scree data; uses PCA fallback if the factor_analyzer library isn\'t installed.)',
    ],
    outputs: [
      'Per-item descriptives + box scores + net agree.',
      'Composite column with α and item-rest correlations. (Tells you which items are weak — see "α if item dropped".)',
      'Group-comparison matrix with corrected p-values.',
    ],
    pitfalls: [
      'Treating a single Likert item as continuous. (Fine for composites of 5+ items; risky for single-item parametric tests — prefer Mann-Whitney.)',
      'α below 0.7. (Items don\'t hang together; the scale isn\'t measuring one construct.)',
      'α above 0.95. (Items may be redundant — consider trimming.)',
    ],
    example: 'A block of scale items → composite index with α ≈ 0.8. Compare by group → one or two items differ significantly.',
  },
  {
    id: 'multi_response',
    title: 'Multi-Response Sets',
    category: 'Survey Analyses',
    icon: '☑️',
    useWhen: '"Select all that apply" questions. (Respondents can pick more than one option per question.)',
    criteria: [
      'A respondent can pick >1 option per question. (If only one option per row → use Frequency Distribution instead.)',
      'Data is in MR shape. (Comma-separated values in one column, *or* a group of dummy columns sharing mr_set_id.)',
      'For "By group": you also have a grouping column. (To compare MR option uptake across groups.)',
    ],
    requires: [
      'Either: one column of comma-separated values. (Auto-detected when commas appear in >10% of values.)',
      'Or: a group of dummy columns sharing mr_set_id. (Set in Variables panel; one 0/1 column per option.)',
    ],
    steps: [
      '— Core analyses (in panel) —',
      '1. Response counts / Frequencies. (% of respondents who chose each option — denominator is N respondents, not N responses. SPSS calls this "Percent of Cases". %s do NOT sum to 100%.)',
      '2. Co-occurrence (Jaccard pairs). (Pairs of options chosen together; J = |A∩B| / |A∪B|. Heat-map data showing which options cluster.)',
      '3. By group (option × group). (MR option × demographic group cross-tab; per-option χ² with FDR multi-test correction across options. Shows which options differ by segment.)',
      '4. Exclusive (only-X segments). (% of respondents who picked option X and nothing else — useful for "single-product loyalists" / "single-reason" segments.)',
      '— Additional canonical MR analyses (taxonomy) —',
      '5. Percent of responses. (Same counts, different denominator: total responses across all rows. Sums to 100%. SPSS calls this "Percent of Responses". Use when total mentions matter; case % when respondent reach matters.)',
      '6. Choice-count distribution. (Histogram of how many options each respondent picked: 1, 2, 3, 4+. Reveals "single-pickers" vs "many-pickers" — affects how you read frequencies.)',
      '7. Pairwise lift / conditional probability. (Beyond Jaccard: lift = P(B|A) / P(B). >1 = picking A makes B more likely than chance. Surfaces "if X then likely Y" patterns hidden by raw co-occurrence.)',
      '8. NET aggregation. (Group several options into super-categories: e.g., "any economic reason" = wages + cost + employment. Build a custom column in Variables panel, then run Frequency Distribution on the NET column.)',
      '9. Driver analysis (MR × continuous outcome). (Mean of an outcome variable among respondents who chose option X vs. who did not, for every option. Plus point-biserial r per option. Identifies which options predict satisfaction/income/yield.)',
      '10. Pairwise group z-tests. (Z-test on proportions between two groups for each option, banner-table style. By-group already does omnibus χ²; this drills into "which two groups differ" with sig markers a/b/c.)',
      '11. Overlap between two MR sets. (When you have TWO MR questions, e.g., brands aware × brands considered. Crosses two MR sets to get an option × option overlap matrix — used heavily in brand funnels.)',
      '— Other patterns occasionally needed —',
      '12. Ranked MR (Top-N). (If respondents *ranked* their picks instead of just selecting: top-1 share, top-3 inclusion %, average rank. Different math — needs rank data.)',
      '13. Multiple Correspondence Analysis (MCA). (Reduce many MR options to a 2-D map for visualisation. Specialist tool — not in panel; export dummies + run separately if needed.)',
      '14. Latent class / segmentation on MR patterns. (Cluster respondents by their selection patterns to find natural segments. Use the Cluster panel on the MR dummies.)',
    ],
    outputs: [
      'Frequency table: N, % of cases, % of responses, rank.',
      'Co-occurrence Jaccard matrix (0 = never together, 1 = always together).',
      'Per-option χ² with corrected p-values when comparing across groups.',
      'Choice-count histogram (selections-per-respondent).',
      'Lift matrix (>1 = options reinforce each other; <1 = mutually exclusive).',
      'Exclusive-pick %s per option.',
    ],
    pitfalls: [
      'Treating an MR column as a normal categorical. (% of cases will not sum to 100% because each respondent can contribute to multiple categories — confusing if you forget.)',
      'Reporting % of responses when stakeholders expected % of cases (or vice versa). (Both are valid — always label which denominator.)',
      'Using one cell\'s χ² to call a per-option difference significant. (Apply FDR correction across all options — the panel does this automatically when you toggle correction.)',
      'Interpreting raw co-occurrence as "association". (Two popular options will co-occur a lot by chance. Use lift / conditional prob, not raw counts.)',
      'For dummy mode, define "truthy values". (Default is Yes / 1 / true — change if your data uses different markers.)',
      'Comparing MR option frequencies across surveys with different option lists. (Adding/removing options changes denominators — not directly comparable.)',
    ],
    example: 'Q. "Why didn\'t you take micro-irrigation?" (select all that apply) → Frequencies show 62% picked "cost", 41% "no awareness", 28% "land too small". Co-occurrence shows "cost" + "no awareness" cluster heavily (J=0.48). By-group reveals "no awareness" is 3× higher in remote tehsils (FDR-adjusted p<0.001). Lift on "land too small" → "cost" = 2.1 (smallholders worry about cost disproportionately). NET-aggregating cost+land+credit into "economic reasons" lifts the top barrier to 78%.',
  },
  {
    id: 'observer',
    title: 'Observer vs Respondent',
    category: 'Survey Analyses',
    icon: '👁️',
    useWhen: 'You collected both self-report and observer-verified versions of the same fact. (Concordance check.)',
    criteria: [
      'Same respondent has both a self-report and an observer rating. (Paired observations on the same row.)',
      'The two columns measure the *same* construct. (Otherwise concordance is meaningless.)',
      'Both columns have the same value space. (Both binary, both ordinal Likert, or both continuous — the test picks accordingly.)',
    ],
    requires: [
      'Pairs of columns: one self-reported, one observer-rated. (Same construct, two perspectives.)',
      'Optional: tag observer columns with role=observer_rated + paired_with in Variables. (Enables auto-suggestion.)',
    ],
    steps: [
      'Concordance mode. (Add pairs, pick kind: binary / ordinal / continuous; returns % agreement, Cohen κ, weighted κ for Likert, McNemar for binary, Bland-Altman for continuous.)',
      'Discrepancies mode. (Pick one pair + ID columns; returns the disagreeing rows, ordered by magnitude — useful for QA and data cleaning.)',
    ],
    outputs: [
      'Concordance matrix per pair. (% agreement, κ, p-value, interpretation in colour code.)',
      'Discrepancy report. (Raw disagreeing rows for follow-up.)',
    ],
    pitfalls: [
      'Reading % agreement alone. (Misleading when categories are imbalanced — always check κ.)',
      'κ < 0.4. (Poor agreement — measurement instrument may be unclear or training was inconsistent.)',
    ],
    example: 'A self-reported binary item vs the observer-verified version → typically high % agreement with κ in the moderate-to-substantial range.',
  },

  // ── Descriptive ─────────────────────────────────────────────
  {
    id: 'stat_descriptive',
    title: 'Descriptive Summary',
    category: 'Descriptive',
    icon: '📋',
    useWhen: 'Always — the "Table 1" of any report. (Numeric columns only.)',
    criteria: [
      'Variable is continuous or count-like. (For categorical variables, use Frequency Distribution instead.)',
      'No inferential claim — pure description. (No p-values; just N + central tendency + spread.)',
    ],
    requires: [
      'At least one numeric column. (Pick columns with the # badge in the column list.)',
    ],
    steps: [
      'Pick numeric columns. (Multi-select supported.)',
      'Click Run Analysis.',
    ],
    outputs: [
      'Per column: N, Mean, SD, Median, Min, Max, Q1, Q3, Missing count.',
    ],
    pitfalls: [
      'Mean on skewed data. (Always also report median; Mean >> Median signals right skew.)',
      'Ignoring Missing count. (Always check — large missing implies a data-quality or sampling issue.)',
    ],
    example: 'Numeric outcome column → N, Mean, SD, Median, IQR, and missing count for each picked column.',
  },
  {
    id: 'stat_frequency',
    title: 'Frequency Distribution',
    category: 'Descriptive',
    icon: '📊',
    useWhen: 'Categorical, ordinal, or low-cardinality numeric columns. (For multi-response columns, use the MR panel instead.)',
    criteria: [
      'Variable is categorical or low-cardinality (≤30 unique values). (Continuous variables produce a row per value — not useful.)',
      'Each respondent picks exactly one value per question. (For "select all that apply", use MR panel.)',
    ],
    requires: [
      'At least one column. (Any type; numeric columns produce one row per distinct value — prefer this for ≤30 unique values.)',
    ],
    steps: [
      'Pick column(s). (One frequency table per column.)',
      'Run.',
    ],
    outputs: [
      'Value | Count | % per column.',
    ],
    pitfalls: [
      'High-cardinality numeric columns. (Continuous variables produce a row per unique value — use bins or Descriptive Summary instead.)',
    ],
    example: 'Any categorical column → one row per category with count + percentage of total.',
  },

  // ── Relationships ─────────────────────────────────────────────
  {
    id: 'stat_correlation',
    title: 'Pearson Correlation',
    category: 'Relationships',
    icon: '📐',
    useWhen: 'Both variables are continuous and the relationship looks linear on a scatter plot. (Otherwise prefer Spearman.)',
    criteria: [
      'Both variables are continuous. (Interval/ratio scale — not Likert or categorical.)',
      'Relationship is linear. (Curved/U-shaped relationships return r ≈ 0 — always plot first.)',
      'No extreme outliers. (One outlier can flip the sign of r.)',
      'Approximately bivariate normal. (Heavy skew → switch to Spearman.)',
    ],
    requires: [
      'At least 2 numeric columns. (Pick from the # badge list.)',
    ],
    steps: [
      'Pick 2 or more numeric columns. (Order doesn\'t matter — matrix is symmetric.)',
      'Run.',
    ],
    outputs: [
      'Pairwise r matrix with heat-map shading. (Green = positive, red = negative.)',
      '95% CI per coefficient. (Fisher z transform.)',
    ],
    pitfalls: [
      'Assumed linearity. (A U-shaped relationship has r ≈ 0 even though variables are clearly related — always plot first.)',
      'Outliers flip the sign. (Run Outlier detection first.)',
      'Correlation ≠ causation. (Especially in observational survey data — confounders are everywhere.)',
    ],
    example: 'Two numeric columns → r with a 95% CI; interpret the *size* of r (≤0.1 trivial, 0.3 moderate, 0.5+ strong).',
  },
  {
    id: 'stat_regression',
    title: 'OLS Regression',
    category: 'Relationships',
    icon: '📈',
    useWhen: 'Numeric outcome Y, one or more numeric predictors X. (Use Multi-Reg for categorical predictors or VIF diagnostics.)',
    criteria: [
      'Outcome Y is continuous. (For binary Y use Logistic Regression.)',
      'Predictors X are numeric. (For categorical X use Multi-Reg with auto one-hot encoding.)',
      'Observations are independent. (Clustered data needs mixed models — coming in Phase 6.)',
      'OLS assumptions: linearity + homoscedasticity + normal residuals. (Check residual plots after.)',
    ],
    requires: [
      'First column = numeric Y. (Click Y first; the picker reads "Dependent: column-name".)',
      'Rest = numeric X(s). (Auto-encoded categoricals — use Multi-Reg instead for mixed inputs.)',
    ],
    steps: [
      'Pick the outcome (Y) first. (The hint line confirms "Dependent (Y): ...".)',
      'Pick predictors (X). (One or more.)',
      'Run.',
    ],
    outputs: [
      'β coefficients with t, p. (Per predictor.)',
      'R² and adjusted R². (% of variance in Y explained; adjusted penalises extra predictors.)',
      'Residual diagnostics. (Q-Q, residual-vs-fitted summary; use to check OLS assumptions.)',
    ],
    pitfalls: [
      'OLS assumes linearity + independence + homoscedasticity + normal residuals. (Run Normality + Outlier first; check residual plots after.)',
      'Categorical predictors. (This endpoint expects numeric; for mixed inputs use Multi-Reg.)',
    ],
    example: 'Numeric Y modelled on one numeric X → β + p + R²; R² tells you how much of Y\'s variance X explains.',
  },

  // ── Hypothesis Tests ─────────────────────────────────────────────
  {
    id: 'stat_ttest',
    title: 't-Test (Welch)',
    category: 'Hypothesis Tests',
    icon: '𝑡',
    useWhen: 'Compare the mean of a continuous variable across exactly 2 independent groups.',
    criteria: [
      'Exactly 2 groups. (3+ groups → ANOVA; only 1 group vs a constant → one-sample t.)',
      'Outcome is continuous. (For binary outcomes use χ²; for ordinal use Mann-Whitney.)',
      'Groups are independent. (For same respondents pre vs post → Paired t-Test.)',
      'No need for equal variances. (Welch\'s t handles unequal variances; that\'s why this is the default.)',
      'Outcome is approximately normal within each group, or N is large. (CLT helps for N ≥ 30 per group; otherwise Mann-Whitney.)',
    ],
    requires: [
      '1 grouping column with exactly 2 categories. (Any 2-level column — Yes/No, A/B, Treated/Control, etc.)',
      '1 numeric outcome column.',
    ],
    steps: [
      'Pick the grouping column first. (The hint line reads "Group: column-name".)',
      'Pick the numeric outcome second. (Hint: "Value: column-name".)',
      'Run. (Welch\'s t by default — does not assume equal variances.)',
    ],
    outputs: [
      't statistic + df + p-value. (df uses Welch-Satterthwaite.)',
      'Per-group means + mean difference + 95% CI on the difference.',
      'Cohen\'s d (effect size). (0.2 = small, 0.5 = medium, 0.8 = large.)',
    ],
    pitfalls: [
      '3+ groups. (Use ANOVA — or Kruskal-Wallis if non-normal.)',
      'Strong skew or small N. (Use Mann-Whitney — the panel auto-suggests when Shapiro normality fails.)',
      'Reading p without effect size. (Large samples make tiny differences "significant"; always read d and CI.)',
    ],
    example: 'Two-group comparison on a numeric outcome → mean difference + p + Cohen\'s d, reported together.',
  },
  {
    id: 'stat_anova',
    title: 'One-Way ANOVA',
    category: 'Hypothesis Tests',
    icon: 'F',
    useWhen: 'Continuous outcome across 3+ independent groups.',
    criteria: [
      '3 or more groups. (For exactly 2 groups use t-Test — more powerful.)',
      'Outcome is continuous. (For ordinal/skewed → Kruskal-Wallis.)',
      'Groups are independent. (For repeated measures on same respondents → Friedman or mixed-effects.)',
      'Approximately equal variances across groups. (Check via Levene; if violated, the Welch ANOVA row is reported.)',
      'Outcome is approximately normal in each group, or N is large.',
    ],
    requires: [
      '1 grouping column with 3+ categories.',
      '1 numeric outcome column.',
    ],
    steps: [
      'Pick the grouping column first.',
      'Pick the numeric outcome.',
      'Run.',
    ],
    outputs: [
      'F + df1/df2 + p-value.',
      'η² and ω². (Variance explained; ω² is less biased for small samples.)',
      'Per-group means + 95% CI. (Welch\'s ANOVA also reported if Levene\'s test fails.)',
    ],
    pitfalls: [
      'Significant ANOVA tells you only that *some* pair differs. (Run Post-hoc for which.)',
      'Unequal variances. (Read the Welch row when Levene\'s p < 0.05.)',
      'Skewed data or ordinal outcome. (Use Kruskal-Wallis instead.)',
    ],
    example: 'A 3+ category column vs a numeric outcome → F + p + η²; follow up with Post-hoc to identify which pairs differ.',
  },
  {
    id: 'stat_crosstab',
    title: 'Cross-Tab + χ²',
    category: 'Hypothesis Tests',
    icon: 'χ²',
    useWhen: 'Both variables are categorical and you want to test association.',
    criteria: [
      'Both variables are categorical / binary. (For numeric outcomes use t-Test or ANOVA.)',
      'Observations are independent. (Paired binary → McNemar instead.)',
      'Expected counts in each cell ≥ 5. (If smaller, panel auto-falls back to Fisher\'s exact for 2×2.)',
      'Each respondent contributes once. (Multi-response columns need the MR panel.)',
    ],
    requires: [
      '2 categorical columns. (Either text columns, or numeric tagged as categorical.)',
    ],
    steps: [
      'Pick the row variable first.',
      'Pick the column variable second.',
      'Run.',
    ],
    outputs: [
      'Contingency table (counts).',
      'χ² + df + p-value.',
      'Cramér\'s V (effect size 0–1). (0.1 = weak, 0.3 = moderate, 0.5 = strong.)',
      'Fisher\'s exact for 2×2 small N. (Auto-fallback when any expected cell < 5.)',
      'Standardized residuals. (Identify *which* cells drive the χ² result.)',
    ],
    pitfalls: [
      'Small expected counts. (χ² is unreliable when any expected cell < 5 — the panel auto-uses Fisher\'s exact for 2×2.)',
      'Big table, small N. (Sparse cells inflate χ²; collapse rare categories first.)',
    ],
    example: 'Two categorical columns → χ² + p + Cramér\'s V; V tells you the *strength* of any association.',
  },

  // ── Paired / Pre-Post ─────────────────────────────────────────────
  {
    id: 'stat_paired_ttest',
    title: 'Paired t-Test',
    category: 'Paired / Pre-Post',
    icon: '↔',
    useWhen: 'Same respondents measured twice (before/after) on a continuous variable.',
    criteria: [
      'Same respondents in both columns. (For independent groups use the regular t-Test.)',
      'Outcome is continuous. (For binary paired → McNemar; for ordinal/skewed → Wilcoxon.)',
      'Exactly 2 timepoints. (3+ waves → Friedman or repeated-measures ANOVA.)',
      'Change scores are approximately normal. (Heavy skew or outliers in the differences → Wilcoxon.)',
    ],
    requires: [
      'Two numeric columns from the same respondents. (A pre and a post column for the same construct.)',
    ],
    steps: [
      'Pick PRE first. (Hint reads "PRE: column-name".)',
      'Pick POST second.',
      'Run.',
    ],
    outputs: [
      't + df + p-value on the within-respondent change. (df = N pairs − 1.)',
      'Mean difference + 95% CI on the change.',
      'Cohen\'s d_z (paired effect size). (Computed on change scores; *not* comparable to independent-samples d.)',
    ],
    pitfalls: [
      'Order matters. (PRE first — the sign of the change is post − pre.)',
      'Strongly skewed change scores. (Use Wilcoxon signed-rank instead.)',
      'Mixing up d and d_z. (d_z is paired-only — quote it as such in your report.)',
    ],
    example: 'A pre/post numeric pair → mean change + p + d_z; d_z ≥ 0.8 is a large within-respondent change.',
  },
  {
    id: 'stat_wilcoxon',
    title: 'Wilcoxon Signed-Rank',
    category: 'Paired / Pre-Post',
    icon: 'W',
    useWhen: 'Paired before/after where change scores are skewed or contain outliers. (Non-parametric alternative to paired t.)',
    criteria: [
      'Same respondents in both columns. (Independent groups → Mann-Whitney.)',
      'Outcome is continuous or ordinal. (Likert pre/post is a classic use case.)',
      'Change-score distribution is skewed, has outliers, or is ordinal. (Otherwise paired t is more powerful.)',
      'Exactly 2 timepoints.',
    ],
    requires: [
      'Two numeric columns from the same respondents.',
    ],
    steps: [
      'Pick PRE first.',
      'Pick POST second.',
      'Run.',
    ],
    outputs: [
      'W statistic + p-value.',
      'Median change + rank-biserial r (effect size).',
    ],
    pitfalls: [
      'Lower power than paired t when assumptions hold. (Use only when paired t is inappropriate — skew, outliers, ordinal data.)',
      'Many tied change scores. (Wilcoxon downweights ties; very tie-heavy data may justify sign test.)',
    ],
    example: 'A pre/post pair on a Likert / ordinal outcome → W + p + rank-biserial r as the effect size.',
  },
  {
    id: 'stat_mcnemar',
    title: 'McNemar Test',
    category: 'Paired / Pre-Post',
    icon: '±',
    useWhen: 'Same respondents, binary outcome before vs after. (Paired Yes/No comparison.)',
    criteria: [
      'Outcome is binary in both columns. (Yes/No, 0/1. For ordinal use Wilcoxon; for continuous use paired t.)',
      'Same respondents in both columns. (Independent binary samples → χ² instead.)',
      'Exactly 2 timepoints. (3+ → Cochran\'s Q — not yet supported here.)',
      'Discordant cell counts are reasonable. (< 25 → panel switches to exact binomial automatically.)',
    ],
    requires: [
      'Two binary columns from the same respondents. (Yes/No or 0/1.)',
    ],
    steps: [
      'Pick PRE binary column.',
      'Pick POST binary column.',
      'Run.',
    ],
    outputs: [
      'McNemar χ² + p-value.',
      'Discordant cell counts. (No→Yes vs Yes→No — only these carry information.)',
    ],
    pitfalls: [
      'Treating it like a χ² of independence. (McNemar uses *paired* data — never compare unrelated groups with it.)',
      'Tiny discordant counts. (< 25 → panel switches to exact binomial automatically.)',
    ],
    example: 'A binary outcome measured pre vs post → counts of No→Yes vs Yes→No switches + p on net change.',
  },

  // ── Non-parametric ─────────────────────────────────────────────
  {
    id: 'stat_kruskal',
    title: 'Kruskal-Wallis',
    category: 'Non-parametric',
    icon: 'K',
    useWhen: '3+ groups + continuous/ordinal outcome with skew, outliers, or Likert data. (Non-parametric ANOVA.)',
    criteria: [
      '3 or more independent groups. (For 2 groups → Mann-Whitney; for paired → Friedman.)',
      'Outcome is ordinal or skewed continuous. (For normally-distributed continuous → ANOVA is more powerful.)',
      'Observations are independent across groups. (Same respondents across columns → Friedman.)',
      'Group distributions have similar shape. (Otherwise the test is on stochastic dominance, not on medians.)',
    ],
    requires: [
      '1 grouping column with 3+ categories.',
      '1 numeric or ordinal outcome.',
    ],
    steps: [
      'Pick grouping column first.',
      'Pick outcome.',
      'Run.',
    ],
    outputs: [
      'H statistic + df + p-value.',
      'η²_H effect size + per-group medians and IQR. (Medians + IQR are the right summary for non-parametric outputs.)',
    ],
    pitfalls: [
      'Significant H only says *some* group differs. (Follow up with pairwise Mann-Whitney + FDR correction.)',
      'Mixed-direction ordinal outcomes. (Reverse-code before running.)',
    ],
    example: 'A 3+ category column vs an ordinal outcome → H + p + η²_H; report group medians (not means) alongside.',
  },
  {
    id: 'stat_friedman',
    title: 'Friedman Test',
    category: 'Non-parametric',
    icon: 'Fr',
    useWhen: '3+ repeated measurements on the same respondents. (Non-parametric repeated-measures ANOVA.)',
    criteria: [
      'Same respondents across 3+ timepoints/conditions. (For independent groups → Kruskal-Wallis.)',
      'Outcome is ordinal or skewed continuous. (Normal continuous repeated → repeated-measures ANOVA.)',
      'No missing values across waves. (Rows with any missing wave are dropped — pre-impute if needed.)',
    ],
    requires: [
      '3+ numeric/ordinal columns at different timepoints. (Same respondents across columns.)',
    ],
    steps: [
      'Pick measures in time order. (Hint shows "Measures (in order): col1 → col2 → col3".)',
      'Run.',
    ],
    outputs: [
      'χ²_F + df + p-value.',
      'Kendall\'s W (concordance / effect size, 0–1).',
    ],
    pitfalls: [
      'Rows with any missing wave are dropped. (Pre-impute or accept smaller N.)',
      'Order matters for interpretation. (Pick columns in chronological order.)',
    ],
    example: '3+ repeated waves of the same construct → χ²_F + p + Kendall\'s W on cross-wave change.',
  },
  {
    id: 'stat_spearman',
    title: 'Spearman Rank Correlation',
    category: 'Non-parametric',
    icon: 'ρ',
    useWhen: 'Monotonic but not necessarily linear relationship, or at least one variable is ordinal (Likert).',
    criteria: [
      'Relationship is monotonic (always increasing or always decreasing) but not necessarily linear.',
      'At least one variable is ordinal, or both are continuous but non-normal. (For linear + continuous + normal → Pearson.)',
      'Few ties in ranks. (Heavy ties → Kendall τ handles them better.)',
    ],
    requires: [
      'At least 2 numeric or ordinal columns.',
    ],
    steps: [
      'Pick columns.',
      'Run.',
    ],
    outputs: [
      'Pairwise ρ matrix with p-values and 95% CIs.',
    ],
    pitfalls: [
      'Many ties. (Use Kendall τ — it handles ties more gracefully.)',
      'Same outlier sensitivity as Pearson when ranks happen to be linear. (Still plot first.)',
    ],
    example: 'A Likert / ordinal variable vs a continuous variable → ρ + p; interpret like Pearson r.',
  },
  {
    id: 'stat_kendall',
    title: 'Kendall τ Correlation',
    category: 'Non-parametric',
    icon: 'τ',
    useWhen: 'Ordinal data with heavy ties, or small sample where Spearman is unstable.',
    criteria: [
      'At least one variable is ordinal with many ties. (Heavy ties bias Spearman; τ handles ties via concordant/discordant pair counts.)',
      'Small N. (τ has better small-sample properties than Spearman.)',
      'Monotonic relationship. (Same monotonicity assumption as Spearman.)',
    ],
    requires: [
      'At least 2 ordinal or numeric columns.',
    ],
    steps: [
      'Pick columns.',
      'Run.',
    ],
    outputs: [
      'Pairwise τ matrix with p-values.',
    ],
    pitfalls: [
      'τ is smaller in magnitude than ρ. (Don\'t cross-quote against Spearman values from other reports.)',
    ],
    example: 'Two Likert items → τ + p; expect τ to be smaller than the Spearman ρ on the same data.',
  },

  // ── Models ─────────────────────────────────────────────
  {
    id: 'stat_multiple_regression',
    title: 'Multiple Regression',
    category: 'Models',
    icon: '📐',
    useWhen: 'Numeric outcome modelled by multiple predictors. (Mixes numeric and categorical — categoricals are auto one-hot encoded.)',
    criteria: [
      'Outcome Y is continuous. (For binary Y → Logistic Regression.)',
      'Multiple predictors (2+). (For 1 numeric predictor only → OLS Regression is fine.)',
      'Predictors can be mixed numeric + categorical. (Categoricals are auto one-hot encoded — first level is reference.)',
      'Independent observations. (Clustered data → mixed-effects models.)',
      'Low multicollinearity. (VIF > 5 is a red flag — flagged in output.)',
      'OLS assumptions: linearity, homoscedasticity, normal residuals.',
    ],
    requires: [
      'First column = numeric Y.',
      'Rest = predictors. (Numeric and/or categorical — first level of each categorical is the reference.)',
    ],
    steps: [
      'Pick Y first. (Numeric outcome.)',
      'Pick predictors.',
      'Run.',
    ],
    outputs: [
      'β + SE + t + p + 95% CI per predictor.',
      'R² + adjusted R². (Adjusted penalises extra predictors.)',
      'VIF per predictor. (Multicollinearity check — flag > 5.)',
      'Residual diagnostics + Cook\'s D. (Influential outliers flagged.)',
    ],
    pitfalls: [
      'VIF > 5. (Predictors too correlated — drop or combine one.)',
      'Categorical reference level matters. (β\'s are vs the reference; rename to make outputs readable.)',
      'High R² without checking residuals. (Could mask a non-linear relationship or influential outlier.)',
    ],
    example: 'Numeric Y modelled on a treatment indicator + a continuous covariate + a categorical → β per predictor, R², VIF.',
  },
  {
    id: 'stat_logistic_regression',
    title: 'Logistic Regression',
    category: 'Models',
    icon: 'OR',
    useWhen: 'Binary outcome (Yes/No, 0/1) modelled by one or more predictors. (Reports odds ratios.)',
    criteria: [
      'Outcome is binary. (Yes/No, 0/1. For 3+ categories → multinomial logit, not yet supported here.)',
      'Predictors can be mixed numeric + categorical. (Same encoding as Multi-Reg.)',
      'Independent observations. (Clustered data → mixed-effects logistic.)',
      'Adequate events-per-predictor. (Rule of thumb: ≥10 events of the minority class per predictor.)',
      'Outcome is encoded so "1" = the event of interest. (OR direction depends on this.)',
    ],
    requires: [
      'First column = binary outcome.',
      'Rest = predictors. (Numeric + categorical OK.)',
    ],
    steps: [
      'Pick binary outcome first. (Hint reads "Outcome (binary): ...".)',
      'Pick predictors.',
      'Run.',
    ],
    outputs: [
      'Odds ratios + 95% CI + Wald p-values per predictor. (OR > 1 = predictor increases odds of "Yes"; OR < 1 = decreases.)',
      'McFadden pseudo-R². (0.2–0.4 is good fit for behavioural data.)',
      'Hosmer-Lemeshow goodness-of-fit. (Non-significant p = good calibration.)',
    ],
    pitfalls: [
      '3+ outcome categories. (Use multinomial logit — not yet supported here; binarise or use the simple ratio.)',
      'Outcome encoded backwards. (Make sure 1 = the event of interest.)',
      'Pseudo-R² interpretation. (Not the same scale as OLS R² — don\'t compare across model types.)',
    ],
    example: 'A binary outcome modelled on a treatment indicator + covariates → OR with CI per predictor + pseudo-R².',
  },
  {
    id: 'stat_posthoc',
    title: 'Post-Hoc Pairwise',
    category: 'Models',
    icon: '⇄',
    useWhen: 'After a significant ANOVA / Kruskal — find which specific pairs differ.',
    criteria: [
      'You\'ve already run ANOVA or Kruskal-Wallis and it\'s significant. (Without a significant umbrella test, post-hoc inflates false positives.)',
      '3+ groups. (For 2 groups, the t-test answers the pairwise question directly.)',
      'Continuous outcome. (For ordinal/non-normal, use pairwise Mann-Whitney + FDR instead.)',
      'Equal variances → Tukey HSD; unequal → Games-Howell. (Auto-suggested based on Levene.)',
    ],
    requires: [
      '1 grouping column with 3+ categories.',
      '1 numeric outcome.',
    ],
    steps: [
      'Pick grouping column first.',
      'Pick outcome.',
      'Run. (Tukey HSD by default; Games-Howell auto-suggested if Levene fails.)',
    ],
    outputs: [
      'All pairs: mean difference + adjusted p + 95% CI.',
    ],
    pitfalls: [
      'Running post-hoc without a significant ANOVA. (Defeats the purpose — the umbrella test should be significant first.)',
      'Equal-variance assumption. (Tukey HSD assumes it — use Games-Howell otherwise.)',
    ],
    example: 'After a significant ANOVA → one row per pair of groups with mean difference + adjusted p + CI.',
  },
  {
    id: 'stat_reliability',
    title: 'Cronbach α',
    category: 'Models',
    icon: 'α',
    useWhen: 'Test whether multiple Likert items measure the same underlying construct. (Internal consistency check.)',
    criteria: [
      'All items measure the *same* construct. (Mixing constructs → α is meaningless.)',
      '3+ items recommended. (α on 2 items is unstable.)',
      'All items scored in the same direction. (Reverse-code opposite items first.)',
      'Items are ordinal Likert or interval. (For binary items, KR-20 is the equivalent — same formula.)',
    ],
    requires: [
      'At least 2 Likert / scale items. (3+ recommended for stability.)',
    ],
    steps: [
      'Pick scale items. (All measuring the same construct.)',
      'Run.',
    ],
    outputs: [
      'Cronbach α (0–1). (>0.7 = acceptable, >0.8 = good, >0.9 = excellent.)',
      'Item-rest correlations. (Per item — how strongly it correlates with the rest of the scale.)',
      '"α if item dropped" per item. (Tells you which item is dragging α down.)',
    ],
    pitfalls: [
      'α < 0.7. (Scale has reliability issues — review item wording.)',
      'α > 0.95. (May indicate redundant items — trim.)',
      'Reverse-coded items. (Reverse them before computing α, else they pull α down.)',
    ],
    example: 'A block of scale items → α + item-rest r + "α if dropped" per item; drop weak items to lift α.',
  },

  // ── Distribution ─────────────────────────────────────────────
  {
    id: 'stat_normality',
    title: 'Normality Tests',
    category: 'Distribution',
    icon: '📉',
    useWhen: 'Before parametric tests (t-test, ANOVA, OLS) — check whether your numeric variable is normally distributed.',
    criteria: [
      'You\'re about to run a parametric test. (And want to justify it — or pick a non-parametric alternative.)',
      'Variable is continuous. (Normality has no meaning for categorical or low-cardinality discrete data.)',
      'N is moderate. (Shapiro is most useful for 10 ≤ N ≤ 300; for larger N rely on histograms + skew/kurtosis.)',
    ],
    requires: [
      'At least one numeric column.',
    ],
    steps: [
      'Pick numeric columns.',
      'Run.',
    ],
    outputs: [
      'Shapiro-Wilk W + p per column. (Most sensitive for small N; over-sensitive for N > 300 — also eyeball a histogram.)',
      'Kolmogorov-Smirnov D + p. (Compared against a fitted normal.)',
      'Skewness + kurtosis. (Skew |·| > 1 = strong skew; kurtosis > 3 = heavy tails.)',
    ],
    pitfalls: [
      'Over-sensitive on large N. (Shapiro flags trivial deviations as significant — always check the histogram and skewness.)',
      'Treating "p > 0.05" as proof of normality. (It only fails to reject; not the same as accepting.)',
    ],
    example: 'A right-skewed numeric column → Shapiro p<0.05 + skew > 1 → prefer Mann-Whitney over t-test.',
  },
  {
    id: 'stat_outlier',
    title: 'Outlier Detection',
    category: 'Distribution',
    icon: '⚠',
    useWhen: 'Before any parametric test or correlation — outliers can flip results.',
    criteria: [
      'Variable is continuous. (For categorical variables, "rare category" is the analogue — see Frequency Distribution.)',
      'You want to flag (not auto-delete) extreme values. (Always investigate before removing.)',
      'Distribution is approximately symmetric → Z-score; skewed → IQR. (Both reported; trust IQR more on skewed data.)',
    ],
    requires: [
      'At least one numeric column.',
    ],
    steps: [
      'Pick numeric columns.',
      'Run.',
    ],
    outputs: [
      'Counts of outliers by IQR rule (>1.5×IQR). (More robust on skewed data.)',
      'Counts of outliers by Z-score (|z| > 3). (Assumes near-normal — biased on skewed data.)',
      'Flagged row indices. (Drill in to inspect — not auto-delete.)',
    ],
    pitfalls: [
      'Auto-deleting outliers. (Extreme values are often legitimate — investigate before removing.)',
      'Z-score on skewed data. (Heavily skewed distributions throw false z-positives; trust the IQR list more.)',
    ],
    example: 'A numeric column → IQR + Z counts + the specific row indices flagged — review each row before deciding.',
  },
];

export const GUIDE_INDEX: Record<string, GuideEntry> = GUIDES.reduce((acc, g) => {
  acc[g.id] = g; return acc;
}, {} as Record<string, GuideEntry>);
