"""Triangulation & external-benchmark library (Phase 4 — Survey Analysis Studio).

Loads a JSON-backed benchmark library (`tools/tableforge/benchmarks/*.json`) and
exposes endpoints to:
  - Search / list indicators by query, geography, topic.
  - Compute deviation + one-sample significance test of a user value vs. a benchmark.
  - Bulk-triangulate an Analysis Pack (or a column directly) using indicator IDs.
  - Contribute new indicators (writes to a user-extensions JSON file).

Indicator schema is documented in `tools/tableforge/benchmarks/sources.md`.
"""

from __future__ import annotations

import json
import math
import re
import traceback
from pathlib import Path
from typing import Optional, Literal

import numpy as np
import pandas as pd
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from scipy import stats as sp_stats

from ..shared import (
    BASE_DIR,
    datasets,
    column_roles,
    apply_metrics_and_bins,
    sanitize_for_json,
    add_audit_log,
)
from . import inferential_utils as iu

router = APIRouter()


BENCHMARKS_DIR = BASE_DIR / "benchmarks"  # tools/tableforge/benchmarks
USER_EXTENSIONS_FILE = BENCHMARKS_DIR / "user_extensions.json"


# ───────────────────────────── Library loading ─────────────────────────────

_INDICATOR_CACHE: dict[str, list[dict]] = {}


def _load_library() -> list[dict]:
    """Load all *.json files in benchmarks/ and flatten the indicators list.
    Cached at module level — restart backend to pick up file edits."""
    if "indicators" in _INDICATOR_CACHE:
        return _INDICATOR_CACHE["indicators"]
    all_indicators: list[dict] = []
    if BENCHMARKS_DIR.exists():
        for fp in sorted(BENCHMARKS_DIR.glob("*.json")):
            try:
                data = json.loads(fp.read_text(encoding="utf-8"))
                inds = data.get("indicators") or []
                for ind in inds:
                    ind["_source_file"] = fp.name
                    all_indicators.append(ind)
            except Exception:
                continue
    _INDICATOR_CACHE["indicators"] = all_indicators
    return all_indicators


def _invalidate_cache() -> None:
    _INDICATOR_CACHE.pop("indicators", None)


def _find_indicator(indicator_id: str) -> Optional[dict]:
    for ind in _load_library():
        if ind.get("indicator_id") == indicator_id:
            return ind
    return None


# ───────────────────────────── Models ─────────────────────────────


class BenchmarkSearch(BaseModel):
    q: Optional[str] = None
    geography_level: Optional[str] = None
    geography_code: Optional[str] = None
    topic: Optional[str] = None
    limit: int = 50


class TriangulateOne(BaseModel):
    """Compare a single value (or proportion) against a benchmark indicator."""
    indicator_id: str
    value: float                         # user's point estimate
    sample_size: Optional[int] = None    # n — required for significance test
    standard_error: Optional[float] = None  # if known, skip n-based SE estimate
    is_proportion: bool = False          # value is a proportion (0-100 by default, see proportion_scale)
    proportion_scale: Literal["percent", "fraction"] = "percent"


class TriangulateAuto(BaseModel):
    """Run triangulation directly against a dataset column.
    Uses the column's `benchmark_link` from column_roles, or an explicit indicator_id."""
    dataset_id: str
    column: str
    indicator_id: Optional[str] = None
    weight_col: Optional[str] = None
    filters: dict = {}
    is_proportion: Optional[bool] = None  # auto-detect if None
    proportion_value: Optional[str] = None  # which value counts as "yes" for proportion (e.g., "Yes", "1")


class TriangulatePack(BaseModel):
    """Triangulate a list of (indicator_id, value, n) rows in one pass — useful for
    attaching benchmarks to an Analysis Pack."""
    items: list[dict]                    # [{indicator_id, value, sample_size, is_proportion?}]


class ContributeIndicator(BaseModel):
    indicator: dict


# ───────────────────────────── Search / list ─────────────────────────────


def _ind_matches(ind: dict, q: Optional[str], level: Optional[str],
                  code: Optional[str], topic: Optional[str]) -> bool:
    if level and ind.get("geography_level") != level:
        return False
    if code and ind.get("geography_code") != code:
        return False
    if topic and ind.get("topic") != topic:
        return False
    if q:
        ql = q.lower()
        hay = " ".join(str(ind.get(k, "")) for k in ("name", "source", "geography_name", "topic", "notes", "indicator_id")).lower()
        if ql not in hay:
            return False
    return True


@router.get("/api/benchmarks/list")
async def list_benchmarks(q: Optional[str] = None, geography_level: Optional[str] = None,
                          geography_code: Optional[str] = None, topic: Optional[str] = None,
                          limit: int = 200):
    library = _load_library()
    out = [ind for ind in library if _ind_matches(ind, q, geography_level, geography_code, topic)]
    return {
        "indicators": out[:limit],
        "total": len(out),
        "library_size": len(library),
    }


