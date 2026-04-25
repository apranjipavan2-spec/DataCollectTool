"""
Comprehensive program seed — 14 programs across 7 survey sectors (2 each).
Safe to re-run (idempotent). Requires seed_dev.py to have run first.

Sectors:
  1. Household Survey
  2. Health / WASH / Nutrition
  3. Agricultural / Livelihood
  4. Government Program Monitoring
  5. RCT Baseline / Endline
  6. NGO M&E / Impact Assessment
  7. Education / School Survey
"""
import sys, os, random, uuid
from datetime import datetime, timezone, timedelta
from datetime import date as date_type

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import app.models  # noqa: F401
from app.core.database import SessionLocal
from app.models.tenant import Tenant
from app.models.user import User
from app.models.form import Form
from app.models.form_version import FormVersion
from app.models.form_assignment import FormAssignment
from app.models.submission import Submission
from app.models.program import Program, ProgramLocation, ProgramQuestionnaire

db = SessionLocal()

# ── Helpers ───────────────────────────────────────────────────────────────────

def rand_date(days_back_max=60):
    d = random.randint(0, days_back_max)
    return datetime.now(timezone.utc) - timedelta(days=d, hours=random.randint(0, 8))

def pick(*items): return random.choice(items)
def rand_int(lo, hi): return random.randint(lo, hi)

NAMES = ["Ramesh Kumar","Priya Devi","Suresh Singh","Anita Sharma","Mohan Yadav",
         "Geeta Bai","Raju Patel","Sunita Verma","Vijay Gupta","Meena Kumari",
         "Arun Nair","Kavitha Reddy","Dinesh Chauhan","Savitri Devi","Rakesh Maurya",
         "Pushpa Joshi","Bharat Rao","Lalita Devi","Santosh Kumar","Usha Pandey",
         "Mahesh Tiwari","Rekha Singh","Gopal Das","Sushila Kumari","Naresh Sharma"]

VILLAGES = ["Rampur","Shivpur","Krishnapur","Devapur","Nandpur","Bhimpur","Arjunpur",
             "Ganeshpur","Sundarpur","Lakshmipur","Amarpur","Balrampur","Chandrapur",
             "Dayalpur","Ekapur","Fatehpur","Gaonpur","Haripur","Indrapur","Jairampur"]

DISTRICTS_KA = ["Bellary","Raichur","Bidar","Kalaburagi","Yadgir","Vijayapura","Bagalkot"]
DISTRICTS_MH = ["Nashik","Amravati","Yavatmal","Nanded","Osmanabad","Latur","Buldhana"]
DISTRICTS_BR = ["Muzaffarpur","Sitamarhi","Madhubani","Darbhanga","Samastipur","Vaishali","Begusarai"]
DISTRICTS_UP = ["Varanasi","Allahabad","Jhansi","Banda","Chitrakoot","Mirzapur","Sonbhadra"]
DISTRICTS_RJ = ["Barmer","Jaisalmer","Bikaner","Nagaur","Churu","Jhunjhunu","Sikar"]
DISTRICTS_MP = ["Shivpuri","Guna","Ashok Nagar","Datia","Tikamgarh","Chattarpur","Damoh"]
DISTRICTS_TL = ["Nizamabad","Karimnagar","Warangal","Khammam","Nalgonda","Mahbubnagar","Adilabad"]

CASTES = ["General","OBC","SC","ST","OBC"]
GENDERS = ["Male","Female","Female","Male","Male"]
STATUSES = ["synced","synced","synced","flagged","approved"]

def gps(lat_base, lng_base):
    return {"lat": round(lat_base + random.uniform(-0.4, 0.4), 4),
            "lng": round(lng_base + random.uniform(-0.4, 0.4), 4),
            "accuracy": round(random.uniform(5, 20), 1)}

# ── Load demo tenant + users ──────────────────────────────────────────────────

demo = db.query(Tenant).filter(Tenant.name == "Demo Org").first()
if not demo:
    print("ERROR: Demo Org tenant not found. Run seed_dev.py first.")
    db.close(); sys.exit(1)

enumerators = db.query(User).filter(
    User.tenant_id == demo.id, User.role == "enumerator"
).all()
org_admin = db.query(User).filter(
    User.tenant_id == demo.id, User.role == "org_admin"
).first()
supervisors = db.query(User).filter(
    User.tenant_id == demo.id, User.role == "supervisor"
).all()

if not enumerators or not org_admin:
    print("ERROR: Users not found. Run seed_dev.py first.")
    db.close(); sys.exit(1)

# ── Form + Program creation helpers ──────────────────────────────────────────

def get_or_create_form(title, schema):
    f = db.query(Form).filter(Form.tenant_id == demo.id, Form.title == title).first()
    if f:
        return f, False
    f = Form(tenant_id=demo.id, title=title, json_schema=schema, version=1,
             status="active", created_by=org_admin.id)
    db.add(f)
    db.flush()
    db.add(FormVersion(form_id=f.id, version=1, json_schema=schema))
    return f, True

def get_or_create_program(name, scheme, desc, sector, start_y=2024):
    p = db.query(Program).filter(Program.tenant_id == demo.id, Program.name == name).first()
    if p:
        return p, False
    p = Program(tenant_id=demo.id, name=name, scheme_name=scheme,
                description=desc, status="active",
                start_date=date_type(start_y, 1, 1),
                end_date=date_type(start_y, 12, 31),
                created_by=org_admin.id)
    db.add(p); db.flush()
    return p, True

def add_location(program_id, state, district, block=""):
    exists = db.query(ProgramLocation).filter(
        ProgramLocation.program_id == program_id,
        ProgramLocation.district == district,
    ).first()
    if not exists:
        db.add(ProgramLocation(tenant_id=demo.id, program_id=program_id,
                               state=state, district=district, block=block))

def get_or_create_questionnaire(program_id, form_id, name, target=100):
    q = db.query(ProgramQuestionnaire).filter(
        ProgramQuestionnaire.program_id == program_id,
        ProgramQuestionnaire.form_id == form_id,
    ).first()
    if q:
        return q
    q = ProgramQuestionnaire(program_id=program_id, form_id=form_id,
                              tenant_id=demo.id, name=name, total_target=target, status="active")
    db.add(q); db.flush()
    return q

def assign_all_enumerators(form):
    for e in enumerators:
        ex = db.query(FormAssignment).filter(
            FormAssignment.form_id == form.id,
            FormAssignment.enumerator_id == e.id,
        ).first()
        if not ex:
            db.add(FormAssignment(tenant_id=demo.id, form_id=form.id,
                                  enumerator_id=e.id, assigned_by=org_admin.id))

def make_submissions(form, questionnaire, program, count, data_fn, districts):
    created = 0
    for i in range(count):
        enum = enumerators[i % len(enumerators)]
        district = districts[i % len(districts)]
        data = data_fn(district)
        db.add(Submission(
            tenant_id=demo.id, form_id=form.id, form_version=1,
            enumerator_id=enum.id, local_id=str(uuid.uuid4()),
            data_json=data,
            program_id=program.id, questionnaire_id=questionnaire.id,
            status=random.choice(STATUSES),
            local_created_at=rand_date(60),
            server_received_at=rand_date(58),
            gps_open=gps(17.0, 78.5), gps_submit=gps(17.0, 78.5),
        ))
        created += 1
    return created

# ═══════════════════════════════════════════════════════════════════════════════
# SECTOR 1 — HOUSEHOLD SURVEY
# ═══════════════════════════════════════════════════════════════════════════════

HH_SCHEMA = {
    "title": "Socioeconomic Household Survey",
    "version": 1,
    "sections": [{
        "id": "s1", "title": "1. Household Identification",
        "fields": [
            {"id":"hh_id","type":"text","name":"hh_id","label":"Household ID","required":True},
            {"id":"village","type":"text","name":"village","label":"Village / Habitation","required":True},
            {"id":"district","type":"text","name":"district","label":"District","required":True},
            {"id":"gps","type":"gps","name":"gps","label":"GPS Location","required":True},
        ]
    },{
        "id": "s2", "title": "2. Respondent Details",
        "fields": [
            {"id":"resp_name","type":"text","name":"resp_name","label":"Respondent Name","required":True},
            {"id":"resp_age","type":"number","name":"resp_age","label":"Age (years)","required":True,"min":18,"max":99},
            {"id":"resp_gender","type":"single_choice","name":"resp_gender","label":"Gender","required":True,
             "options":[{"value":"male","label":"Male"},{"value":"female","label":"Female"},{"value":"other","label":"Other"}]},
            {"id":"caste","type":"single_choice","name":"caste","label":"Social Category","required":True,
             "options":[{"value":"general","label":"General"},{"value":"obc","label":"OBC"},
                        {"value":"sc","label":"SC"},{"value":"st","label":"ST"}]},
            {"id":"religion","type":"single_choice","name":"religion","label":"Religion",
             "options":[{"value":"hindu","label":"Hindu"},{"value":"muslim","label":"Muslim"},
                        {"value":"christian","label":"Christian"},{"value":"other","label":"Other"}]},
        ]
    },{
        "id": "s3", "title": "3. Economic Profile",
        "fields": [
            {"id":"hh_size","type":"number","name":"hh_size","label":"Total Household Members","required":True,"min":1,"max":20},
            {"id":"monthly_income","type":"number","name":"monthly_income","label":"Monthly Household Income (₹)","min":0,"max":500000},
            {"id":"primary_occupation","type":"single_choice","name":"primary_occupation","label":"Primary Occupation",
             "options":[{"value":"agriculture","label":"Agriculture"},{"value":"labour","label":"Daily Labour"},
                        {"value":"business","label":"Business"},{"value":"govt_job","label":"Govt Job"},
                        {"value":"private_job","label":"Private Job"},{"value":"other","label":"Other"}]},
            {"id":"ration_card","type":"single_choice","name":"ration_card","label":"Ration Card Type",
             "options":[{"value":"aay","label":"AAY (Yellow)"},{"value":"bpl","label":"BPL (Red)"},
                        {"value":"apl","label":"APL (White)"},{"value":"none","label":"No Card"}]},
            {"id":"bank_account","type":"single_choice","name":"bank_account","label":"Bank Account",
             "options":[{"value":"yes","label":"Yes"},{"value":"no","label":"No"}]},
        ]
    },{
        "id": "s4", "title": "4. Housing & Assets",
        "fields": [
            {"id":"house_type","type":"single_choice","name":"house_type","label":"House Type",
             "options":[{"value":"pucca","label":"Pucca"},{"value":"semi_pucca","label":"Semi-Pucca"},{"value":"kutcha","label":"Kutcha"}]},
            {"id":"electricity","type":"single_choice","name":"electricity","label":"Electricity Connection",
             "options":[{"value":"yes","label":"Yes"},{"value":"no","label":"No"}]},
            {"id":"owns_smartphone","type":"single_choice","name":"owns_smartphone","label":"Smartphone Ownership",
             "options":[{"value":"yes","label":"Yes"},{"value":"no","label":"No"}]},
            {"id":"remarks","type":"text","name":"remarks","label":"Enumerator Remarks"},
        ]
    }]
}

