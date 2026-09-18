"""Add data_rights_requests table — DPDP data-principal rights workflow
(access/correction/erasure/portability requests, tracked as staff-logged
cases with an SLA due date and optional nominee).

Idempotent — safe to re-run.
"""
import sqlalchemy as sa
from alembic import op

revision = "0058"
down_revision = "0057"
branch_labels = None
depends_on = None


def upgrade():
    conn = op.get_bind()
    conn.execute(sa.text("""
        CREATE TABLE IF NOT EXISTS data_rights_requests (
            id UUID PRIMARY KEY,
            tenant_id UUID NOT NULL REFERENCES tenants(id),
            logged_by UUID REFERENCES users(id),
            request_type VARCHAR NOT NULL,
            requester_name VARCHAR NOT NULL,
            requester_contact VARCHAR NOT NULL,
            nominee_name VARCHAR,
            nominee_contact VARCHAR,
            status VARCHAR NOT NULL DEFAULT 'open',
            identity_verified BOOLEAN NOT NULL DEFAULT FALSE,
            linked_submission_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
            resolution_note VARCHAR,
            closed_at TIMESTAMPTZ,
            closed_by UUID REFERENCES users(id),
            sla_due_at TIMESTAMPTZ NOT NULL,
            deleted_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ DEFAULT now(),
            updated_at TIMESTAMPTZ DEFAULT now()
        )
    """))
    conn.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS ix_data_rights_requests_tenant_id ON data_rights_requests (tenant_id)"
    ))
    conn.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS ix_data_rights_requests_status ON data_rights_requests (tenant_id, status)"
    ))
    conn.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS ix_data_rights_requests_sla_due_at ON data_rights_requests (sla_due_at)"
    ))


def downgrade():
    conn = op.get_bind()
    conn.execute(sa.text("DROP TABLE IF EXISTS data_rights_requests"))
