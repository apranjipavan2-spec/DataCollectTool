"""Aggregate-only results for public share links (routes/dashboard_shares.py).

Privacy rules (agreed 2026-11-04, see api/PARTNER_INTEGRATION_GUIDE.md):
  1. Enumerators appear as "Enumerator 1..N", never names or phones.
  2. Any count of 1-4 is shown as "<5" (MIN_CELL). If that leaves exactly one
     hidden cell in a breakdown whose total is shown, the next-smallest cell is
     hidden too, so the hidden one can't be worked out by subtraction.
  3. Only choice and rating questions are summarised. Free text, numbers, GPS,
     photos and anything marked is_identifier are never read.

Pure functions — no DB access — so the rules are unit-testable.
"""
from __future__ import annotations

from collections import Counter
from typing import Iterable

MIN_CELL = 5
_SUMMARISED_TYPES = {"single_choice", "multiple_choice", "rating"}


def suppress(counts: list[tuple[str, int]], denominator: int) -> list[dict]:
    """[(label, count)] → [{label, count, pct, suppressed}] with small cells hidden."""
    hidden = {i for i, (_, c) in enumerate(counts) if 0 < c < MIN_CELL}
    if len(hidden) == 1:
        rest = sorted((c, i) for i, (_, c) in enumerate(counts) if i not in hidden and c > 0)
        if rest:
            hidden.add(rest[0][1])
    out = []
    for i, (label, c) in enumerate(counts):
        if i in hidden:
            out.append({"label": label, "count": None, "pct": None, "suppressed": True})
        else:
            pct = round(100 * c / denominator, 1) if denominator else 0.0
            out.append({"label": label, "count": c, "pct": pct, "suppressed": False})
    return out


def _iter_fields(schema: dict):
    def walk(sections):
        for s in sections or []:
            yield from s.get("fields", [])
            yield from walk(s.get("subsections"))
    yield from walk((schema or {}).get("sections", []))


def _values(v) -> list[str]:
    if v is None or v == "":
        return []
    if isinstance(v, list):
        return [str(x) for x in v if x not in (None, "")]
    if isinstance(v, str) and ("," in v or " " in v):
        return [p for p in (x.strip() for x in v.replace(",", " ").split()) if p]
    return [str(v)]


def build_results(schema: dict, rows: Iterable[tuple[dict, object, str | None]]) -> dict:
    """rows = (data_json, enumerator_id, 'YYYY-MM-DD' or None) for each counted submission."""
    rows = list(rows)
    total = len(rows)
    if total < MIN_CELL:
        return {"total": None, "total_suppressed": True, "by_day": [], "by_enumerator": [], "questions": []}

    by_day = Counter(d for _, _, d in rows if d)
    days = sorted(by_day.items())

    per_enum = Counter(str(e) for _, e, _ in rows if e)
    ranked = [(f"Enumerator {i}", c) for i, (_, c) in enumerate(per_enum.most_common(), start=1)]

    questions = []
    for f in _iter_fields(schema):
        ftype = f.get("type")
        key = f.get("name") or f.get("id")
        if ftype not in _SUMMARISED_TYPES or not key or f.get("is_identifier"):
            continue
        labels = {str(o.get("value")): o.get("label") or str(o.get("value")) for o in f.get("options") or []}
        tally: Counter = Counter()
        answered = 0
        for data, _, _ in rows:
            vals = _values((data or {}).get(key))
            if vals:
                answered += 1
                tally.update(set(vals))
        q = {"label": f.get("label") or key, "type": ftype, "answered": answered}
        if answered < MIN_CELL:
            q.update(answered=None, suppressed=True, options=[])
        else:
            extra = [k for k in tally if k not in labels]  # e.g. rating values 1..10
            order = list(labels) + sorted(extra, key=lambda k: (not k.isdigit(), int(k) if k.isdigit() else 0, k))
            q.update(suppressed=False, options=suppress([(labels.get(k, k), tally[k]) for k in order], answered))
        questions.append(q)

    return {
        "total": total,
        "total_suppressed": False,
        "by_day": [{"date": d, **cell} for (d, _), cell in zip(days, suppress(days, total))],
        "by_enumerator": suppress(ranked, total),
        "questions": questions,
    }


# ── Exact totals for the organisation's own systems (API key) ─────────────────
# No suppression: the caller's API key can already pull every raw row, so exact
# totals disclose strictly less. Identifier fields are still never read.

_NUMERIC_TYPES = {"number", "decimal", "rating"}
_CHOICE_TYPES = {"single_choice", "multiple_choice", "rating"}


def _to_float(v):
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return float(v)
    if isinstance(v, str):
        try:
            return float(v.strip())
        except ValueError:
            return None
    return None


def _summarise(fields: list[dict], datas: list[dict]) -> dict:
    numbers, choices = {}, {}
    for f in fields:
        key, ftype = f.get("name") or f.get("id"), f.get("type")
        if ftype in _NUMERIC_TYPES:
            vals = [x for x in (_to_float((d or {}).get(key)) for d in datas) if x is not None]
            numbers[key] = {
                "label": f.get("label") or key, "n": len(vals),
                "sum": round(sum(vals), 6) if vals else None,
                "average": round(sum(vals) / len(vals), 6) if vals else None,
                "min": min(vals) if vals else None, "max": max(vals) if vals else None,
            }
        if ftype in _CHOICE_TYPES:
            labels = {str(o.get("value")): o.get("label") or str(o.get("value")) for o in f.get("options") or []}
            tally: Counter = Counter()
            answered = 0
            for d in datas:
                vals = _values((d or {}).get(key))
                if vals:
                    answered += 1
                    tally.update(set(vals))
            extra = [k for k in tally if k not in labels]
            order = list(labels) + sorted(extra, key=lambda k: (not k.isdigit(), int(k) if k.isdigit() else 0, k))
            choices[key] = {
                "label": f.get("label") or key, "n": answered,
                "options": [{"value": k, "label": labels.get(k, k), "count": tally[k]} for k in order],
            }
    return {"count": len(datas), "numbers": numbers, "choices": choices}


def build_exact_totals(schema: dict, rows: Iterable[tuple[dict, str | None]]) -> dict:
    """rows = (data_json, period key e.g. '2026-10' or None). Returns overall + per-period totals."""
    fields = [f for f in _iter_fields(schema)
              if not f.get("is_identifier") and (f.get("name") or f.get("id"))
              and f.get("type") in (_NUMERIC_TYPES | _CHOICE_TYPES)]
    rows = list(rows)
    buckets: dict[str, list[dict]] = {}
    for data, period in rows:
        if period is not None:
            buckets.setdefault(period, []).append(data)
    return {
        "overall": _summarise(fields, [d for d, _ in rows]),
        "groups": [{"period": p, **_summarise(fields, ds)} for p, ds in sorted(buckets.items())],
        "questions": [{"name": f.get("name") or f.get("id"), "label": f.get("label"), "type": f.get("type")}
                      for f in fields],
    }
