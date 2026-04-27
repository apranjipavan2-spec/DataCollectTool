"""
Idempotent seed — safe to run on every deploy.
Creates platform tenant + master admin, plus demo tenant with all 4 roles,
two sample forms, form assignments, and realistic sample submissions.

Default password for all seed users: test@123
"""
import sys, os, random
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import app.models  # noqa: F401
from app.core.database import SessionLocal, engine, Base
from app.core.security import hash_password
from app.models.tenant import Tenant
from app.models.user import User
from app.models.form import Form
from app.models.form_version import FormVersion
from app.models.submission import Submission
from app.models.form_assignment import FormAssignment
from app.models.program import Program, ProgramQuestionnaire, ProgramParticipantType
import uuid
from datetime import datetime, timezone, timedelta

print("Creating tables...")
Base.metadata.create_all(bind=engine)
print("Tables ready.")

# ── Schema repair: apply any missing columns/tables that alembic may have missed ──
# Uses IF NOT EXISTS so this is fully idempotent on every deploy.
print("Applying schema patches...")
_PATCHES = [
    # 0016
    "ALTER TABLE submissions ADD COLUMN IF NOT EXISTS serial_no INTEGER",
    "ALTER TABLE tenants ADD COLUMN IF NOT EXISTS allow_enumerator_edit BOOLEAN NOT NULL DEFAULT true",
    # 0013
    "ALTER TABLE tenants ADD COLUMN IF NOT EXISTS app_name VARCHAR",
    # 0014
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS email VARCHAR",
    # 0016 backfill serial_no for existing rows
    """
    UPDATE submissions SET serial_no = sub.rn
    FROM (
        SELECT id, ROW_NUMBER() OVER (PARTITION BY tenant_id ORDER BY server_received_at ASC, id ASC) AS rn
        FROM submissions WHERE serial_no IS NULL
    ) sub WHERE submissions.id = sub.id AND submissions.serial_no IS NULL
    """,
    # 0017 — program tables (CREATE TABLE IF NOT EXISTS)
    """CREATE TABLE IF NOT EXISTS program_locations (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        state VARCHAR DEFAULT '',
        district VARCHAR NOT NULL DEFAULT '',
        block VARCHAR DEFAULT '',
        village VARCHAR DEFAULT '',
        gps_lat FLOAT,
        gps_lng FLOAT,
        created_at TIMESTAMPTZ DEFAULT now()
    )""",
    """CREATE TABLE IF NOT EXISTS programs (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        name VARCHAR NOT NULL,
        scheme_name VARCHAR DEFAULT '',
        description TEXT DEFAULT '',
        start_date DATE,
        end_date DATE,
        status VARCHAR DEFAULT 'active',
        created_by UUID REFERENCES users(id),
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now()
    )""",
    """CREATE TABLE IF NOT EXISTS program_participant_types (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        program_id UUID NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        name VARCHAR NOT NULL,
        description TEXT DEFAULT '',
        sort_order INTEGER DEFAULT 0
    )""",
    """CREATE TABLE IF NOT EXISTS program_questionnaires (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        program_id UUID NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
        participant_type_id UUID REFERENCES program_participant_types(id) ON DELETE SET NULL,
        form_id UUID REFERENCES forms(id) ON DELETE SET NULL,
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        name VARCHAR NOT NULL,
        total_target INTEGER DEFAULT 0,
        start_date DATE,
        end_date DATE,
        status VARCHAR DEFAULT 'active',
        created_at TIMESTAMPTZ DEFAULT now()
    )""",
    """CREATE TABLE IF NOT EXISTS questionnaire_location_targets (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        questionnaire_id UUID NOT NULL REFERENCES program_questionnaires(id) ON DELETE CASCADE,
        location_id UUID NOT NULL REFERENCES program_locations(id) ON DELETE CASCADE,
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        target_count INTEGER DEFAULT 0,
        deadline DATE,
        created_at TIMESTAMPTZ DEFAULT now()
    )""",
    # 0018
    "ALTER TABLE submissions ADD COLUMN IF NOT EXISTS program_id UUID REFERENCES programs(id) ON DELETE SET NULL",
    "ALTER TABLE submissions ADD COLUMN IF NOT EXISTS participant_type_id UUID REFERENCES program_participant_types(id) ON DELETE SET NULL",
    "ALTER TABLE submissions ADD COLUMN IF NOT EXISTS questionnaire_id UUID REFERENCES program_questionnaires(id) ON DELETE SET NULL",
    "ALTER TABLE submissions ADD COLUMN IF NOT EXISTS location_id UUID REFERENCES program_locations(id) ON DELETE SET NULL",
    # 0019 — integrations
    "ALTER TABLE tenants ADD COLUMN IF NOT EXISTS notification_config JSONB DEFAULT '{}'::jsonb",
    "ALTER TABLE forms ADD COLUMN IF NOT EXISTS sheets_sync_config JSONB DEFAULT '{}'::jsonb",
    # 0020 — QC / compliance
    "ALTER TABLE submissions ADD COLUMN IF NOT EXISTS has_violations BOOLEAN DEFAULT false",
    "ALTER TABLE submissions ADD COLUMN IF NOT EXISTS consent_given BOOLEAN DEFAULT true",
    "ALTER TABLE submissions ADD COLUMN IF NOT EXISTS consent_timestamp TIMESTAMPTZ",
    "ALTER TABLE submissions ADD COLUMN IF NOT EXISTS backcheck_required BOOLEAN DEFAULT false",
    "ALTER TABLE submissions ADD COLUMN IF NOT EXISTS backcheck_form_id UUID",
    # 0021 — public survey + respondent roster
    "ALTER TABLE forms ADD COLUMN IF NOT EXISTS public_token VARCHAR(64)",
    "ALTER TABLE forms ADD COLUMN IF NOT EXISTS is_public BOOLEAN DEFAULT false",
    """CREATE TABLE IF NOT EXISTS respondent_roster (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        form_id UUID NOT NULL REFERENCES forms(id),
        tenant_id UUID NOT NULL REFERENCES tenants(id),
        name VARCHAR(255) NOT NULL,
        phone VARCHAR(50),
        address TEXT,
        target_enumerator_id UUID REFERENCES users(id),
        status VARCHAR(20) DEFAULT 'pending',
        scheduled_date DATE,
        notes TEXT,
        created_at TIMESTAMPTZ DEFAULT now()
    )""",
    # 0022 — AI config
    "ALTER TABLE tenants ADD COLUMN IF NOT EXISTS ai_config JSONB DEFAULT '{}'::jsonb",
    # 0023 — roster ↔ submission link
    "ALTER TABLE submissions ADD COLUMN IF NOT EXISTS roster_id UUID REFERENCES respondent_roster(id)",
    "ALTER TABLE respondent_roster ADD COLUMN IF NOT EXISTS extra_data JSONB DEFAULT '{}'::jsonb",
    # 0024 — locations hierarchy
    """CREATE TABLE IF NOT EXISTS locations (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        tenant_id UUID NOT NULL REFERENCES tenants(id),
        name VARCHAR(255) NOT NULL,
        type VARCHAR(50) NOT NULL,
        parent_id UUID REFERENCES locations(id),
        code VARCHAR(100),
        created_at TIMESTAMPTZ DEFAULT now()
    )""",
    "ALTER TABLE respondent_roster ADD COLUMN IF NOT EXISTS location_id UUID REFERENCES locations(id)",
    # 0025 — panel study / waves
    "ALTER TABLE program_questionnaires ADD COLUMN IF NOT EXISTS wave_number INTEGER",
    "ALTER TABLE program_questionnaires ADD COLUMN IF NOT EXISTS wave_label VARCHAR(100)",
    "ALTER TABLE program_questionnaires ADD COLUMN IF NOT EXISTS panel_key VARCHAR(200)",
    "ALTER TABLE programs ADD COLUMN IF NOT EXISTS is_panel_study BOOLEAN DEFAULT false",
    "ALTER TABLE submissions ADD COLUMN IF NOT EXISTS household_id VARCHAR(500)",
    "CREATE INDEX IF NOT EXISTS ix_submissions_household_id ON submissions (household_id, tenant_id)",

    # 0026 — program_analysis
    """CREATE TABLE IF NOT EXISTS program_analysis (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        program_id UUID NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
        tenant_id UUID NOT NULL,
        created_by UUID REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now(),
        status TEXT DEFAULT 'done',
        source TEXT DEFAULT 'manual',
        objectives TEXT,
        table_configs JSONB DEFAULT '[]',
        cleaning_summary JSONB DEFAULT '{}',
        ai_rationale TEXT,
        error_text TEXT,
        run_count INTEGER DEFAULT 0,
        last_run_at TIMESTAMPTZ
    )""",
    "CREATE INDEX IF NOT EXISTS ix_program_analysis_program_id ON program_analysis (program_id, tenant_id)",

    # 0027 — backcheck completion, system_settings, form generation status
    "ALTER TABLE submissions ADD COLUMN IF NOT EXISTS backcheck_completed BOOLEAN DEFAULT false",
    """CREATE TABLE IF NOT EXISTS system_settings (
        key TEXT PRIMARY KEY,
        value JSONB NOT NULL DEFAULT '{}',
        updated_at TIMESTAMPTZ DEFAULT now()
    )""",
    "INSERT INTO system_settings (key, value) VALUES ('ai_config', '{}') ON CONFLICT DO NOTHING",
    "ALTER TABLE forms ADD COLUMN IF NOT EXISTS generation_status TEXT DEFAULT 'done'",
    "ALTER TABLE forms ADD COLUMN IF NOT EXISTS generation_error TEXT",

    # 0028 — program_id on program_locations
    "ALTER TABLE program_locations ADD COLUMN IF NOT EXISTS program_id UUID REFERENCES programs(id) ON DELETE CASCADE",
    "CREATE INDEX IF NOT EXISTS ix_program_locations_program_id ON program_locations (program_id, tenant_id)",

    # DATA: deactivate extra demo enumerators/supervisors (keep 3 enum + 1 supervisor)
    """UPDATE users SET is_active = false
       WHERE phone IN ('+919333333332', '+919111111111', '+919222222222')
       AND tenant_id = (SELECT id FROM tenants WHERE name = 'Demo Org' LIMIT 1)""",

    # DATA: rename BulkUser1 to a realistic field name
    """UPDATE users SET name = 'Arjun Das'
       WHERE phone = '+919333333331'
       AND tenant_id = (SELECT id FROM tenants WHERE name = 'Demo Org' LIMIT 1)""",

    # DATA: add participant types for all demo programs that have none yet
    """INSERT INTO program_participant_types (id, program_id, tenant_id, name, description, sort_order)
       SELECT gen_random_uuid(), p.id, p.tenant_id, 'Household', 'Household-level respondent', 0
       FROM programs p
       WHERE p.tenant_id = (SELECT id FROM tenants WHERE name = 'Demo Org' LIMIT 1)
       AND NOT EXISTS (
           SELECT 1 FROM program_participant_types pt WHERE pt.program_id = p.id
       )
       AND p.name NOT ILIKE '%health%' AND p.name NOT ILIKE '%education%'
       AND p.name NOT ILIKE '%student%' AND p.name NOT ILIKE '%farmer%'""",

    """INSERT INTO program_participant_types (id, program_id, tenant_id, name, description, sort_order)
       SELECT gen_random_uuid(), p.id, p.tenant_id, 'Beneficiary', 'Direct program beneficiary', 1
       FROM programs p
       WHERE p.tenant_id = (SELECT id FROM tenants WHERE name = 'Demo Org' LIMIT 1)
       AND NOT EXISTS (
           SELECT 1 FROM program_participant_types pt WHERE pt.program_id = p.id AND pt.name = 'Beneficiary'
       )""",

    # DATA: add Health Worker type for health programs
    """INSERT INTO program_participant_types (id, program_id, tenant_id, name, description, sort_order)
       SELECT gen_random_uuid(), p.id, p.tenant_id, 'Patient / Community Member', 'Health program participant', 0
       FROM programs p
       WHERE p.tenant_id = (SELECT id FROM tenants WHERE name = 'Demo Org' LIMIT 1)
       AND (p.name ILIKE '%health%' OR p.name ILIKE '%nutrition%' OR p.name ILIKE '%sanitation%')
       AND NOT EXISTS (
           SELECT 1 FROM program_participant_types pt WHERE pt.program_id = p.id AND pt.name = 'Patient / Community Member'
       )""",

    # DATA: add Student type for education programs
    """INSERT INTO program_participant_types (id, program_id, tenant_id, name, description, sort_order)
       SELECT gen_random_uuid(), p.id, p.tenant_id, 'Student', 'School-going child', 0
       FROM programs p
       WHERE p.tenant_id = (SELECT id FROM tenants WHERE name = 'Demo Org' LIMIT 1)
       AND (p.name ILIKE '%education%' OR p.name ILIKE '%school%' OR p.name ILIKE '%student%' OR p.name ILIKE '%learning%')
       AND NOT EXISTS (
           SELECT 1 FROM program_participant_types pt WHERE pt.program_id = p.id AND pt.name = 'Student'
       )""",

    # DATA: add Farmer type for agriculture programs
    """INSERT INTO program_participant_types (id, program_id, tenant_id, name, description, sort_order)
       SELECT gen_random_uuid(), p.id, p.tenant_id, 'Farmer / Cultivator', 'Agricultural household', 0
       FROM programs p
       WHERE p.tenant_id = (SELECT id FROM tenants WHERE name = 'Demo Org' LIMIT 1)
       AND (p.name ILIKE '%farm%' OR p.name ILIKE '%agri%' OR p.name ILIKE '%crop%' OR p.name ILIKE '%kisan%' OR p.name ILIKE '%pm-kisan%')
       AND NOT EXISTS (
           SELECT 1 FROM program_participant_types pt WHERE pt.program_id = p.id AND pt.name = 'Farmer / Cultivator'
       )""",

    # DATA: update questionnaire total_target to realistic numbers
    """UPDATE program_questionnaires SET total_target = CASE
           WHEN name ILIKE '%baseline%' THEN 500
           WHEN name ILIKE '%midline%' THEN 450
           WHEN name ILIKE '%endline%' THEN 400
           WHEN name ILIKE '%household%' THEN 300
           WHEN name ILIKE '%health%' THEN 250
           WHEN name ILIKE '%education%' OR name ILIKE '%school%' THEN 200
           ELSE 250
       END
       WHERE tenant_id = (SELECT id FROM tenants WHERE name = 'Demo Org' LIMIT 1)
       AND total_target = 0""",

    # DATA: link questionnaires to participant types where possible
    """UPDATE program_questionnaires pq SET participant_type_id = (
           SELECT pt.id FROM program_participant_types pt
           WHERE pt.program_id = pq.program_id
           ORDER BY pt.sort_order LIMIT 1
       )
       WHERE pq.tenant_id = (SELECT id FROM tenants WHERE name = 'Demo Org' LIMIT 1)
       AND pq.participant_type_id IS NULL""",

    # 0029 — user_tool_projects
    """CREATE TABLE IF NOT EXISTS user_tool_projects (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id   UUID NOT NULL REFERENCES tenants(id)  ON DELETE CASCADE,
        user_id     UUID NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
        tool        VARCHAR(20)  NOT NULL,
        name        VARCHAR(255) NOT NULL,
        program_id  UUID REFERENCES programs(id) ON DELETE SET NULL,
        data        JSONB NOT NULL DEFAULT '{}',
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )""",
    "CREATE INDEX IF NOT EXISTS ix_utp_user_tool ON user_tool_projects (user_id, tool)",
    "CREATE INDEX IF NOT EXISTS ix_utp_tenant    ON user_tool_projects (tenant_id)",

    # 0030 — performance indexes on submissions
    "CREATE INDEX IF NOT EXISTS ix_sub_tenant_program    ON submissions (tenant_id, program_id) WHERE program_id IS NOT NULL",
    "CREATE INDEX IF NOT EXISTS ix_sub_questionnaire     ON submissions (questionnaire_id) WHERE questionnaire_id IS NOT NULL",
    "CREATE INDEX IF NOT EXISTS ix_sub_enumerator        ON submissions (enumerator_id)",
    "CREATE INDEX IF NOT EXISTS ix_sub_tenant_status     ON submissions (tenant_id, status)",
    "CREATE INDEX IF NOT EXISTS ix_sub_tenant_recvd      ON submissions (tenant_id, server_received_at DESC)",

    # 0031 — per-form and per-program enumerator edit override
    "ALTER TABLE forms    ADD COLUMN IF NOT EXISTS allow_enumerator_edit BOOLEAN",
    "ALTER TABLE programs ADD COLUMN IF NOT EXISTS allow_enumerator_edit BOOLEAN",
]

