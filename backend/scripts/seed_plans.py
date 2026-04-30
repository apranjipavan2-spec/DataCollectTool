"""
Seed all FieldGovern plans into the database.
Run: python -m scripts.seed_plans
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.core.database import SessionLocal
from app.models.billing import Plan

PLANS = [
    # ── NGO / Social Impact ────────────────────────────────────────────────────
    dict(
        id="ngo_free", segment="ngo", tier="free", name="NGO Free", sort_order=10,
        description="For small NGOs and pilots. Core data collection with no AI features.",
        price_inr=0, price_usd_cents=0,
        submissions_limit=2000, storage_limit_mb=500,
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
        description="For growing NGOs. AI cleaning + unlimited reports at Kobo Community pricing.",
        price_inr=7499, price_usd_cents=9000,
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
        description="Full AI suite. Panel study, attrition reports, donor templates.",
        price_inr=11499, price_usd_cents=13800,
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
        description="Multi-org, SSO, on-premise, white-label. Custom pricing.",
        price_inr=0, price_usd_cents=0,   # Custom — set manually per org
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
        description="Pilot and evaluation. No AI features.",
        price_inr=0, price_usd_cents=0,
        submissions_limit=2000, storage_limit_mb=500,
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
        description="Single department or scheme. AI cleaning, audit log, RBAC, GPS fraud detection.",
        price_inr=13999, price_usd_cents=16800,
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
        description="Multi-scheme dashboard, panel study, GPS spoofing, real-time monitoring.",
        price_inr=21999, price_usd_cents=26400,
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
        description="SSO, on-premise, DPDP compliance, GeM-compatible, white-label.",
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
        description="Student projects and pilot surveys. 2,000 submissions with .edu/.ac.in verification.",
        price_inr=0, price_usd_cents=0,
        submissions_limit=2000, storage_limit_mb=500,
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
        description="AI cleaning, panel study, attrition reports, SPSS/Stata export.",
        price_inr=13999, price_usd_cents=16800,
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
        description="Multi-PI, IRB audit trail, nested waves, SSO option.",
        price_inr=21999, price_usd_cents=26400,
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
        description="University-wide licence, on-premise, custom anonymisation pipeline.",
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

    # ── Corporate ────────────────────────────────────────────────────────────
    dict(
        id="corp_free", segment="corporate", tier="free", name="Corporate Free", sort_order=40,
        description="Pilot and PoC. No AI features.",
        price_inr=0, price_usd_cents=0,
        submissions_limit=2000, storage_limit_mb=500,
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
        description="AI cleaning, GPS fraud detection, photo audit, Smart Builder, Webhooks.",
        price_inr=13999, price_usd_cents=16800,
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
        description="Multi-branch dashboard, real-time monitoring, AI Interpret, ESG metrics.",
        price_inr=21999, price_usd_cents=26400,
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
        description="SSO, white-label, on-premise, CRM integration, dedicated CSM.",
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


def seed():
    db = SessionLocal()
    try:
        added, updated = 0, 0
        for p in PLANS:
            existing = db.query(Plan).filter(Plan.id == p["id"]).first()
            if existing:
                for k, v in p.items():
                    setattr(existing, k, v)
                updated += 1
            else:
                db.add(Plan(**p))
                added += 1
        db.commit()
        print(f"Plans seeded: {added} added, {updated} updated.")
    finally:
        db.close()


if __name__ == "__main__":
    seed()
