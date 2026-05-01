"""
Run this on the server if login stops working.
Usage:  python scripts/reset_passwords.py

Resets all seed-user passwords back to defaults WITHOUT touching any
real user data — only phones that appear in the seed list.
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import app.models  # noqa
from app.core.database import SessionLocal
from app.core.security import hash_password
from app.models.user import User

SEED_PHONES = {
    '+919999990000': ('test@123',        'Master Admin — FieldGovern Platform'),
    '+918317390926': ('superadmin@4991', 'Super Admin (org_admin) — Demo Org'),
    '+919999990001': ('test@123',        'Admin User — Demo Org'),
    '+918123105186': ('test@123',        'PavanDeshetty — Demo Org'),
    '+919999990002': ('test@123',        'Supervisor User — Demo Org'),
    '+919222222222': ('test@123',        'New Supervisor — Demo Org'),
    '+919999990003': ('test@123',        'Rajesh Kumar — Demo Org'),
    '+919999990004': ('test@123',        'Priya Sharma — Demo Org'),
    '+919333333331': ('test@123',        'BulkUser1 — Demo Org'),
    '+919333333332': ('test@123',        'BulkUser2 — Demo Org'),
    '+919111111111': ('test@123',        'Test Field Worker — Demo Org'),
    '+919999991001': ('test@123',        'Dataworx Admin'),
    '+919999991002': ('test@123',        'Manjunath — Dataworx'),
    '+919999991003': ('test@123',        'Ninganna — Dataworx'),
    '+919999991004': ('test@123',        'Babasaheb — Dataworx'),
    '+919999991005': ('test@123',        'Rohit — Dataworx'),
}

db = SessionLocal()
try:
    updated = 0
    for phone, (password, label) in SEED_PHONES.items():
        user = db.query(User).filter(User.phone == phone).first()
        if user:
            user.password_hash = hash_password(password)
            user.is_active = True
            updated += 1
            print(f'  ✓ reset  {phone}  ({label})')
        else:
            print(f'  – missing {phone}  ({label})')
    db.commit()
    print(f'\nDone — {updated} passwords reset.')
    print('\nCredentials:')
    print('  Most accounts  : test@123')
    print('  +918317390926  : superadmin@4991')
finally:
    db.close()