from sqlalchemy import text as _text
with engine.begin() as _conn:
    for _sql in _PATCHES:
        try:
            _conn.execute(_text(_sql.strip()))
        except Exception as _e:
            print(f"  patch warning (ignored): {_e}")
print("Schema patches done.")

# ── Fast-path: skip seed data on warm restarts ────────────────────────────────
# On every container restart (not just first deploy) the seed runs. If the DB
# already has the Demo Org tenant the data is already in place — exit early so
# uvicorn can start within Railway's 2-minute healthcheck window.
_fast_check_db = SessionLocal()
try:
    _already_seeded = _fast_check_db.query(Tenant).filter(Tenant.name == 'Demo Org').first()
finally:
    _fast_check_db.close()

if _already_seeded:
    print("DB already seeded — skipping seed data (warm restart fast-path).")
    print("\n✓ Seed complete")
    sys.exit(0)

db = SessionLocal()

DEFAULT_PASSWORD = 'test@123'
SUPER_ADMIN_PASSWORD = 'superadmin@4991'
hashed = hash_password(DEFAULT_PASSWORD)
hashed_super = hash_password(SUPER_ADMIN_PASSWORD)

# ── helpers (upsert — always syncs role, name, password, active status) ──────

def get_or_create_tenant(name, plan_tier='starter'):
    t = db.query(Tenant).filter(Tenant.name == name).first()
    if t:
        return t, False
    t = Tenant(id=uuid.uuid4(), name=name, plan_tier=plan_tier)
    db.add(t)
    db.flush()
    return t, True

