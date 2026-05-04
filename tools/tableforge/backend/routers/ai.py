import os
import json
import re as _re
from typing import Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..shared import (datasets, custom_metrics, custom_bins, sanitize_for_json, apply_metrics_and_bins, BASE_DIR)

router = APIRouter()

AI_CONFIG_FILE = BASE_DIR / "ai_config.json"


def _load_ai_cfg() -> dict:
    """Load AI config from file, env vars, FieldGovern API, or database."""
    if AI_CONFIG_FILE.exists():
        try:
            cfg = json.loads(AI_CONFIG_FILE.read_text())
            if cfg.get("api_key"):
                return cfg
        except Exception:
            pass
    # Fallback to env vars
    provider = os.environ.get("AI_PROVIDER", "")
    api_key = os.environ.get("AI_API_KEY", "")
    model = os.environ.get("AI_MODEL", "")
    if provider and api_key:
        return {"provider": provider, "api_key": api_key, "model": model}
    # Fallback: fetch from FieldGovern main app API (when running as sidecar)
    fg_internal = os.environ.get("FG_INTERNAL_URL", "").rstrip("/")
    if fg_internal:
        try:
            import httpx
            resp = httpx.get(f"{fg_internal}/api/v1/system-settings/ai_config", timeout=5.0)
            if resp.status_code == 200:
                cfg = resp.json()
                if isinstance(cfg, dict) and "keys" in cfg:
                    active = cfg.get("active_provider", "")
                    key_cfg = cfg.get("keys", {}).get(active, {})
                    if key_cfg.get("api_key"):
                        return {"provider": active, "api_key": key_cfg["api_key"], "model": key_cfg.get("model", "")}
                elif isinstance(cfg, dict) and cfg.get("api_key"):
                    return cfg
        except Exception:
            pass
    # Fallback: try FieldGovern's database directly (when co-deployed)
    db_url = os.environ.get("DATABASE_URL", "")
    if db_url:
        try:
            from sqlalchemy import create_engine, text
            engine = create_engine(db_url)
            with engine.connect() as conn:
                row = conn.execute(text("SELECT value FROM system_settings WHERE key = 'ai_config'")).fetchone()
                if row:
                    cfg = json.loads(row[0]) if isinstance(row[0], str) else row[0]
                    if "keys" in cfg:
                        active = cfg.get("active_provider", "")
                        key_cfg = cfg.get("keys", {}).get(active, {})
                        return {"provider": active, "api_key": key_cfg.get("api_key", ""), "model": key_cfg.get("model", "")}
                    return cfg
        except Exception:
            pass
    return {}


async def _call_llm(cfg: dict, prompt: str) -> str:
    """Call configured LLM provider."""
    provider = cfg.get("provider")
    key = cfg.get("api_key")
    model = cfg.get("model")
    if not provider or not key:
        raise HTTPException(400, "AI not configured. Set AI_PROVIDER and AI_API_KEY env vars or configure via /api/ai/config.")

    LLM_TIMEOUT = 300

    try:
        if provider == "openai":
            from openai import AsyncOpenAI
            client = AsyncOpenAI(api_key=key, timeout=LLM_TIMEOUT)
            r = await client.chat.completions.create(
                model=model or "gpt-4o", messages=[{"role": "user", "content": prompt}], max_tokens=4096,
            )
            return r.choices[0].message.content or ""

        elif provider == "anthropic":
            from anthropic import AsyncAnthropic
            client = AsyncAnthropic(api_key=key, timeout=LLM_TIMEOUT)
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
            client = AsyncOpenAI(api_key=key, base_url="https://api.deepseek.com", timeout=LLM_TIMEOUT)
            r = await client.chat.completions.create(
                model=model or "deepseek-v4-flash", messages=[{"role": "user", "content": prompt}], max_tokens=8192,
            )
            return r.choices[0].message.content or ""

        else:
            raise HTTPException(400, f"Unsupported AI provider: {provider}")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, f"AI provider error ({provider}): {str(e)}")


def _match_col(name: str, actual_cols: list) -> str:
    """Best-effort match an AI-returned column name to an actual column."""
    if name in actual_cols:
        return name
    low = {c.lower().strip(): c for c in actual_cols}
    if name.lower().strip() in low:
        return low[name.lower().strip()]
    for c in actual_cols:
        if name.lower() in c.lower() or c.lower() in name.lower():
            return c
    return name


