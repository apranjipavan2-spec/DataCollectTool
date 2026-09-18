"""Shared in-app inbox notification helper — used by comments.py and feedback.py so the
`in_app_notifications` insert isn't duplicated a third time (billing.py has its own copy,
left as-is; not worth the churn of touching working, unrelated code for this)."""
import logging
from sqlalchemy import text
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)


def create_notification(db: Session, tenant_id: str, recipient_id: str,
                         notif_type: str, title: str, body: str, link: str = "") -> None:
    if not recipient_id or not tenant_id:
        return
    try:
        # in_app_notifications has no migration — only ever created lazily, same as
        # submission_comments used to be. Ensure it exists before inserting rather than
        # silently losing the notification (which is exactly what happened without this).
        from app.api.routes.inbox import _ensure_table
        _ensure_table(db)
        db.execute(text("""
            INSERT INTO in_app_notifications (tenant_id, recipient_id, type, title, body, link)
            VALUES (:tid, :rid, :type, :title, :body, :link)
        """), {"tid": str(tenant_id), "rid": str(recipient_id), "type": notif_type,
               "title": title, "body": body, "link": link})
        db.commit()
    except Exception as e:
        db.rollback()
        logger.warning("create_notification failed (recipient=%s, type=%s): %s", recipient_id, notif_type, e)