SECC_SCHEMA = {
    "title": "SECC Household Listing Form",
    "version": 1,
    "sections": [{
        "id": "s1", "title": "1. Location",
        "fields": [
            {"id":"state","type":"text","name":"state","label":"State","required":True},
            {"id":"district","type":"text","name":"district","label":"District","required":True},
            {"id":"gram_panchayat","type":"text","name":"gram_panchayat","label":"Gram Panchayat","required":True},
            {"id":"village","type":"text","name":"village","label":"Village","required":True},
            {"id":"gps","type":"gps","name":"gps","label":"GPS Coordinates"},
        ]
    },{
        "id": "s2", "title": "2. Household Head",
        "fields": [
            {"id":"head_name","type":"text","name":"head_name","label":"Name of Household Head","required":True},
            {"id":"head_age","type":"number","name":"head_age","label":"Age","required":True,"min":18,"max":110},
            {"id":"head_gender","type":"single_choice","name":"head_gender","label":"Gender",
             "options":[{"value":"male","label":"Male"},{"value":"female","label":"Female"}]},
            {"id":"head_edu","type":"single_choice","name":"head_edu","label":"Education Level",
             "options":[{"value":"illiterate","label":"Illiterate"},{"value":"primary","label":"Primary"},
                        {"value":"secondary","label":"Secondary"},{"value":"graduate","label":"Graduate+"}]},
        ]
    },{
        "id": "s3", "title": "3. Deprivation Indicators",
        "fields": [
            {"id":"no_shelter","type":"single_choice","name":"no_shelter","label":"Houseless?",
             "options":[{"value":"yes","label":"Yes"},{"value":"no","label":"No"}]},
            {"id":"child_labour","type":"single_choice","name":"child_labour","label":"Child aged 5-14 as primary earner?",
             "options":[{"value":"yes","label":"Yes"},{"value":"no","label":"No"}]},
            {"id":"female_headed_no_adult_male","type":"single_choice","name":"female_headed_no_adult_male",
             "label":"Female-headed HH with no adult male member?",
             "options":[{"value":"yes","label":"Yes"},{"value":"no","label":"No"}]},
            {"id":"disabled_member","type":"single_choice","name":"disabled_member","label":"Disabled member with no earning adult?",
             "options":[{"value":"yes","label":"Yes"},{"value":"no","label":"No"}]},
            {"id":"manual_scavenger","type":"single_choice","name":"manual_scavenger","label":"Manual scavenging household?",
             "options":[{"value":"yes","label":"Yes"},{"value":"no","label":"No"}]},
        ]
    },{
        "id": "s4", "title": "4. Additional Info",
        "fields": [
            {"id":"total_members","type":"number","name":"total_members","label":"Total Family Members","min":1,"max":25},
            {"id":"land_owned_acres","type":"decimal","name":"land_owned_acres","label":"Agricultural Land (acres)"},
            {"id":"has_govt_employee","type":"single_choice","name":"has_govt_employee","label":"Any Govt Employee in HH?",
             "options":[{"value":"yes","label":"Yes"},{"value":"no","label":"No"}]},
            {"id":"enumerator_obs","type":"text","name":"enumerator_obs","label":"Observation"},
        ]
    }]
}

def hh_data(district):
    return {
        "hh_id": f"HH-{rand_int(1000,9999)}", "village": pick(*VILLAGES), "district": district,
        "resp_name": pick(*NAMES), "resp_age": rand_int(25, 70),
        "resp_gender": pick("male","female"), "caste": pick("general","obc","sc","st"),
        "religion": pick("hindu","muslim","hindu","hindu"),
        "hh_size": rand_int(2, 8), "monthly_income": rand_int(3000, 25000),
        "primary_occupation": pick("agriculture","labour","business","govt_job","private_job"),
        "ration_card": pick("aay","bpl","apl","none"), "bank_account": pick("yes","yes","no"),
        "house_type": pick("pucca","semi_pucca","kutcha"), "electricity": pick("yes","yes","no"),
        "owns_smartphone": pick("yes","no"), "remarks": "",
    }

def secc_data(district):
    return {
        "state": "Telangana", "district": district,
        "gram_panchayat": f"{pick(*VILLAGES)} GP", "village": pick(*VILLAGES),
        "head_name": pick(*NAMES), "head_age": rand_int(25, 75),
        "head_gender": pick("male","female"), "head_edu": pick("illiterate","primary","secondary","graduate"),
        "no_shelter": pick("no","no","no","yes"), "child_labour": pick("no","no","no","yes"),
        "female_headed_no_adult_male": pick("no","no","yes"),
        "disabled_member": pick("no","no","yes"), "manual_scavenger": pick("no","no","no","yes"),
        "total_members": rand_int(2, 9), "land_owned_acres": round(random.uniform(0, 5), 2),
        "has_govt_employee": pick("no","no","yes"), "enumerator_obs": "",
    }

# ═══════════════════════════════════════════════════════════════════════════════
# SECTOR 2 — HEALTH / WASH / NUTRITION
# ═══════════════════════════════════════════════════════════════════════════════

WASH_SCHEMA = {
    "title": "Jal Jeevan Mission WASH Household Survey",
    "version": 1,
    "sections": [{
        "id": "s1", "title": "1. Identification",
        "fields": [
            {"id":"village","type":"text","name":"village","label":"Village","required":True},
            {"id":"district","type":"text","name":"district","label":"District","required":True},
            {"id":"gps","type":"gps","name":"gps","label":"GPS"},
            {"id":"respondent_name","type":"text","name":"respondent_name","label":"Respondent Name","required":True},
            {"id":"respondent_age","type":"number","name":"respondent_age","label":"Age","min":18,"max":99},
            {"id":"respondent_gender","type":"single_choice","name":"respondent_gender","label":"Gender",
             "options":[{"value":"male","label":"Male"},{"value":"female","label":"Female"}]},
        ]
    },{
        "id": "s2", "title": "2. Water Access",
        "fields": [
            {"id":"tap_connection","type":"single_choice","name":"tap_connection","label":"Tap Water Connection at Home?",
             "options":[{"value":"yes","label":"Yes"},{"value":"no","label":"No"}]},
            {"id":"primary_water_src","type":"single_choice","name":"primary_water_src","label":"Primary Water Source",
             "options":[{"value":"tap_piped","label":"Tap (Piped)"},{"value":"borewell","label":"Borewell/Handpump"},
                        {"value":"open_well","label":"Open Well"},{"value":"pond","label":"Pond/River"},{"value":"tanker","label":"Tanker"}]},
            {"id":"water_distance_mins","type":"number","name":"water_distance_mins","label":"Time to fetch water (minutes)","min":0,"max":180},
            {"id":"water_hours_per_day","type":"number","name":"water_hours_per_day","label":"Hours of water supply per day","min":0,"max":24},
            {"id":"water_quality_ok","type":"single_choice","name":"water_quality_ok","label":"Is water quality satisfactory?",
             "options":[{"value":"yes","label":"Yes"},{"value":"no","label":"No"},{"value":"unsure","label":"Not Sure"}]},
        ]
    },{
        "id": "s3", "title": "3. Sanitation",
        "fields": [
            {"id":"toilet_type","type":"single_choice","name":"toilet_type","label":"Toilet Type",
             "options":[{"value":"individual","label":"Individual (Private)"},{"value":"community","label":"Community"},
                        {"value":"open","label":"Open Defecation"}]},
            {"id":"toilet_usable","type":"single_choice","name":"toilet_usable","label":"Is toilet functional?",
             "options":[{"value":"yes","label":"Yes"},{"value":"no","label":"No"},{"value":"na","label":"N/A"}]},
            {"id":"handwash_facility","type":"single_choice","name":"handwash_facility","label":"Handwashing facility present?",
             "options":[{"value":"yes_soap","label":"Yes, with soap"},{"value":"yes_no_soap","label":"Yes, no soap"},{"value":"no","label":"No"}]},
            {"id":"solid_waste_disposal","type":"single_choice","name":"solid_waste_disposal","label":"Solid waste disposal",
             "options":[{"value":"municipal","label":"Municipal Collection"},{"value":"burning","label":"Burning"},
                        {"value":"dumping","label":"Open Dumping"},{"value":"composting","label":"Composting"}]},
        ]
    },{
        "id": "s4", "title": "4. Health Outcomes",
        "fields": [
            {"id":"diarrhoea_last_month","type":"single_choice","name":"diarrhoea_last_month","label":"Diarrhoea in HH last month?",
             "options":[{"value":"yes","label":"Yes"},{"value":"no","label":"No"}]},
            {"id":"children_under5","type":"number","name":"children_under5","label":"Children under 5 in household","min":0,"max":10},
            {"id":"remarks","type":"text","name":"remarks","label":"Remarks"},
        ]
    }]
}

