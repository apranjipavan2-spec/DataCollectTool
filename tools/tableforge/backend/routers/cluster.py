"""Cluster analysis — K-means with elbow + silhouette + cluster profiles.

Pure numpy implementation (no sklearn dep). Sufficient for survey-scale data.

Endpoint:
  POST /api/cluster/kmeans
    body: {dataset_id, columns[], k?, k_range?, standardize?, max_iter?, seed?}
    output: cluster assignments, centroids, inertia, silhouette (sampled),
            per-cluster profile (mean of each col by cluster), elbow curve if k_range given.
"""

from __future__ import annotations

import math
import numpy as np
import pandas as pd
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..shared import datasets, sanitize_for_json
from .inferential_utils import safe_round

router = APIRouter(prefix="/api/cluster", tags=["cluster"])


class ClusterConfig(BaseModel):
    dataset_id: str
    columns: list[str]
    k: int | None = None              # if set, run single k
    k_range: tuple[int, int] | None = None  # if set, run elbow curve
    standardize: bool = True
    max_iter: int = 100
    seed: int = 42
    filters: dict = {}


def _kmeans(X: np.ndarray, k: int, max_iter: int, seed: int) -> tuple[np.ndarray, np.ndarray, float]:
    """Returns (labels, centroids, inertia). kmeans++ init."""
    rng = np.random.default_rng(seed)
    n = X.shape[0]
    if k > n:
        k = n
    # kmeans++ init
    idx = [int(rng.integers(0, n))]
    for _ in range(k - 1):
        d2 = np.min(((X[:, None, :] - X[idx][None, :, :]) ** 2).sum(axis=2), axis=1)
        probs = d2 / d2.sum() if d2.sum() > 0 else np.full(n, 1 / n)
        idx.append(int(rng.choice(n, p=probs)))
    centroids = X[idx].copy()

    for _ in range(max_iter):
        # assign
        dist = ((X[:, None, :] - centroids[None, :, :]) ** 2).sum(axis=2)
        labels = np.argmin(dist, axis=1)
        # update
        new_cent = np.array([
            X[labels == c].mean(axis=0) if (labels == c).any() else centroids[c]
            for c in range(k)
        ])
        if np.allclose(new_cent, centroids, atol=1e-6):
            centroids = new_cent
            break
        centroids = new_cent

    dist = ((X[:, None, :] - centroids[None, :, :]) ** 2).sum(axis=2)
    labels = np.argmin(dist, axis=1)
    inertia = float(np.sum(np.min(dist, axis=1)))
    return labels, centroids, inertia


def _silhouette_sampled(X: np.ndarray, labels: np.ndarray, sample: int = 500, seed: int = 42) -> float:
    """Approx silhouette via random sample. NaN-safe."""
    n = X.shape[0]
    if n <= 1:
        return float("nan")
    rng = np.random.default_rng(seed)
    idx = rng.choice(n, size=min(sample, n), replace=False)
    Xs, Ls = X[idx], labels[idx]
    unique = np.unique(Ls)
    if len(unique) < 2:
        return float("nan")
    sils = []
    for i in range(len(idx)):
        own = Ls[i]
        same = Ls == own
        same[i] = False
        if not same.any():
            sils.append(0)
            continue
        a = float(np.mean(np.sqrt(((Xs[same] - Xs[i]) ** 2).sum(axis=1))))
        bs = []
        for c in unique:
            if c == own:
                continue
            other = Ls == c
            if not other.any():
                continue
            bs.append(float(np.mean(np.sqrt(((Xs[other] - Xs[i]) ** 2).sum(axis=1)))))
        if not bs:
            sils.append(0)
            continue
        b = min(bs)
        sils.append((b - a) / max(a, b) if max(a, b) > 0 else 0)
    return float(np.mean(sils))


@router.post("/kmeans")
def kmeans(config: ClusterConfig):
    if config.dataset_id not in datasets:
        raise HTTPException(status_code=404, detail="Dataset not found")
    df = datasets[config.dataset_id]["df"]
    for col, vals in (config.filters or {}).items():
        if vals and col in df.columns:
            df = df[df[col].astype(str).isin([str(v) for v in vals])]
    cols = [c for c in config.columns if c in df.columns]
    if len(cols) < 2:
        raise HTTPException(status_code=400, detail="Need ≥2 columns")

    Xdf = df[cols].apply(pd.to_numeric, errors="coerce").dropna()
    if len(Xdf) < 10:
        raise HTTPException(status_code=400, detail="Not enough non-null rows (<10)")
    X = Xdf.values.astype(float)
    means = X.mean(axis=0)
    sds = X.std(axis=0, ddof=1)
    sds[sds == 0] = 1
    if config.standardize:
        Xz = (X - means) / sds
    else:
        Xz = X

    elbow: list[dict] = []
    if config.k_range:
        kmin, kmax = config.k_range
        for k in range(max(2, kmin), min(kmax, 12) + 1):
            _, _, inertia = _kmeans(Xz, k, config.max_iter, config.seed)
            elbow.append({"k": k, "inertia": safe_round(inertia, 2)})

    k = config.k or 3
    labels, centroids, inertia = _kmeans(Xz, k, config.max_iter, config.seed)
    sil = _silhouette_sampled(Xz, labels, seed=config.seed)

    # Cluster profiles — unstandardized means
    profiles = []
    for c in range(k):
        mask = labels == c
        n = int(mask.sum())
        prof = {"cluster": c, "n": n, "pct": safe_round(n / len(labels) * 100, 2), "means": {}}
        for j, col in enumerate(cols):
            prof["means"][col] = safe_round(float(X[mask, j].mean()) if n > 0 else None, 4)
        profiles.append(prof)

    # Centroids — convert back to original scale for interpretability
    cent_orig = centroids * sds + means if config.standardize else centroids
    cent_table = []
    for c in range(k):
        row = {"cluster": c}
        for j, col in enumerate(cols):
            row[col] = safe_round(float(cent_orig[c, j]), 4)
        cent_table.append(row)

    return sanitize_for_json({
        "k": k,
        "n": len(labels),
        "columns": cols,
        "inertia": safe_round(inertia, 2),
        "silhouette": safe_round(sil, 3),
        "labels_preview": labels[:200].tolist(),
        "labels_full_size": len(labels),
        "centroids": cent_table,
        "profiles": profiles,
        "elbow": elbow,
        "standardized": config.standardize,
    })
