"""
Seed all FieldGovern plans into the database.
Run: python -m scripts.seed_plans
Prices sourced from FieldGovern_Pricing_Strategy.docx (April 2026).
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.core.database import SessionLocal
from app.models.billing import Plan

PLANS = [
    # ── NGO / Social Impact ───────────────────────────────────────────────────
    dict(
        id="ngo_free", segment="ngo", tier="free", name="NGO Free", sort_order=10,
        description="For small NGOs and pilots. 1,000 submissions · 500 MB · 1 AI report/month.",
        price_inr=0, price_usd_cents=0,
        submissions_limit=1000, storage_limit_mb=500,
        max_org_admins=1, max_supervisors=3, max_enumerators=10,
        asr_minutes_limit=5, translation_chars=3000,
        ai_cleaning=False, ai_writer=False, ai_smart_builder=False,
        ai_interpret=False, ai_analyzer=False, map_view=False,
        panel_study=False, spss_export=False, api_write=False,
        webhooks=False, two_fa=False, sso=False, audit_log=False,
        advanced_rbac=False, white_label=False, on_premise=False, priority_support=False,
    ),
    dict(
        id="ngo_starter", segment="ngo", tier="starter", name="NGO Starter", sort_order=11,
        description="AI cleaning + unlimited FG Writer reports. Priced below Kobo Community ($88/mo).",
        price_inr=6499, price_usd_cents=7800,
        submissions_limit=5000, storage_limit_mb=1024,
        max_org_admins=3, max_supervisors=10, max_enumerators=None,
        asr_minutes_limit=10, translation_chars=6000,
        ai_cleaning=True, ai_writer=True, ai_smart_builder=False,
        ai_interpret=False, ai_analyzer=True, map_view=True,
        panel_study=False, spss_export=False, api_write=False,
        webhooks=False, two_fa=False, sso=False, audit_log=False,
        advanced_rbac=False, white_label=False, on_premise=False, priority_support=False,
    ),
    dict(
        id="ngo_growth", segment="ngo", tier="growth", name="NGO Growth", sort_order=12,
        description="Full AI suite · Panel study · Attrition reports · Donor templates. Priced below Kobo Pro Nonprofit ($129/mo).",
        price_inr=10999, price_usd_cents=13200,
        submissions_limit=25000, storage_limit_mb=None,
        max_org_admins=10, max_supervisors=None, max_enumerators=None,
        asr_minutes_limit=120, translation_chars=72000,
        ai_cleaning=True, ai_writer=True, ai_smart_builder=True,
        ai_interpret=True, ai_analyzer=True, map_view=True,
        panel_study=True, spss_export=False, api_write=True,
        webhooks=True, two_fa=True, sso=False, audit_log=False,
        advanced_rbac=False, white_label=False, on_premise=False, priority_support=False,
    ),
    dict(
        id="ngo_enterprise", segment="ngo", tier="enterprise", name="NGO Enterprise", sort_order=13,
        description="Multi-org · SSO · On-premise · DPDP compliance · White-label. Custom pricing.",
        price_inr=0, price_usd_cents=0,
        submissions_limit=None, storage_limit_mb=None,
        max_org_admins=None, max_supervisors=None, max_enumerators=None,
        asr_minutes_limit=None, translation_chars=None,
        ai_cleaning=True, ai_writer=True, ai_smart_builder=True,
        ai_interpret=True, ai_analyzer=True, map_view=True,
        panel_study=True, spss_export=True, api_write=True,
        webhooks=True, two_fa=True, sso=True, audit_log=True,
        advanced_rbac=True, white_label=True, on_premise=True, priority_support=True,
    ),

    # ── Government ────────────────────────────────────────────────────────────
    dict(
        id="govt_free", segment="govt", tier="free", name="Government Free", sort_order=20,
        description="Pilot and evaluation. 1,000 submissions · 500 MB · 1 AI report/month.",
        price_inr=0, price_usd_cents=0,
        submissions_limit=1000, storage_limit_mb=500,
        max_org_admins=1, max_supervisors=3, max_enumerators=10,
        asr_minutes_limit=5, translation_chars=3000,
        ai_cleaning=False, ai_writer=False, ai_smart_builder=False,
        ai_interpret=False, ai_analyzer=False, map_view=False,
        panel_study=False, spss_export=False, api_write=False,
        webhooks=False, two_fa=False, sso=False, audit_log=False,
        advanced_rbac=False, white_label=False, on_premise=False, priority_support=False,
    ),
    dict(
        id="govt_department", segment="govt", tier="starter", name="Government — Department", sort_order=21,
        description="AI cleaning · Audit log · RBAC · GPS fraud detection. At par with Kobo Professional ($166/mo).",
        price_inr=13799, price_usd_cents=16600,
        submissions_limit=25000, storage_limit_mb=None,
        max_org_admins=5, max_supervisors=None, max_enumerators=None,
        asr_minutes_limit=120, translation_chars=72000,
        ai_cleaning=True, ai_writer=True, ai_smart_builder=False,
        ai_interpret=False, ai_analyzer=True, map_view=True,
        panel_study=False, spss_export=False, api_write=True,
        webhooks=True, two_fa=True, sso=False, audit_log=True,
        advanced_rbac=True, white_label=False, on_premise=False, priority_support=False,
    ),
    dict(
        id="govt_state", segment="govt", tier="growth", name="Government — State / Multi-Scheme", sort_order=22,
        description="Multi-scheme dashboard · Panel study · Advanced RBAC · Real-time monitoring.",
        price_inr=24999, price_usd_cents=30100,
        submissions_limit=100000, storage_limit_mb=None,
        max_org_admins=None, max_supervisors=None, max_enumerators=None,
        asr_minutes_limit=None, translation_chars=None,
        ai_cleaning=True, ai_writer=True, ai_smart_builder=True,
        ai_interpret=True, ai_analyzer=True, map_view=True,
        panel_study=True, spss_export=False, api_write=True,
        webhooks=True, two_fa=True, sso=False, audit_log=True,
        advanced_rbac=True, white_label=False, on_premise=False, priority_support=True,
    ),
    dict(
        id="govt_enterprise", segment="govt", tier="enterprise", name="Government — National / Enterprise", sort_order=23,
        description="SSO · On-premise · DPDP compliance · GeM-compatible · White-label. Custom pricing.",
        price_inr=0, price_usd_cents=0,
        submissions_limit=None, storage_limit_mb=None,
        max_org_admins=None, max_supervisors=None, max_enumerators=None,
        asr_minutes_limit=None, translation_chars=None,
        ai_cleaning=True, ai_writer=True, ai_smart_builder=True,
        ai_interpret=True, ai_analyzer=True, map_view=True,
        panel_study=True, spss_export=True, api_write=True,
        webhooks=True, two_fa=True, sso=True, audit_log=True,
        advanced_rbac=True, white_label=True, on_premise=True, priority_support=True,
    ),

    # ── Research ──────────────────────────────────────────────────────────────
    dict(
        id="research_free", segment="research", tier="free", name="Research Free", sort_order=30,
        description="Student projects and pilot surveys. 1,000 submissions · 500 MB · 1 AI report/month.",
        price_inr=0, price_usd_cents=0,
        submissions_limit=1000, storage_limit_mb=500,
        max_org_admins=1, max_supervisors=3, max_enumerators=10,
        asr_minutes_limit=5, translation_chars=3000,
        ai_cleaning=False, ai_writer=False, ai_smart_builder=False,
        ai_interpret=False, ai_analyzer=False, map_view=False,
        panel_study=False, spss_export=False, api_write=False,
        webhooks=False, two_fa=False, sso=False, audit_log=False,
        advanced_rbac=False, white_label=False, on_premise=False, priority_support=False,
    ),
    dict(
        id="research_plan", segment="research", tier="starter", name="Research", sort_order=31,
        description="AI cleaning · Panel study · Attrition tracking · SPSS/Stata export. Half the price of SurveyCTO ($299/mo).",
        price_inr=13799, price_usd_cents=16600,
        submissions_limit=25000, storage_limit_mb=None,
        max_org_admins=5, max_supervisors=None, max_enumerators=None,
        asr_minutes_limit=120, translation_chars=72000,
        ai_cleaning=True, ai_writer=True, ai_smart_builder=False,
        ai_interpret=False, ai_analyzer=True, map_view=True,
        panel_study=True, spss_export=True, api_write=True,
        webhooks=True, two_fa=True, sso=False, audit_log=False,
        advanced_rbac=False, white_label=False, on_premise=False, priority_support=False,
    ),
    dict(
        id="research_institutional", segment="research", tier="growth", name="Institutional", sort_order=32,
        description="Multi-PI · IRB audit trail · Nested waves · SSO option for university accounts.",
        price_inr=20799, price_usd_cents=25000,
        submissions_limit=75000, storage_limit_mb=None,
        max_org_admins=None, max_supervisors=None, max_enumerators=None,
        asr_minutes_limit=None, translation_chars=None,
        ai_cleaning=True, ai_writer=True, ai_smart_builder=True,
        ai_interpret=True, ai_analyzer=True, map_view=True,
        panel_study=True, spss_export=True, api_write=True,
        webhooks=True, two_fa=True, sso=True, audit_log=True,
        advanced_rbac=True, white_label=False, on_premise=False, priority_support=True,
    ),
    dict(
        id="research_enterprise", segment="research", tier="enterprise", name="University Enterprise", sort_order=33,
        description="University-wide licence · On-premise · Custom anonymisation pipeline. Custom pricing.",
        price_inr=0, price_usd_cents=0,
        submissions_limit=None, storage_limit_mb=None,
        max_org_admins=None, max_supervisors=None, max_enumerators=None,
        asr_minutes_limit=None, translation_chars=None,
        ai_cleaning=True, ai_writer=True, ai_smart_builder=True,
        ai_interpret=True, ai_analyzer=True, map_view=True,
        panel_study=True, spss_export=True, api_write=True,
        webhooks=True, two_fa=True, sso=True, audit_log=True,
        advanced_rbac=True, white_label=True, on_premise=True, priority_support=True,
    ),

    # ── Corporate ─────────────────────────────────────────────────────────────
    dict(
        id="corp_free", segment="corporate", tier="free", name="Corporate Free", sort_order=40,
        description="Pilot and PoC. 1,000 submissions · 500 MB · 1 AI report/month.",
        price_inr=0, price_usd_cents=0,
        submissions_limit=1000, storage_limit_mb=500,
        max_org_admins=1, max_supervisors=3, max_enumerators=10,
        asr_minutes_limit=5, translation_chars=3000,
        ai_cleaning=False, ai_writer=False, ai_smart_builder=False,
        ai_interpret=False, ai_analyzer=False, map_view=False,
        panel_study=False, spss_export=False, api_write=False,
        webhooks=False, two_fa=False, sso=False, audit_log=False,
        advanced_rbac=False, white_label=False, on_premise=False, priority_support=False,
    ),
    dict(
        id="corp_business", segment="corporate", tier="starter", name="Business", sort_order=41,
        description="AI cleaning · Smart Builder · GPS fraud detection · Photo audit. At par with Kobo Professional ($166/mo).",
        price_inr=13799, price_usd_cents=16600,
        submissions_limit=25000, storage_limit_mb=None,
        max_org_admins=5, max_supervisors=None, max_enumerators=None,
        asr_minutes_limit=120, translation_chars=72000,
        ai_cleaning=True, ai_writer=True, ai_smart_builder=True,
        ai_interpret=False, ai_analyzer=True, map_view=True,
        panel_study=False, spss_export=False, api_write=True,
        webhooks=True, two_fa=True, sso=False, audit_log=True,
        advanced_rbac=False, white_label=False, on_premise=False, priority_support=False,
    ),
    dict(
        id="corp_corporate", segment="corporate", tier="growth", name="Corporate", sort_order=42,
        description="Multi-branch dashboard · AI Interpret · Advanced RBAC · ESG metrics. A fraction of Qualtrics ($1,500+/mo).",
        price_inr=20799, price_usd_cents=25000,
        submissions_limit=200000, storage_limit_mb=None,
        max_org_admins=None, max_supervisors=None, max_enumerators=None,
        asr_minutes_limit=None, translation_chars=None,
        ai_cleaning=True, ai_writer=True, ai_smart_builder=True,
        ai_interpret=True, ai_analyzer=True, map_view=True,
        panel_study=False, spss_export=False, api_write=True,
        webhooks=True, two_fa=True, sso=False, audit_log=True,
        advanced_rbac=True, white_label=False, on_premise=False, priority_support=True,
    ),
    dict(
        id="corp_enterprise", segment="corporate", tier="enterprise", name="Corporate Enterprise", sort_order=43,
        description="SSO · White-label · On-premise · CRM integration · Dedicated CSM. Custom pricing.",
        price_inr=0, price_usd_cents=0,
        submissions_limit=None, storage_limit_mb=None,
        max_org_admins=None, max_supervisors=None, max_enumerators=None,
        asr_minutes_limit=None, translation_chars=None,
        ai_cleaning=True, ai_writer=True, ai_smart_builder=True,
        ai_interpret=True, ai_analyzer=True, map_view=True,
        panel_study=True, spss_export=True, api_write=True,
        webhooks=True, two_fa=True, sso=True, audit_log=True,
        advanced_rbac=True, white_label=True, on_premise=True, priority_support=True,
    ),
]

# ── Unified plans (segment='unified') — single source of truth for the pricing page
# and plan enforcement.  Super-admin can edit these via PATCH /billing/admin/plans/{id}.
# Null = unlimited in the Plan model; 0 = feature not available.
# ─────────────────────────────────────────────────────────────────────────────────────
UNIFIED_PLANS = [
    dict(
        id="fg_trial", segment="unified", tier="trial", name="Free Trial", sort_order=0,
        description="15-day full-feature trial. Data collection + full AI suite.",
        price_inr=0, price_usd_cents=0,
        submissions_limit=1000,  storage_limit_mb=1024,
        active_forms_limit=10,   ai_reports_per_month=20, api_calls_per_month=2000,
        max_org_admins=2,        max_supervisors=None,    max_enumerators=None,
        asr_minutes_limit=60,    translation_chars=36000,
        ai_cleaning=True, ai_writer=True, ai_smart_builder=True,
        ai_interpret=True, ai_analyzer=True, map_view=True,
        panel_study=True, spss_export=True, api_write=True,
        webhooks=False, two_fa=False, sso=False, audit_log=False,
        advanced_rbac=False, white_label=False, on_premise=False, priority_support=False,
    ),
    dict(
        id="fg_free", segment="unified", tier="free", name="Free", sort_order=1,
        description="For individuals and small pilots.",
        price_inr=0, price_usd_cents=0,
        submissions_limit=300,   storage_limit_mb=50,
        active_forms_limit=2,    ai_reports_per_month=0,  api_calls_per_month=0,
        max_org_admins=1,        max_supervisors=None,    max_enumerators=None,
        asr_minutes_limit=0,     translation_chars=0,
        ai_cleaning=False, ai_writer=False, ai_smart_builder=False,
        ai_interpret=False, ai_analyzer=False, map_view=False,
        panel_study=False, spss_export=False, api_write=False,
        webhooks=False, two_fa=False, sso=False, audit_log=False,
        advanced_rbac=False, white_label=False, on_premise=False, priority_support=False,
    ),
    dict(
        id="fg_starter", segment="unified", tier="starter", name="Starter", sort_order=2,
        description="For small teams running active surveys.",
        price_inr=6999, price_usd_cents=8400,
        submissions_limit=2000,  storage_limit_mb=500,
        active_forms_limit=8,    ai_reports_per_month=8,  api_calls_per_month=3000,
        max_org_admins=2,        max_supervisors=None,    max_enumerators=None,
        asr_minutes_limit=10,    translation_chars=6000,
        ai_cleaning=True, ai_writer=True, ai_smart_builder=False,
        ai_interpret=False, ai_analyzer=True, map_view=True,
        panel_study=False, spss_export=False, api_write=True,
        webhooks=False, two_fa=False, sso=False, audit_log=False,
        advanced_rbac=False, white_label=False, on_premise=False, priority_support=False,
    ),
    dict(
        id="fg_growth", segment="unified", tier="growth", name="Growth", sort_order=3,
        description="For growing organisations with multiple active studies.",
        price_inr=12999, price_usd_cents=15600,
        submissions_limit=5000,  storage_limit_mb=5120,   # 5 GB
        active_forms_limit=20,   ai_reports_per_month=30, api_calls_per_month=10000,
        max_org_admins=5,        max_supervisors=None,    max_enumerators=None,
        asr_minutes_limit=120,   translation_chars=72000,
        ai_cleaning=True, ai_writer=True, ai_smart_builder=True,
        ai_interpret=True, ai_analyzer=True, map_view=True,
        panel_study=True, spss_export=False, api_write=True,
        webhooks=True, two_fa=True, sso=False, audit_log=False,
        advanced_rbac=False, white_label=False, on_premise=False, priority_support=False,
    ),
    dict(
        id="fg_pro", segment="unified", tier="pro", name="Pro", sort_order=4,
        description="For large organisations with high volume data collection.",
        price_inr=24999, price_usd_cents=30000,
        submissions_limit=25000, storage_limit_mb=10240,  # 10 GB
        active_forms_limit=100,  ai_reports_per_month=100, api_calls_per_month=25000,
        max_org_admins=20,       max_supervisors=None,    max_enumerators=None,
        asr_minutes_limit=None,  translation_chars=None,
        ai_cleaning=True, ai_writer=True, ai_smart_builder=True,
        ai_interpret=True, ai_analyzer=True, map_view=True,
        panel_study=True, spss_export=True, api_write=True,
        webhooks=True, two_fa=True, sso=False, audit_log=True,
        advanced_rbac=True, white_label=False, on_premise=False, priority_support=True,
    ),
    dict(
        id="fg_custom", segment="unified", tier="custom", name="Custom", sort_order=5,
        description="Enterprise — unlimited everything. Contact us for pricing.",
        price_inr=0, price_usd_cents=0,
        submissions_limit=None,  storage_limit_mb=None,
        active_forms_limit=None, ai_reports_per_month=None, api_calls_per_month=None,
        max_org_admins=None,     max_supervisors=None,    max_enumerators=None,
        asr_minutes_limit=None,  translation_chars=None,
        ai_cleaning=True, ai_writer=True, ai_smart_builder=True,
        ai_interpret=True, ai_analyzer=True, map_view=True,
        panel_study=True, spss_export=True, api_write=True,
        webhooks=True, two_fa=True, sso=True, audit_log=True,
        advanced_rbac=True, white_label=True, on_premise=True, priority_support=True,
    ),
]


def seed():
    db = SessionLocal()
    try:
        added, updated = 0, 0
        for p in PLANS + UNIFIED_PLANS:
            existing = db.query(Plan).filter(Plan.id == p["id"]).first()
            if existing:
                for k, v in p.items():
                    setattr(existing, k, v)
                updated += 1
            else:
                db.add(Plan(**p))
                added += 1
        db.commit()
        print(f"[seed_plans] {added} added, {updated} updated.")
    finally:
        db.close()


if __name__ == "__main__":
    seed()