NUTRITION_SCHEMA = {
    "title": "PM-POSHAN Nutrition & Health Assessment",
    "version": 1,
    "sections": [{
        "id": "s1", "title": "1. Location & Respondent",
        "fields": [
            {"id":"district","type":"text","name":"district","label":"District","required":True},
            {"id":"village","type":"text","name":"village","label":"Village","required":True},
            {"id":"gps","type":"gps","name":"gps","label":"GPS"},
            {"id":"mother_name","type":"text","name":"mother_name","label":"Mother's Name","required":True},
            {"id":"mother_age","type":"number","name":"mother_age","label":"Mother's Age","min":15,"max":50},
        ]
    },{
        "id": "s2", "title": "2. Child Information",
        "fields": [
            {"id":"child_name","type":"text","name":"child_name","label":"Child Name","required":True},
            {"id":"child_age_months","type":"number","name":"child_age_months","label":"Child Age (months)","min":0,"max":72},
            {"id":"child_gender","type":"single_choice","name":"child_gender","label":"Child Gender",
             "options":[{"value":"male","label":"Male"},{"value":"female","label":"Female"}]},
            {"id":"child_weight_kg","type":"decimal","name":"child_weight_kg","label":"Weight (kg)","min":1,"max":30},
            {"id":"child_height_cm","type":"decimal","name":"child_height_cm","label":"Height (cm)","min":40,"max":130},
        ]
    },{
        "id": "s3", "title": "3. Nutrition Status",
        "fields": [
            {"id":"wasting_status","type":"single_choice","name":"wasting_status","label":"Wasting Status (WHZ)",
             "options":[{"value":"sam","label":"SAM (<-3)"},{"value":"mam","label":"MAM (-3 to -2)"},
                        {"value":"normal","label":"Normal (≥-2)"}]},
            {"id":"stunting_status","type":"single_choice","name":"stunting_status","label":"Stunting Status (HAZ)",
             "options":[{"value":"severe","label":"Severely Stunted"},{"value":"moderate","label":"Moderately Stunted"},{"value":"normal","label":"Normal"}]},
            {"id":"exclusive_bf","type":"single_choice","name":"exclusive_bf","label":"Exclusive breastfeeding (0-6m)?",
             "options":[{"value":"yes","label":"Yes"},{"value":"no","label":"No"},{"value":"na","label":"N/A"}]},
            {"id":"complementary_feeding","type":"single_choice","name":"complementary_feeding","label":"Timely complementary feeding?",
             "options":[{"value":"yes","label":"Yes"},{"value":"no","label":"No"},{"value":"na","label":"N/A"}]},
            {"id":"anganwadi_enrolled","type":"single_choice","name":"anganwadi_enrolled","label":"Enrolled in Anganwadi?",
             "options":[{"value":"yes","label":"Yes"},{"value":"no","label":"No"}]},
        ]
    },{
        "id": "s4", "title": "4. Programme Tracking",
        "fields": [
            {"id":"received_thsr","type":"single_choice","name":"received_thsr","label":"Received THR/Supplement last month?",
             "options":[{"value":"yes","label":"Yes"},{"value":"no","label":"No"}]},
            {"id":"vaccination_complete","type":"single_choice","name":"vaccination_complete","label":"Vaccination up to date?",
             "options":[{"value":"yes","label":"Yes"},{"value":"partial","label":"Partial"},{"value":"no","label":"No"}]},
            {"id":"remarks","type":"text","name":"remarks","label":"Remarks"},
        ]
    }]
}

def wash_data(district):
    return {
        "village": pick(*VILLAGES), "district": district,
        "respondent_name": pick(*NAMES), "respondent_age": rand_int(20, 65),
        "respondent_gender": pick("male","female"),
        "tap_connection": pick("yes","yes","no"),
        "primary_water_src": pick("tap_piped","borewell","open_well","tanker"),
        "water_distance_mins": rand_int(0, 45),
        "water_hours_per_day": rand_int(1, 12),
        "water_quality_ok": pick("yes","yes","no","unsure"),
        "toilet_type": pick("individual","individual","community","open"),
        "toilet_usable": pick("yes","yes","no"),
        "handwash_facility": pick("yes_soap","yes_no_soap","no"),
        "solid_waste_disposal": pick("municipal","burning","dumping","composting"),
        "diarrhoea_last_month": pick("no","no","yes"),
        "children_under5": rand_int(0, 3), "remarks": "",
    }

def nutrition_data(district):
    age_m = rand_int(6, 60)
    wt = round(random.uniform(6, 18), 1)
    ht = round(random.uniform(60, 110), 1)
    return {
        "district": district, "village": pick(*VILLAGES),
        "mother_name": pick(*NAMES), "mother_age": rand_int(20, 38),
        "child_name": pick(*NAMES), "child_age_months": age_m,
        "child_gender": pick("male","female"),
        "child_weight_kg": wt, "child_height_cm": ht,
        "wasting_status": pick("normal","normal","mam","sam"),
        "stunting_status": pick("normal","moderate","severe","normal","normal"),
        "exclusive_bf": pick("yes","yes","no","na"),
        "complementary_feeding": pick("yes","yes","no"),
        "anganwadi_enrolled": pick("yes","yes","no"),
        "received_thsr": pick("yes","yes","no"),
        "vaccination_complete": pick("yes","partial","no","yes"),
        "remarks": "",
    }

# ═══════════════════════════════════════════════════════════════════════════════
# SECTOR 3 — AGRICULTURAL / LIVELIHOOD
# ═══════════════════════════════════════════════════════════════════════════════

AGRI_SCHEMA = {
    "title": "PM-KISAN Farmer Baseline Survey",
    "version": 1,
    "sections": [{
        "id": "s1", "title": "1. Farmer Identification",
        "fields": [
            {"id":"farmer_name","type":"text","name":"farmer_name","label":"Farmer Name","required":True},
            {"id":"village","type":"text","name":"village","label":"Village","required":True},
            {"id":"district","type":"text","name":"district","label":"District","required":True},
            {"id":"gps","type":"gps","name":"gps","label":"Farm GPS Location"},
            {"id":"aadhar_no","type":"text","name":"aadhar_no","label":"Aadhaar No. (Last 4 digits)"},
        ]
    },{
        "id": "s2", "title": "2. Farm Profile",
        "fields": [
            {"id":"age","type":"number","name":"age","label":"Age","min":18,"max":99},
            {"id":"gender","type":"single_choice","name":"gender","label":"Gender",
             "options":[{"value":"male","label":"Male"},{"value":"female","label":"Female"}]},
            {"id":"land_acres","type":"decimal","name":"land_acres","label":"Total Land Holding (acres)","min":0.1},
            {"id":"land_type","type":"single_choice","name":"land_type","label":"Land Type",
             "options":[{"value":"irrigated","label":"Irrigated"},{"value":"rainfed","label":"Rain-fed"},{"value":"both","label":"Both"}]},
            {"id":"primary_crop","type":"single_choice","name":"primary_crop","label":"Primary Crop",
             "options":[{"value":"paddy","label":"Paddy/Rice"},{"value":"wheat","label":"Wheat"},
                        {"value":"cotton","label":"Cotton"},{"value":"sugarcane","label":"Sugarcane"},
                        {"value":"maize","label":"Maize"},{"value":"soybean","label":"Soybean"},{"value":"other","label":"Other"}]},
        ]
    },{
        "id": "s3", "title": "3. PM-KISAN Status",
        "fields": [
            {"id":"pmkisan_registered","type":"single_choice","name":"pmkisan_registered","label":"Registered in PM-KISAN?",
             "options":[{"value":"yes","label":"Yes"},{"value":"no","label":"No"},{"value":"pending","label":"Pending"}]},
            {"id":"instalments_received","type":"number","name":"instalments_received","label":"No. of Instalments Received","min":0,"max":20},
            {"id":"amount_per_instalment","type":"number","name":"amount_per_instalment","label":"Amount per Instalment (₹)"},
            {"id":"bank_linked","type":"single_choice","name":"bank_linked","label":"Bank Account Linked?",
             "options":[{"value":"yes","label":"Yes"},{"value":"no","label":"No"}]},
        ]
    },{
        "id": "s4", "title": "4. Livelihood",
        "fields": [
            {"id":"annual_farm_income","type":"number","name":"annual_farm_income","label":"Annual Farm Income (₹)"},
            {"id":"non_farm_income","type":"number","name":"non_farm_income","label":"Non-Farm Income (₹/year)"},
            {"id":"crop_loss_last_yr","type":"single_choice","name":"crop_loss_last_yr","label":"Crop Loss Last Year?",
             "options":[{"value":"yes","label":"Yes"},{"value":"no","label":"No"}]},
            {"id":"loan_kcc","type":"single_choice","name":"loan_kcc","label":"Has Kisan Credit Card?",
             "options":[{"value":"yes","label":"Yes"},{"value":"no","label":"No"}]},
            {"id":"remarks","type":"text","name":"remarks","label":"Remarks"},
        ]
    }]
}

