"""One-off: export current (proposed) plan pricing across every billing cycle to an
.xlsx for the owner to review/edit by hand, then hand back for import.

Does not touch the database — reads the same plan dicts as seed_plans.py and applies
the exact same _calc_amount() formula billing.py uses in production, so the numbers
here match what a customer would actually be charged.

Run: cd backend && ./venv/Scripts/python.exe scripts/export_pricing_excel.py
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment
from openpyxl.utils import get_column_letter

from scripts.seed_plans import UNIFIED_PLANS

CYCLE_MONTHS       = {"monthly": 1, "6month": 6, "annual": 12}
CYCLE_BONUS_MONTHS = {"monthly": 0, "6month": 0, "annual": 2}
CYCLE_LABELS       = {"monthly": "Monthly", "6month": "6-Month", "annual": "Annual"}

# Mirrors backend/app/api/routes/billing.py:TIER_CYCLE_RATE — every paid tier
# has an explicit flat monthly rate per cycle now (each tier's discount % is
# independent, not derivable from a shared formula). Keep this in sync by hand
# whenever billing.py's TIER_CYCLE_RATE changes.
TIER_CYCLE_RATE = {
    "starter": {"monthly": 8399, "6month": 7499, "annual": 6499},
    "growth":  {"monthly": 12999, "6month": 11999, "annual": 9999},
    "pro":     {"monthly": 19999, "6month": 16499, "annual": 15999},
}


def calc_effective_monthly(price_inr: int, tier: str, cycle: str) -> int:
    """Same math as backend/app/api/routes/billing.py:_calc_amount, reduced to the
    per-month rate shown on the pricing page."""
    if price_inr <= 0:
        return 0
    months = CYCLE_MONTHS[cycle]
    tier_rates = TIER_CYCLE_RATE.get(tier)
    if tier_rates:
        rate = tier_rates.get(cycle, price_inr)
        total = rate * months
    else:
        bonus = CYCLE_BONUS_MONTHS.get(cycle, 0)
        paid_months = months - bonus
        total = price_inr * paid_months
    return int(total / months)


def main():
    unified = sorted(UNIFIED_PLANS, key=lambda p: p["sort_order"])

    wb = Workbook()
    ws = wb.active
    ws.title = "Pricing by tenure"

    header_fill = PatternFill(start_color="0EA5E9", end_color="0EA5E9", fill_type="solid")
    header_font = Font(color="FFFFFF", bold=True)
    bold = Font(bold=True)

    headers = ["Plan", "Tier", "Submissions/mo", "Storage (MB)", "Active forms"] + [CYCLE_LABELS[c] for c in CYCLE_MONTHS]
    for col, h in enumerate(headers, start=1):
        cell = ws.cell(row=1, column=col, value=h)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = Alignment(horizontal="center")

    for row, plan in enumerate(unified, start=2):
        ws.cell(row=row, column=1, value=plan["name"]).font = bold
        ws.cell(row=row, column=2, value=plan["tier"])
        ws.cell(row=row, column=3, value=plan["submissions_limit"] if plan["submissions_limit"] is not None else "Unlimited")
        ws.cell(row=row, column=4, value=plan["storage_limit_mb"] if plan["storage_limit_mb"] is not None else "Unlimited")
        ws.cell(row=row, column=5, value=plan["active_forms_limit"] if plan["active_forms_limit"] is not None else "Unlimited")
        label = "Contact us" if plan["tier"] == "custom" else "Free"
        for col_offset, cycle in enumerate(CYCLE_MONTHS):
            val = calc_effective_monthly(plan["price_inr"], plan["tier"], cycle)
            ws.cell(row=row, column=6 + col_offset, value=(val if plan["price_inr"] > 0 else label))

    for col in range(1, len(headers) + 1):
        ws.column_dimensions[get_column_letter(col)].width = 16

    ws.freeze_panes = "A2"

    note_row = len(unified) + 3
    ws.cell(row=note_row, column=1, value="All figures are effective ₹/month for that commitment length (what the customer actually pays, averaged per month).").font = Font(italic=True, size=9)
    ws.cell(row=note_row + 1, column=1, value="Edit any number below and send back — I'll apply it to the live plan config.").font = Font(italic=True, size=9)

    out_path = os.path.join(os.path.dirname(__file__), "..", "..", "fieldgovern_pricing_by_tenure.xlsx")
    wb.save(out_path)
    print(f"Saved: {os.path.abspath(out_path)}")


if __name__ == "__main__":
    main()
