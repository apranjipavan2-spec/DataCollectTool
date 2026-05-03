"""AI Features: Smart Build, Polish, Interpret, Suggest, Report, and FieldGovern Proxy."""

import os
import json
import traceback
from typing import Optional

from fastapi import APIRouter
from pydantic import BaseModel

from ..state import (
    datasets, custom_metrics, custom_bins, audit_logs,
    sanitize_for_json, traceback_print_exc,
)

router = APIRouter()

# ─── Pydantic Models ─────────────────────────────────────

class AIPolishRequest(BaseModel):
    dataset_id: str
    table: dict
    context: Optional[str] = ""


class AIInterpretRequest(BaseModel):
    dataset_id: str
    table: dict
    focus: Optional[str] = None
    format: Optional[str] = "paragraph"


class AISuggestRequest(BaseModel):
    dataset_id: str
    context: Optional[str] = ""


class AISmartBuildRequest(BaseModel):
    dataset_id: str
    selected_columns: list[str] = []
    query: str = ""


class AIReportRequest(BaseModel):
    dataset_id: str
    style: str = "field_survey"  # progress, field_survey, research, government, ngo, executive
    custom_context: str = ""


class FGProjectInfo(BaseModel):
    project_id: str
    project_name: str
    dataset_id: Optional[str] = None
    form_name: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


# ─── AI Config (Database) ────────────────────────────────────

AI_CONFIG_FILE = "ai_config.json"

AI_MODELS = {
    "openai": [
        {"id": "gpt-4o", "name": "GPT-4o (recommended)"},
        {"id": "gpt-4o-mini", "name": "GPT-4o Mini (faster, cheaper)"},
        {"id": "gpt-4-turbo", "name": "GPT-4 Turbo"},
    ],
    "anthropic": [
        {"id": "claude-sonnet-4-6", "name": "Claude Sonnet 4.6 (recommended)"},
        {"id": "claude-haiku-4-5-20251001", "name": "Claude Haiku 4.5 (fast)"},
    ],
    "gemini": [
        {"id": "gemini-2.5-flash", "name": "Gemini 2.5 Flash (fast, recommended)"},
        {"id": "gemini-2.5-pro", "name": "Gemini 2.5 Pro (best quality)"},
        {"id": "gemini-2.0-flash", "name": "Gemini 2.0 Flash"},
        {"id": "gemini-1.5-flash", "name": "Gemini 1.5 Flash (legacy)"},
    ],
    "deepseek": [
        {"id": "deepseek-v4-flash", "name": "DeepSeek V4 (fast)"},
        {"id": "deepseek-chat", "name": "DeepSeek Chat (V3)"},
        {"id": "deepseek-reasoner", "name": "DeepSeek Reasoner (R1)"},
    ],
}


def _load_ai_cfg() -> dict:
    """Load AI config from multiple sources: env vars → FieldGovern DB → AI config file."""
    # Try FieldGovern database first
    fg_internal = os.environ.get("FG_INTERNAL_URL", "").rstrip("/")
    if fg_internal:
        try:
            import httpx
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.get(f"{fg_internal}/api/v1/system-settings/ai_config")
                if resp.status_code == 200:
                    cfg = resp.json()
                    if isinstance(cfg, dict) and "keys" in cfg:
                        active = cfg.get("active_provider", "")
                        key_cfg = cfg.get("keys", {}).get(active, {})
                        return {
                            "provider": active,
                            "api_key": key_cfg.get("api_key", ""),
                            "model": key_cfg.get("model", ""),
                            "configured": bool(key_cfg.get("api_key", "")),
                            "has_key": True,
                        }
                    else:
                        return cfg
        except Exception:
            pass

    # Fallback: env vars
    provider = os.environ.get("AI_PROVIDER", "")
    api_key = os.environ.get("AI_API_KEY", "")
    model = os.environ.get("AI_MODEL", "")
    if provider and api_key:
        return {
            "provider": provider,
            "api_key": api_key,
            "model": model,
            "configured": True,
            "has_key": True,
        }

    # Fallback: AI config file
    if AI_CONFIG_FILE.exists():
        try:
            cfg = json.loads(AI_CONFIG_FILE.read_text())
            if isinstance(cfg, dict) and "keys" in cfg:
                active = cfg.get("active_provider", "")
                key_cfg = cfg.get("keys", {}).get(active, {})
                return {
                    "provider": active,
                    "api_key": key_cfg.get("api_key", ""),
                    "model": key_cfg.get("model", ""),
                    "configured": bool(key_cfg.get("api_key", "")),
                }
            else:
                return cfg
        except Exception:
            pass

    return {}


