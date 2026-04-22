# Pending Manual Intervention
<!-- Items that are built but need your credentials/accounts to go live -->
<!-- Updated: 2026-04-23 -->

---

## 1. Sentry — Error Monitoring
**Status:** Code is live. Needs DSN env vars.

**Steps:**
1. Go to sentry.io → Create free account
2. New Project → FastAPI → copy DSN (call it `BACKEND_DSN`)
3. New Project → React → copy DSN (call it `FRONTEND_DSN`)
4. On VPS: add to `/opt/fieldgovern/.env`:
   ```
   SENTRY_DSN=<BACKEND_DSN>
   ```
5. GitHub repo → Settings → Secrets → Actions → add:
   ```
   VITE_SENTRY_DSN=<FRONTEND_DSN>
   ```
6. Trigger a redeploy (push any commit)

---

## 2. WhatsApp Notifications — MSG91
**Status:** Code is live. Needs MSG91 account + Meta approval.

**Steps:**
1. Create account at msg91.com
2. WhatsApp → Apply for WABA (WhatsApp Business Account)
   - Meta review: 1–2 business days
3. Once approved: WhatsApp → Templates → create template, e.g.:
   ```
   FieldGovern: {{1}}
   ```
   Submit for Meta approval (another 24h)
4. Once template approved:
   - Copy **Auth Key** from MSG91 Dashboard → API
   - Copy **Template ID** from WhatsApp → Templates
5. In FieldGovern app → Org Settings → Integrations → WhatsApp:
   - Paste Auth Key + Template ID
   - Add supervisor phone numbers
   - Select events to notify
   - Enable → Save
6. No server restart needed

---

## 3. AI Features (Report Writer, Form Builder, Auto-Translate)
**Status:** Code is built. Needs one LLM API key configured per org.

**Supported providers (org chooses one):**
| Provider | Get key from | Model used |
|----------|-------------|------------|
| OpenAI | platform.openai.com | gpt-4o |
| Anthropic (Claude) | console.anthropic.com | claude-sonnet-4-6 |
| Google Gemini | aistudio.google.com | gemini-1.5-pro |

**Steps:**
1. Get an API key from any of the above providers
2. In FieldGovern → Org Settings → AI Configuration:
   - Select provider
   - Paste API key
   - Save
3. AI features activate immediately for that org
4. No server env vars needed — keys stored per-tenant (encrypted in DB)

---

## 4. Google Sheets Sync — Per Org Setup
**Status:** Code is live. Each org sets up their own sheet (self-serve).

**Share this guide with orgs:**
1. Open your Google Sheet → Extensions → Apps Script → paste script from `planning/MIGRATION_SPEC.md`
2. Deploy → Web app → Execute as: Me → Who has access: Anyone → Deploy
3. Copy the deployment URL
4. In FieldGovern → Org Settings → Integrations → Google Sheets:
   - Find your form → paste URL → enable → Save
5. All new submissions (including imported) auto-append to the sheet

---

## 5. DHIS2 Integration (per org)
**Status:** Code is built. Each org provides their DHIS2 server credentials.

**Steps (per org):**
1. In FieldGovern → Org Settings → Integrations → DHIS2:
   - DHIS2 server URL (e.g. `https://dhis.yourorg.org`)
   - Username + password
   - Map form fields → DHIS2 data elements
2. Enable → Save
3. Submissions will push to DHIS2 on sync

---

## 6. Repeat Groups — QA Required
**Status:** Will be built. Largest structural change — needs testing before enabling for production orgs.

**What to do when built:**
1. Test with a sample household survey form in staging
2. Verify sync (push/pull), CSV export, and repeat group rendering on mobile
3. Enable for production once verified

---

## Summary Table

| Feature | Blocker | Effort |
|---------|---------|--------|
| Sentry | Add 2 env vars | 15 min |
| WhatsApp | MSG91 account + Meta approval | 1–3 days |
| AI features | Get any LLM API key | 5 min per org |
| Google Sheets | Orgs paste Apps Script URL | 5 min per org |
| DHIS2 | Org provides server + credentials | 5 min per org |
| Repeat groups | QA after build | When ready |