NRLM_SCHEMA = {
    "title": "NRLM Self Help Group Member Survey",
    "version": 1,
    "sections": [{
        "id": "s1", "title": "1. SHG & Member Identification",
        "fields": [
            {"id":"shg_name","type":"text","name":"shg_name","label":"SHG Name","required":True},
            {"id":"shg_id","type":"text","name":"shg_id","label":"SHG ID / Registration No."},
            {"id":"village","type":"text","name":"village","label":"Village","required":True},
            {"id":"district","type":"text","name":"district","label":"District","required":True},
            {"id":"gps","type":"gps","name":"gps","label":"GPS"},
            {"id":"member_name","type":"text","name":"member_name","label":"Member Name","required":True},
            {"id":"member_age","type":"number","name":"member_age","label":"Age","min":18,"max":70},
        ]
    },{
        "id": "s2", "title": "2. SHG Participation",
        "fields": [
            {"id":"years_in_shg","type":"number","name":"years_in_shg","label":"Years as SHG Member","min":0,"max":25},
            {"id":"meeting_attendance","type":"single_choice","name":"meeting_attendance","label":"Meeting Attendance",
             "options":[{"value":"always","label":"Always (>90%)"},{"value":"mostly","label":"Mostly (60-90%)"},{"value":"sometimes","label":"Sometimes (<60%)"}]},
            {"id":"current_savings","type":"number","name":"current_savings","label":"Total Savings in SHG (₹)"},
            {"id":"loan_taken","type":"single_choice","name":"loan_taken","label":"Loan from SHG?",
             "options":[{"value":"yes","label":"Yes"},{"value":"no","label":"No"}]},
            {"id":"loan_amount","type":"number","name":"loan_amount","label":"Loan Amount (₹) — if yes"},
        ]
    },{
        "id": "s3", "title": "3. Livelihood & Income",
        "fields": [
            {"id":"livelihood_activity","type":"single_choice","name":"livelihood_activity","label":"Primary Livelihood",
             "options":[{"value":"agriculture","label":"Agriculture"},{"value":"animal_husbandry","label":"Animal Husbandry"},
                        {"value":"micro_enterprise","label":"Micro Enterprise"},{"value":"wage_labour","label":"Wage Labour"},
                        {"value":"tailoring","label":"Tailoring / Handicrafts"},{"value":"other","label":"Other"}]},
            {"id":"monthly_income_before","type":"number","name":"monthly_income_before","label":"Monthly Income BEFORE joining SHG (₹)"},
            {"id":"monthly_income_now","type":"number","name":"monthly_income_now","label":"Monthly Income NOW (₹)"},
            {"id":"shg_helped_income","type":"single_choice","name":"shg_helped_income","label":"Has SHG helped increase income?",
             "options":[{"value":"yes","label":"Yes"},{"value":"no","label":"No"},{"value":"unsure","label":"Not Sure"}]},
        ]
    },{
        "id": "s4", "title": "4. Empowerment",
        "fields": [
            {"id":"financial_decisions","type":"single_choice","name":"financial_decisions","label":"Who makes financial decisions?",
             "options":[{"value":"self","label":"Self"},{"value":"husband","label":"Husband"},{"value":"jointly","label":"Jointly"},{"value":"family","label":"Family"}]},
            {"id":"govt_scheme_awareness","type":"single_choice","name":"govt_scheme_awareness","label":"Aware of 3+ govt schemes?",
             "options":[{"value":"yes","label":"Yes"},{"value":"no","label":"No"}]},
            {"id":"remarks","type":"text","name":"remarks","label":"Remarks"},
        ]
    }]
}

def agri_data(district):
    return {
        "farmer_name": pick(*NAMES), "village": pick(*VILLAGES), "district": district,
        "aadhar_no": str(rand_int(1000, 9999)),
        "age": rand_int(25, 70), "gender": pick("male","male","female"),
        "land_acres": round(random.uniform(0.5, 10), 2),
        "land_type": pick("irrigated","rainfed","both"),
        "primary_crop": pick("paddy","wheat","cotton","sugarcane","maize","soybean"),
        "pmkisan_registered": pick("yes","yes","no","pending"),
        "instalments_received": rand_int(0, 12), "amount_per_instalment": 2000,
        "bank_linked": pick("yes","yes","no"),
        "annual_farm_income": rand_int(30000, 200000),
        "non_farm_income": rand_int(0, 60000),
        "crop_loss_last_yr": pick("no","no","yes"),
        "loan_kcc": pick("yes","no"), "remarks": "",
    }

def nrlm_data(district):
    before = rand_int(2000, 8000)
    return {
        "shg_name": f"{pick(*VILLAGES)} Mahila SHG", "shg_id": f"SHG-{rand_int(100,999)}",
        "village": pick(*VILLAGES), "district": district,
        "member_name": pick(*NAMES), "member_age": rand_int(20, 55),
        "years_in_shg": rand_int(1, 10),
        "meeting_attendance": pick("always","mostly","sometimes"),
        "current_savings": rand_int(1000, 30000),
        "loan_taken": pick("yes","yes","no"),
        "loan_amount": rand_int(5000, 50000) if random.random() > 0.4 else 0,
        "livelihood_activity": pick("agriculture","animal_husbandry","micro_enterprise","tailoring"),
        "monthly_income_before": before,
        "monthly_income_now": before + rand_int(500, 5000),
        "shg_helped_income": pick("yes","yes","yes","no"),
        "financial_decisions": pick("self","jointly","husband"),
        "govt_scheme_awareness": pick("yes","yes","no"),
        "remarks": "",
    }

# ═══════════════════════════════════════════════════════════════════════════════
# SECTOR 4 — GOVERNMENT PROGRAM MONITORING
# ═══════════════════════════════════════════════════════════════════════════════

PMAY_SCHEMA = {
    "title": "PMAY Beneficiary Verification Survey",
    "version": 1,
    "sections": [{
        "id": "s1", "title": "1. Beneficiary Details",
        "fields": [
            {"id":"beneficiary_name","type":"text","name":"beneficiary_name","label":"Beneficiary Name","required":True},
            {"id":"application_id","type":"text","name":"application_id","label":"PMAY Application ID"},
            {"id":"village","type":"text","name":"village","label":"Village","required":True},
            {"id":"district","type":"text","name":"district","label":"District","required":True},
            {"id":"gps","type":"gps","name":"gps","label":"House GPS Location"},
        ]
    },{
        "id": "s2", "title": "2. Housing Status",
        "fields": [
            {"id":"current_house_status","type":"single_choice","name":"current_house_status","label":"Current House Status",
             "options":[{"value":"completed","label":"Completed"},{"value":"in_progress","label":"In Progress"},
                        {"value":"foundation","label":"Foundation Laid"},{"value":"not_started","label":"Not Started"}]},
            {"id":"construction_pct","type":"number","name":"construction_pct","label":"% Construction Complete","min":0,"max":100},
            {"id":"amount_received","type":"number","name":"amount_received","label":"Total Amount Received (₹)"},
            {"id":"instalments_received","type":"number","name":"instalments_received","label":"No. of Instalments Received","min":0,"max":3},
            {"id":"amount_utilised","type":"number","name":"amount_utilised","label":"Amount Utilised (₹)"},
        ]
    },{
        "id": "s3", "title": "3. Issues & Satisfaction",
        "fields": [
            {"id":"issues_faced","type":"multiple_choice","name":"issues_faced","label":"Issues Faced",
             "options":[{"value":"delay_payment","label":"Delay in Payment"},{"value":"material_cost","label":"High Material Cost"},
                        {"value":"labour","label":"Labour Shortage"},{"value":"land_dispute","label":"Land Dispute"},{"value":"none","label":"None"}]},
            {"id":"satisfied","type":"single_choice","name":"satisfied","label":"Overall Satisfaction",
             "options":[{"value":"very_satisfied","label":"Very Satisfied"},{"value":"satisfied","label":"Satisfied"},
                        {"value":"neutral","label":"Neutral"},{"value":"dissatisfied","label":"Dissatisfied"}]},
            {"id":"toilet_constructed","type":"single_choice","name":"toilet_constructed","label":"Toilet Constructed (as part of PMAY)?",
             "options":[{"value":"yes","label":"Yes"},{"value":"no","label":"No"}]},
            {"id":"remarks","type":"text","name":"remarks","label":"Enumerator Remarks"},
        ]
    }]
}