def _validate_table_cols(table: dict, actual_cols: list) -> dict:
    """Fix AI-returned column names to match actual dataset columns."""
    for key in ("groupby_field", "secondary_groupby", "value_field"):
        val = table.get(key, "")
        if val and val != "*":
            table[key] = _match_col(val, actual_cols)
    return table


AI_MODELS = {
    "gemini": [
        {"id": "gemini-2.5-flash", "name": "Gemini 2.5 Flash (fast, recommended)"},
        {"id": "gemini-2.5-pro", "name": "Gemini 2.5 Pro (best quality)"},
        {"id": "gemini-2.0-flash", "name": "Gemini 2.0 Flash"},
        {"id": "gemini-1.5-flash", "name": "Gemini 1.5 Flash (legacy)"},
    ],
    "openai": [
        {"id": "gpt-4o", "name": "GPT-4o (recommended)"},
        {"id": "gpt-4o-mini", "name": "GPT-4o Mini (faster, cheaper)"},
        {"id": "gpt-4-turbo", "name": "GPT-4 Turbo"},
    ],
    "anthropic": [
        {"id": "claude-sonnet-4-6", "name": "Claude Sonnet 4.6 (recommended)"},
        {"id": "claude-haiku-4-5-20251001", "name": "Claude Haiku 4.5 (fast)"},
    ],
    "deepseek": [
        {"id": "deepseek-chat", "name": "DeepSeek Chat (V3)"},
        {"id": "deepseek-reasoner", "name": "DeepSeek Reasoner (R1)"},
    ],
}


@router.get("/api/ai/config")
async def get_ai_config():
    cfg = _load_ai_cfg()
    return {
        "provider": cfg.get("provider", ""),
        "model": cfg.get("model", ""),
        "configured": bool(cfg.get("api_key")),
        "has_key": bool(cfg.get("api_key")),
        "models": AI_MODELS,
    }


@router.post("/api/ai/config")
async def set_ai_config(body: dict):
    # Load existing config to preserve API key if not re-entered
    existing = {}
    if AI_CONFIG_FILE.exists():
        try: existing = json.loads(AI_CONFIG_FILE.read_text())
        except Exception: pass
    provider = body.get("provider") or existing.get("provider", "")
    api_key = body.get("api_key") or existing.get("api_key", "")
    model = body.get("model") or ""
    data = {"provider": provider, "api_key": api_key, "model": model}
    AI_CONFIG_FILE.write_text(json.dumps(data))
    return {"status": "ok", "provider": provider, "model": model}


class AIPolishRequest(BaseModel):
    dataset_id: str
    table_title: str = ""
    rows: list = []
    columns: list = []
    values: list = []
    headers: list = []
    sample_rows: list = []


