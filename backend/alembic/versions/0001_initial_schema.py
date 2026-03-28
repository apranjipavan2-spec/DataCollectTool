"""initial schema with RLS

Revision ID: 0001
Revises:
Create Date: 2026-03-22
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB, ARRAY

revision = '0001'
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    # ------------------------------------------------------------------ #
    # tenants
    # ------------------------------------------------------------------ #
    op.create_table(
        'tenants',
        sa.Column('id', UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('name', sa.String, nullable=False),
        sa.Column('logo_url', sa.String),
        sa.Column('primary_color', sa.String, server_default='#2563EB'),
        sa.Column('plan_tier', sa.String, server_default='free'),
        sa.Column('subscription_status', sa.String, server_default='active'),
        sa.Column('free_submissions_used', sa.Integer, server_default='0'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()')),
    )

    # ------------------------------------------------------------------ #
    # users
    # ------------------------------------------------------------------ #
    op.create_table(
        'users',
        sa.Column('id', UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('tenant_id', UUID(as_uuid=True), sa.ForeignKey('tenants.id', ondelete='CASCADE'), nullable=False),
        sa.Column('role', sa.String, nullable=False),
        sa.Column('phone', sa.String, nullable=False),
        sa.Column('otp_hash', sa.String),
        sa.Column('otp_expires_at', sa.DateTime(timezone=True)),
        sa.Column('name', sa.String),
        sa.Column('language_pref', sa.String, server_default='en'),
        sa.Column('is_active', sa.Boolean, server_default='true'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()')),
    )
    op.create_index('ix_users_phone', 'users', ['phone'])
    op.create_index('ix_users_tenant_id', 'users', ['tenant_id'])

    # ------------------------------------------------------------------ #
    # forms
    # ------------------------------------------------------------------ #
    op.create_table(
        'forms',
        sa.Column('id', UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('tenant_id', UUID(as_uuid=True), sa.ForeignKey('tenants.id', ondelete='CASCADE'), nullable=False),
        sa.Column('title', sa.String, nullable=False),
        sa.Column('json_schema', JSONB, nullable=False),
        sa.Column('version', sa.Integer, server_default='1', nullable=False),
        sa.Column('status', sa.String, server_default='draft'),
        sa.Column('is_template', sa.Boolean, server_default='false'),
        sa.Column('created_by', UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='SET NULL')),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()')),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()')),
    )
    op.create_index('ix_forms_tenant_id', 'forms', ['tenant_id'])

    # ------------------------------------------------------------------ #
    # submissions
    # ------------------------------------------------------------------ #
    op.create_table(
        'submissions',
        sa.Column('id', UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('tenant_id', UUID(as_uuid=True), sa.ForeignKey('tenants.id', ondelete='CASCADE'), nullable=False),
        sa.Column('form_id', UUID(as_uuid=True), sa.ForeignKey('forms.id', ondelete='CASCADE'), nullable=False),
        sa.Column('form_version', sa.Integer),
        sa.Column('enumerator_id', UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='SET NULL')),
        sa.Column('data_json', JSONB, nullable=False),
        sa.Column('gps_open', JSONB),
        sa.Column('gps_submit', JSONB),
        sa.Column('status', sa.String, server_default='synced'),
        sa.Column('local_created_at', sa.DateTime(timezone=True)),
        sa.Column('server_received_at', sa.DateTime(timezone=True), server_default=sa.text('now()')),
    )
    op.create_index('ix_submissions_tenant_id', 'submissions', ['tenant_id'])
    op.create_index('ix_submissions_form_id', 'submissions', ['form_id'])
    op.create_index('ix_submissions_enumerator_id', 'submissions', ['enumerator_id'])

    # ------------------------------------------------------------------ #
    # media_files
    # ------------------------------------------------------------------ #
    op.create_table(
        'media_files',
        sa.Column('id', UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('tenant_id', UUID(as_uuid=True), sa.ForeignKey('tenants.id', ondelete='CASCADE'), nullable=False),
        sa.Column('submission_id', UUID(as_uuid=True), sa.ForeignKey('submissions.id', ondelete='CASCADE')),
        sa.Column('file_type', sa.String),
        sa.Column('cloud_url', sa.String),
        sa.Column('file_size_bytes', sa.Integer),
        sa.Column('uploaded_at', sa.DateTime(timezone=True), server_default=sa.text('now()')),
    )
    op.create_index('ix_media_files_submission_id', 'media_files', ['submission_id'])

    # ------------------------------------------------------------------ #
    # cleaning_flags
    # ------------------------------------------------------------------ #
    op.create_table(
        'cleaning_flags',
        sa.Column('id', UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('tenant_id', UUID(as_uuid=True), sa.ForeignKey('tenants.id', ondelete='CASCADE'), nullable=False),
        sa.Column('submission_id', UUID(as_uuid=True), sa.ForeignKey('submissions.id', ondelete='CASCADE')),
        sa.Column('field_name', sa.String),
        sa.Column('flag_type', sa.String),
        sa.Column('severity', sa.String, server_default='warning'),
        sa.Column('reviewed_by', UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='SET NULL')),
        sa.Column('reviewed_at', sa.DateTime(timezone=True)),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()')),
    )

    # ------------------------------------------------------------------ #
    # sync_log
    # ------------------------------------------------------------------ #
    op.create_table(
        'sync_log',
        sa.Column('id', UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('tenant_id', UUID(as_uuid=True), sa.ForeignKey('tenants.id', ondelete='CASCADE'), nullable=False),
        sa.Column('enumerator_id', UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='SET NULL')),
        sa.Column('direction', sa.String),
        sa.Column('records_count', sa.Integer, server_default='0'),
        sa.Column('media_count', sa.Integer, server_default='0'),
        sa.Column('sync_duration_ms', sa.Integer),
        sa.Column('synced_at', sa.DateTime(timezone=True), server_default=sa.text('now()')),
    )

    # ------------------------------------------------------------------ #
    # Row-Level Security
    # ------------------------------------------------------------------ #
    rls_tables = ['users', 'forms', 'submissions',
                  'media_files', 'cleaning_flags', 'sync_log']

    for table in rls_tables:
        op.execute(f'ALTER TABLE {table} ENABLE ROW LEVEL SECURITY')
        op.execute(f'ALTER TABLE {table} FORCE ROW LEVEL SECURITY')
        op.execute(f"""
            CREATE POLICY tenant_isolation ON {table}
            USING (tenant_id::text = current_setting('app.current_tenant', true))
        """)

    # App role for API connections (bypasses RLS only for master_admin via superuser)
    # Note: Role creation is idempotent via grant statements. Role must be created separately:
    # CREATE ROLE fieldpulse_app LOGIN PASSWORD 'apppassword' NOINHERIT
    try:
        op.execute("GRANT CONNECT ON DATABASE fieldpulse TO fieldpulse_app")
        op.execute("GRANT USAGE ON SCHEMA public TO fieldpulse_app")
        op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO fieldpulse_app")
    except:
        pass  # Role may already exist with grants


def downgrade():
    tables = ['sync_log', 'cleaning_flags',
              'media_files', 'submissions', 'forms', 'users', 'tenants']
    for t in tables:
        op.drop_table(t)
    op.execute("DROP ROLE IF EXISTS fieldpulse_app")
