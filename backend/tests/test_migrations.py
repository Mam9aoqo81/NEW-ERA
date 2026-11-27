from pathlib import Path
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect


def test_migration_roundtrip(tmp_path, monkeypatch):
    root = Path(__file__).resolve().parents[2]
    url = f'sqlite:///{tmp_path / "migrated.db"}'
    monkeypatch.setenv('DATABASE_URL', url)
    config = Config(str(root / 'alembic.ini'))
    command.upgrade(config, 'head')
    engine = create_engine(url)
    assert 'ingestion_jobs' in inspect(engine).get_table_names()
    command.check(config)
    command.downgrade(config, 'base')
    assert 'users' not in inspect(engine).get_table_names()
    command.upgrade(config, 'head')
    assert 'source_chunks' in inspect(engine).get_table_names()
    engine.dispose()
