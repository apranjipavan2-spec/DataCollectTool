"""Reclaim master_admin-owned rows that landed in other tenants.

Before this release, master_admin could pass X-Tenant-ID to act in another
tenant's context. Any UserToolProject / Program created during such a
session was saved with that override tenant_id, making it invisible to the
master_admin in their home tenant — and visible to that other tenant.

This migration moves each such row back to the master_admin's home tenant.
If the original tenant was meant to retain visibility, the master_admin can
re-share the project explicitly via PATCH /tool-projects/{id}/share.

SharedFile is not touched: it has no tenant_id column (ownership is keyed
on uploaded_by), so master_admin's uploads are already correctly owned.
"""
import sqlalchemy as sa
from alembic import op

revision = "0040"
down_revision = "0039"
branch_labels = None
depends_on = None


def upgrade():
    conn = op.get_bind()

    # Move user_tool_projects rows owned by a master_admin back to that
    # master_admin's home tenant. Strip the foreign tenant from
    # shared_with_tenants so they don't keep cross-tenant visibility.
    conn.execute(sa.text("""
        UPDATE user_tool_projects p
        SET    tenant_id = u.tenant_id,
               shared_with_tenants = ARRAY(
                   SELECT t FROM unnest(COALESCE(p.shared_with_tenants, ARRAY[]::uuid[])) AS t
                   WHERE  t <> p.tenant_id
               ),
               updated_at = NOW()
        FROM   users u
        WHERE  u.id = p.user_id
          AND  u.role = 'master_admin'
          AND  p.tenant_id <> u.tenant_id
    """))

    # Move programs created by a master_admin back to that master_admin's
    # home tenant. Programs cascade to questionnaires / submissions via
    # program_id, so retag those rows too if their tenant differs.
    conn.execute(sa.text("""
        UPDATE programs p
        SET    tenant_id = u.tenant_id
        FROM   users u
        WHERE  u.id = p.created_by
          AND  u.role = 'master_admin'
          AND  p.tenant_id <> u.tenant_id
    """))

    conn.execute(sa.text("""
        UPDATE program_questionnaires q
        SET    tenant_id = p.tenant_id
        FROM   programs p, users u
        WHERE  q.program_id = p.id
          AND  u.id = p.created_by
          AND  u.role = 'master_admin'
          AND  q.tenant_id <> p.tenant_id
    """))


def downgrade():
    # Irreversible: previous tenant_id is not preserved per row.
    pass