@router.post("/api/ai/polish")
async def ai_polish_table(body: AIPolishRequest):
    """AI-powered title, subtitle, and column label generation."""
    cfg = _load_ai_cfg()
    groupby = body.rows[0] if body.rows else ""
    value_field = body.values[0].get("field", "*") if body.values else "*"
    aggregation = body.values[0].get("agg", "count") if body.values else "count"
    is_cross_tab = len(body.columns) > 0
    sub_keys = body.columns

    rows_preview = []
    for r in body.sample_rows[:20]:
        if isinstance(r, list):
            rows_preview.append(" | ".join(str(v) for v in r))
        elif isinstance(r, dict):
            rows_preview.append(" | ".join(f"{k}={v}" for k, v in list(r.items())[:8]))

    all_col_keys = list(dict.fromkeys([groupby] + ([value_field] if value_field != "*" else []) + sub_keys + body.headers))
    col_keys_json = json.dumps({k: f"clean label for {k}" for k in all_col_keys[:15]})

    prompt = (
        f"You are a research data analyst. A data tabulation has raw machine-generated names. Clean them up.\n\n"
        f"Raw table info:\n"
        f"- Title: {body.table_title or 'Untitled'}\n"
        f"- Row variable (groupby): {groupby}\n"
        f"- Value/column variable: {value_field}\n"
        f"- Aggregation: {aggregation}\n"
        f"- Is cross-tabulation: {is_cross_tab}\n"
        f"- Column headers: {body.headers[:15]}\n"
        f"- Sample data ({len(rows_preview)} rows):\n" +
        "\n".join(rows_preview) + "\n\n"
        f"Return ONLY valid JSON (no markdown, no explanation):\n"
        f'{{\n'
        f'  "title": "Human-readable table title",\n'
        f'  "subtitle": "One sentence: what insight this table provides",\n'
        f'  "column_labels": {col_keys_json}\n'
        f'}}\n\n'
        f"Rules:\n"
        f"- Title: concise and specific, not generic\n"
        f"- subtitle: describes the insight or finding angle\n"
        f"- column_labels: map raw field names to clean human-readable labels\n"
        f"- For '*' use 'Count' or 'Number of Records'\n"
        f"- For mean aggregation label as 'Average [field meaning]'"
    )
    raw = await _call_llm(cfg, prompt)
    match = _re.search(r'\{.*\}', raw, _re.DOTALL)
    if match:
        try:
            result = json.loads(match.group())
            if isinstance(result.get("column_labels"), dict):
                result["column_labels"] = {str(k): str(v) for k, v in result["column_labels"].items()}
            return result
        except Exception:
            pass
    return {"title": body.table_title, "subtitle": "", "column_labels": {}}


class AIInterpretRequest(BaseModel):
    dataset_id: str
    table_title: str = ""
    subtitle: str = ""
    headers: list = []
    rows_data: list = []
    row_fields: list = []
    column_fields: list = []
    value_fields: list = []
    focus: str = ""
    previous_interpretation: str = ""
    length: str = "auto"
    include_recommendations: bool = True


@router.post("/api/ai/interpret")
async def ai_interpret_table(body: AIInterpretRequest):
    """AI-powered table interpretation — generates narrative analysis."""
    cfg = _load_ai_cfg()

    # Build table text representation
    header_line = " | ".join(body.headers[:20])
    rows_str = "\n".join(
        " | ".join(str(v) for v in row[:20])
        for row in body.rows_data[:60]
    )
    if len(body.rows_data) > 60:
        rows_str += f"\n... ({len(body.rows_data) - 60} more rows not shown)"

    default_focus = (
        "Provide a comprehensive interpretation: identify the standout finding, "
        "notable patterns or disparities, the highest and lowest values and what they suggest, "
        "any cross-variable interactions, and practical implications."
    )

    refinement_block = ""
    if body.previous_interpretation.strip():
        refinement_block = (
            f"\n--- PREVIOUS INTERPRETATION ---\n"
            f"{body.previous_interpretation.strip()}\n"
            f"--- END ---\n\n"
            f"Produce a REFINED interpretation that:\n"
            f"- Preserves accurate findings from previous version\n"
            f"- Corrects errors or vague statements\n"
            f"- Adds missed insights\n"
            f"- Sharpens language and flow\n"
            f"Output ONLY the final refined interpretation.\n"
        )

    length_guide = {
        "short": "Write 2-3 sentences. Only the top finding and one key pattern.",
        "medium": "Write 1-2 short paragraphs. Cover the main finding, key patterns, and notable outliers.",
        "long": "Write a thorough multi-paragraph analysis. Cover all significant findings, patterns, comparisons, and outliers in detail.",
        "auto": "Be as detailed as the data warrants — more rows/complexity = longer interpretation.",
    }
    length_instruction = length_guide.get(body.length, length_guide["auto"])

    rec_instruction = (
        "- End with practical implication or recommendation\n"
        if body.include_recommendations
        else "- Do NOT include recommendations or conclusions — only describe findings and patterns\n"
    )

    prompt = (
        f"You are a senior data analyst writing an interpretation for a data table.\n\n"
        f"Table: {body.table_title}\n"
        f"{body.subtitle}\n"
        f"Row dimensions: {body.row_fields}\n"
        f"Column dimensions: {body.column_fields}\n"
        f"Value fields: {[v.get('field','') + ' (' + v.get('agg','sum') + ')' for v in body.value_fields]}\n\n"
        f"Data ({len(body.rows_data)} rows):\n"
        f"{header_line}\n"
        f"{'-' * max(len(header_line), 40)}\n"
        f"{rows_str}\n"
        f"{refinement_block}\n"
        f"Analyst focus: {body.focus.strip() if body.focus.strip() else default_focus}\n\n"
        f"Length: {length_instruction}\n\n"
        f"Write a data-driven interpretation in flowing prose:\n"
        f"- Be specific — cite actual numbers from the table\n"
        f"- State the most important finding first\n"
        f"- Note outliers, unexpected gaps, or strong patterns\n"
        f"- For cross-tabs: explain interaction between variables\n"
        f"- Quantify comparisons (e.g. '3.2x higher', 'gap of 47 points')\n"
        f"{rec_instruction}"
        f"- Describe what the data MEANS, not what the table contains"
    )
    interpretation = await _call_llm(cfg, prompt)
    return {"interpretation": interpretation}


