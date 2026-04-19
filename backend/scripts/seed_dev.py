"""
Idempotent seed — safe to run on every deploy.
Creates platform tenant + master admin, plus demo tenant with all 4 roles.
Skips creation if data already exists.

Default password for all seed users: test@123
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import app.models  # noqa: F401
from app.core.database import SessionLocal, engine, Base
from app.core.security import hash_password
from app.models.tenant import Tenant
from app.models.user import User
import uuid

print("Creating tables...")
Base.metadata.create_all(bind=engine)
print("Tables ready.")

db = SessionLocal()
DEFAULT_PASSWORD = 'test@123'
hashed = hash_password(DEFAULT_PASSWORD)

def get_or_create_tenant(name, plan_tier='starter'):
    t = db.query(Tenant).filter(Tenant.name == name).first()
    if t:
        return t, False
    t = Tenant(id=uuid.uuid4(), name=name, plan_tier=plan_tier)
    db.add(t)
    db.flush()
    return t, True

def get_or_create_user(tenant_id, phone, role, name):
    u = db.query(User).filter(User.phone == phone).first()
    if u:
        return u, False
    u = User(tenant_id=tenant_id, role=role, phone=phone, name=name, password_hash=hashed)
    db.add(u)
    return u, True

try:
    # Platform tenant (master admin lives here)
    platform_tenant, _ = get_or_create_tenant('FieldPulse Platform', 'enterprise')

    # Demo org tenant
    demo_tenant, _ = get_or_create_tenant('Demo Org', 'professional')

    users = [
        (platform_tenant.id, '+919999990001', 'master_admin', 'Master Admin'),
        (demo_tenant.id,     '+919999990002', 'org_admin',    'Org Admin'),
        (demo_tenant.id,     '+919999990003', 'supervisor',   'Supervisor User'),
        (demo_tenant.id,     '+919999990004', 'enumerator',   'Enumerator User'),
        (demo_tenant.id,     '+919999990005', 'enumerator',   'Enumerator 2'),
    ]

    created = []
    for tenant_id, phone, role, name in users:
        u, is_new = get_or_create_user(tenant_id, phone, role, name)
        if is_new:
            created.append((role, phone))

    db.commit()

    print("\nSeed complete (idempotent — skipped existing records)")
    print(f"\nPlatform tenant : {platform_tenant.name}")
    print(f"Demo tenant     : {demo_tenant.name}")
    print(f"\nDefault password: {DEFAULT_PASSWORD}")
    print("\nDemo accounts:")
    for _, phone, role, name in users:
        print(f"  {role:15s}  {phone}  ({name})")
    if created:
        print(f"\nNewly created: {len(created)} user(s)")
    else:
        print("\nAll users already existed — no changes made.")

except Exception as e:
    db.rollback()
    print(f"Seed error: {e}")
    raise
finally:
    db.close()
