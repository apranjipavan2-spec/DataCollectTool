"""
Submission comments — threaded review between supervisors and enumerators.
GET/POST /submissions/{id}/comments
DELETE   /submissions/{id}/comments/{comment_id}
"""
import logging
import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException

logger = logging.getLogger(__name__)
from sqlalchemy import Column, String, Text, DateTime, ForeignKey, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Session

from app.core.database import Base, get_db
from app.core.deps import require_enumerator, require_supervisor

router = APIRouter()
require_any = require_enumerator  # enumerators can read/post their own comments


class SubmissionComment(Base):
    __tablename__ = "submission_comments"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    submission_id = Column(UUID(as_uuid=True), ForeignKey("submissions.id", ondelete="CASCADE"), nullable=False)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    author_id = Column(UUID(as_uuid=True), nullable=False)
    author_name = Column(String, nullable=False, default="")
    author_role = Column(String, nullable=False, default="")
    body = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


def _ensure_table(db: Session):
    from sqlalchemy import inspect, text
    insp = inspect(db.bind)
    if "submission_comments" not in insp.get_table_names():
        db.execute(text("""
            CREATE TABLE IF NOT EXISTS submission_comments (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                submission_id UUID NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
                tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
                author_id UUID NOT NULL,
                author_name VARCHAR NOT NULL DEFAULT '',
                author_role VARCHAR NOT NULL DEFAULT '',
                body TEXT NOT NULL,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                deleted_at TIMESTAMPTZ
            )
        """))
        db.execute(text("CREATE INDEX IF NOT EXISTS idx_comments_submission ON submission_comments(submission_id)"))
        db.commit()
    else:
        # Table predates soft-delete — add the column if it's missing.
        db.execute(text("ALTER TABLE submission_comments ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ"))
        db.commit()


@router.get("/submissions/{submission_id}/comments")
def list_comments(submission_id: str, user: dict = Depends(require_any), db: Session = Depends(get_db)):
    _ensure_table(db)
    from sqlalchemy import text
    rows = db.execute(text(
        "SELECT id, author_name, author_role, body, created_at FROM submission_comments "
        "WHERE submission_id = :sid AND tenant_id = :tid AND deleted_at IS NULL "
        "ORDER BY created_at ASC"
    ), {"sid": submission_id, "tid": str(user["tenant_id"])}).fetchall()
    return [{"id": str(r[0]), "author_name": r[1], "author_role": r[2],
             "body": r[3], "created_at": r[4].isoformat() if r[4] else None} for r in rows]


@router.post("/submissions/{submission_id}/comments", status_code=201)
def post_comment(submission_id: str, body: dict, user: dict = Depends(require_any), db: Session = Depends(get_db)):
    _ensure_table(db)
    text_body = (body.get("body") or "").strip()
    if not text_body:
        raise HTTPException(400, "body required")

    from sqlalchemy import text as sa_text
    from app.models.user import User
    author = db.query(User).filter(User.id == user["sub"]).first()
    author_name = author.name if author else "Unknown"

    cid = str(uuid.uuid4())
    db.execute(sa_text("""
        INSERT INTO submission_comments (id, submission_id, tenant_id, author_id, author_name, author_role, body)
        VALUES (:id, :sid, :tid, :aid, :aname, :arole, :body)
    """), {
        "id": cid, "sid": submission_id, "tid": str(user["tenant_id"]),
        "aid": str(user["sub"]), "aname": author_name,
        "arole": user.get("role", ""), "body": text_body,
    })
    db.commit()

    # Fire in-app notification to submission enumerator
    try:
        from sqlalchemy import text as t2
        sub = db.execute(t2("SELECT enumerator_id FROM submissions WHERE id=:id"), {"id": submission_id}).fetchone()
        if sub and str(sub[0]) != str(user["sub"]):
            _create_notification(db, str(user["tenant_id"]), str(sub[0]),
                                 "comment", f"New comment from {author_name}",
                                 text_body[:120], f"/submissions/{submission_id}")
    except Exception as e:
        logger.warning("Comment notification failed for submission %s: %s", submission_id, e)

    return {"id": cid, "author_name": author_name, "author_role": user.get("role", ""),
            "body": text_body, "created_at": datetime.now(timezone.utc).isoformat()}


@router.delete("/submissions/{submission_id}/comments/{comment_id}", status_code=204)
def delete_comment(submission_id: str, comment_id: str,
                   user: dict = Depends(require_supervisor), db: Session = Depends(get_db)):
    from sqlalchemy import text
    # Soft-delete: hide it, keep it recoverable, purge after 360 days.
    db.execute(text(
        "UPDATE submission_comments SET deleted_at = NOW() "
        "WHERE id=:cid AND tenant_id=:tid AND deleted_at IS NULL"
    ), {"cid": comment_id, "tid": str(user["tenant_id"])})
    db.commit()


def _create_notification(db: Session, tenant_id: str, recipient_id: str,
                          notif_type: str, title: str, body: str, link: str = ""):
    """Helper used by comments + other modules to fire in-app notifications."""
    from sqlalchemy import text
    try:
        db.execute(text("""
            INSERT INTO in_app_notifications (tenant_id, recipient_id, type, title, body, link)
            VALUES (:tid, :rid, :type, :title, :body, :link)
        """), {"tid": tenant_id, "rid": recipient_id, "type": notif_type,
               "title": title, "body": body, "link": link})
        db.commit()
    except Exception:
        db.rollback()