class AISuggestRequest(BaseModel):
    dataset_id: str
    prompt: str = ""


@router.post("/api/ai/suggest")
async def ai_suggest_tables(body: AISuggestRequest):
    """AI suggests optimal table configurations from the dataset."""
    cfg = _load_ai_cfg()
    if body.dataset_id not in datasets:
        raise HTTPException(404, "Dataset not found")
    ds = datasets[body.dataset_id]
    df = ds["df"]

    cols_info = []
    for col in df.columns[:80]:
        dtype = str(df[col].dtype)
        uniq = int(df[col].nunique())
        sample = df[col].dropna().head(3).astype(str).tolist()
        cols_info.append({"id": col, "type": "numeric" if "int" in dtype or "float" in dtype else "text", "unique": uniq, "sample": sample[:2]})

    sample_rows = df.head(5).fillna("").to_dict(orient="records")

    prompt = (
        f"You are a research data analyst designing tabulations.\n\n"
        f"Available columns (use ONLY these ids):\n{json.dumps(cols_info)}\n\n"
        f"Sample data rows:\n{json.dumps(sample_rows[:3], default=str)}\n\n"
        f"User request: {body.prompt or 'Suggest the most insightful tabulations for this dataset.'}\n\n"
        f"For each table decide:\n"
        f"  - groupby_field: column id to group rows by (required)\n"
        f"  - value_field: column id to aggregate, or '*' for row count\n"
        f"  - aggregation: 'count', 'sum', or 'mean'\n"
        f"  - secondary_groupby: second column for cross-tab, or ''\n"
        f"  - title: clean human-readable title\n"
        f"  - description: one sentence explaining insight\n\n"
        f"Suggest 2-5 tables. Respond with ONLY valid JSON:\n"
        f'{{"rationale": "...", "tables": [{{"title":"...","groupby_field":"...","value_field":"*","aggregation":"count","secondary_groupby":"","description":"..."}}]}}'
    )
    raw = await _call_llm(cfg, prompt)
    match = _re.search(r'\{.*\}', raw, _re.DOTALL)
    if match:
        try:
            result = json.loads(match.group())
            actual_cols = list(df.columns)
            for t in result.get("tables", []):
                _validate_table_cols(t, actual_cols)
            return result
        except Exception:
            pass
    return {"rationale": "Could not parse AI response", "tables": []}


class AISmartBuildRequest(BaseModel):
    dataset_id: str
    selected_columns: list = []
    query: str = ""


