# FieldGovern — SEO & Online Visibility Guide

Goal: get fieldgovern.com indexed, monitored, and ranking for India survey-software searches.
Last reviewed: 2026-06-04

> **Reminder:** Only ever edit files in `website/`. CI auto-syncs `website/ → docs/` on push.
> Never touch `docs/` directly. After any change: `git add` → `git commit` → `git push`,
> then wait ~1–2 min for the GitHub Pages deploy.

---

## Status snapshot (what's already done ✅)
- Google Analytics (`G-SPLVXJJ7GN`) live on all 34 pages.
- `robots.txt` + `sitemap.xml` present, accessible, and **identical** in `website/` and `docs/` (no drift).
- Canonical tags + meta descriptions on every page.
- Structured data (JSON-LD) on all key money pages.
- Sitemap `lastmod` refreshed for the high-churn pages (home, demo, blog).

---

## PART A — Tasks ONLY YOU can do (no code; ~30–40 min total)

These are the real unblockers. Do them in order.

### 1. Google Search Console (most important) ⭐
Without this you're invisible to yourself — you can't see what you rank for or force indexing.

1. Go to https://search.google.com/search-console
2. Click **Add property** → choose **URL prefix** → enter `https://www.fieldgovern.com/`
3. Pick the **HTML tag** verification method. It gives you a line like:
   ```html
   <meta name="google-site-verification" content="XXXXXXXXXXXXXXXXXXXXXXXX" />
   ```
4. **Copy that whole tag and paste it to me** — I'll add it to every page's `<head>` (see Part B, item 1). Then push.
5. Back in Search Console, click **Verify**.
6. Once verified → left menu **Sitemaps** → enter `sitemap.xml` → **Submit**.
7. Optional but good: use **URL Inspection** on your homepage → **Request Indexing**.

### 2. Bing Webmaster Tools (quick win — feeds Bing + ChatGPT + Copilot)
1. Go to https://www.bing.com/webmasters
2. **Add site** → `https://www.fieldgovern.com/` → you can **Import from Google Search Console** (fastest), or
3. Choose meta-tag verification → it gives `<meta name="msvalidate.01" content="..." />` → **paste it to me** (Part B item 1).
4. Submit `https://www.fieldgovern.com/sitemap.xml`.

### 3. Social share image (OG card)
Right now link previews use the logo (`assets/logo-wide.png`), which looks weak in WhatsApp/LinkedIn.
1. Create a **1200 × 630 px PNG** — product name + one-line value prop + a screenshot/brand color.
   (Canva has a "social share / OG image" template; or ask a designer.)
2. Save it as `website/assets/og-card.png` and send it to me / drop it in the folder.
3. Tell me — I'll repoint all `og:image` and `twitter:image` tags to it.

### 4. Off-page authority (ongoing — this is what actually moves rankings)
- **Google Business Profile**: https://business.google.com — register the business (helps "survey software India" local intent).
- **Listing sites**: create profiles on G2, Capterra, SaaSHub, Product Hunt, and Indian SaaS directories. Each is a backlink + a discovery channel.
- **Backlinks**: guest posts / mentions on M&E, NGO-tech, and research blogs. Quality > quantity.

---

## PART B — Code tasks I'll do for you (just say "go")

1. **Add verification meta tags** to all pages' `<head>` (needs the codes from A1 & A2).
   Target spot in each file — right after this existing line:
   ```html
   <meta name="robots" content="index,follow"/>
   ```
2. **Add `twitter:card` tags** to the 6 blog posts (they currently have OG but no Twitter card).
3. **Add Blog + ItemList JSON-LD** to `blog/index.html` so Google treats it as a content hub.
4. **Add JSON-LD** to `partners.html` and `dpdp-compliance.html`.
5. **Repoint OG/Twitter image** to the new `og-card.png` (needs the image from A3).

---

## PART C — Verify it worked (after deploy)
- Sitemap live & correct: open https://www.fieldgovern.com/sitemap.xml
- Robots OK: https://www.fieldgovern.com/robots.txt
- Rich results / structured data: https://search.google.com/test/rich-results
- Social preview: https://www.opengraph.xyz/ (paste your URL)
- Mobile + speed: https://pagespeed.web.dev/
- GA receiving data: GA4 → Reports → Realtime (open the site in another tab)

## Expected timeline
- Indexing starts: a few days to ~2 weeks after GSC verification + sitemap submit.
- Ranking movement for competitive terms: 1–3 months with steady backlinks/content.

---

## My recommended order
1. Do **A1 (Search Console)** + **A2 (Bing)** → send me the two codes.
2. I add them (B1), push, you verify + submit sitemap.
3. Meanwhile create the **A3 OG card** → I wire it up.
4. I knock out **B2–B4** in one pass.
5. Start **A4** (Business Profile + listings) — ongoing.
