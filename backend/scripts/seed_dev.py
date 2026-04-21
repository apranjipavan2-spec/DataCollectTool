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
import uuid
from datetime import datetime, timezone, timedelta

print("Creating tables...")
Base.metadata.create_all(bind=engine)
print("Tables ready.")

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

try:
    # Tenants
    platform_tenant, _ = get_or_create_tenant('FieldPulse Platform', 'enterprise')
    demo_tenant, _ = get_or_create_tenant('Demo Org', 'professional')
    dataworx_tenant, _ = get_or_create_tenant('Dataworx', 'starter')

    # Users — Demo Org
    demo_user_specs = [
        (platform_tenant.id, '+919999990000', 'master_admin', 'Master Admin',        None),
        (demo_tenant.id,     '+918317390926', 'org_admin',    'Super Admin',          hashed_super),
        (demo_tenant.id,     '+919999990001', 'org_admin',    'Admin User',           None),
        (demo_tenant.id,     '+918123105186', 'org_admin',    'PavanDeshetty',        None),
        (demo_tenant.id,     '+919999990002', 'supervisor',   'Supervisor User',      None),
        (demo_tenant.id,     '+919222222222', 'supervisor',   'New Supervisor',       None),
        (demo_tenant.id,     '+919999990003', 'enumerator',   'Enumerator User',      None),
        (demo_tenant.id,     '+919999990004', 'enumerator',   'Priya Sharma',         None),
        (demo_tenant.id,     '+919333333331', 'enumerator',   'BulkUser1',            None),
        (demo_tenant.id,     '+919333333332', 'enumerator',   'BulkUser2',            None),
        (demo_tenant.id,     '+919111111111', 'enumerator',   'Test Field Worker',    None),
    ]
    # Users — Dataworx tenant
    dataworx_user_specs = [
        (dataworx_tenant.id, '+919999991001', 'org_admin',    'Dataworx Admin',   None),
        (dataworx_tenant.id, '+919999991002', 'supervisor',   'Manjunath',        None),
        (dataworx_tenant.id, '+919999991003', 'enumerator',   'Ninganna',         None),
        (dataworx_tenant.id, '+919999991004', 'enumerator',   'Babasaheb',        None),
        (dataworx_tenant.id, '+919999991005', 'enumerator',   'Rohit',            None),
    ]

    user_objs = {}
    for tenant_id, phone, role, name, pw in demo_user_specs + dataworx_user_specs:
        u, _ = upsert_user(tenant_id, phone, role, name, pw_hash=pw)
        user_objs[phone] = u

    enum1    = user_objs['+919999990003']
    enum2    = user_objs['+919999990004']
    org_admin = user_objs['+919999990001']

    db.flush()

    # Forms
    hs_form, hs_new = get_or_create_form(
        demo_tenant.id, 'Household Survey', HOUSEHOLD_SURVEY_SCHEMA, org_admin.id
    )
    ha_form, ha_new = get_or_create_form(
        demo_tenant.id, 'Health Assessment', HEALTH_ASSESSMENT_SCHEMA, org_admin.id
    )

    db.flush()

    # Form assignments (enumerators assigned to both forms)
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

    # Sample submissions (only if forms were just created)
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

    print("\n✓ Seed complete (idempotent — skipped existing records)")
    print(f"\nTenants : FieldPulse Platform · Demo Org · Dataworx")
    print(f"\nDefault password  : {DEFAULT_PASSWORD}")
    print(f"Super Admin pass  : {SUPER_ADMIN_PASSWORD}  (+918317390926)")
    print("\nDemo Org accounts:")
    for _, phone, role, name, _ in demo_user_specs:
        print(f"  {role:15s}  {phone}  ({name})")
    print("\nDataworx accounts:")
    for _, phone, role, name, _ in dataworx_user_specs:
        print(f"  {role:15s}  {phone}  ({name})")
    print(f"\nForms seeded    : {hs_form.title} (v{hs_form.version}) · {ha_form.title} (v{ha_form.version})")
    subs = db.query(Submission).filter(Submission.tenant_id == demo_tenant.id).count()
    print(f"Submissions     : {subs} total in Demo Org")

except Exception as e:
    db.rollback()
    print(f"Seed error: {e}")
    raise
finally:
    db.close()