async def _call_llm(cfg: dict, prompt: str) -> str:
    """Call configured LLM provider with timeout and error handling."""
    provider = cfg.get("provider")
    key = cfg.get("api_key")
    model = cfg.get("model", "gpt-4o")

    if not provider or not key:
        raise HTTPException(400, "AI not configured. Add your API key in AI Settings.")

    try:
        if provider == "openai":
            from openai import AsyncOpenAI
            client = AsyncOpenAI(api_key=key, timeout=300)
            r = await client.chat.completions.create(
                model=model, messages=[{"role": "user", "content": prompt}],
                max_tokens=4096,
            )
            return r.choices[0].message.content or ""

        elif provider == "anthropic":
            from anthropic import AsyncAnthropic
            client = AsyncAnthropic(api_key=key, timeout=300)
            r = await client.messages.create(
                model=model or "claude-sonnet-4-6", max_tokens=4096,
                messages=[{"role": "user", "content": prompt}],
            )
            return r.content[0].text

        elif provider == "gemini":
            import asyncio
            from google import genai
            client = genai.Client(api_key=key)
            r = await asyncio.to_thread(
                client.models.generate_content,
                model=model or "gemini-2.5-flash",
                contents=prompt,
            )
            return r.text

        elif provider == "deepseek":
            from openai import AsyncOpenAI
            client = AsyncOpenAI(
                api_key=key, base_url="https://api.deepseek.com",
                timeout=300,
            )
            r = await client.chat.completions.create(
                model=model or "deepseek-v4-flash",
                messages=[{"role": "user", "content": prompt}],
                max_tokens=8192,
            )
            return r.choices[0].message.content or ""

        else:
            raise HTTPException(400, f"Unsupported AI provider: {provider}")
    except Exception as e:
        traceback_print_exc()
        raise HTTPException(502, f"AI provider error ({provider}): {str(e)}")


# ─── AI Polish ─────────────────────────────────────────────

@router.get("/api/ai/polish")
async def ai_polish_table(body: AIPolishRequest):
    """Improve a table's formatting with AI suggestions."""
    cfg = _load_ai_cfg()
    if not cfg.get("configured"):
        raise HTTPException(400, "AI not configured")

    if body.dataset_id not in datasets:
        raise HTTPException(404, "Dataset not found")

    df = datasets[body.dataset_id]["df"]

    if not body.get("table"):
        return {"headers": [], "rows": []}

    table = body.get("table", {})

    # Simple polish rules
    polish_rules = {
        "numeric": "Apply 2 decimal places",
        "text": "Trim whitespace and capitalize",
        "date": "Format as 'MMM DD, YYYY'",
        "boolean": "Show Yes/No or True/False",
    }

    # Generate AI suggestions
    suggestions = []
    for col in df.columns:
        col_type = "text"
        dtype = str(df[col].dtype)
        if "int" in dtype or "float" in dtype:
            col_type = "numeric"
        sample_vals = df[col].dropna().head(5).astype(str).tolist()
        if dtype == "object":
            is_multi = df[col].str.contains(",", na=False).any()
            if is_multi:
                col_type = "multi_choice"
            sample_vals = [str(v) for v in df[col].dropna().head(5).astype(str) if v.strip() in sample_vals][:5]
            else:
                sample_vals = sample_vals[:5]
        suggestions.append({
            "column": col,
            "type": col_type,
            "sample_values": sample_vals,
            "polish": polish_rules.get(col_type, ""),
        })

    return {"suggestions": suggestions}


# ─── AI Interpret Table ─────────────────────────────────────