@router.post("/api/ai/smart-build")
async def ai_smart_build(body: AISmartBuildRequest):
    """AI designs one optimized table from selected columns or NL query."""
    try:
        cfg = _load_ai_cfg()
        if not cfg.get("api_key"):
            raise HTTPException(400, "AI not configured. Go to AI Settings and add your API key.")
        if body.dataset_id not in datasets:
            raise HTTPException(404, "Dataset not found")
        ds = datasets[body.dataset_id]
        df = ds["df"]

        if body.selected_columns:
            cols = [c for c in body.selected_columns if c in df.columns]
        else:
            cols = list(df.columns[:30])

        if not cols:
            raise HTTPException(400, "No valid columns found for analysis")

        cols_block = []
        for col in cols[:60]:
            dtype = str(df[col].dtype)
            try:
                uniq_vals = [str(v)[:50] for v in df[col].dropna().unique()[:6]]
            except Exception:
                uniq_vals = []
            cols_block.append(f"  - id={col} | type={'numeric' if 'int' in dtype or 'float' in dtype else 'text'} | unique({df[col].nunique()}): {uniq_vals}")

        sample_rows = sanitize_for_json(df[cols[:30]].head(4).fillna("").to_dict(orient="records"))

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
            f"- aggregation: 'count', 'sum', or 'mean'\n"
            f"- title: clean human-readable title\n"
            f"- description: one sentence insight\n"
            f"- column_labels: mapping raw ids to clean names\n\n"
            f"Only use column ids from list. Respond ONLY valid JSON:\n"
            f'{{"groupby_field":"","secondary_groupby":"","value_field":"*","aggregation":"count","title":"","description":"","column_labels":{{}}}}'
        )
        raw = await _call_llm(cfg, prompt)
        match = _re.search(r'\{.*\}', raw, _re.DOTALL)
        if match:
            try:
                result = json.loads(match.group())
                if isinstance(result.get("column_labels"), dict):
                    result["column_labels"] = {str(k): str(v) for k, v in result["column_labels"].items()}
                _validate_table_cols(result, list(df.columns))
                return result
            except json.JSONDecodeError:
                raise HTTPException(502, "AI returned invalid JSON. Try again.")
        raise HTTPException(502, "AI returned empty response. Try again.")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Smart Build failed: {str(e)}")


class AIAutoGenerateRequest(BaseModel):
    dataset_id: str
    table_descriptions: str = ""
    objectives: str = ""
    max_tables: int = 20
    column_descriptions: dict = {}
    selected_columns: list = []
    template: str = ""


