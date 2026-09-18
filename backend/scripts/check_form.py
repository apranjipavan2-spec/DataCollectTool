"""Read-only check: does a form exist server-side? Usage:

    DATABASE_URL='<prod-url>' python backend/scripts/check_form.py [search-term]

Defaults to searching for 'sangwari'. Prints matching forms (id, tenant, title,
status, created_at) or "NO MATCHING FORMS". SELECT only — writes nothing.
"""
import sys
from sqlalchemy import text
from app.core.database import SessionLocal

term = (sys.argv[1] if len(sys.argv) > 1 else "sangwari").lower()

db = SessionLocal()
try:
    rows = db.execute(text(
        "SELECT id, tenant_id, title, status, created_at "
        "FROM forms WHERE LOWER(title) LIKE :t ORDER BY created_at DESC"
    ), {"t": f"%{term}%"}).fetchall()
    if not rows:
        print(f'NO MATCHING FORMS for "{term}" — nothing was saved server-side.')
    else:
        print(f'{len(rows)} form(s) matching "{term}":')
        for r in rows:
            print(f"  {r.id} | tenant={r.tenant_id} | {r.title!r} | {r.status} | {r.created_at}")
finally:
    db.close()
