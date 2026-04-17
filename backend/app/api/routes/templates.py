"""Built-in form template library.

Templates are hardcoded in this file — no DB rows needed.
Tenants clone a template via POST /templates/{slug}/clone which creates
a real editable Form in their tenant.

Endpoints:
  GET  /templates/          — list all built-in templates
  GET  /templates/{slug}    — get full schema for one template
  POST /templates/{slug}/clone — clone template into tenant as a new form
"""
import copy
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import require_org_admin
from app.models.form import Form
from app.models.form_version import FormVersion

router = APIRouter()

# ── Built-in template definitions ────────────────────────────────────────────

TEMPLATES: dict[str, dict[str, Any]] = {
    "health-survey": {
        "slug": "health-survey",
        "title": "Community Health Survey",
        "description": "Collect basic health indicators and service access data at household level.",
        "category": "Health",
        "icon": "🏥",
        "field_count": 9,
        "schema": {
            "title": "Community Health Survey",
            "version": 1,
            "sections": [
                {
                    "id": "s1",
                    "title": "Respondent",
                    "fields": [
                        {"key": "respondent_name", "type": "text", "label": "Respondent Name", "required": True},
                        {"key": "age", "type": "number", "label": "Age (years)", "required": True, "min": 0, "max": 120},
                        {
                            "key": "gender",
                            "type": "single_choice",
                            "label": "Gender",
                            "required": True,
                            "options": [
                                {"value": "female", "label": "Female"},
                                {"value": "male", "label": "Male"},
                                {"value": "other", "label": "Other"},
                            ],
                        },
                        {"key": "village", "type": "text", "label": "Village / Ward", "required": True},
                    ],
                },
                {
                    "id": "s2",
                    "title": "Health Status",
                    "fields": [
                        {
                            "key": "health_issues",
                            "type": "multiple_choice",
                            "label": "Health issues reported in last 3 months",
                            "required": False,
                            "options": [
                                {"value": "fever", "label": "Fever / Malaria"},
                                {"value": "diarrhea", "label": "Diarrhoea"},
                                {"value": "respiratory", "label": "Cough / Respiratory"},
                                {"value": "maternal", "label": "Maternal / Reproductive"},
                                {"value": "chronic", "label": "Chronic (diabetes, BP, etc.)"},
                                {"value": "none", "label": "None"},
                            ],
                        },
                        {
                            "key": "visited_health_center",
                            "type": "single_choice",
                            "label": "Visited a health centre in last 3 months?",
                            "required": True,
                            "options": [
                                {"value": "yes", "label": "Yes"},
                                {"value": "no", "label": "No"},
                            ],
                        },
                        {
                            "key": "travel_time_minutes",
                            "type": "number",
                            "label": "Travel time to nearest health centre (minutes)",
                            "required": False,
                            "min": 0,
                        },
                        {
                            "key": "income_bracket",
                            "type": "single_choice",
                            "label": "Household monthly income",
                            "required": False,
                            "options": [
                                {"value": "below5k", "label": "Below ₹5,000"},
                                {"value": "5k_15k", "label": "₹5,000 – ₹15,000"},
                                {"value": "15k_30k", "label": "₹15,000 – ₹30,000"},
                                {"value": "above30k", "label": "Above ₹30,000"},
                            ],
                        },
                        {"key": "notes", "type": "text", "label": "Additional Notes", "required": False, "multiline": True},
                    ],
                },
            ],
        },
    },

    "household-census": {
        "slug": "household-census",
        "title": "Household Census",
        "description": "Basic household demographics, infrastructure access, and GPS location.",
        "category": "Census",
        "icon": "🏠",
        "field_count": 9,
        "schema": {
            "title": "Household Census",
            "version": 1,
            "sections": [
                {
                    "id": "s1",
                    "title": "Household",
                    "fields": [
                        {"key": "head_name", "type": "text", "label": "Head of Household (Name)", "required": True},
                        {"key": "phone", "type": "text", "label": "Phone Number", "required": False},
                        {"key": "members_total", "type": "number", "label": "Total Members", "required": True, "min": 1},
                        {"key": "children_under5", "type": "number", "label": "Children Under 5", "required": True, "min": 0},
                    ],
                },
                {
                    "id": "s2",
                    "title": "Infrastructure",
                    "fields": [
                        {
                            "key": "water_source",
                            "type": "single_choice",
                            "label": "Primary Water Source",
                            "required": True,
                            "options": [
                                {"value": "piped", "label": "Piped / Tap"},
                                {"value": "borewell", "label": "Borewell / Hand pump"},
                                {"value": "open_well", "label": "Open well"},
                                {"value": "river", "label": "River / Stream"},
                                {"value": "tanker", "label": "Water tanker"},
                            ],
                        },
                        {
                            "key": "sanitation",
                            "type": "single_choice",
                            "label": "Sanitation Facility",
                            "required": True,
                            "options": [
                                {"value": "flush_toilet", "label": "Flush toilet (private)"},
                                {"value": "shared_toilet", "label": "Shared / Community toilet"},
                                {"value": "open_defecation", "label": "Open defecation"},
                            ],
                        },
                        {
                            "key": "electricity",
                            "type": "single_choice",
                            "label": "Electricity Access",
                            "required": True,
                            "options": [
                                {"value": "grid_regular", "label": "Grid (regular supply)"},
                                {"value": "grid_intermittent", "label": "Grid (intermittent)"},
                                {"value": "solar", "label": "Solar only"},
                                {"value": "none", "label": "No electricity"},
                            ],
                        },
                        {"key": "location", "type": "gps", "label": "GPS Location", "required": False},
                        {"key": "notes", "type": "text", "label": "Notes", "required": False, "multiline": True},
                    ],
                },
            ],
        },
    },

    "field-audit": {
        "slug": "field-audit",
        "title": "Field Site Audit",
        "description": "Inspect sites for compliance, document issues, and capture photographic evidence.",
        "category": "Audit",
        "icon": "📋",
        "field_count": 8,
        "schema": {
            "title": "Field Site Audit",
            "version": 1,
            "sections": [
                {
                    "id": "s1",
                    "title": "Site Info",
                    "fields": [
                        {"key": "site_name", "type": "text", "label": "Site Name", "required": True},
                        {
                            "key": "site_type",
                            "type": "single_choice",
                            "label": "Site Type",
                            "required": True,
                            "options": [
                                {"value": "school", "label": "School"},
                                {"value": "health_facility", "label": "Health Facility"},
                                {"value": "water_point", "label": "Water Point"},
                                {"value": "construction", "label": "Construction Site"},
                                {"value": "other", "label": "Other"},
                            ],
                        },
                        {"key": "auditor_name", "type": "text", "label": "Auditor Name", "required": True},
                        {"key": "location", "type": "gps", "label": "GPS Location", "required": True},
                    ],
                },
                {
                    "id": "s2",
                    "title": "Findings",
                    "fields": [
                        {
                            "key": "compliance_status",
                            "type": "single_choice",
                            "label": "Overall Compliance",
                            "required": True,
                            "options": [
                                {"value": "compliant", "label": "Compliant"},
                                {"value": "minor_issues", "label": "Minor Issues"},
                                {"value": "major_issues", "label": "Major Issues"},
                                {"value": "non_compliant", "label": "Non-Compliant"},
                            ],
                        },
                        {
                            "key": "issues_found",
                            "type": "multiple_choice",
                            "label": "Issues Found",
                            "required": False,
                            "options": [
                                {"value": "structural", "label": "Structural damage"},
                                {"value": "hygiene", "label": "Hygiene / Sanitation"},
                                {"value": "safety", "label": "Safety hazard"},
                                {"value": "documentation", "label": "Missing documentation"},
                                {"value": "staff", "label": "Staff absent / insufficient"},
                                {"value": "equipment", "label": "Equipment missing / broken"},
                            ],
                        },
                        {"key": "photo", "type": "photo", "label": "Site Photo", "required": False},
                        {"key": "action_required", "type": "text", "label": "Action Required", "required": False, "multiline": True},
                    ],
                },
            ],
        },
    },

    "agriculture-survey": {
        "slug": "agriculture-survey",
        "title": "Agriculture & Crop Survey",
        "description": "Capture crop type, land area, irrigation access, and market linkages for farming households.",
        "category": "Agriculture",
        "icon": "🌾",
        "field_count": 10,
        "schema": {
            "title": "Agriculture & Crop Survey",
            "version": 1,
            "sections": [
                {
                    "id": "s1",
                    "title": "Farmer Details",
                    "fields": [
                        {"key": "farmer_name", "type": "text", "label": "Farmer Name", "required": True},
                        {"key": "village", "type": "text", "label": "Village / Gram Panchayat", "required": True},
                        {"key": "land_area_acres", "type": "number", "label": "Total Land Area (acres)", "required": True, "min": 0},
                        {"key": "location", "type": "gps", "label": "Farm GPS Location", "required": False},
                    ],
                },
                {
                    "id": "s2",
                    "title": "Crop Information",
                    "fields": [
                        {
                            "key": "primary_crop",
                            "type": "single_choice",
                            "label": "Primary Crop (current season)",
                            "required": True,
                            "options": [
                                {"value": "rice", "label": "Rice / Paddy"},
                                {"value": "wheat", "label": "Wheat"},
                                {"value": "cotton", "label": "Cotton"},
                                {"value": "sugarcane", "label": "Sugarcane"},
                                {"value": "vegetables", "label": "Vegetables"},
                                {"value": "pulses", "label": "Pulses / Legumes"},
                                {"value": "other", "label": "Other"},
                            ],
                        },
                        {
                            "key": "irrigation_source",
                            "type": "single_choice",
                            "label": "Irrigation Source",
                            "required": True,
                            "options": [
                                {"value": "rainfed", "label": "Rainfed only"},
                                {"value": "canal", "label": "Canal irrigation"},
                                {"value": "borewell", "label": "Borewell / Drip"},
                                {"value": "tank", "label": "Tank / Pond"},
                            ],
                        },
                        {
                            "key": "market_access",
                            "type": "single_choice",
                            "label": "Sells crop at",
                            "required": False,
                            "options": [
                                {"value": "mandi", "label": "Local mandi"},
                                {"value": "fpo", "label": "FPO / Cooperative"},
                                {"value": "direct", "label": "Direct to consumer"},
                                {"value": "contractor", "label": "Middleman / Contractor"},
                            ],
                        },
                        {
                            "key": "challenges",
                            "type": "multiple_choice",
                            "label": "Key Challenges",
                            "required": False,
                            "options": [
                                {"value": "water", "label": "Water scarcity"},
                                {"value": "pests", "label": "Pests / Disease"},
                                {"value": "credit", "label": "Lack of credit"},
                                {"value": "price", "label": "Low market price"},
                                {"value": "labour", "label": "Labour shortage"},
                            ],
                        },
                        {"key": "photo", "type": "photo", "label": "Crop Photo", "required": False},
                        {"key": "notes", "type": "text", "label": "Additional Notes", "required": False, "multiline": True},
                    ],
                },
            ],
        },
    },
}


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/")
def list_templates(user=Depends(require_org_admin)):
    """List all available built-in form templates."""
    return [
        {
            "slug": t["slug"],
            "title": t["title"],
            "description": t["description"],
            "category": t["category"],
            "icon": t["icon"],
            "field_count": t["field_count"],
        }
        for t in TEMPLATES.values()
    ]


@router.get("/{slug}")
def get_template(slug: str, user=Depends(require_org_admin)):
    """Get the full schema for a built-in template."""
    tpl = TEMPLATES.get(slug)
    if not tpl:
        raise HTTPException(status_code=404, detail=f"Template '{slug}' not found")
    return tpl


@router.post("/{slug}/clone")
def clone_template(
    slug: str,
    user=Depends(require_org_admin),
    db: Session = Depends(get_db),
):
    """Clone a built-in template into the tenant as a new editable form."""
    tpl = TEMPLATES.get(slug)
    if not tpl:
        raise HTTPException(status_code=404, detail=f"Template '{slug}' not found")

    schema = copy.deepcopy(tpl["schema"])

    form = Form(
        tenant_id=user["tenant_id"],
        title=tpl["title"],
        json_schema=schema,
        created_by=user["sub"],
        status="draft",
    )
    db.add(form)
    db.flush()

    # Snapshot version 1
    fv = FormVersion(form_id=form.id, version=form.version, json_schema=schema)
    db.add(fv)
    db.commit()
    db.refresh(form)

    return {
        "id": str(form.id),
        "title": form.title,
        "version": form.version,
        "status": form.status,
        "cloned_from": slug,
    }
