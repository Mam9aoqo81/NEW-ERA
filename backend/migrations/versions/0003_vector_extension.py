"""Enable PostgreSQL vector extension; no embeddings are generated yet."""
from alembic import op

revision = '0003_vector_extension'
down_revision = '0002_ingestion_jobs'
branch_labels = None
depends_on = None


def upgrade():
    if op.get_bind().dialect.name == 'postgresql':
        op.execute('CREATE EXTENSION IF NOT EXISTS vector')


def downgrade():
    # Do not drop a shared database extension that other tables may depend on.
    pass
