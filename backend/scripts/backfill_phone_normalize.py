"""
One-time backfill: normalize existing user phones to the canonical +91 form so
they match what the login page sends (10 digits -> +91XXXXXXXXXX).

Fixes users added before the phone-normalize fix (e.g. a supervisor saved as
'9752546653' who could never log in because login looks up '+919752546653').

Usage:
    python scripts/backfill_phone_normalize.py           # dry run (shows changes)
    python scripts/backfill_phone_normalize.py --apply   # write changes
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import app.models  # noqa
from app.core.database import SessionLocal
from app.core.phone import normalize_phone
from app.models.user import User

apply = "--apply" in sys.argv

db = SessionLocal()
try:
    users = db.query(User).all()
    # Map of already-taken normalized phones -> user id, to detect collisions.
    taken = {u.phone: str(u.id) for u in users}

    changed = 0
    skipped = 0
    for u in users:
        new_phone = normalize_phone(u.phone or "")
        if new_phone == u.phone:
            continue
        # Collision: another user already owns the normalized phone.
        if new_phone in taken and taken[new_phone] != str(u.id):
            print(f"  ! SKIP  {u.phone!r} -> {new_phone!r}  (already used by another user)  [{u.name}]")
            skipped += 1
            continue
        print(f"  {'✓' if apply else '·'} {u.phone!r} -> {new_phone!r}  [{u.name}]")
        if apply:
            del taken[u.phone]
            u.phone = new_phone
            taken[new_phone] = str(u.id)
        changed += 1

    if apply:
        db.commit()
        print(f"\nDone — {changed} phones normalized, {skipped} skipped.")
    else:
        print(f"\nDry run — {changed} would change, {skipped} would be skipped.")
        print("Re-run with --apply to write changes.")
finally:
    db.close()
