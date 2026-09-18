"""Power & sample-size planner (Phase 6).

Pre-survey design tool: given expected effect size and alpha, compute the sample
size needed to achieve a target power; or given a sample size, compute the
power achievable. Covers the four most common designs:
  * Two-sample t (independent means)
  * Paired t (within-subject means)
  * One-proportion test
  * Two-proportion test (chi-square / z)
  * One-way ANOVA (k groups)

Returns plain dicts so the existing StatisticalTables shape can render them.
"""

from __future__ import annotations

import math
import traceback
import numpy as np
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional

from statsmodels.stats.power import (
    TTestIndPower,
    TTestPower,
    NormalIndPower,
    FTestAnovaPower,
)
from statsmodels.stats.proportion import proportion_effectsize

router = APIRouter()


class PowerTwoSampleT(BaseModel):
    effect_size: Optional[float] = None    # Cohen's d
    alpha: float = 0.05
    power: Optional[float] = 0.80
    n_per_group: Optional[float] = None
    ratio: float = 1.0                     # n2/n1
    alternative: str = "two-sided"         # 'two-sided'|'larger'|'smaller'
    solve_for: str = "n"                   # 'n'|'power'|'effect'|'alpha'


class PowerPairedT(BaseModel):
    effect_size: Optional[float] = None    # Cohen's d_z
    alpha: float = 0.05
    power: Optional[float] = 0.80
    n: Optional[float] = None
    alternative: str = "two-sided"
    solve_for: str = "n"


class PowerProportions(BaseModel):
    p1: Optional[float] = None             # group 1 proportion
    p2: Optional[float] = None             # group 2 proportion
    alpha: float = 0.05
    power: Optional[float] = 0.80
    n_per_group: Optional[float] = None
    ratio: float = 1.0
    alternative: str = "two-sided"
    solve_for: str = "n"


class PowerAnova(BaseModel):
    effect_size: Optional[float] = None    # Cohen's f
    k_groups: int = 3
    alpha: float = 0.05
    power: Optional[float] = 0.80
    n_total: Optional[float] = None
    solve_for: str = "n"                   # 'n'|'power'|'effect'


def _interpret_d(d: float) -> str:
    a = abs(d)
    if a < 0.2:
        return "trivial"
    if a < 0.5:
        return "small"
    if a < 0.8:
        return "medium"
    return "large"


def _interpret_f(f: float) -> str:
    a = abs(f)
    if a < 0.10:
        return "trivial"
    if a < 0.25:
        return "small"
    if a < 0.40:
        return "medium"
    return "large"


@router.post("/api/power/two_sample_t")
def power_two_sample_t(cfg: PowerTwoSampleT):
    try:
        analysis = TTestIndPower()
        result: dict = {}
        if cfg.solve_for == "n":
            if cfg.effect_size is None or cfg.power is None:
                raise HTTPException(400, "Need effect_size and power to solve for n")
            n1 = analysis.solve_power(effect_size=cfg.effect_size, alpha=cfg.alpha,
                                      power=cfg.power, ratio=cfg.ratio,
                                      alternative=cfg.alternative)
            n1_ceil = int(math.ceil(n1))
            n2_ceil = int(math.ceil(n1 * cfg.ratio))
            result = {
                "solved": "n_per_group",
                "n_per_group": n1_ceil,
                "n_group1": n1_ceil,
                "n_group2": n2_ceil,
                "n_total": n1_ceil + n2_ceil,
                "effect_size": cfg.effect_size,
                "effect_label": _interpret_d(cfg.effect_size),
                "alpha": cfg.alpha,
                "power": cfg.power,
            }
        elif cfg.solve_for == "power":
            if cfg.effect_size is None or cfg.n_per_group is None:
                raise HTTPException(400, "Need effect_size and n_per_group")
            p = analysis.solve_power(effect_size=cfg.effect_size, alpha=cfg.alpha,
                                     nobs1=cfg.n_per_group, ratio=cfg.ratio,
                                     alternative=cfg.alternative)
            result = {"solved": "power", "power": float(p), "effect_size": cfg.effect_size,
                      "effect_label": _interpret_d(cfg.effect_size),
                      "alpha": cfg.alpha, "n_per_group": cfg.n_per_group}
        elif cfg.solve_for == "effect":
            if cfg.power is None or cfg.n_per_group is None:
                raise HTTPException(400, "Need power and n_per_group")
            d = analysis.solve_power(effect_size=None, alpha=cfg.alpha,
                                     power=cfg.power, nobs1=cfg.n_per_group,
                                     ratio=cfg.ratio, alternative=cfg.alternative)
            result = {"solved": "effect_size", "effect_size": float(d),
                      "effect_label": _interpret_d(float(d)),
                      "alpha": cfg.alpha, "power": cfg.power,
                      "n_per_group": cfg.n_per_group}
        else:
            raise HTTPException(400, f"Unknown solve_for: {cfg.solve_for}")

        result["interpretation"] = _interp_text("two-sample t-test", result)
        return result
    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(500, f"Power calc failed: {e}")


