"""Form assignment endpoints — assign/unassign forms to enumerators."""
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.core.deps import require_supervisor
from app.models.form_assignment import FormAssignment
from app.models.form import Form
from app.models.user import User
from app.api.routes.notifications import send_push
from app.services.email import send_assignment_email

router = APIRouter()


class AssignRequest(BaseModel):
    form_id: str
    enumerator_id: str


@router.get("/")
def list_assignments(
    form_id: str = None,
    enumerator_id: str = None,
    user=Depends(require_supervisor),
    db: Session = Depends(get_db),
):
    """List form assignments, optionally filtered by form or enumerator."""
    q = db.query(FormAssignment, Form.title, User.name).join(
        Form, FormAssignment.form_id == Form.id
    ).join(
        User, FormAssignment.enumerator_id == User.id
    ).filter(FormAssignment.tenant_id == user["tenant_id"])

    if form_id:
        q = q.filter(FormAssignment.form_id == form_id)
    if enumerator_id:
        q = q.filter(FormAssignment.enumerator_id == enumerator_id)

    rows = q.order_by(Form.title, User.name).all()
    return [{
        "id": str(a.id),
        "form_id": str(a.form_id),
        "form_title": form_title,
        "enumerator_id": str(a.enumerator_id),
        "enumerator_name": user_name,
        "assigned_at": a.assigned_at,
    } for a, form_title, user_name in rows]


@router.post("/", status_code=status.HTTP_201_CREATED)
def assign_form(body: AssignRequest, user=Depends(require_supervisor), db: Session = Depends(get_db)):
    """Assign a form to an enumerator."""
    # Verify form exists in tenant
    form = db.query(Form).filter(Form.id == body.form_id, Form.tenant_id == user["tenant_id"]).first()
    if not form:
        raise HTTPException(status_code=404, detail="Form not found")

    # Verify enumerator exists in tenant
    enumerator = db.query(User).filter(User.id == body.enumerator_id, User.tenant_id == user["tenant_id"]).first()
    if not enumerator:
        raise HTTPException(status_code=404, detail="Enumerator not found")

    # Check duplicate
    existing = db.query(FormAssignment).filter(
        FormAssignment.form_id == body.form_id,
        FormAssignment.enumerator_id == body.enumerator_id,
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail="Already assigned")

    assignment = FormAssignment(
        tenant_id=user["tenant_id"],
        form_id=body.form_id,
        enumerator_id=body.enumerator_id,
        assigned_by=user["sub"],
    )
    db.add(assignment)
    db.commit()

    # Auto-notify the enumerator about the new form assignment
    send_push(
        db,
        user_id=body.enumerator_id,
        title="New Form Assigned",
        body=f"You have been assigned the form \"{form.title}\"",
        url="/collect",
    )

    # Send email notification if enumerator has an email address
    enumerator_email = getattr(enumerator, "email", None)
    if enumerator_email:
        send_assignment_email(enumerator_email, enumerator.name, form.title)

    return {"id": str(assignment.id), "status": "assigned"}


@router.delete("/{assignment_id}", status_code=status.HTTP_204_NO_CONTENT)
def unassign_form(assignment_id: str, user=Depends(require_supervisor), db: Session = Depends(get_db)):
    """Remove a form assignment."""
    a = db.query(FormAssignment).filter(
        FormAssignment.id == assignment_id,
        FormAssignment.tenant_id == user["tenant_id"],
    ).first()
    if not a:
        raise HTTPException(status_code=404, detail="Assignment not found")
    db.delete(a)
    db.commit()


@router.post("/bulk")
def bulk_assign(
    form_id: str,
    enumerator_ids: list[str],
    user=Depends(require_supervisor),
    db: Session = Depends(get_db),
):
    """Assign a form to multiple enumerators at once."""
    form = db.query(Form).filter(Form.id == form_id, Form.tenant_id == user["tenant_id"]).first()
    if not form:
        raise HTTPException(status_code=404, detail="Form not found")

    created = 0
    for eid in enumerator_ids:
        existing = db.query(FormAssignment).filter(
            FormAssignment.form_id == form_id,
            FormAssignment.enumerator_id == eid,
        ).first()
        if not existing:
            db.add(FormAssignment(
                tenant_id=user["tenant_id"],
                form_id=form_id,
                enumerator_id=eid,
                assigned_by=user["sub"],
            ))
            created += 1

    db.commit()
    return {"assigned": created, "form_id": form_id}