MGNREGA_SCHEMA = {
    "title": "MGNREGA Job Card Verification & Work Survey",
    "version": 1,
    "sections": [{
        "id": "s1", "title": "1. Household & Job Card",
        "fields": [
            {"id":"hh_head_name","type":"text","name":"hh_head_name","label":"HH Head Name","required":True},
            {"id":"job_card_no","type":"text","name":"job_card_no","label":"Job Card Number"},
            {"id":"village","type":"text","name":"village","label":"Village","required":True},
            {"id":"district","type":"text","name":"district","label":"District","required":True},
            {"id":"gps","type":"gps","name":"gps","label":"GPS"},
        ]
    },{
        "id": "s2", "title": "2. Work Demand & Allotment",
        "fields": [
            {"id":"demanded_work_days","type":"number","name":"demanded_work_days","label":"Work Days Demanded (this year)","min":0,"max":365},
            {"id":"allotted_work_days","type":"number","name":"allotted_work_days","label":"Work Days Allotted","min":0,"max":365},
            {"id":"worked_days","type":"number","name":"worked_days","label":"Actual Days Worked","min":0,"max":365},
            {"id":"work_type","type":"single_choice","name":"work_type","label":"Type of Work",
             "options":[{"value":"road","label":"Road Construction"},{"value":"water_conservation","label":"Water Conservation"},
                        {"value":"watershed","label":"Watershed Dev"},{"value":"plantation","label":"Plantation"},{"value":"other","label":"Other"}]},
        ]
    },{
        "id": "s3", "title": "3. Payment",
        "fields": [
            {"id":"wage_rate","type":"number","name":"wage_rate","label":"Daily Wage Rate (₹)"},
            {"id":"payment_received_on_time","type":"single_choice","name":"payment_received_on_time","label":"Payment on Time?",
             "options":[{"value":"yes","label":"Yes"},{"value":"no","label":"No"},{"value":"partial","label":"Partially"}]},
            {"id":"total_wages_received","type":"number","name":"total_wages_received","label":"Total Wages Received (₹)"},
            {"id":"payment_mode","type":"single_choice","name":"payment_mode","label":"Payment Mode",
             "options":[{"value":"bank","label":"Bank Account"},{"value":"post_office","label":"Post Office"},{"value":"cash","label":"Cash"}]},
        ]
    },{
        "id": "s4", "title": "4. Quality & Issues",
        "fields": [
            {"id":"measurement_done","type":"single_choice","name":"measurement_done","label":"Work Measurement Done?",
             "options":[{"value":"yes","label":"Yes"},{"value":"no","label":"No"}]},
            {"id":"mate_present","type":"single_choice","name":"mate_present","label":"Mate (Supervisor) Present at Worksite?",
             "options":[{"value":"yes","label":"Yes"},{"value":"no","label":"No"}]},
            {"id":"issues","type":"text","name":"issues","label":"Issues if any"},
            {"id":"remarks","type":"text","name":"remarks","label":"Enumerator Remarks"},
        ]
    }]
}

def pmay_data(district):
    pct = rand_int(0, 100)
    amt = rand_int(0, 120000)
    return {
        "beneficiary_name": pick(*NAMES), "application_id": f"PMAY-{rand_int(10000,99999)}",
        "village": pick(*VILLAGES), "district": district,
        "current_house_status": pick("completed","in_progress","foundation","not_started"),
        "construction_pct": pct, "amount_received": amt,
        "instalments_received": rand_int(0, 3), "amount_utilised": int(amt * random.uniform(0.6, 1.0)),
        "issues_faced": [pick("delay_payment","material_cost","labour","none")],
        "satisfied": pick("very_satisfied","satisfied","neutral","dissatisfied"),
        "toilet_constructed": pick("yes","yes","no"),
        "remarks": "",
    }

def mgnrega_data(district):
    demanded = rand_int(30, 100)
    allotted = rand_int(20, demanded)
    worked = rand_int(10, allotted)
    wage = pick(215, 220, 228, 235, 250)
    return {
        "hh_head_name": pick(*NAMES), "job_card_no": f"JC-{rand_int(10000,99999)}",
        "village": pick(*VILLAGES), "district": district,
        "demanded_work_days": demanded, "allotted_work_days": allotted, "worked_days": worked,
        "work_type": pick("road","water_conservation","watershed","plantation","other"),
        "wage_rate": wage, "total_wages_received": worked * wage,
        "payment_received_on_time": pick("yes","yes","no","partial"),
        "payment_mode": pick("bank","bank","post_office"),
        "measurement_done": pick("yes","yes","no"),
        "mate_present": pick("yes","yes","no"),
        "issues": "", "remarks": "",
    }

# ═══════════════════════════════════════════════════════════════════════════════
# SECTOR 5 — RCT BASELINE / ENDLINE
# ═══════════════════════════════════════════════════════════════════════════════

RCT_BASELINE_SCHEMA = {
    "title": "Karnataka Nutrition RCT — Baseline Survey",
    "version": 1,
    "sections": [{
        "id": "s1", "title": "1. Study Identification",
        "fields": [
            {"id":"study_id","type":"text","name":"study_id","label":"Study Participant ID","required":True},
            {"id":"cluster_id","type":"text","name":"cluster_id","label":"Cluster / Village ID","required":True},
            {"id":"treatment_arm","type":"single_choice","name":"treatment_arm","label":"Treatment Arm",
             "options":[{"value":"treatment","label":"Treatment"},{"value":"control","label":"Control"}]},
            {"id":"village","type":"text","name":"village","label":"Village","required":True},
            {"id":"district","type":"text","name":"district","label":"District","required":True},
            {"id":"gps","type":"gps","name":"gps","label":"GPS"},
        ]
    },{
        "id": "s2", "title": "2. Household Profile",
        "fields": [
            {"id":"head_name","type":"text","name":"head_name","label":"Household Head Name","required":True},
            {"id":"head_age","type":"number","name":"head_age","label":"Age of Head","min":18,"max":90},
            {"id":"hh_size","type":"number","name":"hh_size","label":"Household Size","min":1,"max":20},
            {"id":"monthly_income","type":"number","name":"monthly_income","label":"Monthly Household Income (₹)"},
            {"id":"years_education","type":"number","name":"years_education","label":"Years of Education (Head)","min":0,"max":20},
            {"id":"caste","type":"single_choice","name":"caste","label":"Social Category",
             "options":[{"value":"sc","label":"SC"},{"value":"st","label":"ST"},{"value":"obc","label":"OBC"},{"value":"general","label":"General"}]},
        ]
    },{
        "id": "s3", "title": "3. Nutrition Baseline",
        "fields": [
            {"id":"food_security_score","type":"number","name":"food_security_score","label":"Food Security Score (0-12 HFIAS)","min":0,"max":12},
            {"id":"dietary_diversity_score","type":"number","name":"dietary_diversity_score","label":"HH Dietary Diversity Score (0-12)","min":0,"max":12},
            {"id":"anemia_hb","type":"decimal","name":"anemia_hb","label":"Haemoglobin level (g/dL)","min":3,"max":18},
            {"id":"bmi_category","type":"single_choice","name":"bmi_category","label":"BMI Category (respondent)",
             "options":[{"value":"underweight","label":"Underweight (<18.5)"},{"value":"normal","label":"Normal (18.5-24.9)"},
                        {"value":"overweight","label":"Overweight (25+)"}]},
        ]
    },{
        "id": "s4", "title": "4. Access & Utilisation",
        "fields": [
            {"id":"access_healthcare","type":"single_choice","name":"access_healthcare","label":"Access to healthcare within 5km?",
             "options":[{"value":"yes","label":"Yes"},{"value":"no","label":"No"}]},
            {"id":"access_anganwadi","type":"single_choice","name":"access_anganwadi","label":"Access to Anganwadi?",
             "options":[{"value":"yes","label":"Yes"},{"value":"no","label":"No"}]},
            {"id":"social_capital_score","type":"number","name":"social_capital_score","label":"Social Capital Score (0-10)","min":0,"max":10},
            {"id":"remarks","type":"text","name":"remarks","label":"Remarks"},
        ]
    }]
}

RCT_ENDLINE_SCHEMA = {
    "title": "UP Education RCT — Endline Survey",
    "version": 1,
    "sections": [{
        "id": "s1", "title": "1. Study ID",
        "fields": [
            {"id":"study_id","type":"text","name":"study_id","label":"Study Participant ID","required":True},
            {"id":"treatment_arm","type":"single_choice","name":"treatment_arm","label":"Treatment Arm",
             "options":[{"value":"treatment","label":"Treatment"},{"value":"control","label":"Control"}]},
            {"id":"village","type":"text","name":"village","label":"Village"},
            {"id":"district","type":"text","name":"district","label":"District","required":True},
            {"id":"gps","type":"gps","name":"gps","label":"GPS"},
        ]
    },{
        "id": "s2", "title": "2. Endline Outcomes",
        "fields": [
            {"id":"reading_score","type":"number","name":"reading_score","label":"Reading Test Score (0-100)","min":0,"max":100},
            {"id":"math_score","type":"number","name":"math_score","label":"Math Test Score (0-100)","min":0,"max":100},
            {"id":"school_enrollment","type":"single_choice","name":"school_enrollment","label":"Currently Enrolled in School?",
             "options":[{"value":"yes","label":"Yes"},{"value":"no","label":"No"}]},
            {"id":"attendance_pct","type":"number","name":"attendance_pct","label":"Attendance % (last term)","min":0,"max":100},
            {"id":"completed_grade","type":"number","name":"completed_grade","label":"Grade Completed","min":1,"max":12},
        ]
    },{
        "id": "s3", "title": "3. Household Factors",
        "fields": [
            {"id":"parent_edu_years","type":"number","name":"parent_edu_years","label":"Father's Education (years)","min":0,"max":20},
            {"id":"mother_edu_years","type":"number","name":"mother_edu_years","label":"Mother's Education (years)","min":0,"max":20},
            {"id":"hh_income_change","type":"single_choice","name":"hh_income_change","label":"HH Income Change vs Baseline",
             "options":[{"value":"increased","label":"Increased"},{"value":"same","label":"Same"},{"value":"decreased","label":"Decreased"}]},
            {"id":"study_hours_per_day","type":"decimal","name":"study_hours_per_day","label":"Child Study Hours/Day","min":0,"max":12},
            {"id":"tuition","type":"single_choice","name":"tuition","label":"Private Tuition?",
             "options":[{"value":"yes","label":"Yes"},{"value":"no","label":"No"}]},
        ]
    },{
        "id": "s4", "title": "4. Programme Impact",
        "fields": [
            {"id":"program_benefited","type":"single_choice","name":"program_benefited","label":"Do you feel you benefited from the program?",
             "options":[{"value":"yes","label":"Yes"},{"value":"no","label":"No"},{"value":"unsure","label":"Unsure"}]},
            {"id":"remarks","type":"text","name":"remarks","label":"Remarks"},
        ]
    }]
}

