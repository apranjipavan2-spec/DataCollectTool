"""
Dev seed — creates a test tenant + one user of each role.
Run: python scripts/seed_dev.py

Default password for all seed users: test@123
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import app.models  # noqa: F401 — register all models for create_all
from app.core.database import SessionLocal, engine, Base
from app.core.security import hash_password
from app.models.tenant import Tenant
from app.models.user import User
import uuid

# Create all tables (idempotent — skips existing)
print("Creating tables...")
Base.metadata.create_all(bind=engine)
print("Tables ready.")

db = SessionLocal()

try:
    # Wipe existing seed data
    db.query(User).filter(User.phone.like('+91999999%')).delete(synchronize_session=False)
    db.query(Tenant).filter(Tenant.name == 'Demo Org').delete(synchronize_session=False)
    db.commit()
except Exception as e:
    print(f"Cleanup warning (OK on first run): {e}")
    db.rollback()

DEFAULT_PASSWORD = 'test@123'
hashed = hash_password(DEFAULT_PASSWORD)

tenant = Tenant(id=uuid.uuid4(), name='Demo Org', plan_tier='starter')
db.add(tenant)
db.flush()

users = [
    User(tenant_id=tenant.id, role='org_admin',   phone='+919999990001', name='Admin User',      password_hash=hashed),
    User(tenant_id=tenant.id, role='supervisor',  phone='+919999990002', name='Supervisor User',  password_hash=hashed),
    User(tenant_id=tenant.id, role='enumerator',  phone='+919999990003', name='Enumerator User',  password_hash=hashed),
]
for u in users:
    db.add(u)

db.commit()

print("\nSeed complete")
print(f"\nTenant:  {tenant.name}  ({tenant.id})")
print(f"\nDefault password: {DEFAULT_PASSWORD}")
print("\nUsers:")
for u in users:
    print(f"  {u.role:15s}  phone: {u.phone}")
print(f"\nTo log in: POST /api/v1/auth/login  {{ phone: '<number>', password: '{DEFAULT_PASSWORD}' }}\n")
