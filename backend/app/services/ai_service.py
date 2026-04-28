import json
import re


async def _call_llm(cfg: dict, prompt: str) -> str:
    """cfg = {'provider': ..., 'api_key': ..., 'model': ...} from system_settings."""
    provider = cfg.get('provider')
    key = cfg.get('api_key')
    model = cfg.get('model')
    if not provider or not key:
        raise ValueError("AI not configured. Contact your platform administrator.")

    LLM_TIMEOUT = 300  # seconds — extended for large reports; runs in background tasks so no worker stall

    if provider == 'openai':
        from openai import AsyncOpenAI
        client = AsyncOpenAI(api_key=key, timeout=LLM_TIMEOUT)
        r = await client.chat.completions.create(
            model=model or 'gpt-4o',
            messages=[{"role": "user", "content": prompt}],
            max_tokens=4096,
        )
        return r.choices[0].message.content or ""

    elif provider == 'anthropic':
        from anthropic import AsyncAnthropic
        client = AsyncAnthropic(api_key=key, timeout=LLM_TIMEOUT)
        r = await client.messages.create(
            model=model or 'claude-sonnet-4-6',
            max_tokens=4096,
            messages=[{"role": "user", "content": prompt}],
        )
        return r.content[0].text

    elif provider == 'gemini':
        import asyncio
        import google.generativeai as genai
        genai.configure(api_key=key)
        m = genai.GenerativeModel(model or 'gemini-1.5-pro')
        r = await asyncio.wait_for(m.generate_content_async(prompt), timeout=LLM_TIMEOUT)
        return r.text

    elif provider == 'deepseek':
        from openai import AsyncOpenAI
        client = AsyncOpenAI(api_key=key, base_url="https://api.deepseek.com", timeout=LLM_TIMEOUT)
        r = await client.chat.completions.create(
            model=model or 'deepseek-v4-flash',
            messages=[{"role": "user", "content": prompt}],
            max_tokens=8192,
        )
        return r.choices[0].message.content or ""

    raise ValueError(f"Unsupported provider: {provider}")


async def generate_report(cfg: dict, form_title: str, field_labels: list, submissions: list) -> str:
    sample = submissions[:30]
    prompt = (
        f"You are a research analyst. Summarize the following field survey results.\n"
        f"Form: {form_title}\nFields: {', '.join(field_labels)}\n"
        f"Data ({len(sample)} of {len(submissions)} submissions):\n{sample}\n\n"
        f"Write a professional 3-5 paragraph summary report in markdown. "
        f"Include key findings, patterns, and any notable data points."
    )
    return await _call_llm(cfg, prompt)


async def suggest_skip_logic(cfg: dict, question_text: str, form_fields: list) -> list:
    fields_summary = [{"id": f.get("id"), "label": f.get("label"), "type": f.get("type")} for f in form_fields[:20]]
    prompt = (
        f"Survey question: '{question_text}'\n"
        f"Existing fields: {json.dumps(fields_summary)}\n\n"
        f"Suggest 1-3 skip logic conditions for this question. "
        f"Return ONLY a JSON array like: "
        f'[{{"if_field_id": "field_id", "operator": "equals", "value": "some_value", "explanation": "why"}}]'
    )
    raw = await _call_llm(cfg, prompt)
    match = re.search(r'\[.*\]', raw, re.DOTALL)
    if match:
        return json.loads(match.group())
    return []


REPORT_STYLE_PROMPTS = {
    "progress": "You are writing a field program progress report for NGO/government management. Use clear sections: Executive Summary, Progress Against Targets, Enumerator Performance, Data Quality, Issues & Resolutions, Next Steps. Professional but accessible tone.",
    "field_survey": "You are writing a field survey report for a research team. Sections: Background, Methodology, Sample Description, Key Findings, Data Quality Assessment, Limitations, Recommendations. Technical but readable.",
    "medical": "You are writing a clinical/health data report following CONSORT/STROBE guidelines. Sections: Background, Methods, Results, Discussion, Conclusions. Formal medical research tone.",
    "research": "You are writing an academic research paper. Sections: Abstract, Introduction, Methods, Results, Discussion, Conclusion. Use formal academic language.",
    "government": "You are writing an official government administrative report. Sections: Executive Summary, Objectives, Methodology, Findings, Recommendations, Action Points. Formal bureaucratic style.",
    "ngo": "You are writing an NGO/donor impact report. Sections: Program Overview, Impact Summary, Key Indicators, Challenges, Lessons Learned. Warm but evidence-based tone.",
}