def rct_baseline_data(district):
    return {
        "study_id": f"RCT-KA-{rand_int(1000,9999)}", "cluster_id": f"CL-{rand_int(10,99)}",
        "treatment_arm": pick("treatment","control"),
        "village": pick(*VILLAGES), "district": district,
        "head_name": pick(*NAMES), "head_age": rand_int(25, 65),
        "hh_size": rand_int(3, 7), "monthly_income": rand_int(4000, 20000),
        "years_education": rand_int(0, 12),
        "caste": pick("sc","st","obc","general"),
        "food_security_score": rand_int(0, 12),
        "dietary_diversity_score": rand_int(2, 10),
        "anemia_hb": round(random.uniform(7.0, 14.0), 1),
        "bmi_category": pick("underweight","normal","normal","overweight"),
        "access_healthcare": pick("yes","yes","no"),
        "access_anganwadi": pick("yes","yes","no"),
        "social_capital_score": rand_int(2, 10), "remarks": "",
    }

def rct_endline_data(district):
    arm = pick("treatment","control")
    boost = 15 if arm == "treatment" else 0
    return {
        "study_id": f"RCT-UP-{rand_int(1000,9999)}",
        "treatment_arm": arm,
        "village": pick(*VILLAGES), "district": district,
        "reading_score": min(100, rand_int(30, 70) + boost),
        "math_score": min(100, rand_int(25, 65) + boost),
        "school_enrollment": pick("yes","yes","yes","no"),
        "attendance_pct": rand_int(50, 100),
        "completed_grade": rand_int(3, 10),
        "parent_edu_years": rand_int(0, 12),
        "mother_edu_years": rand_int(0, 10),
        "hh_income_change": pick("increased","same","decreased","same"),
        "study_hours_per_day": round(random.uniform(0.5, 4.0), 1),
        "tuition": pick("yes","no"),
        "program_benefited": pick("yes","yes","unsure","no"),
        "remarks": "",
    }

# ═══════════════════════════════════════════════════════════════════════════════
# SECTOR 6 — NGO M&E / IMPACT ASSESSMENT
# ═══════════════════════════════════════════════════════════════════════════════

NGO_EDUCATION_SCHEMA = {
    "title": "UNICEF Girl Education Initiative — M&E Survey",
    "version": 1,
    "sections": [{
        "id": "s1", "title": "1. Respondent & Location",
        "fields": [
            {"id":"mother_name","type":"text","name":"mother_name","label":"Mother/Guardian Name","required":True},
            {"id":"village","type":"text","name":"village","label":"Village","required":True},
            {"id":"district","type":"text","name":"district","label":"District","required":True},
            {"id":"gps","type":"gps","name":"gps","label":"GPS"},
            {"id":"months_in_program","type":"number","name":"months_in_program","label":"Months Enrolled in Program","min":0,"max":60},
        ]
    },{
        "id": "s2", "title": "2. Girl Child Education",
        "fields": [
            {"id":"girl_name","type":"text","name":"girl_name","label":"Girl's Name","required":True},
            {"id":"girl_age","type":"number","name":"girl_age","label":"Age","min":5,"max":18},
            {"id":"currently_enrolled","type":"single_choice","name":"currently_enrolled","label":"Currently Enrolled in School?",
             "options":[{"value":"yes","label":"Yes"},{"value":"no","label":"No"}]},
            {"id":"grade","type":"number","name":"grade","label":"Grade / Class","min":1,"max":12},
            {"id":"attendance_pct","type":"number","name":"attendance_pct","label":"Attendance %","min":0,"max":100},
            {"id":"dropout_risk","type":"single_choice","name":"dropout_risk","label":"Dropout Risk",
             "options":[{"value":"low","label":"Low"},{"value":"medium","label":"Medium"},{"value":"high","label":"High"}]},
        ]
    },{
        "id": "s3", "title": "3. Barriers & Support",
        "fields": [
            {"id":"barrier_type","type":"multiple_choice","name":"barrier_type","label":"Main Barriers to Education",
             "options":[{"value":"distance","label":"Distance to School"},{"value":"cost","label":"Cost/Fees"},
                        {"value":"safety","label":"Safety"},{"value":"child_marriage","label":"Early Marriage"},
                        {"value":"household_work","label":"Household Work"},{"value":"none","label":"No Barrier"}]},
            {"id":"scholarship_received","type":"single_choice","name":"scholarship_received","label":"Received Scholarship?",
             "options":[{"value":"yes","label":"Yes"},{"value":"no","label":"No"}]},
            {"id":"mentor_support","type":"single_choice","name":"mentor_support","label":"Has Mentor Support?",
             "options":[{"value":"yes","label":"Yes"},{"value":"no","label":"No"}]},
        ]
    },{
        "id": "s4", "title": "4. Impact",
        "fields": [
            {"id":"self_confidence_improved","type":"single_choice","name":"self_confidence_improved","label":"Self-Confidence Improved?",
             "options":[{"value":"yes","label":"Yes"},{"value":"no","label":"No"},{"value":"unsure","label":"Unsure"}]},
            {"id":"family_support_improved","type":"single_choice","name":"family_support_improved","label":"Family Support for Education Improved?",
             "options":[{"value":"yes","label":"Yes"},{"value":"no","label":"No"}]},
            {"id":"overall_satisfaction","type":"rating","name":"overall_satisfaction","label":"Overall Program Satisfaction (1-5)","min":1,"max":5},
            {"id":"remarks","type":"text","name":"remarks","label":"Remarks"},
        ]
    }]
}

NGO_WATER_SCHEMA = {
    "title": "World Vision Community Water Project — M&E Survey",
    "version": 1,
    "sections": [{
        "id": "s1", "title": "1. Household & Location",
        "fields": [
            {"id":"respondent_name","type":"text","name":"respondent_name","label":"Respondent Name","required":True},
            {"id":"village","type":"text","name":"village","label":"Village","required":True},
            {"id":"district","type":"text","name":"district","label":"District","required":True},
            {"id":"gps","type":"gps","name":"gps","label":"GPS"},
            {"id":"project_phase","type":"single_choice","name":"project_phase","label":"Project Phase",
             "options":[{"value":"phase1","label":"Phase 1 (2022-23)"},{"value":"phase2","label":"Phase 2 (2023-24)"},{"value":"phase3","label":"Phase 3 (2024-25)"}]},
        ]
    },{
        "id": "s2", "title": "2. Water Access (Post-Project)",
        "fields": [
            {"id":"water_access_improved","type":"single_choice","name":"water_access_improved","label":"Water Access Improved since project?",
             "options":[{"value":"yes","label":"Yes"},{"value":"no","label":"No"},{"value":"partial","label":"Partially"}]},
            {"id":"daily_water_litres","type":"number","name":"daily_water_litres","label":"Daily Water Available (litres/person)","min":1,"max":200},
            {"id":"collection_time_mins","type":"number","name":"collection_time_mins","label":"Collection Time (minutes) — now","min":0,"max":180},
            {"id":"water_quality_rating","type":"rating","name":"water_quality_rating","label":"Water Quality Rating (1-5)","min":1,"max":5},
        ]
    },{
        "id": "s3", "title": "3. Behaviour Change",
        "fields": [
            {"id":"handwash_practice","type":"single_choice","name":"handwash_practice","label":"Regular Handwashing Practice?",
             "options":[{"value":"always","label":"Always"},{"value":"mostly","label":"Mostly"},{"value":"sometimes","label":"Sometimes"},{"value":"rarely","label":"Rarely"}]},
            {"id":"water_treated","type":"single_choice","name":"water_treated","label":"Water Treated Before Drinking?",
             "options":[{"value":"always","label":"Always"},{"value":"sometimes","label":"Sometimes"},{"value":"never","label":"Never"}]},
            {"id":"children_diarrhoea_reduced","type":"single_choice","name":"children_diarrhoea_reduced","label":"Child Diarrhoea Reduced?",
             "options":[{"value":"yes","label":"Yes"},{"value":"no","label":"No"},{"value":"no_children","label":"No Children <5"}]},
        ]
    },{
        "id": "s4", "title": "4. Sustainability",
        "fields": [
            {"id":"water_committee_active","type":"single_choice","name":"water_committee_active","label":"Village Water Committee Active?",
             "options":[{"value":"yes","label":"Yes"},{"value":"no","label":"No"},{"value":"not_formed","label":"Not Formed"}]},
            {"id":"maintenance_fund","type":"single_choice","name":"maintenance_fund","label":"Maintenance Fund Collected?",
             "options":[{"value":"yes","label":"Yes"},{"value":"no","label":"No"}]},
            {"id":"overall_satisfaction","type":"rating","name":"overall_satisfaction","label":"Overall Satisfaction (1-5)","min":1,"max":5},
            {"id":"remarks","type":"text","name":"remarks","label":"Remarks"},
        ]
    }]
}

def ngo_education_data(district):
    return {
        "mother_name": pick(*NAMES), "village": pick(*VILLAGES), "district": district,
        "months_in_program": rand_int(6, 48),
        "girl_name": pick(*NAMES), "girl_age": rand_int(8, 16),
        "currently_enrolled": pick("yes","yes","yes","no"),
        "grade": rand_int(3, 10), "attendance_pct": rand_int(50, 100),
        "dropout_risk": pick("low","low","medium","high"),
        "barrier_type": [pick("distance","cost","household_work","none")],
        "scholarship_received": pick("yes","no"),
        "mentor_support": pick("yes","yes","no"),
        "self_confidence_improved": pick("yes","yes","unsure"),
        "family_support_improved": pick("yes","yes","no"),
        "overall_satisfaction": rand_int(3, 5), "remarks": "",
    }

