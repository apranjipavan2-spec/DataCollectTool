async def _call_llm(tenant, prompt: str) -> str:
    cfg = tenant.ai_config or {}
    provider = cfg.get('provider')
    key = cfg.get('api_key')
    model = cfg.get('model')
    if not provider or not key:
        raise ValueError("AI not configured for this organisation")

    if provider == 'openai':
        from openai import AsyncOpenAI
        client = AsyncOpenAI(api_key=key)
        r = await client.chat.completions.create(
            model=model or 'gpt-4o',
            messages=[{"role": "user", "content": prompt}],
            max_tokens=2048
        )
        return r.choices[0].message.content or ""

    elif provider == 'anthropic':
        from anthropic import AsyncAnthropic
        client = AsyncAnthropic(api_key=key)
        r = await client.messages.create(
            model=model or 'claude-sonnet-4-6',
            max_tokens=2048,
            messages=[{"role": "user", "content": prompt}]
        )
        return r.content[0].text

    elif provider == 'gemini':
        import google.generativeai as genai
        genai.configure(api_key=key)
        m = genai.GenerativeModel(model or 'gemini-1.5-pro')
        r = await m.generate_content_async(prompt)
        return r.text

    raise ValueError(f"Unsupported provider: {provider}")


async def generate_report(tenant, form_title: str, field_labels: list, submissions: list) -> str:
    sample = submissions[:30]
    prompt = (
        f"You are a research analyst. Summarize the following field survey results.\n"
        f"Form: {form_title}\nFields: {', '.join(field_labels)}\n"
        f"Data ({len(sample)} of {len(submissions)} submissions):\n{sample}\n\n"
        f"Write a professional 3-5 paragraph summary report in markdown. "
        f"Include key findings, patterns, and any notable data points."
    )
    return await _call_llm(tenant, prompt)


async def suggest_skip_logic(tenant, question_text: str, form_fields: list) -> list:
    import json
    fields_summary = [{"id": f.get("id"), "label": f.get("label"), "type": f.get("type")} for f in form_fields[:20]]
    prompt = (
        f"Survey question: '{question_text}'\n"
        f"Existing fields: {json.dumps(fields_summary)}\n\n"
        f"Suggest 1-3 skip logic conditions for this question. "
        f"Return ONLY a JSON array like: "
        f'[{{"if_field_id": "field_id", "operator": "equals", "value": "some_value", "explanation": "why"}}]'
    )
    raw = await _call_llm(tenant, prompt)
    import re
    match = re.search(r'\[.*\]', raw, re.DOTALL)
    if match:
        return json.loads(match.group())
    return []


REPORT_STYLE_PROMPTS = {
    "progress": "You are writing a field program progress report for NGO/government management. Use clear sections: Executive Summary, Progress Against Targets, Enumerator Performance, Data Quality, Issues & Resolutions, Next Steps. Professional but accessible tone.",
    "field_survey": "You are writing a field survey report for a research team. Sections: Background, Methodology, Sample Description, Key Findings, Data Quality Assessment, Limitations, Recommendations. Technical but readable.",
    "medical": "You are writing a clinical/health data report following CONSORT/STROBE guidelines. Sections: Background, Methods (design, participants, data collection), Results (with statistical context), Discussion, Conclusions. Formal medical research tone.",
    "research": "You are writing an academic research paper. Sections: Abstract, Introduction, Methods, Results, Discussion, Conclusion. Use formal academic language, passive voice where appropriate, cite data precisely.",
    "government": "You are writing an official government administrative report. Sections: Executive Summary, Objectives, Methodology, Findings, Recommendations, Action Points. Formal bureaucratic style, numbered points.",
    "ngo": "You are writing an NGO/donor impact report. Sections: Program Overview, Impact Summary, Beneficiary Stories (placeholder), Key Indicators, Challenges, Lessons Learned, Financial Summary (placeholder). Warm but evidence-based tone.",
}


async def generate_styled_report(tenant, style: str, form_title: str, date_range: str,
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
    return await _call_llm(tenant, prompt)


async def translate_labels(tenant, labels: list, target_lang: str) -> list:
    import json
    prompt = (
        f"Translate these survey field labels to {target_lang}.\n"
        f"Return ONLY a JSON array of translated strings in the same order, no extra text:\n"
        f"{json.dumps(labels)}"
    )
    raw = await _call_llm(tenant, prompt)
    import re
    match = re.search(r'\[.*\]', raw, re.DOTALL)
    if match:
        return json.loads(match.group())
    return labels
