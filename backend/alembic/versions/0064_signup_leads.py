"""Add signup_leads — emails/phones captured by the chatbot and signup attempts.

Idempotent — safe to re-run.
"""
import sqlalchemy as sa
from alembic import op

revision = "0064"
down_revision = "0063"
branch_labels = None
depends_on = None


def upgrade():
    conn = op.get_bind()
    conn.execute(sa.text("""
        CREATE TABLE IF NOT EXISTS signup_leads (
            id BIGSERIAL PRIMARY KEY,
            email VARCHAR(320) NOT NULL UNIQUE,
            phone VARCHAR(32),
            name VARCHAR(200),
            org_name VARCHAR(200),
            source VARCHAR(32) NOT NULL,
            status VARCHAR(16) NOT NULL DEFAULT 'lead',
            attempts INTEGER NOT NULL DEFAULT 1,
            note TEXT,
            ip VARCHAR(64),
            created_at TIMESTAMPTZ DEFAULT now(),
            last_seen_at TIMESTAMPTZ DEFAULT now()
        )
    """))
    conn.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_signup_leads_last_seen_at ON signup_leads (last_seen_at)"))


def downgrade():
    conn = op.get_bind()
    conn.execute(sa.text("DROP TABLE IF EXISTS signup_leads"))
