from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Request, status
from pydantic import BaseModel
from typing import Optional
import csv
import io
import secrets
import string
from sqlalchemy import func
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.core.deps import get_current_user, require_org_admin, require_supervisor
from app.core.security import hash_password
from app.core.phone import normalize_phone
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
    role: Optional[str] = None          # org_admin only
    is_active: Optional[bool] = None     # org_admin only — activate/deactivate
    password: Optional[str] = None       # set a new password (self, or org_admin for tenant users)


@router.get("/me")
def get_me(user=Depends(get_current_user), db: Session = Depends(get_db)):
    u = db.query(User).filter(User.id == user["sub"]).first()
    if not u:
        raise HTTPException(status_code=404, detail="User not found")
    return {"id": str(u.id), "name": u.name, "phone": u.phone,
            "role": u.role, "language_pref": u.language_pref,
            "email": u.email, "totp_enabled": bool(u.totp_enabled)}


@router.get("/")
def list_users(page: int = 1, page_size: int = 50, include_inactive: bool = True,
               user=Depends(require_supervisor), db: Session = Depends(get_db)):
    """All users in the caller's org. Deactivated users are included by default
    (active first) so an admin can see and reactivate them — previously they were
    hidden entirely, which made an already-registered phone look 'missing'."""
    page_size = min(page_size, 200)
    q = db.query(User).filter(User.tenant_id == user["tenant_id"])
    if not include_inactive:
        q = q.filter(User.is_active == True)
    total = q.count()
    users = (q.order_by(User.is_active.desc(), User.name)
             .offset((page - 1) * page_size).limit(page_size).all())
    return {
        "items": [{"id": str(u.id), "name": u.name, "phone": u.phone, "role": u.role,
                   "email": u.email, "is_active": bool(u.is_active)} for u in users],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.post("/", status_code=status.HTTP_201_CREATED)
@limiter.limit("30/minute")
def create_user(request: Request, body: UserCreate, user=Depends(require_org_admin), db: Session = Depends(get_db)):
    # Enforce seat limits per role
    if body.role == "org_admin":
        from app.core.plan_limits import _limits_for_db
        tenant = db.query(Tenant).filter(Tenant.id == user["tenant_id"]).first()
        if tenant:
            limits = _limits_for_db(tenant.plan_tier, db)
            admin_limit = limits.get("admins", -1)
            if admin_limit >= 0:
                current_count = db.query(func.count(User.id)).filter(
                    User.tenant_id == user["tenant_id"],
                    User.is_active == True,
                    User.role == "org_admin",
                ).scalar() or 0
                if current_count >= admin_limit:
                    raise HTTPException(
                        status_code=402,
                        detail=f"Admin limit reached ({current_count}/{admin_limit} on your plan). Upgrade to add more admins.",
                    )
    elif body.role in ("supervisor", "enumerator"):
        from app.services.plan_enforcement import check_supervisor_limit, check_enumerator_limit
        tenant = db.query(Tenant).filter(Tenant.id == user["tenant_id"]).first()
        if tenant:
            check_fn = check_supervisor_limit if body.role == "supervisor" else check_enumerator_limit
            result = check_fn(db, str(user["tenant_id"]), tenant.plan_tier)
            if not result["allowed"]:
                raise HTTPException(status_code=402, detail=result["reason"])

    phone = normalize_phone(body.phone)
    existing = db.query(User).filter(User.phone == phone).first()
    if existing:
        # Reactivate a previously-deactivated user in this tenant instead of dead-ending
        if existing.tenant_id == user["tenant_id"] and not existing.is_active:
            existing.is_active = True
            existing.name = body.name
            existing.role = body.role
            existing.language_pref = body.language_pref
            existing.email = body.email
            if body.password:
                existing.password_hash = hash_password(body.password)
            db.commit()
            db.refresh(existing)
            return {"id": str(existing.id), "phone": existing.phone, "role": existing.role, "email": existing.email, "is_active": True}
        # Same tenant + already active → it's already in their team (just not found
        # because the caller was looking at a filtered view). Point them to it.
        if existing.tenant_id == user["tenant_id"]:
            raise HTTPException(status_code=400, detail=f"This phone already belongs to {existing.name or 'a user'} in your team — check the Team list.")
        # Different tenant → the number is registered under another organization.
        raise HTTPException(status_code=400, detail="This phone number is already registered under a different organization account. Ask the person to use a different number, or contact support to move the account.")
    new_user = User(
        tenant_id=user["tenant_id"],
        phone=phone,
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
_PW_ALPHABET = string.ascii_letters + string.digits


def _generate_password(length: int = 12) -> str:
    """A fresh random password per user — never reused across rows, so one
    leaked/guessed account doesn't expose every other bulk-imported user."""
    return "".join(secrets.choice(_PW_ALPHABET) for _ in range(length))


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
    generated_passwords: list[dict] = []  # rows that didn't specify one — only chance to show these

    # Bulk import: track admin/supervisor/enumerator seat limits as we go
    from app.core.plan_limits import _limits_for_db
    tenant = db.query(Tenant).filter(Tenant.id == user["tenant_id"]).first()
    plan_admin_limit = plan_supervisor_limit = plan_enumerator_limit = -1
    if tenant:
        limits = _limits_for_db(tenant.plan_tier, db)
        plan_admin_limit = limits.get("admins", -1)
        plan_supervisor_limit = limits.get("supervisors", -1)
        plan_enumerator_limit = limits.get("enumerators", -1)

    current_supervisor_count = db.query(func.count(User.id)).filter(
        User.tenant_id == user["tenant_id"], User.is_active == True, User.role == "supervisor"
    ).scalar() or 0
    current_enumerator_count = db.query(func.count(User.id)).filter(
        User.tenant_id == user["tenant_id"], User.is_active == True, User.role == "enumerator"
    ).scalar() or 0
    created_supervisors = created_enumerators = 0

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
        phone = normalize_phone((row.get("phone") or "").strip())
        name = (row.get("name") or "").strip()
        role = (row.get("role") or "enumerator").strip().lower()
        csv_password = (row.get("password") or "").strip()
        password = csv_password or _generate_password()

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

        # For org_admin role, enforce the admin seat limit
        if role == "org_admin" and plan_admin_limit >= 0:
            admin_created_so_far = db.query(func.count(User.id)).filter(
                User.tenant_id == user["tenant_id"], User.is_active == True, User.role == "org_admin"
            ).scalar() or 0
            if admin_created_so_far + created >= plan_admin_limit:
                errors.append(f"Row {idx}: admin limit ({plan_admin_limit}) reached — skipping remaining admins")
                continue

        if role == "supervisor" and plan_supervisor_limit >= 0:
            if current_supervisor_count + created_supervisors >= plan_supervisor_limit:
                errors.append(f"Row {idx}: supervisor limit ({plan_supervisor_limit}) reached — skipping remaining supervisors")
                continue

        if role == "enumerator" and plan_enumerator_limit >= 0:
            if current_enumerator_count + created_enumerators >= plan_enumerator_limit:
                errors.append(f"Row {idx}: enumerator limit ({plan_enumerator_limit}) reached — skipping remaining enumerators")
                continue

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
        if role == "supervisor":
            created_supervisors += 1
        elif role == "enumerator":
            created_enumerators += 1
        if not csv_password:
            generated_passwords.append({"phone": phone, "name": new_user.name, "password": password})

    db.commit()

    return {"created": created, "skipped": skipped, "errors": errors, "generated_passwords": generated_passwords}


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
        new_phone = normalize_phone(body.phone.strip())
        # Check phone uniqueness only if it changed
        if new_phone != target.phone:
            existing = db.query(User).filter(User.phone == new_phone, User.id != user_id).first()
            if existing:
                raise HTTPException(status_code=400, detail="Phone already in use")
        target.phone = new_phone
    if body.email is not None:
        new_email = body.email.strip() or None
        if new_email and (target.email or "").lower() != new_email.lower():
            dup = db.query(User).filter(
                func.lower(User.email) == new_email.lower(),
                User.is_active == True, User.id != target.id,
            ).first()
            if dup:
                raise HTTPException(status_code=400, detail="Email already in use")
        target.email = new_email
    if body.language_pref is not None:
        target.language_pref = body.language_pref

    # Role + activation are admin-only, tenant-scoped changes.
    if body.role is not None:
        if not is_admin:
            raise HTTPException(status_code=403, detail="Only an admin can change roles")
        if body.role not in VALID_ROLES:
            raise HTTPException(status_code=400, detail=f"Invalid role — must be one of {', '.join(sorted(VALID_ROLES))}")
        target.role = body.role
    if body.is_active is not None:
        if not is_admin:
            raise HTTPException(status_code=403, detail="Only an admin can activate or deactivate users")
        if str(target.tenant_id) != str(user["tenant_id"]):
            raise HTTPException(status_code=403, detail="Not authorised to update this user")
        target.is_active = body.is_active

    if body.password is not None:
        # Admins may reset any tenant user's password; anyone may change their own.
        if not is_self and str(target.tenant_id) != str(user["tenant_id"]):
            raise HTTPException(status_code=403, detail="Not authorised to update this user")
        if len(body.password) < 6:
            raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
        target.password_hash = hash_password(body.password)

    db.commit()
    db.refresh(target)
    return {
        "id": str(target.id),
        "name": target.name,
        "phone": target.phone,
        "role": target.role,
        "email": target.email,
        "language_pref": target.language_pref,
        "is_active": bool(target.is_active),
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