@router.get("/api/benchmarks/{indicator_id}")
async def get_benchmark(indicator_id: str):
    ind = _find_indicator(indicator_id)
    if not ind:
        raise HTTPException(404, f"Indicator not found: {indicator_id}")
    return ind


@router.get("/api/benchmarks/meta/topics")
async def list_topics():
    lib = _load_library()
    topics = sorted({i.get("topic") for i in lib if i.get("topic")})
    levels = sorted({i.get("geography_level") for i in lib if i.get("geography_level")})
    geos = sorted({i.get("geography_code") for i in lib if i.get("geography_code")})
    return {"topics": topics, "levels": levels, "geographies": geos}


# ───────────────────────────── Triangulation maths ─────────────────────────────


def _to_fraction(value: float, scale: str) -> float:
    return float(value) / 100.0 if scale == "percent" else float(value)


def _abs_rel_dev(user_val: float, bench_val: float) -> tuple[float, float]:
    abs_dev = user_val - bench_val
    rel_dev = (abs_dev / bench_val * 100.0) if bench_val not in (0, None) and not math.isnan(bench_val) else float("nan")
    return abs_dev, rel_dev


def _z_proportion(user_p: float, bench_p: float, n: int) -> tuple[float, float]:
    """One-sample z test on a proportion vs benchmark."""
    if n <= 0 or bench_p <= 0 or bench_p >= 1:
        return float("nan"), float("nan")
    se = math.sqrt(bench_p * (1 - bench_p) / n)
    if se == 0:
        return float("nan"), float("nan")
    z = (user_p - bench_p) / se
    p = 2 * (1 - sp_stats.norm.cdf(abs(z)))
    return z, p


def _t_mean_one_sample(user_mean: float, bench_val: float, se: float, n: int) -> tuple[float, float]:
    """One-sample t test on a mean vs benchmark, using the user's SE."""
    if n <= 1 or se <= 0:
        return float("nan"), float("nan")
    t = (user_mean - bench_val) / se
    p = 2 * (1 - sp_stats.t.cdf(abs(t), df=n - 1))
    return t, p


def _flag(rel_dev_pct: float) -> str:
    if rel_dev_pct is None or math.isnan(rel_dev_pct):
        return "unknown"
    a = abs(rel_dev_pct)
    if a < 5:
        return "matches benchmark"
    if a < 15:
        return "minor deviation"
    if a < 30:
        return "notable deviation"
    return "large deviation"


def _triangulate_value(ind: dict, value: float, sample_size: Optional[int],
                       is_proportion: bool, proportion_scale: str = "percent",
                       standard_error: Optional[float] = None) -> dict:
    bench_val = float(ind.get("value")) if ind.get("value") is not None else float("nan")
    bench_unit = ind.get("unit", "")
    bench_is_percent = bench_unit in ("percent", "fraction") or "percent" in bench_unit
    # Auto-normalise if both are clearly percentages
    if bench_is_percent and is_proportion:
        user_p = _to_fraction(value, proportion_scale)
        bench_p = bench_val / 100.0 if bench_unit == "percent" else bench_val
        abs_dev_pct, rel_dev_pct = _abs_rel_dev(user_p * 100, bench_val if bench_unit == "percent" else bench_p * 100)
        z, p = _z_proportion(user_p, bench_p, sample_size) if sample_size else (float("nan"), float("nan"))
        return {
            "indicator": ind,
            "user_value": iu.safe_round(value),
            "benchmark_value": iu.safe_round(bench_val),
            "unit": bench_unit,
            "absolute_deviation": iu.safe_round(abs_dev_pct),
            "relative_deviation_pct": iu.safe_round(rel_dev_pct, 2),
            "test": {"name": "one-sample z (proportion)", "stat": iu.safe_round(z),
                      "p": iu.safe_round(p, 6)},
            "n": sample_size,
            "flag": _flag(rel_dev_pct),
        }
    # Mean / continuous comparison
    abs_dev, rel_dev_pct = _abs_rel_dev(value, bench_val)
    t = p = float("nan")
    if sample_size and standard_error and standard_error > 0:
        t, p = _t_mean_one_sample(value, bench_val, standard_error, sample_size)
    return {
        "indicator": ind,
        "user_value": iu.safe_round(value),
        "benchmark_value": iu.safe_round(bench_val),
        "unit": bench_unit,
        "absolute_deviation": iu.safe_round(abs_dev),
        "relative_deviation_pct": iu.safe_round(rel_dev_pct, 2),
        "test": {"name": "one-sample t (mean)", "stat": iu.safe_round(t),
                  "p": iu.safe_round(p, 6)},
        "n": sample_size,
        "flag": _flag(rel_dev_pct),
    }


