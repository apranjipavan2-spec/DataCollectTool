from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, status
from pydantic import BaseModel
from typing import Optional
import csv
import io
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.core.deps import get_current_user, require_org_admin
from app.core.security import hash_password
from app.models.user import User

router = APIRouter()


class UserCreate(BaseModel):
    phone: str
    name: str
    role: str  # org_admin | supervisor | enumerator
    password: str = ""  # plain-text; will be hashed before storage
    language_pref: str = "en"
    email: Optional[str] = None


@router.get("/me")
def get_me(user=Depends(get_current_user), db: Session = Depends(get_db)):
    u = db.query(User).filter(User.id == user["sub"]).first()
    if not u:
        raise HTTPException(status_code=404, detail="User not found")
    return {"id": str(u.id), "name": u.name, "phone": u.phone,
            "role": u.role, "language_pref": u.language_pref,
            "email": u.email}


@router.get("/")
def list_users(page: int = 1, page_size: int = 50, user=Depends(require_org_admin), db: Session = Depends(get_db)):
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
def create_user(body: UserCreate, user=Depends(require_org_admin), db: Session = Depends(get_db)):
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


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def deactivate_user(user_id: str, user=Depends(require_org_admin), db: Session = Depends(get_db)):
    target = db.query(User).filter(
        User.id == user_id, User.tenant_id == user["tenant_id"]
    ).first()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    target.is_active = False
    db.commit()