@router.post("/api/ai/auto-generate")
async def ai_auto_generate(body: AIAutoGenerateRequest):
    """AI generates a comprehensive set of tables from all columns."""
    try:
        cfg = _load_ai_cfg()
        if not cfg.get("api_key"):
            raise HTTPException(400, "AI not configured. Go to AI Settings and add your API key.")
        if body.dataset_id not in datasets:
            raise HTTPException(404, "Dataset not found")
        ds = datasets[body.dataset_id]
        df = ds["df"]

        target_cols = body.selected_columns if body.selected_columns else list(df.columns[:100])
        cols_info = []
        for col in target_cols:
            if col not in df.columns:
                continue
            dtype = str(df[col].dtype)
            uniq = int(df[col].nunique())
            sample = [str(v)[:50] for v in df[col].dropna().head(3).tolist()]
            col_entry = {
                "id": col,
                "dtype": dtype,
                "analysis_type": "numeric" if "int" in dtype or "float" in dtype else ("date" if "datetime" in dtype else "categorical"),
                "unique": uniq,
                "sample": sample,
            }
            if col in body.column_descriptions and body.column_descriptions[col]:
                col_entry["description"] = body.column_descriptions[col]
            cols_info.append(col_entry)

        sample_rows = df[target_cols[:30]].head(5).fillna("").to_dict(orient="records")

        guidance = ""
        if body.objectives.strip():
            guidance += (
                f"\n--- RESEARCH OBJECTIVES & QUESTIONS ---\n"
                f"{body.objectives.strip()}\n"
                f"--- END ---\n\n"
                f"Generate tables that directly answer these research objectives and questions. "
                f"Each table should map to one or more objectives. "
                f"Include the relevant objective in each table's description.\n\n"
            )
        if body.table_descriptions.strip():
            guidance += (
                f"\n--- USER TABLE DESCRIPTIONS ---\n"
                f"{body.table_descriptions.strip()}\n"
                f"--- END ---\n\n"
                f"Follow the user's table descriptions closely. Create EXACTLY the tables described. "
                f"If the descriptions mention specific columns, use those. "
                f"If they mention cross-tabs, set secondary_groupby accordingly.\n\n"
            )

        template_guide = (
            "TEMPLATE FORMATS — choose the best template for each table:\n"
            "  'count_pct_row': Count + % of Row total. Best for cross-tabs comparing distributions.\n"
            "  'count_pct_col': Count + % of Column total. Best for demographic breakdowns.\n"
            "  'count_pct_grand': Count + % of Grand Total. Best for overall composition.\n"
            "  'frequency': Simple frequency distribution (count only). Best for single categorical variable.\n"
            "  'average_totals': Average with subtotals and grand totals. Best for numeric measures.\n"
            "  'sum_pct_row': Sum + % of Row total. Best for monetary/volume cross-tabs.\n"
            "  'crosstab_full': Count + row % + subtotals + grand totals. Best for full cross-tabulations.\n\n"
            "ANALYSIS TYPE GUIDANCE:\n"
            "  - Categorical columns (low unique values <20): frequency distribution, cross-tabs\n"
            "  - Numeric columns: mean/sum aggregations, averages by category\n"
            "  - Text columns with high cardinality: skip or use as row grouping only\n"
            "  - Date columns: use for time-based groupings\n"
            "  - Boolean columns: frequency counts, cross-tabs with demographics\n\n"
        )

        prompt = (
            f"You are a senior research data analyst designing a comprehensive tabulation plan.\n\n"
            f"Available columns (use ONLY these exact ids):\n{json.dumps(cols_info, ensure_ascii=False, default=str)}\n\n"
            f"Sample data rows:\n{json.dumps(sample_rows[:4], ensure_ascii=False, default=str)}\n\n"
            f"{guidance}"
            f"{template_guide}"
            f"Generate {body.max_tables} tables covering all major dimensions of this dataset.\n"
            f"Include a mix of:\n"
            f"- Simple frequency tables for each categorical variable\n"
            f"- Cross-tabulations (category x category) for related variables\n"
            f"- Mean/sum aggregations for numeric columns grouped by categories\n"
            f"- Key demographic breakdowns\n"
            f"- Any analysis suggested by column descriptions or data patterns\n\n"
            f"For each table provide:\n"
            f"  - groupby_field: column id for row grouping (required)\n"
            f"  - secondary_groupby: column id for cross-tab columns, or '' for simple table\n"
            f"  - value_field: column id to aggregate, or the groupby_field with 'count' aggregation\n"
            f"  - aggregation: 'count', 'sum', or 'mean'\n"
            f"  - template: one of 'count_pct_row', 'count_pct_col', 'count_pct_grand', 'frequency', 'average_totals', 'sum_pct_row', 'crosstab_full'\n"
            f"  - title: clean descriptive title\n"
            f"  - description: one sentence explaining the insight\n\n"
            f"IMPORTANT: Do NOT use '*' as value_field. For count tables, use the groupby_field as value_field with aggregation 'count'.\n\n"
            f"Respond with ONLY valid JSON:\n"
            f'{{"tables": [{{"groupby_field":"...","secondary_groupby":"","value_field":"...","aggregation":"count","template":"frequency","title":"...","description":"..."}}]}}'
        )
        all_tables = []
        batch_size = 30
        remaining = body.max_tables
        batch_num = 0
        while remaining > 0:
            this_batch = min(remaining, batch_size)
            batch_prompt = prompt.replace(
                f"Generate {body.max_tables} tables",
                f"Generate {this_batch} tables"
            )
            if batch_num > 0 and all_tables:
                existing_titles = [t.get("title", "") for t in all_tables]
                batch_prompt += f"\n\nYou already generated these tables (do NOT repeat them):\n{json.dumps(existing_titles)}"
            raw = await _call_llm(cfg, batch_prompt)
            match = _re.search(r'\{.*\}', raw, _re.DOTALL)
            if match:
                try:
                    result = json.loads(match.group())
                    actual_cols = list(df.columns)
                    batch_tables = result.get("tables", [])
                    for t in batch_tables:
                        _validate_table_cols(t, actual_cols)
                        if t.get("value_field") == "*":
                            t["value_field"] = t.get("groupby_field", "")
                            t["aggregation"] = "count"
                        if not t.get("template"):
                            t["template"] = "frequency" if not t.get("secondary_groupby") else "count_pct_row"
                    all_tables.extend(batch_tables)
                except json.JSONDecodeError:
                    if not all_tables:
                        raise HTTPException(502, "AI returned invalid JSON. Try again.")
                    break
            else:
                if not all_tables:
                    raise HTTPException(502, "AI returned empty response. Try again.")
                break
            remaining -= this_batch
            batch_num += 1
        return {"tables": all_tables}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Auto-generate failed: {str(e)}")