@router.post("/api/power/paired_t")
def power_paired_t(cfg: PowerPairedT):
    try:
        analysis = TTestPower()
        if cfg.solve_for == "n":
            if cfg.effect_size is None or cfg.power is None:
                raise HTTPException(400, "Need effect_size and power")
            n = analysis.solve_power(effect_size=cfg.effect_size, alpha=cfg.alpha,
                                     power=cfg.power, alternative=cfg.alternative)
            n_ceil = int(math.ceil(n))
            result = {"solved": "n", "n": n_ceil, "effect_size": cfg.effect_size,
                      "effect_label": _interpret_d(cfg.effect_size),
                      "alpha": cfg.alpha, "power": cfg.power}
        elif cfg.solve_for == "power":
            if cfg.effect_size is None or cfg.n is None:
                raise HTTPException(400, "Need effect_size and n")
            p = analysis.solve_power(effect_size=cfg.effect_size, alpha=cfg.alpha,
                                     nobs=cfg.n, alternative=cfg.alternative)
            result = {"solved": "power", "power": float(p), "effect_size": cfg.effect_size,
                      "effect_label": _interpret_d(cfg.effect_size),
                      "alpha": cfg.alpha, "n": cfg.n}
        elif cfg.solve_for == "effect":
            if cfg.power is None or cfg.n is None:
                raise HTTPException(400, "Need power and n")
            d = analysis.solve_power(effect_size=None, alpha=cfg.alpha,
                                     power=cfg.power, nobs=cfg.n,
                                     alternative=cfg.alternative)
            result = {"solved": "effect_size", "effect_size": float(d),
                      "effect_label": _interpret_d(float(d)),
                      "alpha": cfg.alpha, "power": cfg.power, "n": cfg.n}
        else:
            raise HTTPException(400, f"Unknown solve_for: {cfg.solve_for}")
        result["interpretation"] = _interp_text("paired t-test", result)
        return result
    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(500, f"Power calc failed: {e}")


@router.post("/api/power/proportions")
def power_proportions(cfg: PowerProportions):
    try:
        analysis = NormalIndPower()
        es = None
        if cfg.p1 is not None and cfg.p2 is not None:
            es = float(proportion_effectsize(cfg.p1, cfg.p2))
        if cfg.solve_for == "n":
            if es is None or cfg.power is None:
                raise HTTPException(400, "Need p1, p2 and power")
            n1 = analysis.solve_power(effect_size=abs(es), alpha=cfg.alpha,
                                      power=cfg.power, ratio=cfg.ratio,
                                      alternative=cfg.alternative)
            n1_ceil = int(math.ceil(n1))
            n2_ceil = int(math.ceil(n1 * cfg.ratio))
            result = {
                "solved": "n_per_group",
                "n_per_group": n1_ceil,
                "n_group1": n1_ceil,
                "n_group2": n2_ceil,
                "n_total": n1_ceil + n2_ceil,
                "p1": cfg.p1, "p2": cfg.p2,
                "effect_size_h": es,
                "effect_label": _interpret_d(es),
                "alpha": cfg.alpha, "power": cfg.power,
            }
        elif cfg.solve_for == "power":
            if es is None or cfg.n_per_group is None:
                raise HTTPException(400, "Need p1, p2, and n_per_group")
            p = analysis.solve_power(effect_size=abs(es), alpha=cfg.alpha,
                                     nobs1=cfg.n_per_group, ratio=cfg.ratio,
                                     alternative=cfg.alternative)
            result = {"solved": "power", "power": float(p),
                      "p1": cfg.p1, "p2": cfg.p2,
                      "effect_size_h": es, "effect_label": _interpret_d(es),
                      "alpha": cfg.alpha, "n_per_group": cfg.n_per_group}
        else:
            raise HTTPException(400, f"Unsupported solve_for: {cfg.solve_for}")
        result["interpretation"] = _interp_text("two-proportion z-test", result)
        return result
    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(500, f"Power calc failed: {e}")


