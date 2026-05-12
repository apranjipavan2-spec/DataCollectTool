

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
## frontend

### frontend\src\auth\LoginPage.tsx
```
component FeatureIcon
component Logo
component LoginPage
hook useNavigate
hook useState
hook useRef
hook useEffect
handler onMouseEnter
handler onMouseLeave
handler onChange
handler onKeyDown
handler onFocus
handler onBlur
handler onClick
```

### frontend\src\components\TopNav.tsx
```
component NotifRow
component NotificationBell
component UsageBar
props TopNavProps
hook useState
hook useRef
hook useNavigate
hook useCallback
hook useEffect
hook useSubscription
export TopNav
handler onClick
```

### frontend\src\components\ui\Card.tsx
```
export Card
```

### frontend\src\dashboard\Dashboard.modern.tsx
```
component StatusBadge
component RoleBadge
component CommentsThread
component SubmissionDetailModal
component AssignModal
component Dashboard
hook useState
hook useEffect
hook useToast
hook useRef
hook useMemo
handler onChange
handler onKeyDown
handler onClick
handler onId
handler onClose
handler onFlag
handler onAssign
handler onUnassign
handler onMouseEnter
handler onMouseLeave
```
