"""
In-app notification inbox.
Separate from WhatsApp/web-push notifications (notifications.py).

GET  /inbox/          — list unread + recent (last 50)
POST /inbox/read-all  — mark all read
PATCH /inbox/{id}/read — mark one read
"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import text

from app.core.database import get_db
from app.core.deps import require_enumerator

router = APIRouter()


def _ensure_table(db: Session):
    db.execute(text("""
        CREATE TABLE IF NOT EXISTS in_app_notifications (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id UUID NOT NULL,
            recipient_id UUID NOT NULL,
            type VARCHAR(50) NOT NULL DEFAULT 'info',
            title VARCHAR(200) NOT NULL DEFAULT '',
            body TEXT NOT NULL DEFAULT '',
            link VARCHAR(500) NOT NULL DEFAULT '',
            read BOOLEAN NOT NULL DEFAULT FALSE,
            created_at TIMESTAMPTZ DEFAULT NOW()
        )
    """))
    db.execute(text(
        "CREATE INDEX IF NOT EXISTS idx_inbox_recipient ON in_app_notifications(recipient_id, read, created_at DESC)"
    ))
    db.commit()


@router.get("/inbox/")
def list_inbox(user: dict = Depends(require_enumerator), db: Session = Depends(get_db)):
    _ensure_table(db)
    rows = db.execute(text("""
        SELECT id, type, title, body, link, read, created_at
        FROM in_app_notifications
        WHERE recipient_id = :rid AND tenant_id = :tid
        ORDER BY created_at DESC LIMIT 50
    """), {"rid": str(user["sub"]), "tid": str(user["tenant_id"])}).fetchall()

    unread_count = sum(1 for r in rows if not r[5])
    return {
        "unread_count": unread_count,
        "items": [{
            "id": str(r[0]), "type": r[1], "title": r[2],
            "body": r[3], "link": r[4], "read": r[5],
            "created_at": r[6].isoformat() if r[6] else None,
        } for r in rows],
    }


@router.post("/inbox/read-all", status_code=204)
def mark_all_read(user: dict = Depends(require_enumerator), db: Session = Depends(get_db)):
    _ensure_table(db)
    db.execute(text(
        "UPDATE in_app_notifications SET read=TRUE WHERE recipient_id=:rid AND tenant_id=:tid AND read=FALSE"
    ), {"rid": str(user["sub"]), "tid": str(user["tenant_id"])})
    db.commit()


@router.patch("/inbox/{notif_id}/read", status_code=204)
def mark_one_read(notif_id: str, user: dict = Depends(require_enumerator), db: Session = Depends(get_db)):
    _ensure_table(db)
    db.execute(text(
        "UPDATE in_app_notifications SET read=TRUE WHERE id=:id AND recipient_id=:rid"
    ), {"id": notif_id, "rid": str(user["sub"])})
    db.commit()
