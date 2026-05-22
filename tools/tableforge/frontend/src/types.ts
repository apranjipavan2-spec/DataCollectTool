export interface ColumnInfo {
  name: string;
  type: 'numeric' | 'text' | 'date' | 'boolean' | 'multi_choice';
  sample_values: string[];
  stats: {
    min?: number | null;
    max?: number | null;
    mean?: number | null;
    nulls: number;
    unique: number;
    is_multi_choice?: boolean;
    unique_responses?: number;
    total_responses?: number;
  };
}

export interface DatasetMeta {
  dataset_id: string;
  filename: string;
  sheets: string[];
  row_count: number;
  columns: ColumnInfo[];
  preview: Record<string, any>[];
}

export interface ValueField {
  field: string;
  agg: string;           // Summarize by: sum, count, average, min, max, median, std, var, count_distinct, first, last
  show_as?: string;       // Show values as: normal, pct_grand, pct_row, pct_col, pct_parent_row, pct_parent_col, running_total, rank_asc, rank_desc, index, pct_point_change, z_score, percentile_rank, cagr
  decimals?: number;      // Decimal places (0-6)
  combo_show_as?: string; // If set, shows "value (show_as%)" combination e.g. "1500 (25.3%)"
  label?: string;
  number_format?: NumberFormat;
  // Statistical display options
  show_stars?: boolean;       // Significance stars (*,**,***)
  star_thresholds?: number[]; // p-value thresholds e.g. [0.05, 0.01, 0.001]
  show_se?: boolean;          // Show standard error in parentheses
  show_ci?: boolean;          // Show confidence interval [lower, upper]
  ci_level?: number;          // 0.90, 0.95, 0.99
  show_mean_sd?: boolean;     // Show as "mean ± SD"
  show_n?: boolean;           // Show sample size
  missing_indicator?: string; // Custom missing data symbol e.g. "—", "n/a", "."
  change_arrows?: boolean;    // Show ▲/▼ arrows for positive/negative change
}

export interface NumberFormat {
  style: 'number' | 'currency' | 'percent';
  decimals: number;
  separator: boolean;
  prefix: string;
  suffix: string;
  currency_symbol: string;
}

export interface ConditionalFormat {
  id: string;
  type: 'color_scale' | 'data_bar' | 'icon_set' | 'rule';
  applies_to: string;  // value field name
  // color scale
  min_color?: string;
  mid_color?: string;
  max_color?: string;
  use_mid?: boolean;
  // data bar
  bar_color?: string;
  // icon set
  icon_set?: 'arrows' | 'traffic' | 'rating' | 'flags';
  // rule-based
  rule_condition?: 'gt' | 'lt' | 'gte' | 'lte' | 'eq' | 'neq' | 'between' | 'top_n' | 'bottom_n';
  rule_value?: number;
  rule_value2?: number;
  rule_color?: string;
  rule_bold?: boolean;
  rule_operator?: string;
  rule_bg?: string;
}

export interface SortKey {
  field: string;
  order: 'asc' | 'desc';
}

export interface HeaderFormat {
  field: string;
  font?: string;
  size?: number;
  bold?: boolean;
  italic?: boolean;
  color?: string;
  backgroundColor?: string;
}

export interface DateFormat {
  field: string;
  format: string;  // e.g., 'YYYY-MM-DD', 'DD/MM/YYYY', 'MMM YYYY', 'Q[Q] YYYY'
}

export interface ComparisonConfig {
  date_column: string;
  value_column: string;
  group_by: string[];
  comparisons: string[];
  moving_avg_n: number;
}