class AICreateColumnRequest(BaseModel):
    dataset_id: str
    description: str
    column_descriptions: dict = {}
    selected_columns: list = []


@router.post("/api/ai/create-column")
async def ai_create_column(body: AICreateColumnRequest):
    """AI creates a new computed column (metric or bin) from natural language."""
    try:
        cfg = _load_ai_cfg()
        if not cfg.get("api_key"):
            raise HTTPException(400, "AI not configured. Go to AI Settings and add your API key.")
        if body.dataset_id not in datasets:
            raise HTTPException(404, "Dataset not found")
        ds = datasets[body.dataset_id]
        df = ds["df"]

        use_cols = [c for c in df.columns if c in body.selected_columns] if body.selected_columns else list(df.columns[:80])
        cols_info = []
        for col in use_cols:
            dtype = str(df[col].dtype)
            uniq = int(df[col].nunique())
            sample = df[col].dropna().head(5).astype(str).tolist()
            entry = {
                "id": col,
                "type": "numeric" if "int" in dtype or "float" in dtype else "text",
                "unique": uniq,
                "sample": sample,
            }
            if col in body.column_descriptions and body.column_descriptions[col]:
                entry["description"] = body.column_descriptions[col]
            cols_info.append(entry)

        prompt = (
            f"You are a data engineer. The user wants to create a new computed column.\n"
            f"Think of it like Excel formulas or Power BI conditional columns.\n\n"
            f"Available columns:\n{json.dumps(cols_info, indent=1)}\n\n"
            f"User request: \"{body.description}\"\n\n"
            f"Decide if this is a METRIC (computation/formula/conditional) or BIN (categorization/grouping).\n\n"
            f"METRIC types and their required fields:\n"
            f"  formula: column_a, operator (+,-,*,/), column_b\n"
            f"  ratio: numerator, denominator\n"
            f"  percentage: part, whole\n"
            f"  growth: current, previous, growth_type (percentage|absolute)\n"
            f"  weighted_average: value_column, weight_column\n"
            f"  index: base_column, base_value\n"
            f"  rank: rank_column, rank_order (asc|desc)\n"
            f"  cumulative: value_column\n"
            f"  composite: column_a, operator, column_b (for combining metrics)\n"
            f"  conditional: cond_column, cond_operator (gt|gte|lt|lte|eq|neq|contains|not_contains), cond_value,\n"
            f"    cond_then_type (literal|column), cond_then_val or cond_then_col,\n"
            f"    cond_else_type (literal|column), cond_else_val or cond_else_col\n\n"
            f"For conditional with multiple conditions (nested IF), use metric_type='conditional' for the outer.\n"
            f"Set cond_else_type='literal' and cond_else_val to a label for the else case.\n\n"
            f"BIN types: numeric (ranges), text (mapping), group (category collapsing),\n"
            f"  equal_width (auto bins), quartile, decile\n"
            f"  For numeric bins use: source_column, bin_type='numeric',\n"
            f"    ranges: [{{label, lower, upper}}, ...]\n"
            f"  For text mapping: source_column, bin_type='text',\n"
            f"    mapping: {{\"original_value\": \"new_label\", ...}}\n"
            f"  For category grouping: source_column, bin_type='group',\n"
            f"    group_map: {{\"group_label\": [\"val1\", \"val2\"], ...}}\n\n"
            f"Return JSON:\n"
            f'{{"type": "metric"|"bin", "definition": {{...}}}}\n\n'
            f"IMPORTANT:\n"
            f"- Use ONLY column ids from the available columns list\n"
            f"- Always include a 'name' field for the new column\n"
            f"- For conditional columns, text comparisons: cond_operator='eq' with cond_value as the text\n"
            f"- Return ONLY valid JSON, nothing else"
        )
        raw = await _call_llm(cfg, prompt)
        match = _re.search(r'\{.*\}', raw, _re.DOTALL)
        if match:
            try:
                result = json.loads(match.group())
                return result
            except json.JSONDecodeError:
                raise HTTPException(502, "AI returned invalid JSON. Try again.")
        raise HTTPException(502, "AI returned empty response. Try again.")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"AI column creation failed: {str(e)}")


