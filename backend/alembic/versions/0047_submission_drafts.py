"""Add submission_drafts table.

Server-side backup of half-filled forms (Save & Exit). Kept separate from
`submissions` so drafts never touch counts, quota, dashboards, or webhooks.
Idempotent — safe to re-run.
"""
import sqlalchemy as sa
from alembic import op

revision = "0047"
down_revision = "0046"
branch_labels = None
depends_on = None


def upgrade():
    conn = op.get_bind()
    # DO block instead of CREATE TABLE IF NOT EXISTS: the latter's existence check
    # isn't atomic with the create, so a concurrent/retried deploy can lose the race
    # and fail on pg_type ("submission_drafts already exists"). Swallow that here.
    conn.execute(sa.text(
        """
        DO $$ BEGIN
            CREATE TABLE submission_drafts (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                tenant_id UUID NOT NULL REFERENCES tenants(id),
                enumerator_id UUID NOT NULL REFERENCES users(id),
                form_id UUID NOT NULL REFERENCES forms(id),
                form_version INTEGER,
                local_id VARCHAR NOT NULL,
                data_json JSONB NOT NULL,
                gps_open JSONB,
                gps_submit JSONB,
                local_created_at TIMESTAMPTZ,
                updated_at TIMESTAMPTZ DEFAULT now(),
                CONSTRAINT uq_draft_enum_local UNIQUE (enumerator_id, local_id)
            );
        EXCEPTION
            WHEN duplicate_table THEN NULL;
            WHEN unique_violation THEN NULL;
        END $$;
        """
    ))
    conn.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS ix_submission_drafts_tenant_id ON submission_drafts (tenant_id)"
    ))
    conn.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS ix_submission_drafts_enumerator_id ON submission_drafts (enumerator_id)"
    ))


def downgrade():
    op.get_bind().execute(sa.text("DROP TABLE IF EXISTS submission_drafts"))
