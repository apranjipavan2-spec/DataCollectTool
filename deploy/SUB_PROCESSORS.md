# Sub-Processors — FieldGovern

Every third party that FieldGovern uses to process customer/respondent
personal data, checked against the actual codebase (not assumed) —
`grep`-verified against every service integration in `backend/app/services/`,
`backend/app/core/storage.py`, and the frontend's analytics/error-tracking
setup.

Fill in `[...]` placeholders (current hosting provider/region, currently
configured SMTP provider) before publishing this externally — those are
runtime/operator config, not hardcoded, so they can't be verified from code
alone.

| Sub-processor | Purpose | Data categories | Country | Notes |
|---|---|---|---|---|
| `[Hosting provider — e.g. Contabo]` | Application + database hosting | All personal data collected | `[region — confirm current: EU as of 2026-09-18, India move planned]` | See `tasks/pending_owner_action.md` §3 |
| OpenAI / Anthropic / Google (Gemini) / DeepSeek | AI report writing, tabulation suggestions, data-cleaning suggestions | Aggregated/pseudonymised data only — direct identifiers stripped before any call (item 1); orgs may bring their own key (BYO) instead of the shared platform key | US (OpenAI/Anthropic), varies (Gemini/DeepSeek) | Configurable per-org; `GET /ai/sub-processor` reports which provider a given tenant is actually using |
| Google (Sheets, Drive) | Optional live Sheets sync; optional Drive-backed object storage | Whatever a form owner enables Sheets sync for — identifier fields excluded by default (item 22); Drive-backed storage holds photos/audio | US / global | Sheets sync is opt-in per form and explicitly labeled as an export in the admin UI |
| Google OAuth | "Sign in with Google" login option | Email, name, profile photo URL | US | Only for orgs/users who choose Google login over password |
| `[SMTP provider — operator-configured, e.g. SES/SendGrid/Postmark]` | Transactional email (password reset, verification, digests, notifications) | Email address, name, notification content | Varies by provider | `SMTP_HOST` is empty by default — filled in by the operator, not hardcoded |
| MSG91 | SMS/OTP delivery (opt-in per tenant) | Phone number, OTP/notification content | India | Only active for tenants that configure it |
| WhatsApp Business API (Meta) | Optional WhatsApp notifications | Phone number, notification content | US/global (Meta) | Opt-in per tenant |
| Telegram | Optional Telegram notifications | Chat ID, notification content | Varies | Opt-in per tenant |
| Razorpay | Payment processing for subscriptions | Billing contact info, payment metadata (not card numbers — Razorpay is PCI-DSS scoped, FieldGovern never touches card data directly) | India | |
| Sentry | Application error tracking | Error stack traces, which may incidentally include request metadata; configured to avoid logging submission content | Configurable region | Only active if `SENTRY_DSN` is set |
| PostHog | Product usage analytics (which pages/features are used) | Usage events, not submission/respondent data | US (`us.i.posthog.com`) | Frontend-only, initialized in `main.tsx` |

## What's explicitly NOT a sub-processor in the DPDP sense

- **Redis** — self-hosted alongside the app (rate limiting, caching), data
  never leaves the deployment.
- **S3-compatible object storage** (if configured instead of local/Drive
  storage) — depends entirely on which provider/region the operator points
  it at; not a fixed third party.

## Process for adding a new sub-processor

Before integrating a new third-party service that will touch personal data:
1. Add it to the table above with purpose, data categories, and country.
2. Update this file in the same change that ships the integration — don't
   let code and this list drift apart.
3. **Notify existing customers before the new sub-processor goes live for
   their data**, with a reasonable window to object — this is a process
   commitment, not something enforced by code.
