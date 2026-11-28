"""Durable PDF ingestion jobs."""
from alembic import op
import sqlalchemy as sa

revision = '0002_ingestion_jobs'
down_revision = '05f8dbbe542a'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('ingestion_jobs',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('source_id', sa.String(length=36), nullable=False),
    sa.Column('status', sa.String(length=20), nullable=False),
    sa.Column('payload', sa.LargeBinary(), nullable=True),
    sa.Column('attempts', sa.Integer(), nullable=False),
    sa.Column('error_code', sa.String(length=50), nullable=True),
    sa.Column('lease_token', sa.String(length=36), nullable=True),
    sa.Column('lease_until', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['source_id'], ['sources.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('source_id')
    )
    op.create_index(op.f('ix_ingestion_jobs_status'), 'ingestion_jobs', ['status'], unique=False)


def downgrade():
    op.drop_index('ix_ingestion_jobs_status', table_name='ingestion_jobs')
    op.drop_table('ingestion_jobs')
