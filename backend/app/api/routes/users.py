from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Request, status
from pydantic import BaseModel
from typing import Optional
import csv
import io
from sqlalchemy import func
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.core.deps import get_current_user, require_org_admin, require_supervisor
from app.core.security import hash_password
from app.core.rate_limit import limiter
from app.models.user import User
from app.models.tenant import Tenant

router = APIRouter()


class UserCreate(BaseModel):
    phone: str
    name: str
    role: str  # org_admin | supervisor | enumerator
    password: str = ""  # plain-text; will be hashed before storage
    language_pref: str = "en"
    email: Optional[str] = None


class UserUpdate(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    language_pref: Optional[str] = None


@router.get("/me")
def get_me(user=Depends(get_current_user), db: Session = Depends(get_db)):
    u = db.query(User).filter(User.id == user["sub"]).first()
    if not u:
        raise HTTPException(status_code=404, detail="User not found")
    return {"id": str(u.id), "name": u.name, "phone": u.phone,
            "role": u.role, "language_pref": u.language_pref,
            "email": u.email}


@router.get("/")
def list_users(page: int = 1, page_size: int = 50, user=Depends(require_supervisor), db: Session = Depends(get_db)):
    page_size = min(page_size, 200)
    q = db.query(User).filter(User.tenant_id == user["tenant_id"], User.is_active == True)
    total = q.count()
    users = q.order_by(User.name).offset((page - 1) * page_size).limit(page_size).all()
    return {
        "items": [{"id": str(u.id), "name": u.name, "phone": u.phone, "role": u.role, "email": u.email} for u in users],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.post("/", status_code=status.HTTP_201_CREATED)
@limiter.limit("30/minute")
def create_user(request: Request, body: UserCreate, user=Depends(require_org_admin), db: Session = Depends(get_db)):
    # Enforce plan user limit
    from app.api.routes.tenants import PLAN_LIMITS
    tenant = db.query(Tenant).filter(Tenant.id == user["tenant_id"]).first()
    if tenant:
        limit = PLAN_LIMITS.get(tenant.plan_tier, PLAN_LIMITS["free"])["users"]
        if limit >= 0:
            current_count = db.query(func.count(User.id)).filter(
                User.tenant_id == user["tenant_id"], User.is_active == True
            ).scalar() or 0
            if current_count >= limit:
                raise HTTPException(
                    status_code=402,
                    detail=f"User limit reached ({current_count}/{limit}). Upgrade your plan to add more team members.",
                )

    if db.query(User).filter(User.phone == body.phone).first():
        raise HTTPException(status_code=400, detail="Phone already registered")
    new_user = User(
        tenant_id=user["tenant_id"],
        phone=body.phone,
        name=body.name,
        role=body.role,
        language_pref=body.language_pref,
        email=body.email,
        password_hash=hash_password(body.password) if body.password else None,
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    return {"id": str(new_user.id), "phone": new_user.phone, "role": new_user.role, "email": new_user.email}


VALID_ROLES = {"org_admin", "supervisor", "enumerator"}
DEFAULT_PASSWORD = "fieldpulse123"


@router.post("/bulk-import")
def bulk_import_users(
    file: UploadFile = File(...),
    user=Depends(require_org_admin),
    db: Session = Depends(get_db),
):
    """Import users from a CSV file.

    Expected columns: phone, name, role, password (optional).
    Skips rows where the phone number already exists.
    """
    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="Please upload a .csv file")

    try:
        raw = file.file.read().decode("utf-8-sig")
    except UnicodeDecodeError:
        raise HTTPException(status_code=400, detail="File must be UTF-8 encoded")

    reader = csv.DictReader(io.StringIO(raw))

    # Normalise header names (strip whitespace, lowercase)
    if reader.fieldnames:
        reader.fieldnames = [f.strip().lower() for f in reader.fieldnames]

    if not reader.fieldnames or "phone" not in reader.fieldnames:
        raise HTTPException(
            status_code=400,
            detail="CSV must contain at least a 'phone' column. Expected: phone, name, role, password",
        )

    created = 0
    skipped = 0
    errors: list[str] = []

    # Enforce plan user limit
    from app.api.routes.tenants import PLAN_LIMITS
    tenant = db.query(Tenant).filter(Tenant.id == user["tenant_id"]).first()
    plan_user_limit = -1
    if tenant:
        plan_user_limit = PLAN_LIMITS.get(tenant.plan_tier, PLAN_LIMITS["free"])["users"]

    current_user_count = db.query(func.count(User.id)).filter(
        User.tenant_id == user["tenant_id"], User.is_active == True
    ).scalar() or 0

    # Pre-fetch existing phones in this tenant for fast lookup
    existing_phones: set[str] = {
        p[0]
        for p in db.query(User.phone)
        .filter(User.tenant_id == user["tenant_id"])
        .all()
    }

    for idx, row in enumerate(reader, start=2):  # start=2 because row 1 is header
        phone = (row.get("phone") or "").strip()
        name = (row.get("name") or "").strip()
        role = (row.get("role") or "enumerator").strip().lower()
        password = (row.get("password") or "").strip() or DEFAULT_PASSWORD

        # ── Validate ──
        if not phone:
            errors.append(f"Row {idx}: phone is required")
            continue

        if role not in VALID_ROLES:
            errors.append(f"Row {idx}: invalid role '{role}' (must be one of {', '.join(sorted(VALID_ROLES))})")
            continue

        if phone in existing_phones:
            skipped += 1
            continue

        # Check plan limit before adding
        if plan_user_limit >= 0 and (current_user_count + created) >= plan_user_limit:
            errors.append(f"Row {idx}: user limit ({plan_user_limit}) reached — remaining rows skipped")
            break

        # ── Create user ──
        new_user = User(
            tenant_id=user["tenant_id"],
            phone=phone,
            name=name or phone,
            role=role,
            password_hash=hash_password(password),
        )
        db.add(new_user)
        existing_phones.add(phone)
        created += 1

    db.commit()

    return {"created": created, "skipped": skipped, "errors": errors}


@router.patch("/{user_id}")
def update_user(user_id: str, body: UserUpdate, user=Depends(get_current_user), db: Session = Depends(get_db)):
    """Update own profile (any role) or any tenant user (org_admin only)."""
    is_self = str(user["sub"]) == user_id
    is_admin = user["role"] == "org_admin"

    if not is_self and not is_admin:
        raise HTTPException(status_code=403, detail="Not authorised to update this user")

    target = db.query(User).filter(User.id == user_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")

    # Non-admins can only edit themselves (not users from other tenants)
    if not is_admin and str(target.tenant_id) != str(user["tenant_id"]):
        raise HTTPException(status_code=403, detail="Not authorised to update this user")

    if body.name is not None:
        target.name = body.name.strip()
    if body.phone is not None:
        # Check phone uniqueness only if it changed
        if body.phone.strip() != target.phone:
            existing = db.query(User).filter(User.phone == body.phone.strip(), User.id != user_id).first()
            if existing:
                raise HTTPException(status_code=400, detail="Phone already in use")
        target.phone = body.phone.strip()
    if body.email is not None:
        target.email = body.email.strip() or None
    if body.language_pref is not None:
        target.language_pref = body.language_pref

    db.commit()
    db.refresh(target)
    return {
        "id": str(target.id),
        "name": target.name,
        "phone": target.phone,
        "role": target.role,
        "email": target.email,
        "language_pref": target.language_pref,
    }


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def deactivate_user(user_id: str, user=Depends(require_org_admin), db: Session = Depends(get_db)):
    target = db.query(User).filter(
        User.id == user_id, User.tenant_id == user["tenant_id"]
    ).first()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    target.is_active = False
    db.commit()