def upsert_user(tenant_id, phone, role, name, pw_hash=None):
    """Create or update a seed user — keeps role/password/name in sync."""
    u = db.query(User).filter(User.phone == phone).first()
    if u:
        u.tenant_id = tenant_id
        u.role = role
        u.name = name
        u.is_active = True
        if pw_hash:
            u.password_hash = pw_hash  # always reset seeded passwords
        return u, False
    u = User(tenant_id=tenant_id, role=role, phone=phone, name=name,
             password_hash=pw_hash or hashed, is_active=True)
    db.add(u)
    db.flush()
    return u, True

def get_or_create_form(tenant_id, title, json_schema, created_by):
    f = db.query(Form).filter(Form.tenant_id == tenant_id, Form.title == title).first()
    if f:
        return f, False
    f = Form(
        tenant_id=tenant_id,
        title=title,
        json_schema=json_schema,
        version=1,
        status='active',
        created_by=created_by,
    )
    db.add(f)
    db.flush()
    # snapshot version 1
    fv = FormVersion(form_id=f.id, version=1, json_schema=json_schema)
    db.add(fv)
    return f, True

# ── schemas ───────────────────────────────────────────────────────────────────

HOUSEHOLD_SURVEY_SCHEMA = {
    "title": "Household Survey",
    "sections": [
        {
            "title": "1. Household Identification",
            "fields": [
                {"id": "hs_state",     "label": "State",           "type": "select",  "required": True,  "options": ["Karnataka","Maharashtra","Tamil Nadu","Telangana","Andhra Pradesh","Uttar Pradesh","Bihar"]},
                {"id": "hs_district",  "label": "District",        "type": "text",    "required": True},
                {"id": "hs_village",   "label": "Village / Ward",  "type": "text",    "required": True},
                {"id": "hs_gp",        "label": "Gram Panchayat",  "type": "text",    "required": False},
                {"id": "hs_hh_no",     "label": "Household Number","type": "text",    "required": True},
                {"id": "hs_gps",       "label": "GPS Location",    "type": "gps",     "required": False},
            ]
        },
        {
            "title": "2. Head of Household",
            "fields": [
                {"id": "hs_hh_name",   "label": "Name of Head",        "type": "text",   "required": True},
                {"id": "hs_hh_gender", "label": "Gender",               "type": "select", "required": True,  "options": ["Male","Female","Transgender"]},
                {"id": "hs_hh_age",    "label": "Age (years)",          "type": "number", "required": True},
                {"id": "hs_hh_edu",    "label": "Education Level",      "type": "select", "required": False, "options": ["Illiterate","Primary","Secondary","Graduate","Post Graduate"]},
                {"id": "hs_hh_occ",    "label": "Primary Occupation",   "type": "select", "required": False, "options": ["Agriculture","Labour","Business","Government Job","Other"]},
                {"id": "hs_caste",     "label": "Social Category",      "type": "select", "required": False, "options": ["General","OBC","SC","ST"]},
                {"id": "hs_mobile",    "label": "Mobile Number",        "type": "text",   "required": False},
            ]
        },
        {
            "title": "3. Family Composition",
            "fields": [
                {"id": "hs_total_members", "label": "Total Family Members",     "type": "number", "required": True},
                {"id": "hs_male_members",  "label": "Male Members",             "type": "number", "required": False},
                {"id": "hs_female_members","label": "Female Members",            "type": "number", "required": False},
                {"id": "hs_children_0_5", "label": "Children (0–5 years)",      "type": "number", "required": False},
                {"id": "hs_children_6_18","label": "Children (6–18 years)",     "type": "number", "required": False},
            ]
        },
        {
            "title": "4. Housing & Assets",
            "fields": [
                {"id": "hs_house_type",  "label": "House Type",      "type": "select", "required": False, "options": ["Pucca","Semi-Pucca","Kutcha"]},
                {"id": "hs_toilet",      "label": "Toilet Facility",  "type": "select", "required": False, "options": ["Individual","Community","Open Defecation","None"]},
                {"id": "hs_water_src",   "label": "Water Source",     "type": "select", "required": False, "options": ["Tap (Piped)","Borewell","Open Well","River/Pond","Tanker"]},
                {"id": "hs_electricity", "label": "Electricity",      "type": "select", "required": False, "options": ["Yes","No"]},
                {"id": "hs_smartphone",  "label": "Smartphone in HH", "type": "select", "required": False, "options": ["Yes","No"]},
                {"id": "hs_photo",       "label": "House Photo",      "type": "photo",  "required": False},
                {"id": "hs_remarks",     "label": "Remarks",          "type": "textarea","required": False},
            ]
        }
    ],
    "fields": []
}

