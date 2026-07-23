"""One-off (not wired into any route): writes the recovered _statConfig for
the confidently-resolved GK-INTERIM stat tables directly into the project
file, so they recompute correctly on next load.

Safety: never hand-types the real (long, survey-question-text) column names —
every column is located by a short, human-chosen keyword searched against the
real column pool, and a table is only patched if every keyword matches
EXACTLY ONE known column. Ambiguous (0 or 2+ matches) keywords cause that
table to be skipped and reported, never silently guessed. Writes a
timestamped backup of the original file before touching it.

Usage: python3 apply_stat_recovery.py <project.tableforge> <source.xlsx>
"""
import json
import shutil
import sys
import time
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.path.insert(0, str(Path(__file__).parent))
from recover_stat_configs import collect_known_columns, load_headers_from_source  # noqa: E402

# (exact table title, statType, [keyword per needed column])
# Keywords are matched case-insensitively as substrings; each must resolve to
# exactly one column or the table is skipped.
PATCH_PLAN = [
    ("Correlation between Borewell Depth and Water Yield for Interim-GK Beneficiaries", "correlation",
     ["3.1.7. depth drilled (feet)", "3.1.9. current water yield (now)"]),
    ("Cross-Tabulation + Cramér’s V - INM", "crosstab",
     ["6. inm (integrated nutrient management) > before", "6. inm (integrated nutrient management) > after"]),
    ("Cross-Tabulation + Cramér’s V - IPM", "crosstab",
     ["5. ipm (integrated pest management) > before", "5. ipm (integrated pest management) > after"]),
    ("Cross-Tabulation + Cramér’s V - ED Vs IPM", "crosstab",
     ["highest education attainment of applicant", "5. ipm (integrated pest management) > after"]),
    ("Cross-Tabulation + Cramér’s V - ED - INM", "crosstab",
     ["highest education attainment of applicant", "6. inm (integrated nutrient management) > after"]),
    ("Cross-Tabulation + Cramér’s V - ED - MICROIRR", "crosstab",
     ["highest education attainment of applicant", "2. micro irrigation > after"]),
    ("One-Way ANOVA + η²/ω² - depth of borewell", "anova",
     ["3.1.7. depth drilled (feet)", "1.1 beneficiary identification details > district"]),
    ("One-Way ANOVA + η²/ω² - water yield", "anova",
     ["3.1.9. current water yield (now)", "1.1 beneficiary identification details > district"]),
    ("One-Way ANOVA + η²/ω² - % irrigation land increase", "anova",
     ["% increase in irrigation", "1.1 beneficiary identification details > district"]),
    ("Paired t-Test (Pre vs Post) - Irrig Before and After", "paired_ttest",
     ["before irrig %", "after irrig %"]),
    ("Paired t-Test (Pre vs Post) - before and after yield of water", "paired_ttest",
     ["3.1.8. initial water yield/flow rate (when drilled)", "3.1.9. current water yield (now)"]),
    ("One-Way ANOVA + η²/ω² - Dist Vs Income", "anova",
     ["Total Household Income After", "1.1 beneficiary identification details > district"]),
]

# Deliberately NOT included (left for manual rebuild) — either only one real
# variable could ever be found (a crosstab/ANOVA needs two), the two
# candidates were ambiguous with no way to pick correctly, or the title is
# fully generic with zero information:
#   - Cross-Tabulation - Borewell Drilling Success Status (candidates looked wrong)
#   - Cross-Tabulation -  Water access in dry months (only 1 variable found)
#   - Cross-Tabulation – Dependence on Rainfall (only 1 variable found)
#   - Cross-Tabulation - Time taken / Time taken by Year (ambiguous between two unrelated fields)
#   - Paired t-Test (Pre vs Post)  x2 (generic title, no info)
#   - Correlation Matrix (Pearson) (generic title, no info)


def find_unique(keyword: str, known_cols):
    matches = [c for c in known_cols if keyword.lower() in c.lower()]
    return matches


def main():
    if len(sys.argv) < 3:
        print("usage: apply_stat_recovery.py <project.tableforge> <source.xlsx>")
        return
    proj_path = Path(sys.argv[1])
    source_xlsx = sys.argv[2]

    data = json.loads(proj_path.read_text(encoding="utf-8"))
    known_cols = collect_known_columns(data) | load_headers_from_source(source_xlsx)

    tables_by_title = {}
    for t in data.get("tables", []):
        tables_by_title.setdefault(t.get("title") or "", []).append(t)

    patched, skipped = [], []
    for title, stat_type, keywords in PATCH_PLAN:
        matches = tables_by_title.get(title)
        if not matches:
            skipped.append((title, "table not found by exact title match"))
            continue
        resolved_cols = []
        ok = True
        for kw in keywords:
            hits = find_unique(kw, known_cols)
            if len(hits) != 1:
                skipped.append((title, f"keyword {kw!r} matched {len(hits)} columns (need exactly 1)"))
                ok = False
                break
            resolved_cols.append(hits[0])
        if not ok:
            continue
        for t in matches:
            t["_statResult"] = True
            t["_statConfig"] = {
                "statType": stat_type,
                "columns": resolved_cols,
                "alpha": 0.05,
                "analysisFilters": {},
                "useProjectFilter": True,
            }
        patched.append((title, stat_type, resolved_cols))

    if not patched:
        print("Nothing patched — no changes written.")
        for title, reason in skipped:
            print(f"  SKIPPED {title!r}: {reason}")
        return

    backup_path = proj_path.with_suffix(f".tableforge.backup-{int(time.time())}")
    shutil.copy2(proj_path, backup_path)
    print(f"Backup written to {backup_path}")

    proj_path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")

    print(f"\n{len(patched)} table(s) patched:")
    for title, stat_type, cols in patched:
        print(f"  [{stat_type}] {title}")
        for c in cols:
            print(f"      -> {c}")
    print(f"\n{len(skipped)} table(s) skipped:")
    for title, reason in skipped:
        print(f"  {title!r}: {reason}")


if __name__ == "__main__":
    main()
