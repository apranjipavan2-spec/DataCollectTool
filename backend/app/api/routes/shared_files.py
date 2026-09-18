"""Shared Files — master_admin uploads files and shares with tenants."""
import os
import uuid
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from pydantic import BaseModel
from sqlalchemy.orm import Session
from typing import List
from sqlalchemy import or_
from app.core.deps import get_current_user, get_db
from app.models.shared_file import SharedFile
from app.core.soft_delete import soft_delete

router = APIRouter(prefix="/shared-files", tags=["shared-files"])

SHARED_FILES_DIR = Path(os.environ.get("MEDIA_DIR", "uploads")) / "shared_files"
SHARED_FILES_DIR.mkdir(parents=True, exist_ok=True)


@router.post("/")
async def upload_shared_file(
    file: UploadFile = File(...),
    description: str = Form(""),
    shared_with_tenants: str = Form(""),
    folder_param: str = Form(""),
    user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Upload a file (master_admin or org_admin). Optionally share with tenant IDs (comma-separated)."""
    if user.get("role") not in ("master_admin", "org_admin"):
        raise HTTPException(403, "Only admins can upload files")
    file_id = str(uuid.uuid4())
    original_name = file.filename or "file"
    folder = folder_param
    ext = Path(original_name).suffix
    disk_filename = f"{file_id}{ext}"
    disk_path = SHARED_FILES_DIR / disk_filename

    content = await file.read()
    with open(disk_path, "wb") as f:
        f.write(content)

    tenant_ids = []
    if shared_with_tenants.strip():
        tenant_ids = [t.strip() for t in shared_with_tenants.split(",") if t.strip()]

    # Auto-rename if duplicate exists in same folder
    base_name = Path(original_name).stem
    display = original_name
    existing_names = {
        r.display_name or r.original_filename
        for r in db.query(SharedFile.display_name, SharedFile.original_filename).filter(
            SharedFile.uploaded_by == user["sub"],
            SharedFile.folder == folder,
        ).all()
    }
    counter = 1
    while display in existing_names:
        display = f"{base_name}_{counter}{ext}"
        counter += 1

    record = SharedFile(
        id=file_id,
        tenant_id=user["tenant_id"],
        uploaded_by=user["sub"],
        filename=disk_filename,
        original_filename=original_name,
        mime_type=file.content_type,
        file_size_bytes=len(content),
        description=description,
        disk_path=str(disk_path),
        shared_with_tenants=tenant_ids,
        folder=folder,
        display_name=display,
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


@router.get("/folders")
def list_folders(user=Depends(get_current_user), db: Session = Depends(get_db)):
    """List distinct folder names — files the caller uploaded or that are shared with their tenant."""
    user_id = user["sub"]
    tenant_id = user["tenant_id"]
    rows = db.query(SharedFile.folder).filter(
        or_(
            SharedFile.shared_with_tenants.any(tenant_id),
            SharedFile.uploaded_by == user_id,
        )
    ).distinct().all()
    return [r[0] for r in rows if r[0]]


class CreateFolderRequest(BaseModel):
    name: str


@router.post("/folders")
def create_folder(body: CreateFolderRequest, user=Depends(get_current_user), db: Session = Depends(get_db)):
    if user.get("role") not in ("master_admin", "org_admin"):
        raise HTTPException(403, "Only admins can create folders")
    # Folders are virtual - just return the name. Files reference folders by name.
    return {"folder": body.name.strip()}


@router.get("/")
def list_shared_files(folder: str = "", user=Depends(get_current_user), db: Session = Depends(get_db)):
    """List files the caller uploaded or that are shared with their tenant."""
    tenant_id = user["tenant_id"]
    user_id = user["sub"]
    rows = db.query(SharedFile).filter(
        or_(
            SharedFile.shared_with_tenants.any(tenant_id),
            SharedFile.uploaded_by == user_id,
        )
    ).order_by(SharedFile.created_at.desc()).all()

    if folder:
        rows = [r for r in rows if (r.folder or "") == folder]

    return [
        {
            "id": str(r.id),
            "filename": r.original_filename,
            "mime_type": r.mime_type,
            "size": r.file_size_bytes,
            "description": r.description,
            "shared_with": [str(t) for t in (r.shared_with_tenants or [])],
            "created_at": r.created_at.isoformat() if r.created_at else None,
            "folder": r.folder or "",
            "display_name": r.display_name or r.original_filename,
        }
        for r in rows
    ]


@router.get("/{file_id}/download")
def download_shared_file(file_id: str, user=Depends(get_current_user), db: Session = Depends(get_db)):
    """Download a shared file. Must be the uploader or have the tenant listed in shared_with_tenants."""
    record = db.query(SharedFile).filter(SharedFile.id == file_id).first()
    if not record:
        raise HTTPException(404, "File not found")

    tenant_id = user["tenant_id"]
    if str(record.uploaded_by) != user["sub"] and tenant_id not in (record.shared_with_tenants or []):
        raise HTTPException(403, "Access denied")

    from fastapi.responses import FileResponse
    if not os.path.exists(record.disk_path):
        raise HTTPException(404, "File missing from storage")
    return FileResponse(record.disk_path, filename=record.original_filename, media_type=record.mime_type or "application/octet-stream")


class RenameRequest(BaseModel):
    new_name: str


@router.patch("/{file_id}/rename")
def rename_shared_file(file_id: str, body: RenameRequest, user=Depends(get_current_user), db: Session = Depends(get_db)):
    record = db.query(SharedFile).filter(SharedFile.id == file_id).first()
    if not record:
        raise HTTPException(404, "File not found")
    if str(record.uploaded_by) != user["sub"]:
        raise HTTPException(403, "Only the uploader can rename a file")
    record.display_name = body.new_name.strip()
    db.commit()
    return {"id": str(record.id), "display_name": record.display_name}


@router.get("/{file_id}/csv-data")
def get_csv_data(file_id: str, user=Depends(get_current_user), db: Session = Depends(get_db)):
    """Return CSV file content as JSON rows for Analyzer/Cleaner tools."""
    record = db.query(SharedFile).filter(SharedFile.id == file_id).first()
    if not record:
        raise HTTPException(404, "File not found")

    tenant_id = user["tenant_id"]
    if str(record.uploaded_by) != user["sub"] and tenant_id not in (record.shared_with_tenants or []):
        raise HTTPException(403, "Access denied")

    if not os.path.exists(record.disk_path):
        raise HTTPException(404, "File missing from storage")

    import csv
    import io
    with open(record.disk_path, "r", encoding="utf-8-sig") as f:
        content = f.read()

    reader = csv.DictReader(io.StringIO(content))
    headers = reader.fieldnames or []
    data_rows = [dict(r) for r in reader]

    return {"headers": list(headers), "rows": data_rows[:5000], "total_rows": len(data_rows), "filename": record.display_name or record.original_filename}


@router.patch("/{file_id}/share")
def update_sharing(
    file_id: str,
    tenant_ids: List[str],
    user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Update which tenants a file is shared with. Only the uploader can change sharing."""
    record = db.query(SharedFile).filter(SharedFile.id == file_id).first()
    if not record:
        raise HTTPException(404, "File not found")
    if str(record.uploaded_by) != user["sub"]:
        raise HTTPException(403, "Only the uploader can change sharing")
    record.shared_with_tenants = tenant_ids
    db.commit()
    return {"id": str(record.id), "shared_with": tenant_ids}


@router.delete("/{file_id}")
def delete_shared_file(file_id: str, user=Depends(get_current_user), db: Session = Depends(get_db)):
    """Delete a shared file. Only the uploader can delete."""
    record = db.query(SharedFile).filter(SharedFile.id == file_id).first()
    if not record:
        raise HTTPException(404, "File not found")
    if str(record.uploaded_by) != user["sub"]:
        raise HTTPException(403, "Only the uploader can delete this file")
    # Soft-delete: keep the file on disk so it can be restored from the Bin.
    # The 360-day purge job removes the disk file when it hard-deletes the row.
    soft_delete(record)
    db.commit()
    return {"deleted": True}
