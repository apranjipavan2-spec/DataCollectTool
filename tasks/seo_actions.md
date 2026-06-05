# FieldGovern — SEO Action Plan (FREE only)

> Budget = ₹0. No ads, no paid PR, no paid backlinks. Top items = highest ROI.
> Order matters: do Tier 1 this week before anything else.

---

## 🟢 Tier 1 — Foundations (this week, ~2 hours)

### 1. Google Search Console (30 min — single highest ROI free task)
1. Open <https://search.google.com/search-console>
2. Add property `fieldgovern.com` as **Domain** (not URL prefix)
3. Add the `google-site-verification=...` TXT record at your DNS provider:
   - **GoDaddy:** My Products → DNS → Add Record → TXT, Name `@`, Value: paste
   - **Namecheap:** Domain List → Advanced DNS → Add New Record → TXT, Host `@`, Value: paste
   - **Cloudflare:** DNS → Add Record → TXT, Name `@`, Content: paste
4. Wait 5–30 min → click **Verify**
5. **Sitemaps** → submit `https://www.fieldgovern.com/sitemap.xml`
6. **URL Inspection** → Request Indexing on all 30 URLs (verified against sitemap on 2026-06-02 — every URL has a canonical tag, none has `noindex`):

**Core (8)**
```
https://www.fieldgovern.com/
https://www.fieldgovern.com/features.html
https://www.fieldgovern.com/pricing.html
https://www.fieldgovern.com/use-cases.html
https://www.fieldgovern.com/integrations.html
https://www.fieldgovern.com/security.html
https://www.fieldgovern.com/about.html
https://www.fieldgovern.com/demo.html
```

**Competitor comparisons (8)**
```
https://www.fieldgovern.com/surveycto-alternative.html
https://www.fieldgovern.com/kobotoolbox-alternative.html
https://www.fieldgovern.com/odk-alternative.html
https://www.fieldgovern.com/commcare-alternative.html
https://www.fieldgovern.com/googleforms-alternative.html
https://www.fieldgovern.com/surveymonkey-alternative.html
https://www.fieldgovern.com/qualtrics-alternative.html
https://www.fieldgovern.com/magpi-alternative.html
```

**Long-tail landings (5)**
```
https://www.fieldgovern.com/best-survey-app-india.html
https://www.fieldgovern.com/offline-survey-app-india.html
https://www.fieldgovern.com/dpdp-compliant-survey-software.html
https://www.fieldgovern.com/capi-software-india.html
https://www.fieldgovern.com/survey-tool-for-ngos-india.html
```

**Compliance + partner (3)**
```
https://www.fieldgovern.com/dpdp-compliance.html
https://www.fieldgovern.com/dpa-template.html
https://www.fieldgovern.com/partners.html
```

**Blog (6)**
```
https://www.fieldgovern.com/blog/
https://www.fieldgovern.com/blog/surveycto-alternative-india.html
https://www.fieldgovern.com/blog/dpdp-act-2023-field-research.html
https://www.fieldgovern.com/blog/offline-data-collection-india.html
https://www.fieldgovern.com/blog/odk-kobotoolbox-commcare-comparison.html
https://www.fieldgovern.com/blog/panel-study-india-guide.html
```

### 2. GA4 (15 min)
- <https://analytics.google.com/> → create property → web data stream → copy Measurement ID (`G-XXXXXXXXXX`)
- Send the ID to me; I'll wire it into every page in one commit
- Admin → Product Links → Search Console (link them)

### 3. Bing Webmaster Tools (10 min — ~7% of Indian search)
- <https://www.bing.com/webmasters> → import from GSC (one click) → submit sitemap

### 4. Google Business Profile (15 min — local SEO)
- <https://www.google.com/business/> → name: FieldGovern · category: Software Company · website + phone (+91 80887 09011)

---

## 🟡 Tier 2 — Free directory listings (Week 2, ~3 hours)

Paste copy from the section at the bottom of this file into each form.