def ngo_water_data(district):
    return {
        "respondent_name": pick(*NAMES), "village": pick(*VILLAGES), "district": district,
        "project_phase": pick("phase1","phase2","phase3"),
        "water_access_improved": pick("yes","yes","partial","no"),
        "daily_water_litres": rand_int(20, 80),
        "collection_time_mins": rand_int(5, 40),
        "water_quality_rating": rand_int(3, 5),
        "handwash_practice": pick("always","mostly","sometimes"),
        "water_treated": pick("always","sometimes","never"),
        "children_diarrhoea_reduced": pick("yes","yes","no","no_children"),
        "water_committee_active": pick("yes","yes","no"),
        "maintenance_fund": pick("yes","no"),
        "overall_satisfaction": rand_int(3, 5), "remarks": "",
    }

# ═══════════════════════════════════════════════════════════════════════════════
# SECTOR 7 — EDUCATION / SCHOOL SURVEY
# ═══════════════════════════════════════════════════════════════════════════════

ASER_SCHEMA = {
    "title": "ASER-style Learning Outcomes Survey",
    "version": 1,
    "sections": [{
        "id": "s1", "title": "1. Household & Child",
        "fields": [
            {"id":"hh_name","type":"text","name":"hh_name","label":"Household Head Name","required":True},
            {"id":"village","type":"text","name":"village","label":"Village","required":True},
            {"id":"district","type":"text","name":"district","label":"District","required":True},
            {"id":"gps","type":"gps","name":"gps","label":"GPS"},
            {"id":"child_name","type":"text","name":"child_name","label":"Child Name","required":True},
            {"id":"child_age","type":"number","name":"child_age","label":"Age","min":5,"max":16},
            {"id":"child_gender","type":"single_choice","name":"child_gender","label":"Gender",
             "options":[{"value":"male","label":"Male"},{"value":"female","label":"Female"}]},
        ]
    },{
        "id": "s2", "title": "2. Enrollment & Attendance",
        "fields": [
            {"id":"enrolled","type":"single_choice","name":"enrolled","label":"Enrolled in School?",
             "options":[{"value":"yes","label":"Yes"},{"value":"no","label":"No"}]},
            {"id":"school_type","type":"single_choice","name":"school_type","label":"School Type",
             "options":[{"value":"govt","label":"Government"},{"value":"private","label":"Private"},{"value":"madrasa","label":"Madrasa"}]},
            {"id":"grade","type":"number","name":"grade","label":"Current Grade","min":1,"max":10},
            {"id":"attendance_last_week","type":"number","name":"attendance_last_week","label":"Days Attended Last Week","min":0,"max":6},
        ]
    },{
        "id": "s3", "title": "3. Learning Assessment",
        "fields": [
            {"id":"reading_level","type":"single_choice","name":"reading_level","label":"Reading Level",
             "options":[{"value":"cannot_read","label":"Cannot Read"},{"value":"letters","label":"Letters"},
                        {"value":"words","label":"Words"},{"value":"std1_text","label":"Std 1 Text"},{"value":"std2_text","label":"Std 2+ Text"}]},
            {"id":"math_level","type":"single_choice","name":"math_level","label":"Arithmetic Level",
             "options":[{"value":"cannot","label":"Cannot Recognise Numbers"},{"value":"numbers","label":"Numbers 1-9"},
                        {"value":"subtraction","label":"Subtraction"},{"value":"division","label":"Division"}]},
            {"id":"english_words","type":"single_choice","name":"english_words","label":"Can read English words?",
             "options":[{"value":"yes","label":"Yes"},{"value":"no","label":"No"}]},
        ]
    },{
        "id": "s4", "title": "4. School Access & Quality",
        "fields": [
            {"id":"school_distance_km","type":"decimal","name":"school_distance_km","label":"Distance to School (km)","min":0,"max":30},
            {"id":"midday_meal_received","type":"single_choice","name":"midday_meal_received","label":"Mid-Day Meal Received?",
             "options":[{"value":"yes","label":"Yes"},{"value":"no","label":"No"}]},
            {"id":"textbooks_provided","type":"single_choice","name":"textbooks_provided","label":"Free Textbooks?",
             "options":[{"value":"yes","label":"Yes"},{"value":"partial","label":"Partial"},{"value":"no","label":"No"}]},
            {"id":"remarks","type":"text","name":"remarks","label":"Remarks"},
        ]
    }]
}

SCHOOL_INFRA_SCHEMA = {
    "title": "Samagra Shiksha School Infrastructure Survey",
    "version": 1,
    "sections": [{
        "id": "s1", "title": "1. School Details",
        "fields": [
            {"id":"school_name","type":"text","name":"school_name","label":"School Name","required":True},
            {"id":"dise_code","type":"text","name":"dise_code","label":"DISE Code"},
            {"id":"village","type":"text","name":"village","label":"Village","required":True},
            {"id":"district","type":"text","name":"district","label":"District","required":True},
            {"id":"gps","type":"gps","name":"gps","label":"GPS Location of School"},
            {"id":"school_type","type":"single_choice","name":"school_type","label":"School Management Type",
             "options":[{"value":"govt","label":"Government"},{"value":"aided","label":"Govt Aided"},{"value":"private","label":"Private Unaided"}]},
        ]
    },{
        "id": "s2", "title": "2. Enrolment & Staff",
        "fields": [
            {"id":"total_students","type":"number","name":"total_students","label":"Total Students","min":0,"max":2000},
            {"id":"girls_students","type":"number","name":"girls_students","label":"Girls Enrolled","min":0,"max":1000},
            {"id":"total_teachers","type":"number","name":"total_teachers","label":"Total Teachers","min":0,"max":50},
            {"id":"classes","type":"number","name":"classes","label":"Classes (1 to X)","min":1,"max":12},
        ]
    },{
        "id": "s3", "title": "3. Infrastructure",
        "fields": [
            {"id":"classrooms_usable","type":"number","name":"classrooms_usable","label":"Usable Classrooms","min":0,"max":50},
            {"id":"has_electricity","type":"single_choice","name":"has_electricity","label":"Electricity?",
             "options":[{"value":"yes","label":"Yes"},{"value":"no","label":"No"}]},
            {"id":"has_library","type":"single_choice","name":"has_library","label":"Library / Reading Corner?",
             "options":[{"value":"yes","label":"Yes"},{"value":"no","label":"No"}]},
            {"id":"girls_toilet","type":"single_choice","name":"girls_toilet","label":"Girls Toilet Functional?",
             "options":[{"value":"yes","label":"Yes"},{"value":"no","label":"No"},{"value":"under_construction","label":"Under Construction"}]},
            {"id":"drinking_water","type":"single_choice","name":"drinking_water","label":"Drinking Water Available?",
             "options":[{"value":"yes","label":"Yes"},{"value":"no","label":"No"}]},
            {"id":"ramps_for_disabled","type":"single_choice","name":"ramps_for_disabled","label":"Ramps / Disabled Access?",
             "options":[{"value":"yes","label":"Yes"},{"value":"no","label":"No"}]},
        ]
    },{
        "id": "s4", "title": "4. Programmes",
        "fields": [
            {"id":"midday_meal_served","type":"single_choice","name":"midday_meal_served","label":"Mid-Day Meal Served?",
             "options":[{"value":"yes","label":"Yes"},{"value":"no","label":"No"}]},
            {"id":"internet_connection","type":"single_choice","name":"internet_connection","label":"Internet Connection?",
             "options":[{"value":"yes","label":"Yes"},{"value":"no","label":"No"}]},
            {"id":"computer_lab","type":"single_choice","name":"computer_lab","label":"Computer Lab?",
             "options":[{"value":"yes","label":"Yes"},{"value":"no","label":"No"}]},
            {"id":"remarks","type":"text","name":"remarks","label":"Enumerator Remarks"},
        ]
    }]
}

def aser_data(district):
    return {
        "hh_name": pick(*NAMES), "village": pick(*VILLAGES), "district": district,
        "child_name": pick(*NAMES), "child_age": rand_int(6, 14),
        "child_gender": pick("male","female"),
        "enrolled": pick("yes","yes","yes","no"),
        "school_type": pick("govt","govt","private"),
        "grade": rand_int(1, 8), "attendance_last_week": rand_int(3, 6),
        "reading_level": pick("cannot_read","letters","words","std1_text","std2_text"),
        "math_level": pick("cannot","numbers","subtraction","division"),
        "english_words": pick("yes","no"),
        "school_distance_km": round(random.uniform(0.5, 8.0), 1),
        "midday_meal_received": pick("yes","yes","no"),
        "textbooks_provided": pick("yes","partial","no"), "remarks": "",
    }

def school_infra_data(district):
    students = rand_int(80, 600)
    teachers = rand_int(3, 20)
    return {
        "school_name": f"{pick(*VILLAGES)} Government Primary School",
        "dise_code": f"29{rand_int(100000,999999)}",
        "village": pick(*VILLAGES), "district": district,
        "school_type": pick("govt","govt","aided"),
        "total_students": students, "girls_students": rand_int(int(students*0.4), int(students*0.6)),
        "total_teachers": teachers, "classes": rand_int(5, 10),
        "classrooms_usable": rand_int(3, 12),
        "has_electricity": pick("yes","yes","no"),
        "has_library": pick("yes","no"),
        "girls_toilet": pick("yes","yes","no","under_construction"),
        "drinking_water": pick("yes","yes","no"),
        "ramps_for_disabled": pick("yes","no","no"),
        "midday_meal_served": pick("yes","yes","no"),
        "internet_connection": pick("yes","no"),
        "computer_lab": pick("yes","no","no"),
        "remarks": "",
    }