HEALTH_ASSESSMENT_SCHEMA = {
    "title": "Health Assessment",
    "sections": [
        {
            "title": "1. Respondent Details",
            "fields": [
                {"id": "ha_name",    "label": "Respondent Name",  "type": "text",    "required": True},
                {"id": "ha_age",     "label": "Age",              "type": "number",  "required": True},
                {"id": "ha_gender",  "label": "Gender",           "type": "select",  "required": True,  "options": ["Male","Female","Other"]},
                {"id": "ha_village", "label": "Village",          "type": "text",    "required": True},
                {"id": "ha_gps",     "label": "GPS",              "type": "gps",     "required": False},
            ]
        },
        {
            "title": "2. Health Status",
            "fields": [
                {"id": "ha_chronic",     "label": "Chronic Illness",       "type": "select",   "required": False, "options": ["None","Diabetes","Hypertension","TB","Other"]},
                {"id": "ha_insurance",   "label": "Health Insurance",      "type": "select",   "required": False, "options": ["Ayushman Bharat","ESIS","Private","None"]},
                {"id": "ha_last_visit",  "label": "Last Doctor Visit",     "type": "date",     "required": False},
                {"id": "ha_facility",    "label": "Nearest Health Facility","type": "select",  "required": False, "options": ["PHC","CHC","District Hospital","Private Clinic"]},
                {"id": "ha_dist_km",     "label": "Distance to Facility (km)","type": "number","required": False},
            ]
        },
        {
            "title": "3. Nutrition",
            "fields": [
                {"id": "ha_meals_per_day","label": "Meals per Day",        "type": "number",  "required": False},
                {"id": "ha_anemia",       "label": "Anemia (Women/Children)","type": "select","required": False, "options": ["Yes","No","Not Applicable"]},
                {"id": "ha_malnourished", "label": "Malnourished Child in HH","type": "select","required": False,"options": ["Yes","No"]},
            ]
        },
        {
            "title": "4. WASH",
            "fields": [
                {"id": "ha_handwash",    "label": "Handwashing with Soap",  "type": "select", "required": False, "options": ["Always","Sometimes","Never"]},
                {"id": "ha_menstrual",   "label": "Menstrual Hygiene (Women)","type": "select","required": False,"options": ["Sanitary Pad","Cloth","Other","Not Applicable"]},
                {"id": "ha_notes",       "label": "Field Notes",             "type": "textarea","required": False},
            ]
        }
    ],
    "fields": []
}