# ───────────────────────────── Endpoints ─────────────────────────────


@router.post("/api/triangulate")
async def triangulate_one(req: TriangulateOne):
    ind = _find_indicator(req.indicator_id)
    if not ind:
        raise HTTPException(404, f"Indicator not found: {req.indicator_id}")
    try:
        result = _triangulate_value(
            ind, req.value, req.sample_size, req.is_proportion,
            req.proportion_scale, req.standard_error,
        )
        return sanitize_for_json({
            "result": result,
            "interpretation": _build_interpretation(result),
        })
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(400, f"Triangulation error: {e}")


def _build_interpretation(result: dict) -> str:
    ind = result["indicator"]
    user = result["user_value"]
    bench = result["benchmark_value"]
    rel = result.get("relative_deviation_pct")
    flag = result.get("flag")
    p = result.get("test", {}).get("p")
    parts = [
        f"Your value {user} vs {ind.get('name')} benchmark {bench} ({ind.get('source')}, {ind.get('year')})."
    ]
    if rel is not None:
        parts.append(f"Relative deviation: {rel:+.1f}% — {flag}.")
    if p is not None and not (isinstance(p, float) and math.isnan(p)):
        verdict = "significantly different from benchmark" if p < 0.05 else "not significantly different"
        parts.append(f"One-sample test p = {p:.4f} → {verdict}.")
    if ind.get("notes"):
        parts.append(f"Note: {ind['notes']}")
    return " ".join(parts)


def _prepare_df(dataset_id: str, filters: dict | None) -> pd.DataFrame:
    if dataset_id not in datasets:
        raise HTTPException(404, "Dataset not found")
    df = datasets[dataset_id]["df"].copy()
    df = apply_metrics_and_bins(df, dataset_id)
    for col, vals in (filters or {}).items():
        if vals and col in df.columns:
            df = df[df[col].astype(str).isin([str(v) for v in vals])]
    return df


@router.post("/api/triangulate/auto")
async def triangulate_auto(req: TriangulateAuto):
    """Pull the user value (mean or proportion) directly from a dataset column
    and triangulate it against the column's `benchmark_link` (or an override)."""
    try:
        df = _prepare_df(req.dataset_id, req.filters)
        if req.column not in df.columns:
            raise HTTPException(400, f"Column not found: {req.column}")

        # Resolve indicator
        indicator_id = req.indicator_id
        if not indicator_id:
            roles = column_roles.get(req.dataset_id, {})
            indicator_id = roles.get(req.column, {}).get("benchmark_link")
        if not indicator_id:
            raise HTTPException(400, "No indicator_id provided and column has no benchmark_link in metadata.")
        ind = _find_indicator(indicator_id)
        if not ind:
            raise HTTPException(404, f"Indicator not found: {indicator_id}")

        series = df[req.column]
        # Decide proportion vs mean
        is_prop = req.is_proportion
        if is_prop is None:
            uniq = series.dropna().unique()
            is_prop = (len(uniq) <= 5) or ind.get("unit") in ("percent", "fraction")

        wt = None
        if req.weight_col and req.weight_col in df.columns:
            wt = pd.to_numeric(df[req.weight_col], errors="coerce").fillna(0)

        if is_prop:
            target = req.proportion_value
            if target is None:
                # Pick the modal "positive-looking" value
                str_series = series.dropna().astype(str)
                vc = str_series.value_counts()
                positive_hints = {"yes", "1", "true", "y", "agree", "satisfied"}
                target = next((v for v in vc.index if v.lower() in positive_hints), vc.index[0])
            mask = series.notna()
            if wt is not None:
                w_total = float(wt[mask].sum())
                w_pos = float(wt[mask & (series.astype(str) == str(target))].sum())
                p = w_pos / w_total if w_total > 0 else float("nan")
                n = int(mask.sum())  # unweighted N for SE
            else:
                n = int(mask.sum())
                k = int((series.astype(str) == str(target)).sum())
                p = k / n if n > 0 else float("nan")
            user_value = p * 100  # percent for display consistency
            se = None
            result = _triangulate_value(ind, user_value, n, is_proportion=True, proportion_scale="percent", standard_error=se)
            result["selected_positive_value"] = str(target)
        else:
            num = pd.to_numeric(series, errors="coerce")
            mask = num.notna()
            if wt is not None:
                w = wt[mask]
                v = num[mask]
                w_total = float(w.sum())
                mean_val = float((v * w).sum() / w_total) if w_total > 0 else float("nan")
                # Weighted SE: approximate via variance of weighted residuals
                resid2 = ((v - mean_val) ** 2 * w).sum() / w_total if w_total > 0 else float("nan")
                se = math.sqrt(resid2 / mask.sum()) if mask.sum() else float("nan")
                n = int(mask.sum())
            else:
                v = num[mask]
                n = int(len(v))
                mean_val = float(v.mean()) if n else float("nan")
                se = float(v.std(ddof=1) / math.sqrt(n)) if n > 1 else float("nan")
            result = _triangulate_value(ind, mean_val, n, is_proportion=False, standard_error=se)

        add_audit_log(req.dataset_id, "triangulate_auto",
                       f"{req.column} vs {indicator_id} → flag={result.get('flag')}")
        return sanitize_for_json({
            "result": result,
            "interpretation": _build_interpretation(result),
        })
    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(400, f"Auto-triangulation error: {e}")


