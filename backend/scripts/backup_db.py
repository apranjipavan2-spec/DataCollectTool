"""
Backup all database tables to JSON files.
Usage:
    DATABASE_URL="postgresql://..." python scripts/backup_db.py
    # or if .env exists:
    python scripts/backup_db.py

Output: backups/backup_YYYYMMDD_HHMMSS/  (one .json per table)
"""
import os, sys, json, datetime
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

import psycopg2
from psycopg2.extras import RealDictCursor

DATABASE_URL = os.environ.get("DATABASE_URL")
if not DATABASE_URL:
    raise SystemExit("DATABASE_URL env var not set")

TABLES = [
    "tenants", "users", "forms", "form_versions", "form_assignments",
    "submissions", "submission_history", "media_files", "sync_log",
    "schedules", "push_subscriptions", "api_keys", "webhooks",
    "programs", "program_locations", "program_participant_types",
    "program_questionnaires", "questionnaire_location_targets",
]

ts = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
out_dir = os.path.join(os.path.dirname(__file__), "..", "backups", f"backup_{ts}")
os.makedirs(out_dir, exist_ok=True)

conn = psycopg2.connect(DATABASE_URL)
cur = conn.cursor(cursor_factory=RealDictCursor)

summary = {}
for table in TABLES:
    try:
        cur.execute(f"SELECT * FROM {table}")
        rows = [dict(r) for r in cur.fetchall()]
        # Convert non-serialisable types
        for row in rows:
            for k, v in row.items():
                if hasattr(v, 'isoformat'):
                    row[k] = v.isoformat()
                elif not isinstance(v, (str, int, float, bool, list, dict, type(None))):
                    row[k] = str(v)
        path = os.path.join(out_dir, f"{table}.json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(rows, f, indent=2, ensure_ascii=False)
        summary[table] = len(rows)
        print(f"  {table:40s} {len(rows):>6} rows → {table}.json")
    except Exception as e:
        print(f"  {table:40s} SKIPPED ({e})")
        summary[table] = f"ERROR: {e}"

cur.close()
conn.close()

meta = {"backed_up_at": ts, "tables": summary}
with open(os.path.join(out_dir, "_meta.json"), "w") as f:
    json.dump(meta, f, indent=2)

total = sum(v for v in summary.values() if isinstance(v, int))
print(f"\n✓ Backup complete → backups/backup_{ts}/")
print(f"  {len(TABLES)} tables · {total} total rows")