# ── sample data pools ─────────────────────────────────────────────────────────

NAMES = [
    "Rajesh Kumar","Priya Sharma","Amit Mehta","Sunita Devi","Ravi Reddy",
    "Lakshmi Bai","Suresh Patil","Kavitha Nair","Mohammed Rafiq","Anita Singh",
    "Vinod Yadav","Geeta Pillai","Sanjay Guptа","Meera Verma","Arjun Das",
    "Fatima Shaikh","Ramesh Naidu","Pushpa Kumari","Deepak Joshi","Usha Rani",
]
VILLAGES = ["Basavanagudi","Hoskote","Domlur","Malleshwaram","Jayanagar",
            "Kengeri","Whitefield","Yelahanka","Devanahalli","Sarjapur"]
DISTRICTS = ["Bengaluru Urban","Bengaluru Rural","Mysuru","Tumkur","Hassan"]

def rand_sub_hs(enum_id, form_id, tenant_id, days_ago):
    name = random.choice(NAMES)
    village = random.choice(VILLAGES)
    district = random.choice(DISTRICTS)
    members = random.randint(2, 8)
    male = random.randint(1, members)
    female = members - male
    return {
        "tenant_id": tenant_id,
        "form_id": form_id,
        "form_version": 1,
        "enumerator_id": enum_id,
        "local_id": str(uuid.uuid4()),
        "data_json": {
            "hs_state": "Karnataka",
            "hs_district": district,
            "hs_village": village,
            "hs_hh_no": f"HH-{random.randint(100,999)}",
            "hs_hh_name": name,
            "hs_hh_gender": random.choice(["Male","Female"]),
            "hs_hh_age": random.randint(28, 70),
            "hs_hh_edu": random.choice(["Illiterate","Primary","Secondary","Graduate"]),
            "hs_hh_occ": random.choice(["Agriculture","Labour","Business","Government Job","Other"]),
            "hs_caste": random.choice(["General","OBC","SC","ST"]),
            "hs_total_members": members,
            "hs_male_members": male,
            "hs_female_members": female,
            "hs_children_0_5": random.randint(0, 2),
            "hs_children_6_18": random.randint(0, 3),
            "hs_house_type": random.choice(["Pucca","Semi-Pucca","Kutcha"]),
            "hs_toilet": random.choice(["Individual","Community","Open Defecation"]),
            "hs_water_src": random.choice(["Tap (Piped)","Borewell","Open Well"]),
            "hs_electricity": random.choice(["Yes","No"]),
            "hs_smartphone": random.choice(["Yes","No"]),
        },
        "gps_open": {"lat": 12.9 + random.uniform(-0.5,0.5), "lng": 77.5 + random.uniform(-0.5,0.5), "accuracy": round(random.uniform(5,25),1)},
        "gps_submit": {"lat": 12.9 + random.uniform(-0.5,0.5), "lng": 77.5 + random.uniform(-0.5,0.5), "accuracy": round(random.uniform(5,25),1)},
        "status": random.choice(["synced","synced","synced","flagged","approved"]),
        "local_created_at": datetime.now(timezone.utc) - timedelta(days=days_ago, hours=random.randint(0,8)),
        "server_received_at": datetime.now(timezone.utc) - timedelta(days=days_ago, hours=random.randint(0,6)),
    }