REPORT_STYLE_PROMPTS = {
    "progress": "You are writing a field program progress report for NGO/government management. Use clear sections: Executive Summary, Progress Against Targets, Data Quality, Issues & Resolutions, Next Steps. Professional but accessible tone.",
    "field_survey": "You are writing a field survey report for a research team. Sections: Background, Methodology, Sample Description, Key Findings, Data Quality Assessment, Limitations, Recommendations. Technical but readable.",
    "research": "You are writing an academic research paper. Sections: Abstract, Introduction, Methods, Results, Discussion, Conclusion. Use formal academic language.",
    "government": "You are writing an official government administrative report. Sections: Executive Summary, Objectives, Methodology, Findings, Recommendations, Action Points. Formal bureaucratic style.",
    "ngo": "You are writing an NGO/donor impact report. Sections: Program Overview, Impact Summary, Key Indicators, Challenges, Lessons Learned. Warm but evidence-based tone.",
    "executive": "You are writing a concise executive summary for leadership. Maximum 2 pages. Focus on key numbers, decisions needed, and actionable next steps.",
}


class AIReportRequest(BaseModel):
    dataset_id: str
    tables_data: list = []
    style: str = "field_survey"
    custom_context: str = ""
    filename: str = ""


@router.post("/api/ai/report")
async def ai_generate_report(body: AIReportRequest):
    """Generate a full report from table data."""
    cfg = _load_ai_cfg()
    style_prompt = REPORT_STYLE_PROMPTS.get(body.style, REPORT_STYLE_PROMPTS["field_survey"])

    tables_text = ""
    for i, t in enumerate(body.tables_data[:10]):
        title = t.get("title", f"Table {i+1}")
        headers = t.get("headers", [])
        rows = t.get("rows", [])
        tables_text += f"\n### {title}\n"
        tables_text += " | ".join(str(h) for h in headers) + "\n"
        tables_text += " | ".join("---" for _ in headers) + "\n"
        for row in rows[:30]:
            tables_text += " | ".join(str(v) for v in row) + "\n"
        if len(rows) > 30:
            tables_text += f"... ({len(rows) - 30} more rows)\n"

    row_count = 0
    if body.dataset_id in datasets:
        row_count = len(datasets[body.dataset_id]["df"])

    prompt = (
        f"{style_prompt}\n\n"
        f"Dataset: {body.filename or 'Data Analysis'}\n"
        f"Total records: {row_count}\n"
        f"Number of tables analyzed: {len(body.tables_data)}\n\n"
        f"Tabulation data:\n{tables_text[:10000] if tables_text else 'No tabulation data — use placeholders.'}\n\n"
        f"Additional context: {body.custom_context or 'None.'}\n\n"
        f"Generate a complete, professional report in markdown. Use ## for sections, **bold** for key findings. "
        f"Be specific and data-driven. Mark sections needing human input with [REVIEW NEEDED]."
    )
    report = await _call_llm(cfg, prompt)
    return {"report": report}


# AI proxy to FieldGovern (when embedded)
@router.post("/api/ai/fg-proxy")
async def ai_fg_proxy(body: dict):
    """Proxy AI requests to FieldGovern backend when embedded."""
    import httpx
    fg_url = body.get("fg_url", "").rstrip("/")
    token = body.get("token", "")
    endpoint = body.get("endpoint", "")
    payload = body.get("payload", {})
    if not fg_url or not token or not endpoint:
        raise HTTPException(400, "Missing fg_url, token, or endpoint")
    internal_base = os.environ.get("FG_INTERNAL_URL", "").rstrip("/")
    base = internal_base if internal_base else fg_url
    url = f"{base}{endpoint}"
    try:
        async with httpx.AsyncClient(timeout=120.0, verify=bool(not internal_base)) as client:
            resp = await client.post(url, json=payload, headers={"Authorization": f"Bearer {token}"})
        if resp.status_code != 200:
            raise HTTPException(resp.status_code, f"FG returned {resp.status_code}: {resp.text[:200]}")
        return resp.json()
    except httpx.RequestError as e:
        raise HTTPException(502, f"Could not reach FieldGovern: {e}")