@router.post("/api/ai/interpret")
async def ai_interpret_table(body: AIInterpretRequest):
    """Generate an AI-powered interpretation of a tabulated table."""
    cfg = _load_ai_cfg()
    if not cfg.get("configured"):
        raise HTTPException(400, "AI not configured")

    if body.dataset_id not in datasets:
        raise HTTPException(404, "Dataset not found")

    df = datasets[body.dataset_id]["df"]

    if not body.get("table"):
        return {"interpretation": "", "insights": []}

    table = body.get("table", {})
    context = body.get("focus", "")

    insights = []
    if table.get("rows") and len(table["rows"]) > 0:
        row_count = len(table["rows"])
        for col, agg in table.get("values", {}).items():
            val_type = table.get("columns", {}).get(col, {}).get("type", "text")
            if val_type == "count_distinct":
                distinct_count = df[col].nunique()
                insights.append(f"The '{col}' column has {distinct_count} distinct values.")
            elif val_type == "sum":
                total = df[col].sum(skipna=True)
                if total > 0:
                    insights.append(f"Total '{col}' is {total:,.2f}.")
                elif val_type == "average":
                    avg = df[col].mean(skipna=True)
                    if avg > 0:
                        insights.append(f"Average '{col}' is {avg:,.2f}.")
            elif val_type == "max":
                max_val = df[col].max(skipna=True)
                if pd.notna(max_val):
                    insights.append(f"Maximum '{col}' is {max_val:,.2f}.")
            elif val_type == "min":
                min_val = df[col].min(skipna=True)
                if pd.notna(min_val):
                    insights.append(f"Minimum '{col}' is {min_val:,.2f}.")

    interpretation = ""
    if insights:
        interpretation = "Key findings:\n" + "\n".join(insights)
        if context:
            interpretation += f"\n\nFocus: {context}"

    return {"interpretation": interpretation, "insights": insights}


# ─── AI Suggest Tables ─────────────────────────────────────

@router.post("/api/ai/suggest")
async def ai_suggest_tables(body: AISuggestRequest):
    """Suggest optimal tabulations based on dataset schema."""
    cfg = _load_ai_cfg()
    if not cfg.get("configured"):
        raise HTTPException(400, "AI not configured")

    if body.dataset_id not in datasets:
        raise HTTPException(404, "Dataset not found")

    df = datasets[body.dataset_id]["df"]
    columns = list(df.columns)

    if not body.query.strip() and not body.selected_columns:
        # Default: suggest top columns
        selected_columns = columns[:5]

    prompt = (
        f"Analyze this dataset and suggest 1-3 tabulations to answer: '{body.query.strip()}'.\n"
        f"Available columns:\n"
        + "\n".join([f"  - {c} ({df[c].dtype})" for c in selected_columns])
        + f"\n\nSample data (first 5 rows):\n"
        + df.head(5)[selected_columns].fillna("").to_dict(orient="records")
        + f"\n\nFor each suggested table, specify:\n"
        + "- rows: list of column ids for row grouping\n"
        + "- columns: list of column ids for value aggregation\n"
        + "- values: list of column ids for metric calculations\n"
        + "- aggregation: 'count', 'sum', 'average', 'mean', 'min', 'max'\n"
        + "Respond ONLY with valid JSON:\n"
        + f'{{"groupby_field":"","secondary_groupby":"","value_field":"*","aggregation":"count","title":"","description":"","column_labels":{{}}}}'
    )

    try:
        raw = await _call_llm(cfg, prompt)
        match = _re.search(r'\{.*\}', raw)
        if match:
            try:
                result = json.loads(match.group())
            if isinstance(result, dict):
                result["column_labels"] = {str(k): str(v) for k, v in result.get("column_labels", {}).items()}
            except Exception:
                pass
        raise HTTPException(502, "AI returned empty response. Try again.")
    except Exception as e:
        traceback_print_exc()
        raise HTTPException(502, f"Suggestion failed: {str(e)}")


# ─── AI Smart Build ─────────────────────────────────────────────

@router.post("/api/ai/smart-build")
async def ai_smart_build(body: AISmartBuildRequest):
    """AI designs one optimized table from selected columns or NL query."""
    cfg = _load_ai_cfg()
    if not cfg.get("configured"):
        raise HTTPException(400, "AI not configured")

    if body.dataset_id not in datasets:
        raise HTTPException(404, "Dataset not found")

    df = datasets[body.dataset_id]["df"]

    if body.selected_columns:
        cols = [c for c in body.selected_columns if c in df.columns]
    else:
        cols = list(df.columns[:30])

    if not cols:
        raise HTTPException(400, "No valid columns found for analysis")

    cols_block = []
    for col in cols:
        dtype = str(df[col].dtype)
        uniq_vals = df[col].dropna().unique()[:12].tolist()
        cols_block.append(f"  - id={col} | type={'numeric' if 'int' in dtype or 'float' in dtype else 'text'} | unique values ({df[col].nunique()}): {uniq_vals}")

    sample_rows = df[cols].head(6).fillna("").to_dict(orient="records")

    task = f'User question: "{body.query.strip()}"\nDesign the best table to answer this.' if body.query.strip() else "Design the most insightful cross-tabulation or aggregation from these columns."

    prompt = (
        f"You are a research data analyst. Design ONE tabulation table.\n\n"
        f"Available columns:\n" + "\n".join(cols_block) + f"\n\n"
        f"Sample data:\n{json.dumps(sample_rows, ensure_ascii=False, default=str)}\n\n"
        f"{task}\n\n"
        f"Decide:\n"
        f"- groupby_field: column id for row grouping\n"
        f"- secondary_groupby: column id for cross-tab ('' if simple)\n"
        f"- value_field: column id to aggregate, or '*' for count\n"
        f"- aggregation: 'count', 'sum', 'average', 'mean'\n"
        f"- title: clean human-readable title\n"
        f"- description: one sentence insight\n"
        f"- column_labels: mapping raw ids to clean names\n\n"
        f"Only use column ids from list. Respond ONLY valid JSON:\n"
        f'{{"groupby_field":"","secondary_groupby":"","value_field":"*","aggregation":"count","title":"","description":"","column_labels":{{}}}}'
    )

    raw = await _call_llm(cfg, prompt)
    match = _re.search(r'\{.*\}', raw)
    if match:
        try:
            result = json.loads(match.group())
            if isinstance(result.get("column_labels"), dict):
                result["column_labels"] = {str(k): str(v) for k, v in result.get("column_labels", {}).items()}
            return result
        except Exception:
            pass

    raise HTTPException(502, "AI returned empty or invalid response. Try again.")


