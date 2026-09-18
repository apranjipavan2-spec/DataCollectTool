"""
Stamp the current live plan prices into the static website so SEO/JSON-LD and
no-JS fallback text never go stale, even though the marketing pages also fetch
live prices at runtime via /billing/public-pricing (see website/assets/pricing-sync.js).

Run whenever a plan price changes in the admin (super-admin plan editor, or a
direct PATCH /billing/admin/plans/{id}):
    cd backend && python -m scripts.sync_website_prices

Covers:
  1. `<span data-fg-price="tier.cycle">₹old</span>` slots added across website/*.html.
  2. JSON-LD Offer objects with an explicit "name": "Starter"/"Growth"/"Pro".
  3. The bare `"offers": {"@type": "Offer", "price": "..."}` pattern (index.html),
     treated as the Starter/entry monthly price — the convention used site-wide.

Does NOT touch hand-written prose/meta copy ("Free forever, plans from ₹7,999/month" in
<title>/<meta> tags) — those often need a human sentence rewrite alongside a price change
(e.g. "up to 70% less" claims depend on competitor pricing too), not a blind find-replace.
Spot-check those after running this script.
"""
import os, re, sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.core.database import SessionLocal
from app.models.billing import Plan
from app.api.routes.billing import _calc_amount, CYCLE_MONTHS

WEBSITE_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "website")

DATA_ATTR_RE = re.compile(
    r'(data-fg-price="(?P<tier>free|starter|growth|pro|custom)\.(?P<cycle>monthly|3month|6month|annual|3year)"[^>]*>)'
    r'[^<]*'
)
JSONLD_NAMED_OFFER_RE = re.compile(
    r'("name":\s*"(?P<tier>Starter|Growth|Pro)"[^}]*?"price":\s*")\d+(?=")',
    re.DOTALL,
)
JSONLD_BARE_OFFER_RE = re.compile(
    r'("offers":\s*\{"@type":\s*"Offer",\s*"price":\s*")\d+(?=")'
)


def fmt(n: int) -> str:
    return f"₹{n:,}"


def build_price_table(plans: list[Plan]) -> dict:
    """{'starter': {'monthly': 7999, 'annual': 6999, ...}, ...}"""
    table = {}
    for p in plans:
        table[p.tier] = {
            cycle: int(_calc_amount(p, cycle) / months) if p.price_inr else 0
            for cycle, months in CYCLE_MONTHS.items()
        }
    return table


def patch_file(path: str, table: dict) -> int:
    with open(path, "r", encoding="utf-8") as f:
        text = f.read()
    original = text

    def data_attr_sub(m):
        cycle_price = table.get(m.group("tier"), {}).get(m.group("cycle"))
        if cycle_price is None:
            return m.group(0)
        return m.group(1) + fmt(cycle_price)

    text = DATA_ATTR_RE.sub(data_attr_sub, text)

    def named_offer_sub(m):
        tier = m.group("tier").lower()
        monthly = table.get(tier, {}).get("monthly")
        if monthly is None:
            return m.group(0)
        return m.group(1) + str(monthly)

    text = JSONLD_NAMED_OFFER_RE.sub(named_offer_sub, text)

    starter_monthly = table.get("starter", {}).get("monthly")
    if starter_monthly is not None:
        text = JSONLD_BARE_OFFER_RE.sub(lambda m: m.group(1) + str(starter_monthly), text)

    if text != original:
        with open(path, "w", encoding="utf-8") as f:
            f.write(text)
        return 1
    return 0


def sync():
    db = SessionLocal()
    try:
        plans = (
            db.query(Plan)
            .filter(Plan.segment == "unified", Plan.is_active == True)  # noqa: E712
            .all()
        )
    finally:
        db.close()

    if not plans:
        print("[sync_website_prices] No unified plans found in DB — has seed_plans run?")
        return

    table = build_price_table(plans)
    changed = 0
    for root, _, files in os.walk(WEBSITE_DIR):
        for name in files:
            if name.endswith(".html"):
                changed += patch_file(os.path.join(root, name), table)

    print(f"[sync_website_prices] {changed} file(s) updated.")


if __name__ == "__main__":
    sync()
