"""
Convert XLSForm XPath `relevant` expressions → FieldGovern skipLogic dicts.

Handles ~95% of real-world cases. Complex nested XPath is returned as
skipLogicRaw (string) so the UI can warn the user.
"""
from __future__ import annotations
import re
from typing import Any

# ${field_name}
_REF = re.compile(r'\$\{([^}]+)\}')

# single condition patterns
_PATTERNS = [
    (re.compile(r"\$\{([^}]+)\}\s*!=\s*''"),        lambda m: _cond(m[1], 'is_not_empty')),
    (re.compile(r"\$\{([^}]+)\}\s*=\s*''"),          lambda m: _cond(m[1], 'is_empty')),
    (re.compile(r"selected\(\s*\$\{([^}]+)\}\s*,\s*['\"]([^'\"]+)['\"]\s*\)"),
                                                      lambda m: _cond(m[1], 'contains', m[2])),
    (re.compile(r"\$\{([^}]+)\}\s*>=\s*([0-9.]+)"),  lambda m: _cond(m[1], 'gte', float(m[2]))),
    (re.compile(r"\$\{([^}]+)\}\s*<=\s*([0-9.]+)"),  lambda m: _cond(m[1], 'lte', float(m[2]))),
    (re.compile(r"\$\{([^}]+)\}\s*>\s*([0-9.]+)"),   lambda m: _cond(m[1], 'gt',  float(m[2]))),
    (re.compile(r"\$\{([^}]+)\}\s*<\s*([0-9.]+)"),   lambda m: _cond(m[1], 'lt',  float(m[2]))),
    (re.compile(r"\$\{([^}]+)\}\s*!=\s*['\"]([^'\"]*)['\"]"), lambda m: _cond(m[1], 'neq', m[2])),
    (re.compile(r"\$\{([^}]+)\}\s*=\s*['\"]([^'\"]*)['\"]"),  lambda m: _cond(m[1], 'eq',  m[2])),
]


def _cond(field: str, op: str, value: Any = None) -> dict:
    c: dict = {"field": field, "operator": op}
    if value is not None:
        c["value"] = value
    return c


def _parse_single(expr: str) -> dict | None:
    expr = expr.strip()
    for pat, builder in _PATTERNS:
        m = pat.search(expr)
        if m:
            return builder(m)
    return None


def parse_relevant(expr: str) -> tuple[dict | None, str | None]:
    """
    Returns (skipLogic, raw_warning).
    skipLogic is None if expression is empty or unparseable.
    raw_warning carries the original string when we can't fully parse.
    """
    if not expr or not expr.strip():
        return None, None

    # FieldGovern skipLogic: action='show' when condition is true
    # XLSForm relevant=expr means "show when expr is true" → same semantics

    # Detect top-level logic operator (and / or)
    # Split only on bare 'and'/'or' not inside parentheses
    logic, parts = _split_logic(expr)

    conditions = []
    unparsed = []
    for part in parts:
        c = _parse_single(part)
        if c:
            conditions.append(c)
        else:
            unparsed.append(part.strip())

    if not conditions:
        return None, expr  # totally unparseable → raw warning

    skip_logic = {
        "logic": logic,
        "action": "show",
        "conditions": conditions,
    }
    raw_warning = " | ".join(unparsed) if unparsed else None
    return skip_logic, raw_warning


def _split_logic(expr: str) -> tuple[str, list[str]]:
    """Split expression on top-level 'and'/'or'. Returns (logic, parts)."""
    # Try 'and' first, then 'or'
    for op, logic in [(' and ', 'AND'), (' or ', 'OR')]:
        parts = _top_level_split(expr, op)
        if len(parts) > 1:
            return logic, parts
    return 'AND', [expr]


def _top_level_split(expr: str, sep: str) -> list[str]:
    """Split on sep only when not inside parentheses."""
    depth = 0
    parts = []
    current: list[str] = []
    i = 0
    sep_l = sep.lower()
    el = expr.lower()
    while i < len(expr):
        if expr[i] == '(':
            depth += 1
            current.append(expr[i])
            i += 1
        elif expr[i] == ')':
            depth -= 1
            current.append(expr[i])
            i += 1
        elif depth == 0 and el[i:i+len(sep)] == sep_l:
            parts.append(''.join(current).strip())
            current = []
            i += len(sep)
        else:
            current.append(expr[i])
            i += 1
    if current:
        parts.append(''.join(current).strip())
    return parts