# ─── AI Report Generation ─────────────────────────────────────

@router.post("/api/ai/report")
async def ai_generate_report(body: AIReportRequest):
    """Generate an AI-powered analysis report."""
    cfg = _load_ai_cfg()
    if not cfg.get("configured"):
        raise HTTPException(400, "AI not configured")

    if body.dataset_id not in datasets:
        raise HTTPException(404, "Dataset not found")

    df = datasets[body.dataset_id]["df"]
    style = body.get("style", "field_survey")

    # Style-specific prompts
    STYLE_PROMPTS = {
        "progress": "You are writing a field program progress report for NGO management. Use clear sections: Executive Summary, Progress Against Targets, Data Quality, Issues & Resolutions, Next Steps. Be concise and factual.",
        "field_survey": "You are writing a field survey report for data collection. Include sections: Overview, Survey Completion, Key Findings, Data Quality Metrics, Recommendations.",
        "research": "You are writing an academic research paper. Use sections: Abstract, Introduction, Methods, Results, Discussion, Conclusion, References.",
        "government": "You are writing an official government administrative report. Use formal tone. Include sections: Executive Summary, Background, Methodology, Findings, Recommendations, Appendices.",
        "ngo": "You are writing an NGO donor report. Include sections: Impact Summary, Beneficiary Stories, Photos/Videos, Financial Overview, Challenges & Learnings, Recommendations.",
        "executive": "You are writing an executive summary for leadership. Be brief and focus on key metrics, risks, and decisions.",
    }

    prompt = STYLE_PROMPTS.get(style, STYLE_PROMPTS["progress"])

    if body.filename:
        title = f"Analysis Report: {body.filename}"
    else:
        title = "Data Analysis Report"

    context = f"Dataset contains {len(df)} rows and {len(df.columns)} columns."
    if body.custom_context:
        context = f"\n\nAdditional Context: {body.custom_context}"

    full_prompt = f"{prompt}\n\nDataset Overview:\n{len(df)} rows × {len(df.columns)} columns.\n"
    if body.style == "research":
        full_prompt += "Include methodology, limitations, and ethical considerations.\n"
    full_prompt += context

    try:
        raw = await _call_llm(cfg, full_prompt)
        return {"report": raw}
    except Exception as e:
        traceback_print_exc()
        raise HTTPException(502, f"Report generation failed: {str(e)}")


# ─── FieldGovern Proxy Endpoints ─────────────────────────────────

@router.get("/api/ai/fg-proxy")
async def ai_fg_proxy(body: dict):
    """Proxy requests to FieldGovern main app AI endpoints."""
    # This forwards requests to FG's AI endpoints from TableForge
    # Currently a placeholder - FG's AI would handle this internally
    return {"status": "ok", "message": "FG AI proxy not yet implemented"}


# ─── Health Check ─────────────────────────────────────

@router.get("/ai/health")
async def ai_health():
    """Check AI service health."""
    cfg = _load_ai_cfg()
    is_configured = bool(cfg.get("api_key", ""))
    return {
        "configured": is_configured,
        "provider": cfg.get("provider", ""),
        "model": cfg.get("model", ""),
        "has_key": cfg.get("has_key", False),
        "models": AI_MODELS,
    }
