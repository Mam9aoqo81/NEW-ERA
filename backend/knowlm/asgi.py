import os
from knowlm.main import create_app
from knowlm.audio import speech_provider_from_env
from knowlm.generation import provider_from_env
from knowlm.semantic import embedding_provider_from_env

# Set KNOWLM_AUTO_SCHEMA=0 after running Alembic in deployed environments.
app = create_app(initialize_schema=os.getenv('KNOWLM_AUTO_SCHEMA', '1') == '1', answer_provider=provider_from_env(), embedding_provider=embedding_provider_from_env(), speech_provider=speech_provider_from_env())
