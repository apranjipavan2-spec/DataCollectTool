"""
Idempotent master_admin creation from environment variables.

Required env vars:
  MASTER_ADMIN_PHONE     — e.g. 919876543210
  MASTER_ADMIN_PASSWORD  — strong password

Optional:
  MASTER_ADMIN_NAME      — display name (default: Master Admin)
  MASTER_ADMIN_EMAIL     — email address

Run:
  python -m scripts.create_superuser
"""
import os, sys, uuid
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

phone    = os.environ.get("MASTER_ADMIN_PHONE", "").strip()
password = os.environ.get("MASTER_ADMIN_PASSWORD", "").strip()

if not phone or not password:
    print("[superuser] MASTER_ADMIN_PHONE / MASTER_ADMIN_PASSWORD not set — skipping.")
    sys.exit(0)

from app.core.database import SessionLocal
from app.core.security import hash_password
from app.models.user import User
from app.models.tenant import Tenant

SYSTEM_TENANT_ID = uuid.UUID("00000000-0000-0000-0000-000000000001")


def run():
    db = SessionLocal()
    try:
        existing = db.query(User).filter(User.phone == phone, User.role == "master_admin").first()
        if existing:
            print(f"[superuser] Master admin already exists ({existing.phone}) — skipping.")
            return

        tenant = db.query(Tenant).filter(Tenant.id == SYSTEM_TENANT_ID).first()
        if not tenant:
            tenant = Tenant(
                id=SYSTEM_TENANT_ID,
                name="System",
                slug="system",
            )
            db.add(tenant)
            db.flush()

        admin = User(
            tenant_id=SYSTEM_TENANT_ID,
            role="master_admin",
            phone=phone,
            password_hash=hash_password(password),
            name=os.environ.get("MASTER_ADMIN_NAME", "Master Admin"),
            email=os.environ.get("MASTER_ADMIN_EMAIL", ""),
            is_active=True,
        )
        db.add(admin)
        db.commit()
        print(f"[superuser] Master admin created: {phone}")
    except Exception as e:
        db.rollback()
        print(f"[superuser] Failed: {e}")
        sys.exit(1)
    finally:
        db.close()


if __name__ == "__main__":
    run()
