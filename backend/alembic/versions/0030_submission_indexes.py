"""Add missing indexes on submissions for program/tenant/enumerator/questionnaire queries"""
import sqlalchemy as sa
from alembic import op

revision = '0030'
down_revision = '0029'


def upgrade():
    conn = op.get_bind()
    # Use autocommit so CONCURRENTLY works (it cannot run inside a transaction block)
    conn = conn.execution_options(isolation_level="AUTOCOMMIT")
    conn.execute(sa.text("""
        CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_sub_tenant_program
            ON submissions (tenant_id, program_id)
            WHERE program_id IS NOT NULL
    """))
    conn.execute(sa.text("""
        CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_sub_tenant_program_recv
            ON submissions (tenant_id, program_id, server_received_at DESC)
            WHERE program_id IS NOT NULL
    """))
    conn.execute(sa.text("CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_sub_questionnaire ON submissions (questionnaire_id) WHERE questionnaire_id IS NOT NULL"))
    conn.execute(sa.text("CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_sub_enumerator    ON submissions (enumerator_id)"))
    conn.execute(sa.text("CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_sub_tenant_status ON submissions (tenant_id, status)"))
    conn.execute(sa.text("CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_sub_tenant_recvd  ON submissions (tenant_id, server_received_at DESC)"))
    conn.execute(sa.text("""
        CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_sub_form_recvd
            ON submissions (form_id, server_received_at DESC)
    """))


def downgrade():
    conn = op.get_bind()
    conn = conn.execution_options(isolation_level="AUTOCOMMIT")
    conn.execute(sa.text("DROP INDEX CONCURRENTLY IF EXISTS ix_sub_tenant_program"))
    conn.execute(sa.text("DROP INDEX CONCURRENTLY IF EXISTS ix_sub_tenant_program_recv"))
    conn.execute(sa.text("DROP INDEX CONCURRENTLY IF EXISTS ix_sub_questionnaire"))
    conn.execute(sa.text("DROP INDEX CONCURRENTLY IF EXISTS ix_sub_enumerator"))
    conn.execute(sa.text("DROP INDEX CONCURRENTLY IF EXISTS ix_sub_tenant_status"))
    conn.execute(sa.text("DROP INDEX CONCURRENTLY IF EXISTS ix_sub_tenant_recvd"))
    conn.execute(sa.text("DROP INDEX CONCURRENTLY IF EXISTS ix_sub_form_recvd"))
