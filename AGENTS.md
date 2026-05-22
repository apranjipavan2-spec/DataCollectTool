

## Tools

<!-- sigmap-tools -->

```json
[
  {
    "name": "sigmap_ask",
    "description": "Rank source files by relevance to a natural-language query. Run before exploring the codebase.",
    "command": "sigmap ask \"$QUERY\""
  },
  {
    "name": "sigmap_validate",
    "description": "Validate SigMap config and measure context coverage. Run after changing config or source dirs.",
    "command": "sigmap validate"
  },
  {
    "name": "sigmap_judge",
    "description": "Score an LLM response for groundedness against source context. Use to verify answer quality.",
    "command": "sigmap judge --response \"$RESPONSE\" --context \"$CONTEXT\""
  },
  {
    "name": "sigmap_query",
    "description": "Rank all files by relevance using TF-IDF and write a focused mini-context.",
    "command": "sigmap --query \"$QUERY\" --context"
  },
  {
    "name": "sigmap_weights",
    "description": "Show learned file-ranking multipliers accumulated from past sessions.",
    "command": "sigmap weights"
  }
]
```

## Auto-generated signatures
<!-- Updated by gen-context.js -->
# Code signatures

## SigMap commands

| When | Command |
|------|---------|
| Before answering a question | `sigmap ask "<your question>"` |
| After code changes | `sigmap validate` |
| To query by topic | `sigmap --query "<topic>"` |

Always run `sigmap ask` or `sigmap --query` before searching for files relevant to a task.
## website

### website\404.html
```
title: Page Not Found (404) — FieldGovern
```

### website\best-survey-app-india.html
```
title: Best Survey App in India (2026) — Honest Buyer's Guide | FieldGovern
```

### website\capi-software-india.html
```
title: Best CAPI Software for India (2026) — FieldGovern
```

### website\dpdp-compliant-survey-software.html
```
title: DPDP-Compliant Survey Software in India (2026) — FieldGovern
```

### website\features.html
```
title: Features (2026) — FieldGovern | Offline PWA, AI Form Builder, Back-Check, DPDP
nav#navbar
button#hamburgerBtn
div#mobileMenu
div#pgProgress
span#uploadPct
span#sheetCount
div#langQ
div#langHint
div#lo1
div#lo2
div#lo3
div#lo4
```

### website\googleforms-alternative.html
```
title: The Best Google Forms Alternative for Field Research in India (2026) — FieldGovern
```

### website\index.html
```
title: FieldGovern (2026) — India's Offline-First Survey App + AI Analysis | From ₹6,499/mo
nav#navbar
button#hamburgerBtn
div#mobileMenu
canvas#particleCanvas
div#mockBars
span#syncPct
div#syncBar
section#features
section#compare
div#scoreGrid
div#aiMsg
div#aiCards
section#pipeline
section#analytics
section#about
```

### website\integrations.html
```
title: Integrations — FieldGovern
nav#navbar
button#hamburgerBtn
div#mobileMenu
```

### website\magpi-alternative.html
```
title: The Best Magpi Alternative for India (2026) — FieldGovern
```

### website\offline-survey-app-india.html
```
title: Best Offline Survey App for India (2026) — FieldGovern
```

### website\pricing.html
```
title: Pricing (2026) — FieldGovern | From ₹6,499/mo · UPI Billing
nav#navbar
button#hamburgerBtn
div#mobileMenu
```

### website\qualtrics-alternative.html
```
title: The Best Qualtrics Alternative for India (2026) — FieldGovern
```

### website\security.html
```
title: Security — FieldGovern
nav#navbar
button#hamburgerBtn
div#mobileMenu
```

### website\sitemap.xml
```
root urlset
```

### website\survey-tool-for-ngos-india.html
```
title: Best Survey Tool for NGOs in India (2026) — FieldGovern
```

### website\surveycto-alternative.html
```
title: The Best SurveyCTO Alternative for India (2026) — FieldGovern
```

### website\surveymonkey-alternative.html
```
title: The Best SurveyMonkey Alternative for India (2026) — FieldGovern
```

### website\use-cases.html
```
title: Use Cases — FieldGovern
nav#navbar
button#hamburgerBtn
div#mobileMenu
```
