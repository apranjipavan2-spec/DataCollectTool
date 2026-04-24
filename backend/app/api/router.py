from fastapi import APIRouter
from app.api.routes import (
    auth, forms, submissions, users, sync, export, assignments, history,
    schedules, tenants, notifications, api_keys, webhooks, reports,
    templates, import_excel, bulk_upload, programs, admin_monitor, ai,
    field_govern,
)
from app.api.routes.migration.router import router as migration_router
from app.api.routes import public_survey, roster, analytics, locations

router = APIRouter()

router.include_router(auth.router, prefix="/auth", tags=["auth"])
router.include_router(forms.router, prefix="/forms", tags=["forms"])
router.include_router(submissions.router, prefix="/submissions", tags=["submissions"])
router.include_router(users.router, prefix="/users", tags=["users"])
router.include_router(sync.router, prefix="/sync", tags=["sync"])
router.include_router(export.router, prefix="/export", tags=["export"])
router.include_router(assignments.router, prefix="/assignments", tags=["assignments"])
router.include_router(history.router, prefix="/history", tags=["history"])
router.include_router(schedules.router, prefix="/schedules", tags=["schedules"])
router.include_router(tenants.router, prefix="/tenants", tags=["tenants"])
router.include_router(notifications.router, prefix="/notifications", tags=["notifications"])
router.include_router(api_keys.router)
router.include_router(webhooks.router, prefix="/webhooks", tags=["webhooks"])
router.include_router(reports.router, prefix="/reports", tags=["reports"])
router.include_router(templates.router, prefix="/templates", tags=["templates"])
router.include_router(import_excel.router, prefix="/forms", tags=["forms"])
router.include_router(bulk_upload.router, prefix="/bulk-upload", tags=["bulk-upload"])
router.include_router(programs.router, prefix="/programs", tags=["programs"])
router.include_router(admin_monitor.router)
router.include_router(migration_router, prefix="/migration", tags=["migration"])
router.include_router(public_survey.router, tags=["public-survey"])
router.include_router(roster.router, prefix="/roster", tags=["roster"])
router.include_router(analytics.router, prefix="/analytics", tags=["analytics"])
router.include_router(ai.router, prefix="/ai", tags=["ai"])
router.include_router(locations.router, prefix="/locations", tags=["locations"])
router.include_router(field_govern.router, prefix="/fg", tags=["field-govern"])
