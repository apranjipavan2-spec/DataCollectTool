"""
Soft-delete infrastructure — nothing is hard-deleted; it goes to a 360-day bin.

A `SoftDeleteMixin` adds a nullable `deleted_at` column. A single SQLAlchemy
`do_orm_execute` listener auto-excludes any soft-deleted row from every ORM
SELECT, so binned records disappear from normal lists without touching a dozen
queries. Queries that need to see binned rows (the Bin view, restore, purge)
opt in with `.execution_options(include_deleted=True)`.

Restore just clears `deleted_at`. A scheduled job hard-deletes rows whose
`deleted_at` is older than RETENTION_DAYS.
"""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import DateTime, Column, event
from sqlalchemy.orm import Session, with_loader_criteria

RETENTION_DAYS = 360


class SoftDeleteMixin:
    """Mix into a model to make its rows go to the 360-day bin instead of vanishing."""
    deleted_at = Column(DateTime(timezone=True), nullable=True, index=True)


@event.listens_for(Session, "do_orm_execute")
def _exclude_soft_deleted(execute_state) -> None:
    if (
        execute_state.is_select
        and not execute_state.is_column_load
        and not execute_state.is_relationship_load
        and not execute_state.execution_options.get("include_deleted", False)
    ):
        execute_state.statement = execute_state.statement.options(
            with_loader_criteria(
                SoftDeleteMixin,
                lambda cls: cls.deleted_at.is_(None),
                include_aliases=True,
            )
        )


def soft_delete(obj) -> None:
    """Flag a row as binned. Caller commits."""
    obj.deleted_at = datetime.now(timezone.utc)


def restore(obj) -> None:
    obj.deleted_at = None


# ── Bin registry ──────────────────────────────────────────────────────────────
# entity_type -> model. The label for a binned row is resolved from the first
# present of _LABEL_ATTRS, so we don't hard-code each model's naming column.

_LABEL_ATTRS = ("name", "title", "label", "original_filename", "display_name",
                "filename", "url", "event")


def label_for(obj) -> str:
    for attr in _LABEL_ATTRS:
        val = getattr(obj, attr, None)
        if val:
            return str(val)
    return str(getattr(obj, "id", ""))


def _build_registry() -> dict:
    # Imported here to avoid a circular import at module load.
    from app.models.roster import RespondentRoster
    from app.models.shared_file import SharedFile
    from app.models.form_assignment import FormAssignment
    from app.models.program import (
        Program, ProgramLocation, ProgramParticipantType,
        ProgramQuestionnaire, QuestionnaireLocationTarget,
    )
    from app.models.location import Location
    from app.models.scheduled_report import ScheduledReport
    from app.models.webhook import Webhook

    return {
        "respondent":       (RespondentRoster,            "Respondent"),
        "shared_file":      (SharedFile,                  "Shared file"),
        "assignment":       (FormAssignment,              "Form assignment"),
        "program":          (Program,                     "Program"),
        "program_location": (ProgramLocation,             "Program location"),
        "participant_type": (ProgramParticipantType,      "Participant type"),
        "questionnaire":    (ProgramQuestionnaire,        "Questionnaire"),
        "location_target":  (QuestionnaireLocationTarget, "Location target"),
        "location":         (Location,                    "Location"),
        "scheduled_report": (ScheduledReport,             "Scheduled report"),
        "webhook":          (Webhook,                     "Webhook"),
    }


_REGISTRY: dict | None = None


def registry() -> dict:
    global _REGISTRY
    if _REGISTRY is None:
        _REGISTRY = _build_registry()
    return _REGISTRY