export interface TableConfig {
  id: string;
  name: string;
  rows: string[];
  columns: string[];
  values: ValueField[];
  filters: Record<string, string[]>;
  grand_total: boolean;
  grand_total_rows?: boolean;
  grand_total_columns?: boolean;
  grand_total_combined?: boolean;
  subtotals: boolean;
  subtotals_position?: 'top' | 'bottom';
  subtotal_pct_base?: 'subtotal' | 'grand_total';
  missing_data: string;
  title: string;
  subtitle: string;
  comparisonConfig?: ComparisonConfig;
  sort_by?: string;
  sort_order?: string;
  multi_sort?: SortKey[];
  custom_sort_orders?: Record<string, string[]>;  // field -> ordered categories
  // Batch 2/3: date groupings, blank suppress
  date_groupings?: Record<string, string>;  // column -> 'year'|'quarter'|'month'|'week'|'day'
  blank_suppress?: boolean;
  // Batch 4: formatting
  serial_number?: boolean;
  serial_number_mode?: 'continuous' | 'per_group';
  footnote?: string;
  theme?: string;
  border_preset?: string;
  zebra?: boolean;
  zebra_color?: string;
  title_bold?: boolean;
  title_italic?: boolean;
  title_size?: number;
  title_align?: string;
  title_color?: string;
  header_renames?: Record<string, string>;
  header_formats?: HeaderFormat[];
  date_formats?: DateFormat[];
  row_height?: number;
  column_widths?: Record<string, number>;
  // Conditional formatting
  conditional_formats?: ConditionalFormat[];
  // Auto table numbering
  auto_number?: boolean;
  table_number_prefix?: string;
  table_number?: string;
  // Advanced formatting
  frozen_first_col?: boolean;
  header_word_wrap?: boolean;
  zoom_level?: number;  // 50, 75, 100, 125, 150, 200
  // Footnotes system
  footnotes?: { marker: string; text: string }[];
  footnote_style?: 'numeric' | 'alpha' | 'symbol' | 'custom';  // 1,2,3 / a,b,c / *,†,‡ / custom
  _autoTitle?: boolean;  // true = auto-generate title from config; false = user manually edited
  bg_color?: string;           // Values area background color
  header_bg_color?: string;    // Header row background color
  header_text_color?: string;  // Header text color
  row_bg_color?: string;       // Row label cells background color
  total_bg_color?: string;     // Grand total row background color
  // Chart configuration
  chartConfig?: {
    type?: string;
    xField?: string;
    yFields?: string[];
    palette?: string;
    showGrid?: boolean;
    showLabels?: boolean;
    showLegend?: boolean;
    [key: string]: any;
  };
  _lastValueConfig?: Partial<ValueField>;
  // Cell alignment
  cell_align?: 'left' | 'center' | 'right';         // Values area alignment
  header_align?: 'left' | 'center' | 'right';       // Header row alignment
  row_label_align?: 'left' | 'center' | 'right';    // Row labels alignment
  hide_subgroup?: boolean;
  // Pin/star: surface frequently used tables at top of strip
  pinned?: boolean;
  // Table chains: this table's input is the result of another table
  source_table_id?: string;
}

export interface ColumnGroup {
  label: string;
  colspan: number;
  colstart: number;
}

export interface TableResult {
  headers: string[];
  rows: any[][];
  row_count: number;
  col_count: number;
  column_groups?: {
    top: ColumnGroup[];
    bottom: string[];
    has_multi_level: boolean;
  };
  multi_response_note?: string;
  original_respondents?: number;
  total_responses?: number;
}

export type DropZoneType = 'rows' | 'columns' | 'values' | 'filters';

export interface MetricDef {
  name: string;
  metric_type: string;
  column_a?: string;
  column_b?: string;
  operator?: string;
  numerator?: string;
  denominator?: string;
  part?: string;
  whole?: string;
  current?: string;
  previous?: string;
  growth_type?: string;
  value_column?: string;
  weight_column?: string;
  // New types
  base_column?: string;
  base_value?: number;
  rank_column?: string;
  rank_order?: string;
  source_metric?: string;
  format_type?: string;
  decimal_places?: number;
}

export interface BinDef {
  name: string;
  source_column: string;
  bin_type: string;
  ranges?: { label: string; lower: number; upper: number }[];
  frequency?: string;
  mapping?: Record<string, string>;
  // New types
  num_bins?: number;
  percentiles?: number[];
  fiscal_start_month?: number;
  regex_patterns?: { pattern: string; label: string }[];
  group_map?: Record<string, string[]>;
}

export interface QualityReport {
  columns: {
    column: string;
    status: 'green' | 'yellow' | 'red';
    nulls: number;
    null_pct: number;
    unique: number;
    duplicates: number;
    issues: string[];
    // Enhanced
    outliers?: number;
    type_mismatch?: number;
  }[];
  duplicate_rows: number;
  total_rows: number;
}

// ── Survey Analysis Studio: metadata layer (Phase 0) ─────────────────────────

export type ColumnRoleKind =
  | 'treatment' | 'outcome' | 'demographic' | 'mediator' | 'moderator'
  | 'geographic' | 'panel_wave' | 'observer_rated' | 'qualitative' | 'weight'
  | 'id' | 'other';

export type ColumnScale =
  | 'nominal' | 'ordinal' | 'interval' | 'ratio'
  | 'likert' | 'binary' | 'count' | 'multi_response';

export type StudyDesignType =
  | 'cross_sectional' | 'pre_post' | 'quasi_experimental' | 'panel' | 'rcs';

export interface ColumnRole {
  role?: ColumnRoleKind | string | null;
  scale?: ColumnScale | string | null;
  value_labels?: Record<string, string>;
  units?: string | null;
  paired_with?: string | null;
  mr_set_id?: string | null;
  benchmark_link?: string | null;
  notes?: string | null;
}

export interface PrePostPair {
  pre: string;
  post: string;
}

export interface StudyDesign {
  design_type?: StudyDesignType | string | null;
  treatment_col?: string | null;
  treatment_value?: string | null;
  weight_col?: string | null;
  cluster_col?: string | null;
  panel_id_col?: string | null;
  panel_wave_col?: string | null;
  pre_post_pairs?: PrePostPair[];
  strata?: string[];
  notes?: string | null;
}

export interface AutoDetectResult {
  suggested_roles: Record<string, ColumnRole>;
  suggested_design: StudyDesign;
  column_count: number;
}
