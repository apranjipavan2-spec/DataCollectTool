"""Geographic aggregation — value-by-area summaries with optional benchmark deviation.

Endpoint:
  POST /api/geo/aggregate
    body: {dataset_id, geo_col, value_col, agg, top_n?, benchmark?}
    output: ranked list of {area, value, n, share_pct, rank}
            + optional deviation vs benchmark value or value map.

Choropleth-renderer-agnostic: just ranked structured data. Frontend renders.
"""

from __future__ import annotations

import math
import numpy as np
import pandas as pd
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..shared import datasets, study_designs, sanitize_for_json
from .inferential_utils import safe_round

router = APIRouter(prefix="/api/geo", tags=["geo"])


class GeoConfig(BaseModel):
    dataset_id: str
    geo_col: str                 # column with area names (district, state, etc.)
    value_col: str | None = None # numeric column to aggregate; if None, returns counts
    agg: str = "mean"            # mean|sum|count|median
    top_n: int | None = None     # only return top-N areas by value
    benchmark: dict | None = None  # {value: float, label: str} to compare against
    benchmark_map: dict | None = None  # {area_name: value} per-area benchmark


@router.post("/aggregate")
def geo_aggregate(config: GeoConfig):
    if config.dataset_id not in datasets:
        raise HTTPException(status_code=404, detail="Dataset not found")
    df = datasets[config.dataset_id]["df"]
    if config.geo_col not in df.columns:
        raise HTTPException(status_code=400, detail="geo_col not in dataset")

    sd = study_designs.get(config.dataset_id) or {}
    w_col = sd.get("weight_col")
    weights = None
    if isinstance(w_col, str) and w_col in df.columns:
        ws = pd.to_numeric(df[w_col], errors="coerce")
        if ws.notna().sum() > 0:
            weights = ws

    work = df[[config.geo_col]].copy()
    work[config.geo_col] = work[config.geo_col].astype(str).str.strip()
    work = work[work[config.geo_col].notna() & (work[config.geo_col] != "") & (work[config.geo_col].str.lower() != "nan")]

    if config.value_col and config.value_col in df.columns:
        work["__val__"] = pd.to_numeric(df.loc[work.index, config.value_col], errors="coerce")
    else:
        work["__val__"] = 1.0

    if weights is not None:
        work["__w__"] = weights.reindex(work.index).fillna(0)
    else:
        work["__w__"] = 1.0

    rows: list[dict] = []
    for area, g in work.groupby(config.geo_col):
        vals = g["__val__"].dropna()
        ws = g.loc[vals.index, "__w__"]
        n = int(vals.notna().sum())
        if n == 0:
            continue
        if config.agg == "count":
            v = float(ws.sum()) if weights is not None else float(n)
        elif config.agg == "sum":
            v = float((vals * ws).sum()) if weights is not None else float(vals.sum())
        elif config.agg == "median":
            v = float(vals.median())
        else:  # mean
            if weights is not None and ws.sum() > 0:
                v = float(np.average(vals, weights=ws))
            else:
                v = float(vals.mean())
        rows.append({"area": area, "value": v, "n": n})

    rows.sort(key=lambda r: r["value"], reverse=True)
    total_value = sum(r["value"] for r in rows) or 1.0
    for i, r in enumerate(rows):
        r["rank"] = i + 1
        r["share_pct"] = safe_round((r["value"] / total_value) * 100, 2)
        r["value"] = safe_round(r["value"], 4)
        # benchmark deviation
        if config.benchmark and isinstance(config.benchmark.get("value"), (int, float)):
            bv = float(config.benchmark["value"])
            r["benchmark_value"] = safe_round(bv, 4)
            r["deviation"] = safe_round(r["value"] - bv, 4)
            r["deviation_pct"] = safe_round(((r["value"] - bv) / bv) * 100 if bv else None, 2) if bv else None
        if config.benchmark_map and r["area"] in config.benchmark_map:
            bv = float(config.benchmark_map[r["area"]])
            r["benchmark_value"] = safe_round(bv, 4)
            r["deviation"] = safe_round(r["value"] - bv, 4)
            r["deviation_pct"] = safe_round(((r["value"] - bv) / bv) * 100 if bv else None, 2) if bv else None

    if config.top_n and config.top_n > 0:
        rows = rows[: config.top_n]

    return sanitize_for_json({
        "geo_col": config.geo_col,
        "value_col": config.value_col,
        "agg": config.agg,
        "rows": rows,
        "n_areas": len(rows),
        "weighted": weights is not None,
    })
