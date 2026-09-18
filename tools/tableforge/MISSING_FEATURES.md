# TableForge v2.0 — Missing & Partial Features Tracker

## Module A: Data Ingestion & Mapping
- [x] Multi-sheet selector UI (dropdown to pick sheet after upload)
- [x] Large file support (chunked reading for 1M+ rows)
- [x] Encoding auto-detection for CSV (UTF-8, Latin-1, etc.)
- [x] Manual header row override UI
- [x] Column renaming on import
- [x] Row/column exclusion before table creation
- [x] Multi-sheet union (combine sheets from same workbook)
- [x] Progress indicator / splash screen for large files

## Module B: Drag-and-Drop Table Builder
- [x] Reorder fields within zones (drag to reorder)
- [x] Move fields between zones (drag from one zone to another)
- [x] Right-click context menu on fields (Remove, Move to, Set Agg, Rename)
- [x] Multi-select drag (Ctrl+Click multiple fields → add to zone via quick toolbar)
- [x] Auto-suggest date grouping when date column dragged

## Module C: Tabulation & Calculation Engine
- [x] % of Parent Row aggregation
- [x] % of Parent Column aggregation
- [x] Index aggregation
- [x] Date grouping in table builder (Year/Quarter/Month/Week/Day)
- [x] Custom sort order definitions (manual ordering of categories)
- [x] Blank row/column suppression toggle

## Module D: Formatting & Customization
- [x] Table title font, size, bold/italic, color, alignment controls
- [x] Dynamic tokens in title/subtitle ({filename}, {date}, {sheet_name}, {project_name})
- [x] Serial number column toggle
- [x] Serial number modes (continuous / restart per group)
- [x] Header label renaming (override auto-generated labels)
- [x] Header font, size, weight, style, color, background controls (per-header)
- [x] Sub-header independent formatting
- [x] Multi-level header cell merging
- [x] Number formatting controls (decimal places, thousand separator, currency, %)
- [x] Date formatting controls
- [x] Conditional formatting (color scales, data bars, icon sets, rule-based)
- [x] Border presets (full grid, horizontal only, outer only, none, custom)
- [x] Alternating row shading (zebra striping with custom palette)
- [x] Row/column sizing (manual, auto-fit, uniform)
- [x] Pre-built themes (Corporate Blue, Minimalist B&W, Financial Standard, Government Report, Teal)
- [x] Custom theme save/load
- [x] Footnotes / source notes area
- [x] Auto table numbering (Table 1, Table 1.1, etc.)

## Module E: Export Engine
- [x] Word: auto portrait/landscape based on table width
- [x] Word: configurable headers & footers (report name, date, page numbers)
- [x] Word: optional cover page
- [x] Excel: optional raw data companion sheet
- [x] Excel: formula-based export (SUM, AVERAGE formulas instead of values)
- [x] PDF export
- [x] Clipboard copy as formatted table
- [x] Batch export (all tables as Word + Excel simultaneously, one-click)
- [x] Download button in UI to trigger file download to user's machine
- [x] Python/pandas script export

## Module F: Project Template Manager
- [x] Store metrics, bins, comparisons, report template in project file
- [x] One-click re-run: load project + new file → auto-regenerate
- [x] Column reconciliation screen (fuzzy match + side-by-side mapping)
- [x] Version history and rollback (up to 10 versions per project)
- [x] Batch processing (apply project to folder of files via Batch tab)
- [x] Auto-association (remember last project for a file path)
- [x] Template gallery with visual preview cards
- [x] Import/export .tableforge files for team sharing
- [x] Password protection for project files
- [x] Recent files and projects dashboard on launch

