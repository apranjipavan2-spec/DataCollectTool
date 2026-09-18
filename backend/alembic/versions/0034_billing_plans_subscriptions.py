"""Billing: plans, subscriptions, payment_requests, usage_records

Revision ID: 0034
Revises: 0033
Create Date: 2026-04-30
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB

revision = '0034'
down_revision = '0033'
branch_labels = None
depends_on = None


def upgrade():
    # ── plans ──────────────────────────────────────────────────────────────────
    op.create_table('plans',
        sa.Column('id',              sa.String(),  primary_key=True),
        sa.Column('segment',         sa.String(),  nullable=False),
        sa.Column('tier',            sa.String(),  nullable=False),
        sa.Column('name',            sa.String(),  nullable=False),
        sa.Column('description',     sa.Text()),
        sa.Column('price_inr',       sa.Integer(), default=0),
        sa.Column('price_usd_cents', sa.Integer(), default=0),
        sa.Column('submissions_limit',   sa.Integer()),
        sa.Column('storage_limit_mb',    sa.Integer()),
        sa.Column('max_org_admins',      sa.Integer()),
        sa.Column('max_supervisors',     sa.Integer()),
        sa.Column('max_enumerators',     sa.Integer()),
        sa.Column('asr_minutes_limit',   sa.Integer(), default=5),
        sa.Column('translation_chars',   sa.Integer(), default=3000),
        sa.Column('ai_cleaning',         sa.Boolean(), default=False),
        sa.Column('ai_writer',           sa.Boolean(), default=False),
        sa.Column('ai_smart_builder',    sa.Boolean(), default=False),
        sa.Column('ai_interpret',        sa.Boolean(), default=False),
        sa.Column('ai_analyzer',         sa.Boolean(), default=False),
        sa.Column('map_view',            sa.Boolean(), default=False),
        sa.Column('panel_study',         sa.Boolean(), default=False),
        sa.Column('spss_export',         sa.Boolean(), default=False),
        sa.Column('api_write',           sa.Boolean(), default=False),
        sa.Column('webhooks',            sa.Boolean(), default=False),
        sa.Column('two_fa',              sa.Boolean(), default=False),
        sa.Column('sso',                 sa.Boolean(), default=False),
        sa.Column('audit_log',           sa.Boolean(), default=False),
        sa.Column('advanced_rbac',       sa.Boolean(), default=False),
        sa.Column('white_label',         sa.Boolean(), default=False),
        sa.Column('on_premise',          sa.Boolean(), default=False),
        sa.Column('priority_support',    sa.Boolean(), default=False),
        sa.Column('is_active',           sa.Boolean(), default=True),
        sa.Column('sort_order',          sa.Integer(), default=0),
    )

    # ── subscriptions ──────────────────────────────────────────────────────────
    op.create_table('subscriptions',
        sa.Column('id',                   UUID(as_uuid=True), primary_key=True),
        sa.Column('tenant_id',            UUID(as_uuid=True), sa.ForeignKey('tenants.id'), nullable=False, unique=True),
        sa.Column('plan_id',              sa.String(),        sa.ForeignKey('plans.id'),   nullable=False),
        sa.Column('billing_cycle',        sa.String(),        default='monthly'),
        sa.Column('discount_pct',         sa.Integer(),       default=0),
        sa.Column('amount_inr',           sa.Integer(),       default=0),
        sa.Column('status',               sa.String(),        default='trialing'),
        sa.Column('trial_start',          sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('trial_end',            sa.DateTime(timezone=True)),
        sa.Column('current_period_start', sa.DateTime(timezone=True)),
        sa.Column('current_period_end',   sa.DateTime(timezone=True)),
        sa.Column('created_at',           sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at',           sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index('ix_subscriptions_tenant', 'subscriptions', ['tenant_id'])

    # ── payment_requests ───────────────────────────────────────────────────────
    op.create_table('payment_requests',
        sa.Column('id',                     UUID(as_uuid=True), primary_key=True),
        sa.Column('order_ref',              sa.String(),  nullable=False, unique=True),
        sa.Column('tenant_id',              UUID(as_uuid=True), sa.ForeignKey('tenants.id'), nullable=False),
        sa.Column('plan_id',                sa.String(),  sa.ForeignKey('plans.id'),   nullable=False),
        sa.Column('billing_cycle',          sa.String(),  nullable=False),
        sa.Column('amount_inr',             sa.Integer(), nullable=False),
        sa.Column('discount_pct',           sa.Integer(), default=0),
        sa.Column('utr_number',             sa.String()),
        sa.Column('payment_screenshot_url', sa.String()),
        sa.Column('status',                 sa.String(),  default='pending'),
        sa.Column('confirmed_by',           UUID(as_uuid=True), sa.ForeignKey('users.id')),
        sa.Column('confirmed_at',           sa.DateTime(timezone=True)),
        sa.Column('rejection_reason',       sa.Text()),
        sa.Column('notes',                  sa.Text()),
        sa.Column('created_at',             sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at',             sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index('ix_payment_requests_tenant',   'payment_requests', ['tenant_id'])
    op.create_index('ix_payment_requests_status',   'payment_requests', ['status'])

    # ── usage_records ──────────────────────────────────────────────────────────
    op.create_table('usage_records',
        sa.Column('id',               UUID(as_uuid=True), primary_key=True),
        sa.Column('tenant_id',        UUID(as_uuid=True), sa.ForeignKey('tenants.id'), nullable=False),
        sa.Column('period_year',      sa.Integer(), nullable=False),
        sa.Column('period_month',     sa.Integer(), nullable=False),
        sa.Column('submissions_used', sa.Integer(), default=0),
        sa.Column('storage_used_mb',  sa.Float(),   default=0.0),
        sa.Column('ai_reports_used',  sa.Integer(), default=0),
        sa.Column('ai_cleaning_runs', sa.Integer(), default=0),
        sa.Column('asr_minutes_used', sa.Float(),   default=0.0),
        sa.Column('updated_at',       sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index('ix_usage_tenant_period', 'usage_records', ['tenant_id', 'period_year', 'period_month'], unique=True)

    # ── google auth columns on users ───────────────────────────────────────────
    op.add_column('users', sa.Column('google_id',     sa.String(255)))
    op.add_column('users', sa.Column('auth_provider', sa.String(20), server_default='email'))
    op.add_column('users', sa.Column('avatar_url',    sa.Text()))
    op.create_index('ix_users_google_id', 'users', ['google_id'], unique=True)


def downgrade():
    op.drop_index('ix_users_google_id', 'users')
    op.drop_column('users', 'avatar_url')
    op.drop_column('users', 'auth_provider')
    op.drop_column('users', 'google_id')
    op.drop_table('usage_records')
    op.drop_table('payment_requests')
    op.drop_table('subscriptions')
    op.drop_table('plans')