async def generate_styled_report(cfg: dict, style: str, form_title: str, date_range: str,
                                  sample_size: int, table_data: str, chart_descriptions: str,
                                  custom_context: str) -> str:
    style_prompt = REPORT_STYLE_PROMPTS.get(style, REPORT_STYLE_PROMPTS["field_survey"])
    prompt = f"""{style_prompt}

Form/Study: {form_title}
Period: {date_range}
Sample size: {sample_size} respondents

Tabulation data provided:
{table_data[:8000] if table_data else "No tabulation data provided — generate placeholder structure."}

Charts/visuals described:
{chart_descriptions or "No charts provided."}

Additional context:
{custom_context or "None."}

Generate a complete, well-structured report. Use markdown formatting (## for sections, **bold** for key numbers, tables where appropriate). Be specific and data-driven where data is provided. Mark any section needing human input with [REVIEW NEEDED]."""
    return await _call_llm(cfg, prompt)


async def translate_labels(cfg: dict, labels: list, target_lang: str) -> list:
    prompt = (
        f"Translate these survey field labels to {target_lang}.\n"
        f"Return ONLY a JSON array of translated strings in the same order, no extra text:\n"
        f"{json.dumps(labels)}"
    )
    raw = await _call_llm(cfg, prompt)
    match = re.search(r'\[.*\]', raw, re.DOTALL)
    if match:
        return json.loads(match.group())
    return labels


async def suggest_tabulation(cfg: dict, column_headers: list, sample_rows: list, user_prompt: str, research_type: str = "field_survey") -> dict:
    """AI selects columns and table structure; Python does the actual aggregation."""
    cols_str = json.dumps(column_headers[:60])
    sample_str = json.dumps(sample_rows[:10])
    prompt = (
        f"You are a research data analyst designing tabulations for a {research_type} study.\n\n"
        f"Available columns (use ONLY these ids):\n{cols_str}\n\n"
        f"Sample data rows:\n{sample_str}\n\n"
        f"User request: {user_prompt or 'Suggest the most insightful tabulations for this dataset.'}\n\n"
        f"For each table decide:\n"
        f"  - groupby_field: column id to group rows by (required)\n"
        f"  - value_field: column id to aggregate, or '*' for row count\n"
        f"  - aggregation: 'count', 'sum', or 'mean'\n"
        f"  - chart_type: 'bar', 'line', or 'pie'\n"
        f"  - show_percent: true if showing % of total adds insight\n"
        f"  - secondary_groupby: a second column id for cross-tabulation, or ''\n"
        f"  - description: one sentence explaining what this table reveals\n\n"
        f"Decide how many tables the user needs based on their request (1–6).\n\n"
        f"Also write a one-sentence `rationale` summarising your overall approach.\n\n"
        f"Respond with ONLY valid JSON, no markdown:\n"
        f'{{"rationale": "...", "tables": [{{"title": "...", "groupby_field": "...", "value_field": "*", '
        f'"aggregation": "count", "chart_type": "bar", "show_percent": true, "secondary_groupby": "", '
        f'"description": "..."}}]}}'
    )
    raw = await _call_llm(cfg, prompt)
    match = re.search(r'\{.*\}', raw, re.DOTALL)
    if match:
        try:
            return json.loads(match.group())
        except Exception:
            pass
    return {"tables": []}


async def generate_program_report(
    cfg: dict,
    program_name: str,
    scheme: str,
    date_range: str,
    sample_size: int,
    waves: list,
    tabulations: str,
    style: str = "field_survey",
    custom_context: str = "",
    approved: int = 0,
    flagged: int = 0,
    violations: int = 0,
    backcheck_required: int = 0,
    duplicate_suspects: int = 0,
    quality_score: float = 0.0,
) -> str:
    style_prompt = REPORT_STYLE_PROMPTS.get(style, REPORT_STYLE_PROMPTS["field_survey"])
    waves_str = ", ".join([f"Wave {w['wave_number']} ({w['wave_label']})" for w in waves]) if waves else "Single wave"
    approval_pct = round(approved / max(sample_size, 1) * 100, 1)
    stats_block = (
        f"Total submissions: {sample_size}\n"
        f"Approved: {approved} ({approval_pct}%)\n"
        f"Flagged for review: {flagged}\n"
        f"Data quality score: {quality_score}%\n"
        f"Submissions with violations: {violations}\n"
        f"Back-check required: {backcheck_required}\n"
        f"Duplicate suspects: {duplicate_suspects}"
    )
    prompt = (
        f"{style_prompt}\n\n"
        f"Program: {program_name}\nScheme/Study: {scheme}\nPeriod: {date_range}\n"
        f"Study design: {waves_str}\n\n"
        f"Program statistics:\n{stats_block}\n\n"
        f"Tabulation data:\n{tabulations[:10000] if tabulations else 'No tabulation data — use placeholders.'}\n\n"
        f"Additional context: {custom_context or 'None.'}\n\n"
        f"Generate a complete, professional report in markdown. Use ## for sections, **bold** for key findings. "
        f"Mark sections needing human review with [REVIEW NEEDED]."
    )
    return await _call_llm(cfg, prompt)