def rand_sub_ha(enum_id, form_id, tenant_id, days_ago):
    name = random.choice(NAMES)
    village = random.choice(VILLAGES)
    return {
        "tenant_id": tenant_id,
        "form_id": form_id,
        "form_version": 1,
        "enumerator_id": enum_id,
        "local_id": str(uuid.uuid4()),
        "data_json": {
            "ha_name": name,
            "ha_age": random.randint(15, 75),
            "ha_gender": random.choice(["Male","Female"]),
            "ha_village": village,
            "ha_chronic": random.choice(["None","None","None","Diabetes","Hypertension","TB"]),
            "ha_insurance": random.choice(["Ayushman Bharat","ESIS","None","None"]),
            "ha_facility": random.choice(["PHC","CHC","District Hospital","Private Clinic"]),
            "ha_dist_km": random.randint(1, 25),
            "ha_meals_per_day": random.choice([2, 2, 3, 3, 3]),
            "ha_anemia": random.choice(["Yes","No","No","Not Applicable"]),
            "ha_malnourished": random.choice(["Yes","No","No","No"]),
            "ha_handwash": random.choice(["Always","Always","Sometimes","Never"]),
        },
        "gps_open": {"lat": 12.9 + random.uniform(-0.5,0.5), "lng": 77.5 + random.uniform(-0.5,0.5), "accuracy": round(random.uniform(5,25),1)},
        "gps_submit": {"lat": 12.9 + random.uniform(-0.5,0.5), "lng": 77.5 + random.uniform(-0.5,0.5), "accuracy": round(random.uniform(5,25),1)},
        "status": random.choice(["synced","synced","synced","flagged","approved"]),
        "local_created_at": datetime.now(timezone.utc) - timedelta(days=days_ago, hours=random.randint(0,8)),
        "server_received_at": datetime.now(timezone.utc) - timedelta(days=days_ago, hours=random.randint(0,6)),
    }

