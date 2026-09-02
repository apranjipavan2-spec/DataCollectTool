"""
Convert XLSForm XPath `relevant` expressions → FieldGovern skipLogic dicts.

Handles nested / mixed AND-OR by building ConditionGroups recursively, so
expressions like  A != x and (B = 1 or B = 2 or B = 3)  parse correctly instead
of silently dropping the OR branches. Anything we still can't parse is returned
as skipLogicRaw (string) so the UI can warn the user.
"""
from __future__ import annotations
import re
from typing import Any

# ${field_name}
_REF = re.compile(r'\$\{([^}]+)\}')

# single condition patterns (order matters: match >=/<= before >/<, '' before quoted)
_PATTERNS = [
    # age(${dob}) >= N  → age_gte on the DOB field, threshold "N|0|0" (years|months|days).
    # age(${dob}) <  N  → age_lt. Lets XLSForm relevant express "skip if age<15" style rules.
    (re.compile(r"^age\(\s*\$\{([^}]+)\}\s*\)\s*>=\s*(\d+)$"), lambda m: _cond(m[1], 'age_gte', f"{m[2]}|0|0")),
    (re.compile(r"^age\(\s*\$\{([^}]+)\}\s*\)\s*<\s*(\d+)$"),  lambda m: _cond(m[1], 'age_lt',  f"{m[2]}|0|0")),
    (re.compile(r"^\$\{([^}]+)\}\s*!=\s*''$"),        lambda m: _cond(m[1], 'is_not_empty')),
    (re.compile(r"^\$\{([^}]+)\}\s*=\s*''$"),          lambda m: _cond(m[1], 'is_empty')),
    (re.compile(r"^selected\(\s*\$\{([^}]+)\}\s*,\s*['\"]([^'\"]+)['\"]\s*\)$"),
                                                        lambda m: _cond(m[1], 'contains', m[2])),
    (re.compile(r"^\$\{([^}]+)\}\s*>=\s*([0-9.]+)$"),  lambda m: _cond(m[1], 'gte', float(m[2]))),
    (re.compile(r"^\$\{([^}]+)\}\s*<=\s*([0-9.]+)$"),  lambda m: _cond(m[1], 'lte', float(m[2]))),
    (re.compile(r"^\$\{([^}]+)\}\s*>\s*([0-9.]+)$"),   lambda m: _cond(m[1], 'gt',  float(m[2]))),
    (re.compile(r"^\$\{([^}]+)\}\s*<\s*([0-9.]+)$"),   lambda m: _cond(m[1], 'lt',  float(m[2]))),
    (re.compile(r"^\$\{([^}]+)\}\s*!=\s*['\"]?([^'\"]*?)['\"]?$"), lambda m: _cond(m[1], 'neq', m[2])),
    (re.compile(r"^\$\{([^}]+)\}\s*=\s*['\"]?([^'\"]*?)['\"]?$"),  lambda m: _cond(m[1], 'eq',  m[2])),
]


def _cond(field: str, op: str, value: Any = None) -> dict:
    c: dict = {"field": field, "operator": op}
    if value is not None:
        c["value"] = value
    return c


def _strip_outer_parens(expr: str) -> str:
    """Remove one layer of redundant wrapping parens: '(a or b)' -> 'a or b'."""
    expr = expr.strip()
    while expr.startswith('(') and expr.endswith(')'):
        # verify the closing paren matches the opening one (not '(a) or (b)')
        depth = 0
        for i, ch in enumerate(expr):
            if ch == '(':
                depth += 1
            elif ch == ')':
                depth -= 1
                if depth == 0:
                    break
        if i == len(expr) - 1:
            expr = expr[1:-1].strip()
        else:
            break
    return expr


def _parse_single(expr: str) -> dict | None:
    expr = _strip_outer_parens(expr)
    for pat, builder in _PATTERNS:
        m = pat.match(expr)
        if m:
            return builder(m)
    return None


def _parse_node(expr: str, unparsed: list[str]) -> dict | None:
    """
    Recursively parse an expression into a condition dict or a ConditionGroup dict.
    Precedence: OR is lower than AND, so split on top-level OR first, then AND.
    """
    expr = _strip_outer_parens(expr)
    if not expr:
        return None

    for op, logic in [(' or ', 'OR'), (' and ', 'AND')]:
        parts = _top_level_split(expr, op)
        if len(parts) > 1:
            children = [c for c in (_parse_node(p, unparsed) for p in parts) if c]
            if not children:
                return None
            if len(children) == 1:
                return children[0]
            return {"logic": logic, "conditions": children}

    cond = _parse_single(expr)
    if cond is None:
        unparsed.append(expr)
    return cond