# ── AI Form Generation ────────────────────────────────────────────────────────

FIELD_TYPES = "text, number, decimal, single_choice, multiple_choice, date, time, gps, photo, audio, barcode, calculated, repeat_group, note, rating, signature"

FORM_GEN_SYSTEM = """You are an expert field research survey designer with deep knowledge of:
- Community health surveys, WASH studies, agricultural surveys, livelihood assessments
- Government program monitoring forms (MGNREGA, PMAY, PM-KISAN, NRLM, Anganwadi)
- Academic RCT baseline/endline forms
- NGO M&E forms (DISHA, USAID, World Bank format)

You understand chronological question flow, skip logic for conditional sections,
validation rules, and proper variable naming conventions."""


async def generate_form_schema(cfg: dict, objectives: str, study_type: str, reference_schemas: list) -> dict:
    """
    Generate a complete FormSchema-compatible JSON from study objectives.
    Returns { title, schema } where schema matches the FormSchema TypeScript type.
    """
    ref_context = ""
    if reference_schemas:
        ref_context = "\n\nReference forms from this organisation (use for context on field naming conventions):\n"
        for rs in reference_schemas:
            sections = rs["schema"].get("sections", [])
            sample_fields = []
            for sec in sections[:2]:
                for f in sec.get("fields", [])[:5]:
                    sample_fields.append(f"{f.get('id')} ({f.get('type')}): {f.get('label')}")
            ref_context += f"\nForm: {rs['title']}\nSample fields: {', '.join(sample_fields[:10])}"

    prompt = f"""{FORM_GEN_SYSTEM}

TASK: Generate a complete survey form for the following study.

Study Type: {study_type.replace('_', ' ')}
Objectives / Context:
{objectives}
{ref_context}

FIELD TYPES available: {FIELD_TYPES}

OUTPUT FORMAT — respond with ONLY valid JSON, no markdown, no explanation:
{{
  "title": "Form title here",
  "sections": [
    {{
      "id": "section_1",
      "title": "Section Title",
      "fields": [
        {{
          "id": "field_snake_case",
          "type": "single_choice",
          "name": "field_snake_case",
          "label": "Clear question label for the enumerator",
          "hint": "Optional hint for enumerator",
          "required": true,
          "options": [
            {{"value": "yes", "label": "Yes"}},
            {{"value": "no", "label": "No"}}
          ]
        }},
        {{
          "id": "age",
          "type": "number",
          "name": "age",
          "label": "Age of respondent",
          "required": true,
          "min": 0,
          "max": 120,
          "skipLogic": {{
            "logic": "AND",
            "conditions": [{{"field": "consent", "operator": "eq", "value": "yes"}}],
            "action": "show"
          }}
        }}
      ]
    }}
  ],
  "version": 1
}}

RULES:
1. Start with consent/introduction section
2. Demographics section: name, age, gender, location (use GPS field), contact
3. Build sections that logically flow from general → specific
4. Use skip logic for conditional sections (e.g., skip health section if not applicable)
5. For repeat_group fields, include a `fields` array of child fields
6. Use single_choice for categorical variables, multiple_choice for multi-select
7. Add note fields for interviewer instructions between sections
8. End with data quality / enumerator remarks section
9. Field IDs must be unique snake_case, 2-40 chars
10. Generate 20-45 fields spread across 4-8 sections based on complexity of objectives
11. Add validation (min/max for numbers, required for key fields)
12. For government program forms, include scheme-specific identifiers (beneficiary ID, ration card, etc.)
"""

    raw = await _call_llm(cfg, prompt)

    # Extract JSON from response
    match = re.search(r'\{[\s\S]*\}', raw)
    if not match:
        raise ValueError("AI returned no valid JSON")

    schema = json.loads(match.group())

    # Ensure version field
    schema.setdefault("version", 1)

    # Validate basic structure
    if "sections" not in schema or not isinstance(schema["sections"], list):
        raise ValueError("AI returned invalid schema structure")

    # Sanitize: ensure all field IDs are unique
    seen_ids: set = set()
    for section in schema.get("sections", []):
        for field in section.get("fields", []):
            fid = field.get("id", "")
            if not fid or fid in seen_ids:
                field["id"] = f"{fid or 'field'}_{len(seen_ids)}"
                field["name"] = field["id"]
            seen_ids.add(field["id"])

    title = schema.get("title", "Generated Form")
    return {"title": title, "schema": schema}