@router.post("/api/triangulate/pack")
async def triangulate_pack(req: TriangulatePack):
    """Batch endpoint: triangulate many (indicator_id, value, n) rows in one call."""
    results = []
    for item in req.items:
        ind = _find_indicator(item.get("indicator_id"))
        if not ind:
            results.append({"indicator_id": item.get("indicator_id"), "error": "not found"})
            continue
        try:
            r = _triangulate_value(
                ind,
                float(item.get("value")),
                int(item["sample_size"]) if item.get("sample_size") else None,
                bool(item.get("is_proportion", False)),
                item.get("proportion_scale", "percent"),
                float(item["standard_error"]) if item.get("standard_error") else None,
            )
            r["row_label"] = item.get("row_label")
            r["interpretation"] = _build_interpretation(r)
            results.append(r)
        except Exception as e:
            results.append({"indicator_id": item.get("indicator_id"), "error": str(e)})

    # Tabular form for direct rendering in the UI
    headers = ["Indicator", "Source", "Year", "User Value", "Benchmark", "Δ", "Δ %", "p", "Flag"]
    rows = []
    for r in results:
        if "error" in r:
            rows.append([r.get("indicator_id"), "—", "—", "—", "—", "—", "—", "—", r["error"]])
            continue
        ind = r["indicator"]
        rows.append([
            ind.get("name"),
            ind.get("source"),
            ind.get("year"),
            r["user_value"],
            r["benchmark_value"],
            r["absolute_deviation"],
            r["relative_deviation_pct"],
            r["test"]["p"],
            r.get("flag"),
        ])
    return sanitize_for_json({
        "results": results,
        "headers": headers,
        "rows": rows,
        "row_count": len(rows),
        "col_count": len(headers),
        "table_type": "triangulation_pack",
    })


@router.post("/api/benchmarks/contribute")
async def contribute_indicator(req: ContributeIndicator):
    """Append a user-contributed indicator to user_extensions.json.
    Caller is responsible for filling indicator_id, name, source, value, unit."""
    ind = req.indicator
    required = ["indicator_id", "name", "source", "value"]
    missing = [k for k in required if not ind.get(k)]
    if missing:
        raise HTTPException(400, f"Missing required fields: {missing}")
    if not re.match(r"^[a-zA-Z0-9_\-]+$", ind["indicator_id"]):
        raise HTTPException(400, "indicator_id must be alphanumeric + underscore/dash only")
    BENCHMARKS_DIR.mkdir(parents=True, exist_ok=True)
    if USER_EXTENSIONS_FILE.exists():
        existing = json.loads(USER_EXTENSIONS_FILE.read_text(encoding="utf-8"))
    else:
        existing = {"schema_version": "1.0", "indicators": []}
    # Replace if id already exists
    existing["indicators"] = [i for i in existing["indicators"] if i.get("indicator_id") != ind["indicator_id"]]
    existing["indicators"].append(ind)
    USER_EXTENSIONS_FILE.write_text(json.dumps(existing, indent=2), encoding="utf-8")
    _invalidate_cache()
    return {"status": "ok", "indicator_id": ind["indicator_id"], "library_size": len(_load_library())}


@router.delete("/api/benchmarks/contribute/{indicator_id}")
async def remove_user_indicator(indicator_id: str):
    if not USER_EXTENSIONS_FILE.exists():
        raise HTTPException(404, "No user extensions file")
    existing = json.loads(USER_EXTENSIONS_FILE.read_text(encoding="utf-8"))
    before = len(existing.get("indicators", []))
    existing["indicators"] = [i for i in existing["indicators"] if i.get("indicator_id") != indicator_id]
    after = len(existing["indicators"])
    if after == before:
        raise HTTPException(404, f"Indicator not found in user extensions: {indicator_id}")
    USER_EXTENSIONS_FILE.write_text(json.dumps(existing, indent=2), encoding="utf-8")
    _invalidate_cache()
    return {"status": "ok"}
