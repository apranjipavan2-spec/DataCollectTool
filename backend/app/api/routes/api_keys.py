"""
API Key management endpoints.

Org admins can generate, list, and revoke API keys for service-to-service access.
Each key is scoped to the creator's tenant and inherits their role.
"""
import uuid
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import require_org_admin, get_current_user
from app.core.security import hash_api_key
from app.models.api_key import ApiKey
from app.models.user import User

router = APIRouter(prefix="/api-keys", tags=["api_keys"])


class ApiKeyCreateRequest(BaseModel):
    name: str


class ApiKeyResponse(BaseModel):
    id: str
    tenant_id: str
    name: str
    created_at: str
    last_used_at: str | None
    is_active: bool

    class Config:
        from_attributes = True


class ApiKeyCreateResponse(ApiKeyResponse):
    key: str  # Plaintext key (shown only once)


@router.post("/", response_model=ApiKeyCreateResponse, status_code=status.HTTP_201_CREATED)
def create_api_key(
    body: ApiKeyCreateRequest,
    user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Generate a new API key for the current user's tenant.

    The plaintext key is returned only once. Store it securely.
    Returns a 32-character hex string suitable for use in Authorization: Bearer header.
    """
    # Verify user has org_admin role
    if user["role"] not in ("master_admin", "org_admin"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only org admins can create API keys")

    # Generate plaintext key
    plaintext_key = uuid.uuid4().hex

    # Hash and store
    key_hash = hash_api_key(plaintext_key)
    api_key = ApiKey(
        tenant_id=user["tenant_id"],
        created_by_id=user["sub"],
        name=body.name,
        key_hash=key_hash,
    )
    db.add(api_key)
    db.commit()
    db.refresh(api_key)

    return {
        "id": str(api_key.id),
        "tenant_id": str(api_key.tenant_id),
        "name": api_key.name,
        "created_at": api_key.created_at.isoformat(),
        "last_used_at": api_key.last_used_at.isoformat() if api_key.last_used_at else None,
        "is_active": api_key.is_active,
        "key": plaintext_key,  # Show only once
    }


@router.get("/", response_model=list[ApiKeyResponse])
def list_api_keys(
    user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List all active API keys for the current user's tenant."""
    keys = db.query(ApiKey).filter(
        ApiKey.tenant_id == user["tenant_id"],
        ApiKey.is_active == True,
    ).all()

    return [
        {
            "id": str(k.id),
            "tenant_id": str(k.tenant_id),
            "name": k.name,
            "created_at": k.created_at.isoformat(),
            "last_used_at": k.last_used_at.isoformat() if k.last_used_at else None,
            "is_active": k.is_active,
        }
        for k in keys
    ]


@router.delete("/{key_id}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_api_key(
    key_id: str,
    user: dict = Depends(require_org_admin),
    db: Session = Depends(get_db),
):
    """Revoke (deactivate) an API key. It will no longer work."""
    key = db.query(ApiKey).filter(
        ApiKey.id == key_id,
        ApiKey.tenant_id == user["tenant_id"],
    ).first()

    if not key:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="API key not found")

    key.is_active = False
    db.commit()


@router.patch("/{key_id}", response_model=ApiKeyResponse)
def update_api_key(
    key_id: str,
    body: dict,  # {is_active: bool}
    user: dict = Depends(require_org_admin),
    db: Session = Depends(get_db),
):
    """Update an API key (currently only is_active flag)."""
    key = db.query(ApiKey).filter(
        ApiKey.id == key_id,
        ApiKey.tenant_id == user["tenant_id"],
    ).first()

    if not key:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="API key not found")

    if "is_active" in body:
        key.is_active = body["is_active"]
    db.commit()
    db.refresh(key)

    return {
        "id": str(key.id),
        "tenant_id": str(key.tenant_id),
        "name": key.name,
        "created_at": key.created_at.isoformat(),
        "last_used_at": key.last_used_at.isoformat() if key.last_used_at else None,
        "is_active": key.is_active,
    }