@router.post("/api/power/anova")
def power_anova(cfg: PowerAnova):
    try:
        analysis = FTestAnovaPower()
        if cfg.solve_for == "n":
            if cfg.effect_size is None or cfg.power is None:
                raise HTTPException(400, "Need effect_size (Cohen's f) and power")
            n = analysis.solve_power(effect_size=cfg.effect_size, alpha=cfg.alpha,
                                     power=cfg.power, k_groups=cfg.k_groups)
            n_total = int(math.ceil(n))
            per_group = int(math.ceil(n_total / cfg.k_groups))
            result = {
                "solved": "n_total",
                "n_total": n_total,
                "n_per_group_balanced": per_group,
                "k_groups": cfg.k_groups,
                "effect_size_f": cfg.effect_size,
                "effect_label": _interpret_f(cfg.effect_size),
                "alpha": cfg.alpha, "power": cfg.power,
            }
        elif cfg.solve_for == "power":
            if cfg.effect_size is None or cfg.n_total is None:
                raise HTTPException(400, "Need effect_size and n_total")
            p = analysis.solve_power(effect_size=cfg.effect_size, alpha=cfg.alpha,
                                     nobs=cfg.n_total, k_groups=cfg.k_groups)
            result = {"solved": "power", "power": float(p),
                      "k_groups": cfg.k_groups,
                      "effect_size_f": cfg.effect_size,
                      "effect_label": _interpret_f(cfg.effect_size),
                      "alpha": cfg.alpha, "n_total": cfg.n_total}
        elif cfg.solve_for == "effect":
            if cfg.power is None or cfg.n_total is None:
                raise HTTPException(400, "Need power and n_total")
            f = analysis.solve_power(effect_size=None, alpha=cfg.alpha,
                                     power=cfg.power, nobs=cfg.n_total,
                                     k_groups=cfg.k_groups)
            result = {"solved": "effect_size_f", "effect_size_f": float(f),
                      "effect_label": _interpret_f(float(f)),
                      "k_groups": cfg.k_groups,
                      "alpha": cfg.alpha, "power": cfg.power, "n_total": cfg.n_total}
        else:
            raise HTTPException(400, f"Unknown solve_for: {cfg.solve_for}")
        result["interpretation"] = _interp_text("one-way ANOVA", result)
        return result
    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(500, f"Power calc failed: {e}")


@router.post("/api/power/curve")
def power_curve(payload: dict):
    """Plot data: power vs sample size, for a fixed effect size and alpha.

    Returns list of {n, power} for the requested test type and effect size.
    """
    try:
        test = payload.get("test", "two_sample_t")
        es = float(payload.get("effect_size", 0.5))
        alpha = float(payload.get("alpha", 0.05))
        n_min = int(payload.get("n_min", 10))
        n_max = int(payload.get("n_max", 500))
        step = int(payload.get("step", 10))
        k = int(payload.get("k_groups", 3))

        points = []
        ns = list(range(n_min, n_max + 1, step))
        if test == "two_sample_t":
            a = TTestIndPower()
            for n in ns:
                p = a.solve_power(effect_size=es, alpha=alpha, nobs1=n, ratio=1.0)
                points.append({"n": n, "power": float(p)})
        elif test == "paired_t":
            a = TTestPower()
            for n in ns:
                p = a.solve_power(effect_size=es, alpha=alpha, nobs=n)
                points.append({"n": n, "power": float(p)})
        elif test == "anova":
            a = FTestAnovaPower()
            for n in ns:
                p = a.solve_power(effect_size=es, alpha=alpha, nobs=n, k_groups=k)
                points.append({"n": n, "power": float(p)})
        else:
            raise HTTPException(400, f"Unknown test: {test}")

        return {"test": test, "effect_size": es, "alpha": alpha, "points": points}
    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(500, f"Power curve failed: {e}")


def _interp_text(test_name: str, r: dict) -> str:
    if r.get("solved", "").startswith("n"):
        nval = r.get("n_per_group") or r.get("n") or r.get("n_total")
        return (
            f"To detect a {r.get('effect_label','')} effect with α={r['alpha']} "
            f"and power={r['power']} using a {test_name}, you need n={nval} "
            f"{'per group' if r.get('solved') == 'n_per_group' else 'total'}."
        )
    if r.get("solved") == "power":
        return (
            f"With current sample size and a {r.get('effect_label','')} effect, "
            f"your {test_name} achieves power={r['power']:.3f} at α={r['alpha']}."
        )
    if r.get("solved", "").startswith("effect"):
        es = r.get("effect_size") or r.get("effect_size_f")
        return (
            f"Your {test_name} can reliably detect an effect of "
            f"{es:.3f} ({r.get('effect_label','')}) with power={r['power']} at α={r['alpha']}."
        )
    return ""
