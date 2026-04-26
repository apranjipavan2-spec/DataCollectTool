"""Add missing indexes on submissions for program/tenant/enumerator/questionnaire queries"""
from alembic import op

revision = '0030'
down_revision = '0029'


def upgrade():
    # Composite index — most common filter pattern across all FG endpoints
    op.execute("""
        CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_sub_tenant_program
            ON submissions (tenant_id, program_id)
            WHERE program_id IS NOT NULL
    """)
    op.execute("""
        CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_sub_tenant_program_recv
            ON submissions (tenant_id, program_id, server_received_at DESC)
            WHERE program_id IS NOT NULL
    """)
    # Individual indexes for other frequent filter columns
    op.execute("CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_sub_questionnaire ON submissions (questionnaire_id) WHERE questionnaire_id IS NOT NULL")
    op.execute("CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_sub_enumerator    ON submissions (enumerator_id)")
    op.execute("CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_sub_tenant_status ON submissions (tenant_id, status)")
    op.execute("CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_sub_tenant_recvd  ON submissions (tenant_id, server_received_at DESC)")
    # Index for the cleaner endpoint (ordering by received_at within a program)
    op.execute("""
        CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_sub_form_recvd
            ON submissions (form_id, server_received_at DESC)
    """)


def downgrade():
    op.execute("DROP INDEX IF EXISTS ix_sub_tenant_program")
    op.execute("DROP INDEX IF EXISTS ix_sub_tenant_program_recv")
    op.execute("DROP INDEX IF EXISTS ix_sub_questionnaire")
    op.execute("DROP INDEX IF EXISTS ix_sub_enumerator")
    op.execute("DROP INDEX IF EXISTS ix_sub_tenant_status")
    op.execute("DROP INDEX IF EXISTS ix_sub_tenant_recvd")
    op.execute("DROP INDEX IF EXISTS ix_sub_form_recvd")