| # | Site | URL | Time |
|---|---|---|---|
| 5 | **Product Hunt** (schedule Tue/Wed 12:01am PT) | <https://www.producthunt.com/posts/new> | 30 min |
| 6 | AlternativeTo — submit for all 8 competitors | <https://alternativeto.net/software/new> | 15 min |
| 7 | G2 (approval ~1 week) | <https://my.g2.com/start-listing> | 20 min |
| 8 | Capterra | <https://www.capterra.com/vendors/sign-up> | 20 min |
| 9 | SaaSHub | <https://www.saashub.com/submit> | 15 min |
| 10 | BetaList | <https://betalist.com/submit> | 15 min |
| 11 | LinkedIn Company Page | <https://www.linkedin.com/company/setup/new/> | 15 min |
| 12 | YourStory | <https://yourstory.com/submit> | 15 min |
| 13 | Inc42 | <https://inc42.com/contact-us/> | 15 min |
| 14 | Crunchbase | <https://www.crunchbase.com/add-organization> | 20 min |

---

## 🟠 Tier 3 — Ongoing distribution (30–60 min/week)

- **HARO / Qwoted / Featured** (60 min/week) — sign up at <https://www.helpareporter.com>, <https://www.qwoted.com>, <https://featured.com>. Filter on "survey", "data collection", "NGO tech", "DPDP", "India SaaS". Reply 2–3/week with 100-word pitches. One quote in TechCrunch/Mint/ET = worth 50 directory listings.
- **Reddit** (30 min/week) — r/IndianStartups, r/india, r/nonprofit, r/AcademicPsychology, r/AskStatistics, r/socialwork. Answer genuinely, link to comparison page only when relevant. Build karma first.
- **Quora** (30 min/week) — search "best survey app India", "SurveyCTO alternative", "KoboToolbox vs", "DPDP compliant survey". Answer with substance + link to relevant `/...-alternative.html`.
- **LinkedIn personal** (2x/week) — 1 build-in-public + 1 customer story. Comment on 5 India-tech / dev-sector posts.
- **IndieHackers post** (one-time) — <https://www.indiehackers.com/post/new>
- **Hacker News Show HN** (one-time) — "Show HN: FieldGovern – offline-first field data + AI for India". Weekday morning US time.

---

## 🔵 Tier 4 — Long-term content (compounds slowly)

- **Customer testimonials** — email 5 most engaged users, ask for a 1-sentence quote. Add 3–5 to homepage between #features and #compare.
- **Case studies** — 2 customers × 600 words each. Publish at `/case-studies/{slug}.html`. Each = 1 indexable page + sales asset.
- **Quarterly comparison refresh** (30 min × 8 pages) — update competitor pricing, add "Updated [month year]" stamp. Google rewards freshness.
- **New long-tail landings as queries surface** — "Free survey app for college research India", "Mobile data collection for ASHA workers", "How to migrate from KoboToolbox to FieldGovern".
- **Internal linking audit** (30 min/month) — every new page needs 2–3 inbound links from existing pages.
- **Blog** — 1 short post/month. "What DPDP means for NGO data collection", "How AI tabulation cuts report time", field stories.

---

## ❌ NOT doing (no budget)
Google Ads · PRNewswire · paid guest posts · paid backlinks · LinkedIn Sales Nav · Quora ads · G2/Capterra paid lead-gen · sponsorships. Revisit once ₹15K+/month is available.

---

## 🎯 Realistic timeline
- **Week 1–2:** GSC indexes 21 URLs · Bing follows
- **Week 3–6:** Long-tail queries start ranking ("DPDP compliant survey software", "offline survey app India") — low volume, high intent
- **Week 6–12:** Comparison pages rank for "[competitor] alternative" — main organic channel
- **Month 3–6:** Directory listings + reviews accumulate → authority compounds
- **Month 6–12:** Start ranking for headline keywords ("best survey app India")

Most people quit at week 4, right before it starts working.

---

# 📋 Paste copy (use with the table above)

### Product Hunt
**Tagline (60 char):** Offline-first field data + AI reports, built for India

**Description (260 char):** Collect surveys offline anywhere in India, sync when online, and let AI clean your data and write your reports. Replace SurveyCTO at 1/3 the cost. UPI billing. DPDP 2023 compliant. Built for NGOs, researchers, and government teams.