# ═══════════════════════════════════════════════════════════════════════════════
# BUILD ALL PROGRAMS
# ═══════════════════════════════════════════════════════════════════════════════

PROGRAMS = [
    # (name, scheme, desc, form_title, form_schema, data_fn, districts, n_subs, state, locations)
    # ── Sector 1: Household Survey ──
    ("Karnataka Socioeconomic Survey 2024",
     "SECC / State Survey",
     "Comprehensive socioeconomic profiling of rural households across North Karnataka.",
     "Socioeconomic Household Survey", HH_SCHEMA, hh_data,
     DISTRICTS_KA[:4], 35, "Karnataka",
     [("Karnataka","Bellary","Hospet"),("Karnataka","Raichur","Manvi"),("Karnataka","Bidar","Basavakalyan")]),

    ("Telangana SECC Household Listing",
     "Socio Economic and Caste Census",
     "Doorstep enumeration of all households for deprivation index scoring.",
     "SECC Household Listing Form", SECC_SCHEMA, secc_data,
     DISTRICTS_TL[:4], 30, "Telangana",
     [("Telangana","Nizamabad","Armoor"),("Telangana","Karimnagar","Jagtial"),("Telangana","Warangal","Hanamkonda")]),

    # ── Sector 2: Health / WASH / Nutrition ──
    ("Jal Jeevan Mission Karnataka",
     "Har Ghar Jal — JJM",
     "Household water access and WASH behaviour survey for JJM coverage tracking.",
     "Jal Jeevan Mission WASH Household Survey", WASH_SCHEMA, wash_data,
     DISTRICTS_KA[3:6], 40, "Karnataka",
     [("Karnataka","Kalaburagi","Sedam"),("Karnataka","Yadgir","Shorapur"),("Karnataka","Vijayapura","Sindagi")]),

    ("Bihar Nutrition Assessment — POSHAN Abhiyaan",
     "POSHAN Abhiyaan / ICDS",
     "Child and maternal nutrition tracking under National Nutrition Mission.",
     "PM-POSHAN Nutrition & Health Assessment", NUTRITION_SCHEMA, nutrition_data,
     DISTRICTS_BR[:4], 35, "Bihar",
     [("Bihar","Muzaffarpur","Musahari"),("Bihar","Sitamarhi","Pupri"),("Bihar","Madhubani","Jainagar")]),

    # ── Sector 3: Agricultural / Livelihood ──
    ("PM-KISAN Beneficiary Survey — Maharashtra",
     "Pradhan Mantri Kisan Samman Nidhi",
     "Verification and impact assessment of PM-KISAN direct benefit transfers.",
     "PM-KISAN Farmer Baseline Survey", AGRI_SCHEMA, agri_data,
     DISTRICTS_MH[:4], 38, "Maharashtra",
     [("Maharashtra","Nashik","Niphad"),("Maharashtra","Amravati","Warud"),("Maharashtra","Yavatmal","Pusad")]),

    ("NRLM SHG Livelihood Assessment — Uttar Pradesh",
     "National Rural Livelihood Mission / DAY-NRLM",
     "Member-level assessment of SHG participation, savings, income, and empowerment.",
     "NRLM Self Help Group Member Survey", NRLM_SCHEMA, nrlm_data,
     DISTRICTS_UP[:4], 35, "Uttar Pradesh",
     [("Uttar Pradesh","Varanasi","Arajiline"),("Uttar Pradesh","Allahabad","Soraon"),("Uttar Pradesh","Mirzapur","Marihan")]),

    # ── Sector 4: Government Program Monitoring ──
    ("PMAY Gramin Housing Survey — Rajasthan",
     "Pradhan Mantri Awas Yojana — Gramin",
     "Physical verification of housing construction progress and beneficiary satisfaction.",
     "PMAY Beneficiary Verification Survey", PMAY_SCHEMA, pmay_data,
     DISTRICTS_RJ[:4], 40, "Rajasthan",
     [("Rajasthan","Barmer","Shiv"),("Rajasthan","Jaisalmer","Sam"),("Rajasthan","Bikaner","Nokha")]),

    ("MGNREGA Work Monitoring — Bihar",
     "Mahatma Gandhi NREGA",
     "Job card verification, work site inspection, and payment status tracking.",
     "MGNREGA Job Card Verification & Work Survey", MGNREGA_SCHEMA, mgnrega_data,
     DISTRICTS_BR[3:6], 38, "Bihar",
     [("Bihar","Darbhanga","Biraul"),("Bihar","Samastipur","Pusa"),("Bihar","Vaishali","Hajipur")]),

    # ── Sector 5: RCT Baseline / Endline ──
    ("Karnataka Nutrition Intervention RCT — Baseline",
     "IFPRI / Karnataka State NHM",
     "Randomised control trial baseline — measuring household food security, nutrition status, and healthcare access before intervention.",
     "Karnataka Nutrition RCT — Baseline Survey", RCT_BASELINE_SCHEMA, rct_baseline_data,
     DISTRICTS_KA[1:4], 30, "Karnataka",
     [("Karnataka","Raichur","Lingasugur"),("Karnataka","Bellary","Kampli"),("Karnataka","Yadgir","Gurumitkal")]),

    ("UP Education Intervention RCT — Endline",
     "J-PAL / Pratham Education Foundation",
     "Endline assessment of structured pedagogy intervention on learning outcomes.",
     "UP Education RCT — Endline Survey", RCT_ENDLINE_SCHEMA, rct_endline_data,
     DISTRICTS_UP[2:5], 32, "Uttar Pradesh",
     [("Uttar Pradesh","Jhansi","Babina"),("Uttar Pradesh","Banda","Naraini"),("Uttar Pradesh","Chitrakoot","Mau")]),

    # ── Sector 6: NGO M&E / Impact Assessment ──
    ("UNICEF Girl Education M&E — Bihar",
     "UNICEF — Meena Communication Initiative",
     "Monitoring and evaluation of girl child education programme outcomes.",
     "UNICEF Girl Education Initiative — M&E Survey", NGO_EDUCATION_SCHEMA, ngo_education_data,
     DISTRICTS_BR[1:4], 35, "Bihar",
     [("Bihar","Sitamarhi","Riga"),("Bihar","Madhubani","Phulparas"),("Bihar","Darbhanga","Keoti")]),

    ("World Vision Water & Sanitation M&E — MP",
     "World Vision India — WASH Programme",
     "Post-project impact assessment of community water supply and sanitation.",
     "World Vision Community Water Project — M&E Survey", NGO_WATER_SCHEMA, ngo_water_data,
     DISTRICTS_MP[:4], 32, "Madhya Pradesh",
     [("Madhya Pradesh","Shivpuri","Pohri"),("Madhya Pradesh","Guna","Raghogarh"),("Madhya Pradesh","Ashok Nagar","Mungaoli")]),

    # ── Sector 7: Education / School Survey ──
    ("ASER Learning Outcomes Survey 2024 — UP",
     "Annual Status of Education Report",
     "Household-based foundational literacy and numeracy assessment of children 5-16.",
     "ASER-style Learning Outcomes Survey", ASER_SCHEMA, aser_data,
     DISTRICTS_UP[:4], 35, "Uttar Pradesh",
     [("Uttar Pradesh","Varanasi","Chiraigaon"),("Uttar Pradesh","Allahabad","Handia"),("Uttar Pradesh","Sonbhadra","Robertsganj")]),

    ("Samagra Shiksha School Infrastructure Survey — Karnataka",
     "Samagra Shiksha Abhiyan",
     "Physical verification of school infrastructure, enrolment, and programme delivery.",
     "Samagra Shiksha School Infrastructure Survey", SCHOOL_INFRA_SCHEMA, school_infra_data,
     DISTRICTS_KA[:4], 30, "Karnataka",
     [("Karnataka","Bellary","Hospet"),("Karnataka","Bidar","Bhalki"),("Karnataka","Bagalkot","Hungund")]),
]

# ── Run ───────────────────────────────────────────────────────────────────────

total_subs = 0
for (prog_name, scheme, desc, form_title, form_schema, data_fn,
     districts, n_subs, state, locations) in PROGRAMS:

    try:
        form, form_new = get_or_create_form(form_title, form_schema)
        prog, prog_new = get_or_create_program(prog_name, scheme, desc, "")
        questionnaire = get_or_create_questionnaire(prog.id, form.id, form_title, target=n_subs*2)
        assign_all_enumerators(form)

        for (st, dist, block) in locations:
            add_location(prog.id, st, dist, block)

        if form_new:
            made = make_submissions(form, questionnaire, prog, n_subs, data_fn, districts)
            total_subs += made
        else:
            # Backfill program_id on existing unlinked submissions
            db.execute(
                f"UPDATE submissions SET program_id='{prog.id}', questionnaire_id='{questionnaire.id}'"
                f" WHERE tenant_id='{demo.id}' AND form_id='{form.id}' AND program_id IS NULL"
            )

        db.commit()
        status_str = "created" if prog_new else "updated"
        print(f"  ✓ [{status_str}] {prog_name} — {n_subs} subs target")

    except Exception as e:
        db.rollback()
        print(f"  ✗ FAILED {prog_name}: {e}")

print(f"\n✓ seed_programs complete — {total_subs} new submissions across {len(PROGRAMS)} programs")
db.close()