def parse_relevant(expr: str) -> tuple[dict | None, str | None]:
    """
    Returns (skipLogic, raw_warning).
    skipLogic is None if the expression is empty or unparseable.
    raw_warning carries the unparsed fragment(s) when we can't fully parse.

    XLSForm relevant=expr means "show when expr is true" → action='show'.
    """
    if not expr or not expr.strip():
        return None, None

    unparsed: list[str] = []
    node = _parse_node(expr, unparsed)
    if node is None:
        return None, expr

    # Top level must be a group (has 'logic'); wrap a bare condition.
    if "logic" in node:
        skip_logic = {"logic": node["logic"], "action": "show", "conditions": node["conditions"]}
    else:
        skip_logic = {"logic": "AND", "action": "show", "conditions": [node]}

    raw_warning = " | ".join(unparsed) if unparsed else None
    return skip_logic, raw_warning


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
        elif depth == 0 and el[i:i + len(sep)] == sep_l:
            parts.append(''.join(current).strip())
            current = []
            i += len(sep)
        else:
            current.append(expr[i])
            i += 1
    if current:
        parts.append(''.join(current).strip())
    return parts


# ── self-check (run: python -m app.api.routes.migration.relevant_parser) ──────
if __name__ == "__main__":
    def _shape(node):
        """Compact readable shape for assertions."""
        if node is None:
            return None
        if "logic" in node:
            return (node["logic"], [_shape(c) for c in node["conditions"]])
        v = node.get("value")
        return (node["field"], node["operator"], v)

    # simple equality
    sl, w = parse_relevant("${q2_1}='1'")
    assert sl == {"logic": "AND", "action": "show", "conditions": [{"field": "q2_1", "operator": "eq", "value": "1"}]}, sl
    assert w is None

    # multi-value OR (Ask if Q2.1 = 1,2,4)
    sl, w = parse_relevant("${q2_1}='1' or ${q2_1}='2' or ${q2_1}='4'")
    assert _shape(sl) == ("OR", [("q2_1", "eq", "1"), ("q2_1", "eq", "2"), ("q2_1", "eq", "4")]), _shape(sl)
    assert w is None

    # mixed AND + (OR group)  — the case the old parser silently broke
    sl, w = parse_relevant("${q3_11}!='98' and (${q2_1}='1' or ${q2_1}='2' or ${q2_1}='4')")
    assert _shape(sl) == ("AND", [
        ("q3_11", "neq", "98"),
        ("OR", [("q2_1", "eq", "1"), ("q2_1", "eq", "2"), ("q2_1", "eq", "4")]),
    ]), _shape(sl)
    assert w is None

    # married AND not-96 (Q7.3)
    sl, w = parse_relevant("${q1_5}='1' and ${q7_1}!='96'")
    assert _shape(sl) == ("AND", [("q1_5", "eq", "1"), ("q7_1", "neq", "96")]), _shape(sl)

    # married-girl block (Q7.15): 1.5 != 1 and gender = 2
    sl, w = parse_relevant("${q1_5}!='1' and ${q1_0}='2'")
    assert _shape(sl) == ("AND", [("q1_5", "neq", "1"), ("q1_0", "eq", "2")]), _shape(sl)

    # multi-select membership (E-series: E1 has at least one activity)
    sl, w = parse_relevant("selected(${e1},'1')")
    assert _shape(sl) == ("AND", [("e1", "contains", "1")]), _shape(sl)

    # numeric age skip
    sl, w = parse_relevant("${age}>=15")
    assert _shape(sl) == ("AND", [("age", "gte", 15.0)]), _shape(sl)

    # age() helper → age_gte / age_lt against DOB field
    sl, w = parse_relevant("age(${q1_1})>=15")
    assert _shape(sl) == ("AND", [("q1_1", "age_gte", "15|0|0")]), _shape(sl)
    sl, w = parse_relevant("age(${q1_1})<18")
    assert _shape(sl) == ("AND", [("q1_1", "age_lt", "18|0|0")]), _shape(sl)
    # age combined with another condition
    sl, w = parse_relevant("age(${q1_1})>=15 and ${n2}='1'")
    assert _shape(sl) == ("AND", [("q1_1", "age_gte", "15|0|0"), ("n2", "eq", "1")]), _shape(sl)

    # partially unparseable → warning carries the bad fragment, good part kept
    sl, w = parse_relevant("${q1_5}='1' and weird_xpath(1,2)")
    assert _shape(sl) == ("AND", [("q1_5", "eq", "1")]), _shape(sl)
    assert w == "weird_xpath(1,2)", w

    print("relevant_parser self-check: all assertions passed")
