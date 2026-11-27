import os
from knowlm.main import create_app
from knowlm.generation import provider_from_env

# Set KNOWLM_AUTO_SCHEMA=0 after running Alembic in deployed environments.
app = create_app(initialize_schema=os.getenv('KNOWLM_AUTO_SCHEMA', '1') == '1', answer_provider=provider_from_env())