## Module G: Visual Metric Builder
- [x] Metric type: Index (Base = 100)
- [x] Metric type: Conditional / IF (UI — backend exists)
- [x] Metric type: Rank
- [x] Metric type: Cumulative
- [x] Metric type: Composite (metric built on other metrics)
- [x] Output formatting controls (decimals, %, currency, prefix/suffix)
- [x] Calculator icon on metrics in Source Panel
- [x] Global Metric Library (cross-project catalog)
- [x] Library search, tags, categories
- [x] Library import into new projects
- [x] Metric usage tracking

## Module H: Bin Creator & Data Recoding
- [x] Equal-frequency bins (each bin gets same row count)
- [x] Quartile/decile/percentile auto bins
- [x] Boundary inclusive/exclusive control
- [x] Remainder/other handling for values outside ranges
- [x] Fiscal year support (custom start month)
- [x] Custom date ranges with labels
- [x] Relative periods (last 7/30/90 days, YTD, Last Year, QTD, MTD, Rolling 12m)
- [x] Category collapsing (multi-select → single new category)
- [x] Auto-detect common codings (e.g., 1/2 → Male/Female)
- [x] Case normalization (merge case variants)
- [x] Regex-based recodes
- [x] Bin icon in Source Panel

## Module I: Period Comparisons
- [x] Auto-detect time field (pre-selects first date column)
- [x] Arrow indicators (▲▼▶) next to change values
- [x] Comparisons saved with project file

## Module J: Report Template Builder
- [x] Auto-Narrative Block element
- [x] Audit Trail element in report
- [x] Conditional elements (include/exclude based on data existence)
- [x] Functional dynamic tokens in narrative ({date}, {filename}, {total_rows}, cell refs)
- [x] Global document styling (font, heading styles, margins, orientation)
- [x] Report template saved with project
- [x] Auto-Narrative generator: highest/lowest values
- [x] Auto-Narrative generator: grand total statement
- [x] Auto-Narrative generator: share percentages
- [x] Auto-Narrative generator: comparison statements
- [x] Auto-Narrative generator: custom template editing
- [x] Export report as Word document (full report with all elements)
- [x] Cross-table cell references (cell_ref elements link to specific table cells)

## Multi-Table Workspace
- [x] Cross-table references (cell_ref in ReportBuilder; reference values between tables)
- [x] Table comparison mode (side-by-side diff)
- [x] Summary dashboard tab (headline numbers + sparklines for all tables)

## Data Quality & Validation
- [x] Outlier detection (3σ from mean)
- [x] Type mismatch detection
- [x] Consistency checks against project expectations
- [x] Detail drill-down per quality flag
- [x] Fix suggestions (contextual recommendations)
- [x] Exportable validation report (CSV export)

## Table Annotations & Highlights
- [x] Annotation UI (right-click cell → Add Annotation with Note/Format tabs)
- [x] Triangle/dot indicator on annotated cells
- [x] Export annotations as Word footnotes
- [x] Export annotations as Excel cell comments
- [x] Cell highlight color picker UI (7 highlight colors)
- [x] Bold/italic on individual cell values
- [x] Persistence across project re-runs (saved in .tableforge files)
- [x] Reconciliation dialog for changed data structure (on annotation location shift)

## Audit Trail & Change Log
- [x] Log all events: file import, tabulation, metric/bin create, export, save, comparisons
- [x] Include audit trail as Word report appendix
- [x] Standalone log file export (JSON or plain text)

## Live Preview Engine
- [x] Cell tooltip on hover (aggregation formula, input values, metric definition)
- [x] Error indicators on cells with calculation errors
- [x] WYSIWYG preview matching export output closely

## Quality-of-Life & Power User Features
- [x] Auto-save (every 5 minutes, persists tables + annotations)
- [x] Tooltips and onboarding walkthrough (? button in toolbar, auto-shows on first file load)
- [x] Table transpose (one-click swap rows/columns)
- [x] Advanced sort (multi-key sorting via FormatPanel → Sorting section)
- [x] Export table config as Python/pandas script
- [x] Data refresh (reload source file without losing config)
- [x] Blank suppression toggle (hide zero/blank rows/columns)