# ── main ──────────────────────────────────────────────────────────────────────

random.seed(42)

# ── Stage 1: tenants + users (committed immediately so login always works) ────
try:
    platform_tenant, _ = get_or_create_tenant('FieldGovern Platform', 'enterprise')
    demo_tenant, _ = get_or_create_tenant('Demo Org', 'professional')
    dataworx_tenant, _ = get_or_create_tenant('Dataworx', 'starter')
    db.commit()
    print("Stage 1a: tenants OK")
except Exception as e:
    db.rollback()
    print(f"Seed error (tenants): {e}")
    raise

demo_user_specs = [
    (platform_tenant.id, '+919999990000', 'master_admin', 'Master Admin',        None),
    (platform_tenant.id, '+918317390926', 'master_admin', 'Pavan Deshetty',       hashed_super),
    (demo_tenant.id,     '+919999990001', 'org_admin',    'Admin User',           None),
    (demo_tenant.id,     '+918123105186', 'org_admin',    'PavanDeshetty',        None),
    (demo_tenant.id,     '+919999990002', 'supervisor',   'Supervisor User',      None),
    (demo_tenant.id,     '+919999990003', 'enumerator',   'Enumerator User',      None),
    (demo_tenant.id,     '+919999990004', 'enumerator',   'Priya Sharma',         None),
    (demo_tenant.id,     '+919333333331', 'enumerator',   'Arjun Das',            None),
]
dataworx_user_specs = [
    (dataworx_tenant.id, '+919999991001', 'org_admin',    'Dataworx Admin',   None),
    (dataworx_tenant.id, '+919999991002', 'supervisor',   'Manjunath',        None),
    (dataworx_tenant.id, '+919999991003', 'enumerator',   'Ninganna',         None),
    (dataworx_tenant.id, '+919999991004', 'enumerator',   'Babasaheb',        None),
    (dataworx_tenant.id, '+919999991005', 'enumerator',   'Rohit',            None),
]

try:
    user_objs = {}
    for tenant_id, phone, role, name, pw in demo_user_specs + dataworx_user_specs:
        u, created = upsert_user(tenant_id, phone, role, name, pw_hash=pw)
        user_objs[phone] = u
        print(f"  {'+ ' if created else '~ '}{phone} ({role})")
    db.commit()
    print("Stage 1b: users OK")
except Exception as e:
    db.rollback()
    print(f"Seed error (users): {e}")
    raise

print(f"\nDefault password  : {DEFAULT_PASSWORD}")
print(f"Super Admin pass  : {SUPER_ADMIN_PASSWORD}  (+918317390926)")

# ── Stage 2: forms + assignments + sample data (non-critical) ─────────────────
try:
    enum1    = user_objs['+919999990003']
    enum2    = user_objs['+919999990004']
    org_admin = user_objs['+919999990001']

    hs_form, hs_new = get_or_create_form(
        demo_tenant.id, 'Household Survey', HOUSEHOLD_SURVEY_SCHEMA, org_admin.id
    )
    ha_form, ha_new = get_or_create_form(
        demo_tenant.id, 'Health Assessment', HEALTH_ASSESSMENT_SCHEMA, org_admin.id
    )
    db.flush()

    for enum in [enum1, enum2]:
        for form in [hs_form, ha_form]:
            exists = db.query(FormAssignment).filter(
                FormAssignment.form_id == form.id,
                FormAssignment.enumerator_id == enum.id,
            ).first()
            if not exists:
                db.add(FormAssignment(
                    tenant_id=demo_tenant.id,
                    form_id=form.id,
                    enumerator_id=enum.id,
                    assigned_by=org_admin.id,
                ))

    if hs_new:
        for i in range(35):
            days_ago = random.randint(0, 30)
            enum = enum1 if i % 3 != 0 else enum2
            d = rand_sub_hs(enum.id, hs_form.id, demo_tenant.id, days_ago)
            db.add(Submission(**d))

    if ha_new:
        for i in range(25):
            days_ago = random.randint(0, 30)
            enum = enum2 if i % 3 != 0 else enum1
            d = rand_sub_ha(enum.id, ha_form.id, demo_tenant.id, days_ago)
            db.add(Submission(**d))

    db.commit()
    print("Stage 2: forms + submissions OK")
    subs = db.query(Submission).filter(Submission.tenant_id == demo_tenant.id).count()
    print(f"Submissions     : {subs} total in Demo Org")

