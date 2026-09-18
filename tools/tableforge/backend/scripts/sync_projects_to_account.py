"""One-off (not wired into any route): upsert the current, complete local
.tableforge project files into the FieldGovern-account project store
(user_tool_projects), and archive stale/superseded rows there.

Must run inside the main app container (needs app.core.database +
app.models.user_tool_project). Project JSON files are expected to already be
copied into this container (see the workflow that invokes this).

Read/write to user_tool_projects ONLY. Never touches the local .tableforge
files themselves.
"""
import json
import sys
from pathlib import Path

from app.core.database import SessionLocal
from app.models.user_tool_project import UserToolProject

TOOL = "analyzer"


def upsert(db, tenant_id, user_id, name, data):
    existing = db.query(UserToolProject).filter(
        UserToolProject.user_id == user_id,
        UserToolProject.tenant_id == tenant_id,
        UserToolProject.tool == TOOL,
        UserToolProject.name == name,
    ).first()
    if existing:
        before = len((existing.data or {}).get("tables") or [])
        existing.data = data
        existing.archived_at = None
        db.commit()
        after = len(data.get("tables") or [])
        print(f"UPDATED {name!r}: {before} -> {after} tables")
    else:
        proj = UserToolProject(tenant_id=tenant_id, user_id=user_id, tool=TOOL, name=name, data=data)
        db.add(proj)
        db.commit()
        print(f"CREATED {name!r}: {len(data.get('tables') or [])} tables")


def archive(db, tenant_id, user_id, name):
    from datetime import datetime, timezone
    existing = db.query(UserToolProject).filter(
        UserToolProject.user_id == user_id,
        UserToolProject.tenant_id == tenant_id,
        UserToolProject.tool == TOOL,
        UserToolProject.name == name,
    ).first()
    if existing:
        existing.archived_at = datetime.now(timezone.utc)
        db.commit()
        print(f"ARCHIVED {name!r} ({len((existing.data or {}).get('tables') or [])} tables)")
    else:
        print(f"SKIP archive {name!r}: not found")


def project_data_from_file(path: str) -> dict:
    raw = json.loads(Path(path).read_text())
    return {
        "tables": raw.get("tables") or [],
        "annotationsMap": raw.get("annotationsMap") or {},
        "comparisonState": raw.get("comparisonState"),
        "projectFilters": raw.get("projectFilters") or {},
        "columnTypeOverrides": raw.get("columnTypeOverrides") or {},
        "tableInterpretations": raw.get("tableInterpretations") or {},
    }


def main():
    # argv: tenant_id user_id  name1=path1  name2=path2 ...  --archive nameA,nameB
    tenant_id, user_id = sys.argv[1], sys.argv[2]
    rest = sys.argv[3:]
    archive_names = []
    upserts = []
    i = 0
    while i < len(rest):
        if rest[i] == "--archive":
            archive_names = [n for n in rest[i + 1].split(",") if n]
            i += 2
            continue
        name, path = rest[i].split("=", 1)
        upserts.append((name, path))
        i += 1

    db = SessionLocal()
    for name, path in upserts:
        data = project_data_from_file(path)
        upsert(db, tenant_id, user_id, name, data)
    for name in archive_names:
        archive(db, tenant_id, user_id, name)
    db.close()


if __name__ == "__main__":
    main()
