"""Add user_tool_projects table"""
from alembic import op

revision = '0029'
down_revision = '0028'


def upgrade():
    op.execute("""
        CREATE TABLE IF NOT EXISTS user_tool_projects (
            id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id   UUID NOT NULL REFERENCES tenants(id)  ON DELETE CASCADE,
            user_id     UUID NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
            tool        VARCHAR(20)  NOT NULL,
            name        VARCHAR(255) NOT NULL,
            program_id  UUID REFERENCES programs(id) ON DELETE SET NULL,
            data        JSONB NOT NULL DEFAULT '{}',
            created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_utp_user_tool ON user_tool_projects (user_id, tool)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_utp_tenant    ON user_tool_projects (tenant_id)")


def downgrade():
    op.execute("DROP TABLE IF EXISTS user_tool_projects")