except Exception as e:
    db.rollback()
    print(f"Stage 2 warning (sample data skipped): {e}")

# ── Stage 3: programs + link submissions (non-critical) ───────────────────────
try:
    enum1     = user_objs['+919999990003']
    enum2     = user_objs['+919999990004']
    org_admin = user_objs['+919999990001']

    hs_form = db.query(Form).filter(Form.tenant_id == demo_tenant.id, Form.title == 'Household Survey').first()
    ha_form = db.query(Form).filter(Form.tenant_id == demo_tenant.id, Form.title == 'Health Assessment').first()

    if hs_form and ha_form:
        # Ensure all enumerators have form assignments
        all_enums = [u for u in user_objs.values() if u.tenant_id == demo_tenant.id and u.role == 'enumerator']
        for enum in all_enums:
            for form in [hs_form, ha_form]:
                exists = db.query(FormAssignment).filter(
                    FormAssignment.form_id == form.id,
                    FormAssignment.enumerator_id == enum.id,
                ).first()
                if not exists:
                    db.add(FormAssignment(
                        tenant_id=demo_tenant.id,
                        form_id=form.id,
                        enumerator_id=enum.id,
                        assigned_by=org_admin.id,
                    ))
        db.flush()

        # Create demo program if it doesn't exist
        prog = db.query(Program).filter(
            Program.tenant_id == demo_tenant.id,
            Program.name == 'Rural Health Survey 2024',
        ).first()
        if not prog:
            prog = Program(
                tenant_id=demo_tenant.id,
                name='Rural Health Survey 2024',
                scheme_name='Karnataka Rural Health Mission',
                description='Baseline household and health survey across 5 districts in Karnataka.',
                status='active',
                start_date=datetime(2024, 1, 1).date(),
                end_date=datetime(2024, 12, 31).date(),
                created_by=org_admin.id,
            )
            db.add(prog)
            db.flush()

        # Add participant types if not present
        if not db.query(ProgramParticipantType).filter(ProgramParticipantType.program_id == prog.id).first():
            for i, (pname, pdesc) in enumerate([
                ('Household', 'Household head or representative'),
                ('Patient / Community Member', 'Individual health status respondent'),
                ('ASHA / Health Worker', 'Community health worker'),
            ]):
                db.add(ProgramParticipantType(
                    program_id=prog.id, tenant_id=demo_tenant.id,
                    name=pname, description=pdesc, sort_order=i,
                ))
            db.flush()

        household_pt = db.query(ProgramParticipantType).filter(
            ProgramParticipantType.program_id == prog.id,
            ProgramParticipantType.name == 'Household',
        ).first()
        health_pt = db.query(ProgramParticipantType).filter(
            ProgramParticipantType.program_id == prog.id,
            ProgramParticipantType.name == 'Patient / Community Member',
        ).first()

        # Create questionnaires linked to forms
        hs_q = db.query(ProgramQuestionnaire).filter(
            ProgramQuestionnaire.program_id == prog.id,
            ProgramQuestionnaire.form_id == hs_form.id,
        ).first()
        if not hs_q:
            hs_q = ProgramQuestionnaire(
                program_id=prog.id,
                form_id=hs_form.id,
                tenant_id=demo_tenant.id,
                name='Household Survey',
                total_target=300,
                status='active',
                participant_type_id=household_pt.id if household_pt else None,
            )
            db.add(hs_q)
            db.flush()

        ha_q = db.query(ProgramQuestionnaire).filter(
            ProgramQuestionnaire.program_id == prog.id,
            ProgramQuestionnaire.form_id == ha_form.id,
        ).first()
        if not ha_q:
            ha_q = ProgramQuestionnaire(
                program_id=prog.id,
                form_id=ha_form.id,
                tenant_id=demo_tenant.id,
                name='Health Assessment',
                total_target=250,
                status='active',
                participant_type_id=health_pt.id if health_pt else None,
            )
            db.add(ha_q)
            db.flush()

        # Link all unlinked submissions to the program
        from sqlalchemy import text as _sql
        db.execute(_sql(
            f"""UPDATE submissions SET program_id = '{prog.id}', questionnaire_id = '{hs_q.id}'
                WHERE tenant_id = '{demo_tenant.id}' AND form_id = '{hs_form.id}' AND program_id IS NULL"""
        ))
        db.execute(_sql(
            f"""UPDATE submissions SET program_id = '{prog.id}', questionnaire_id = '{ha_q.id}'
                WHERE tenant_id = '{demo_tenant.id}' AND form_id = '{ha_form.id}' AND program_id IS NULL"""
        ))
        db.commit()
        print("Stage 3: program + questionnaires + submission links OK")
    else:
        print("Stage 3: skipped (forms not found, run seed after forms are created)")

except Exception as e:
    db.rollback()
    print(f"Stage 3 warning (program seed skipped): {e}")

finally:
    db.close()

print("\n✓ Seed complete")
