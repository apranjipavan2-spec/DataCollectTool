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
