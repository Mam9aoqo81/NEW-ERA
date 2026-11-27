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


def test_existing_notebooks_and_sources_survive_history_migration(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient
    from knowlm.main import create_app
    from test_api import auth, notebook
    root = Path(__file__).resolve().parents[2]
    url = f'sqlite:///{tmp_path / "upgrade.db"}'
    monkeypatch.setenv('DATABASE_URL', url)
    config = Config(str(root / 'alembic.ini'))
    command.upgrade(config, '0003_vector_extension')
    app = create_app(url, initialize_schema=False)
    with TestClient(app) as c:
        headers = auth(c, 'student')
        nid = notebook(c, headers)
        # Seed the historical schema directly, without today's expanded ORM model.
        from sqlalchemy import text
        import uuid
        sid = str(uuid.uuid4())
        with app.state.engine.begin() as connection:
            connection.execute(text('INSERT INTO sources (id, notebook_id, title, kind, status, content_hash) VALUES (:id, :nid, :title, :kind, :status, :hash)'),
                               {'id': sid, 'nid': nid, 'title': 'كتاب', 'kind': 'text', 'status': 'ready', 'hash': 'a'*64})
            connection.execute(text('INSERT INTO source_chunks (id, source_id, page, chunk_index, text) VALUES (:id, :sid, 1, 0, :text)'),
                               {'id': str(uuid.uuid4()), 'sid': sid, 'text': 'البناء الضوئي داخل البلاستيدات الخضراء.'})
        command.upgrade(config, 'head')
        assert c.get(f'/v1/notebooks/{nid}/sources', headers=headers).json()[0]['id'] == sid
        assert c.get(f'/v1/notebooks/{nid}/history', headers=headers).json()['turns'] == []
        assert c.post(f'/v1/notebooks/{nid}/ask', headers=headers, json={'question': 'البناء الضوئي'}).status_code == 200
        assert len(c.get(f'/v1/notebooks/{nid}/history', headers=headers).json()['turns']) == 1
    app.state.engine.dispose()