**Topics:** Productivity, SaaS, Data, India, Survey

**First maker comment:**
> Hi Product Hunt 👋
>
> I built FieldGovern because Indian NGOs and researchers were paying SurveyCTO ₹1.5–2.5 lakhs/year for tools that didn't even speak their language.
>
> FieldGovern is an offline-first PWA — collect forms, photos, audio, and GPS anywhere with zero internet, sync when you're back online. Then four AI tools take over: form builder, data cleaner, cross-tab interpreter, and report writer.
>
> Live demo: https://www.fieldgovern.com/demo.html
> SurveyCTO comparison: https://www.fieldgovern.com/surveycto-alternative.html

**Launch tip:** Schedule 12:01am PT Tuesday or Wednesday. Don't ask friends to upvote at the 12:01am mark — PH flags suspicious early voting. Ask them to vote in the morning instead.

### AlternativeTo / SaaSHub / BetaList
**Name:** FieldGovern
**Website:** https://www.fieldgovern.com
**Short description:** India-first offline field data collection platform with AI form building, data cleaning, and report writing. SurveyCTO alternative at 1/3 the cost. UPI billing. DPDP 2023 compliant.
**Tags:** survey, data-collection, offline, ai, india, ngo, research
**Platforms:** Web, Android, iOS (PWA)
**Submit as alternative to:** SurveyCTO, KoboToolbox, ODK, CommCare, Google Forms, SurveyMonkey, Qualtrics, Magpi

### G2 / Capterra
**Product name:** FieldGovern
**Tagline:** India's offline-first field data collection and AI analysis platform
**Categories:** Survey Software, Data Collection, Mobile Forms
**Pricing:** Free trial. Plans from ₹6,499/month.
**HQ:** India
**Description:** FieldGovern is India's most affordable offline-first field data collection and AI analysis platform. Built for NGOs, market research firms, government programs, and academic researchers, it combines a true offline PWA (works anywhere with zero internet), a visual + AI-powered form builder, automated data cleaning, AI cross-tab interpretation, and AI report writing. DPDP 2023 compliant, India-hosted, with UPI / NetBanking / INR card billing.

After listing is live, ask 5–10 existing users to leave a review via G2's review link.

### YourStory / Inc42
**Founder(s):** Pallavi Deshetty
**Sector:** SaaS / Data / GovTech / Social Impact
**Pitch (200 words):**
> FieldGovern is India's offline-first field data collection and AI analysis platform — built for the NGOs, researchers, government programs, and market research teams who spend lakhs every year on foreign tools that don't fit Indian budgets, languages, or compliance needs.
>
> Enumerators collect surveys offline anywhere in India using a no-install Progressive Web App, with auto-sync the moment connectivity returns. Once data lands, four AI capabilities take over: an AI form builder, AI data cleaning, AI cross-tab interpretation, and an AI report writer that drafts publication-ready reports in your organisation's voice.
>
> Priced from ₹6,499/month with UPI billing, FieldGovern undercuts SurveyCTO and KoboToolbox while offering features they don't ship: a Hindi/Kannada/Telugu UI, DPDP 2023 compliance by default, Indian hosting, and built-in AI tooling that saves typical research teams 8–20 hours per project.

### LinkedIn Company Page
**Tagline:** India's offline-first field data + AI analysis platform.
**About:**
> FieldGovern is India's offline-first field data collection and AI analysis platform — built for the NGOs, researchers, government programs, and corporate ESG teams who run real fieldwork across India and need tools that match Indian budgets, languages, and compliance requirements.
>
> 🔌 **Offline-first.** Collect surveys, photos, audio, and GPS anywhere in India with zero internet. Auto-sync when connectivity returns.
>
> 🤖 **AI built in.** AI form builder, data cleaner, cross-tab interpreter, and report writer — saving research teams 8–20 hours per project.
>
> 🇮🇳 **India by default.** UI in English, Hindi, Kannada, Telugu. Indian data hosting. DPDP 2023 compliant. UPI / NetBanking / INR card billing.
>
> 💰 **~1/3 the cost of SurveyCTO.** Plans from ₹6,499/month.
>
> Try the live demo: fieldgovern.com/demo.html
