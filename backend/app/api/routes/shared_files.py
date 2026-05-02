"""Shared Files — master_admin uploads files and shares with tenants."""
import os
import uuid
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy.orm import Session
from typing import List
from app.core.deps import get_current_user, require_master_admin, get_db
from app.models.shared_file import SharedFile

router = APIRouter(prefix="/shared-files", tags=["shared-files"])

SHARED_FILES_DIR = Path(os.environ.get("MEDIA_DIR", "uploads")) / "shared_files"
SHARED_FILES_DIR.mkdir(parents=True, exist_ok=True)


@router.post("/")
async def upload_shared_file(
    file: UploadFile = File(...),
    description: str = Form(""),
    shared_with_tenants: str = Form(""),
    user=Depends(require_master_admin),
    db: Session = Depends(get_db),
):
    """Upload a file (master_admin only). Optionally share with tenant IDs (comma-separated)."""
    file_id = str(uuid.uuid4())
    ext = Path(file.filename or "file").suffix
    disk_filename = f"{file_id}{ext}"
    disk_path = SHARED_FILES_DIR / disk_filename

    content = await file.read()
    with open(disk_path, "wb") as f:
        f.write(content)

    tenant_ids = []
    if shared_with_tenants.strip():
        tenant_ids = [t.strip() for t in shared_with_tenants.split(",") if t.strip()]

    record = SharedFile(
        id=file_id,
        uploaded_by=user["sub"],
        filename=disk_filename,
        original_filename=file.filename or "file",
        mime_type=file.content_type,
        file_size_bytes=len(content),
        description=description,
        disk_path=str(disk_path),
        shared_with_tenants=tenant_ids,
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return {
        "id": str(record.id),
        "filename": record.original_filename,
        "size": record.file_size_bytes,
        "shared_with": tenant_ids,
    }


@router.get("/")
def list_shared_files(user=Depends(get_current_user), db: Session = Depends(get_db)):
    """List files. master_admin sees all; others see files shared with their tenant."""
    if user.get("role") == "master_admin":
        rows = db.query(SharedFile).order_by(SharedFile.created_at.desc()).all()
    else:
        tenant_id = user["tenant_id"]
        rows = db.query(SharedFile).filter(
            SharedFile.shared_with_tenants.any(tenant_id)
        ).order_by(SharedFile.created_at.desc()).all()

    return [
        {
            "id": str(r.id),
            "filename": r.original_filename,
            "mime_type": r.mime_type,
            "size": r.file_size_bytes,
            "description": r.description,
            "shared_with": [str(t) for t in (r.shared_with_tenants or [])],
            "created_at": r.created_at.isoformat() if r.created_at else None,
        }
        for r in rows
    ]


@router.get("/{file_id}/download")
def download_shared_file(file_id: str, user=Depends(get_current_user), db: Session = Depends(get_db)):
    """Download a shared file. master_admin can download all; others only if shared."""
    record = db.query(SharedFile).filter(SharedFile.id == file_id).first()
    if not record:
        raise HTTPException(404, "File not found")

    if user.get("role") != "master_admin":
        tenant_id = user["tenant_id"]
        if tenant_id not in (record.shared_with_tenants or []):
            raise HTTPException(403, "Access denied")

    from fastapi.responses import FileResponse
    if not os.path.exists(record.disk_path):
        raise HTTPException(404, "File missing from storage")
    return FileResponse(record.disk_path, filename=record.original_filename, media_type=record.mime_type or "application/octet-stream")


@router.patch("/{file_id}/share")
def update_sharing(
    file_id: str,
    tenant_ids: List[str],
    user=Depends(require_master_admin),
    db: Session = Depends(get_db),
):
    """Update which tenants a file is shared with (master_admin only)."""
    record = db.query(SharedFile).filter(SharedFile.id == file_id).first()
    if not record:
        raise HTTPException(404, "File not found")
    record.shared_with_tenants = tenant_ids
    db.commit()
    return {"id": str(record.id), "shared_with": tenant_ids}


@router.delete("/{file_id}")
def delete_shared_file(file_id: str, user=Depends(require_master_admin), db: Session = Depends(get_db)):
    """Delete a shared file (master_admin only)."""
    record = db.query(SharedFile).filter(SharedFile.id == file_id).first()
    if not record:
        raise HTTPException(404, "File not found")
    if os.path.exists(record.disk_path):
        os.remove(record.disk_path)
    db.delete(record)
    db.commit()
    return {"deleted": True}
