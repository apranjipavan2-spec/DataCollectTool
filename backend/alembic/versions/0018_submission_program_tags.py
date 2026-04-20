"""Link submissions and schedules to programs/locations

Revision ID: 0018
Revises: 0017
Create Date: 2026-04-20
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '0018'
down_revision = '0017'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('submissions', sa.Column('program_id', postgresql.UUID(as_uuid=True),
        sa.ForeignKey('programs.id', ondelete='SET NULL'), nullable=True))
    op.add_column('submissions', sa.Column('participant_type_id', postgresql.UUID(as_uuid=True),
        sa.ForeignKey('program_participant_types.id', ondelete='SET NULL'), nullable=True))
    op.add_column('submissions', sa.Column('questionnaire_id', postgresql.UUID(as_uuid=True),
        sa.ForeignKey('program_questionnaires.id', ondelete='SET NULL'), nullable=True))
    op.add_column('submissions', sa.Column('location_id', postgresql.UUID(as_uuid=True),
        sa.ForeignKey('program_locations.id', ondelete='SET NULL'), nullable=True))

    op.add_column('schedules', sa.Column('program_questionnaire_id', postgresql.UUID(as_uuid=True),
        sa.ForeignKey('program_questionnaires.id', ondelete='SET NULL'), nullable=True))
    op.add_column('schedules', sa.Column('location_id', postgresql.UUID(as_uuid=True),
        sa.ForeignKey('program_locations.id', ondelete='SET NULL'), nullable=True))


def downgrade():
    op.drop_column('schedules', 'location_id')
    op.drop_column('schedules', 'program_questionnaire_id')
    op.drop_column('submissions', 'location_id')
    op.drop_column('submissions', 'questionnaire_id')
    op.drop_column('submissions', 'participant_type_id')
    op.drop_column('submissions', 'program_id')
