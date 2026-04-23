from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from typing import Optional
from app.core.database import get_db
from app.core.deps import require_role
from app.models.location import Location

router = APIRouter()
require_supervisor = require_role("supervisor")
require_org_admin = require_role("org_admin")
require_enumerator = require_role("enumerator")


@router.get("/")
def list_locations(
    type: Optional[str] = Query(None),
    parent_id: Optional[str] = Query(None),
    user: dict = Depends(require_enumerator),
    db: Session = Depends(get_db),
):
    """List locations. Pass parent_id to get children (e.g. talukas in a district)."""
    q = db.query(Location).filter(Location.tenant_id == user["tenant_id"])
    if type:
        q = q.filter(Location.type == type)
    if parent_id:
        q = q.filter(Location.parent_id == parent_id)
    else:
        if not type:
            q = q.filter(Location.parent_id == None)
    locs = q.order_by(Location.name).all()
    return [{"id": str(l.id), "name": l.name, "type": l.type, "parent_id": str(l.parent_id) if l.parent_id else None, "code": l.code} for l in locs]


@router.get("/tree")
def location_tree(
    user: dict = Depends(require_supervisor),
    db: Session = Depends(get_db),
):
    """Return full location tree for the tenant."""
    all_locs = db.query(Location).filter(Location.tenant_id == user["tenant_id"]).order_by(Location.name).all()
    loc_map = {str(l.id): {"id": str(l.id), "name": l.name, "type": l.type, "parent_id": str(l.parent_id) if l.parent_id else None, "children": []} for l in all_locs}
    roots = []
    for loc in loc_map.values():
        if loc["parent_id"] and loc["parent_id"] in loc_map:
            loc_map[loc["parent_id"]]["children"].append(loc)
        else:
            roots.append(loc)
    return roots
