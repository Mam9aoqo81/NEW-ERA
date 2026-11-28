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
        from knowlm.main import password_hash
        import uuid
        nid, owner_id = str(uuid.uuid4()), str(uuid.uuid4())
        # Seed the historical schema directly, without today's expanded ORM model.
        from sqlalchemy import text
        import uuid
        sid = str(uuid.uuid4())
        with app.state.engine.begin() as connection:
            connection.execute(text('INSERT INTO users (id, username, password_hash) VALUES (:id, :name, :password)'), {'id':owner_id, 'name':'student', 'password':password_hash('secure-password-123')})
            connection.execute(text('INSERT INTO notebooks (id, owner_id, title) VALUES (:id, :owner, :title)'), {'id':nid, 'owner':owner_id, 'title':'الأحياء'})
            connection.execute(text('INSERT INTO sources (id, notebook_id, title, kind, status, content_hash) VALUES (:id, :nid, :title, :kind, :status, :hash)'),
                               {'id': sid, 'nid': nid, 'title': 'كتاب', 'kind': 'text', 'status': 'ready', 'hash': 'a'*64})
            connection.execute(text('INSERT INTO source_chunks (id, source_id, page, chunk_index, text) VALUES (:id, :sid, 1, 0, :text)'),
                               {'id': str(uuid.uuid4()), 'sid': sid, 'text': 'البناء الضوئي داخل البلاستيدات الخضراء.'})
        command.upgrade(config, 'head')
        token = c.post('/v1/auth/login', json={'username':'student','password':'secure-password-123'}).json()['access_token']
        headers = {'Authorization':f'Bearer {token}'}
        assert c.get(f'/v1/notebooks/{nid}/sources', headers=headers).json()[0]['id'] == sid
        assert c.get(f'/v1/notebooks/{nid}/history', headers=headers).json()['turns'] == []
        assert c.post(f'/v1/notebooks/{nid}/ask', headers=headers, json={'question': 'البناء الضوئي'}).status_code == 200
        assert len(c.get(f'/v1/notebooks/{nid}/history', headers=headers).json()['turns']) == 1
    app.state.engine.dispose()


def test_collaboration_migration_keeps_owner_history_private(tmp_path,monkeypatch):
    import uuid
    from datetime import datetime,timezone
    from sqlalchemy import text
    from fastapi.testclient import TestClient
    from knowlm.main import create_app,password_hash
    from test_api import auth
    root=Path(__file__).resolve().parents[2]
    url=f'sqlite:///{tmp_path / "private-upgrade.db"}'
    monkeypatch.setenv('DATABASE_URL',url)
    config=Config(str(root/'alembic.ini'))
    command.upgrade(config,'294375eff605')
    engine=create_engine(url)
    owner_id,nid,request_id=[str(uuid.uuid4()) for _ in range(3)]
    with engine.begin() as connection:
        connection.execute(text('INSERT INTO users(id,username,password_hash) VALUES(:id,:name,:password)'),{'id':owner_id,'name':'original','password':password_hash('secure-password-123')})
        connection.execute(text('INSERT INTO notebooks(id,owner_id,title) VALUES(:id,:owner,:title)'),{'id':nid,'owner':owner_id,'title':'existing'})
        connection.execute(text('INSERT INTO chat_turns(notebook_id,request_id,request_hash,question,source_ids,mode,answer,created_at) VALUES(:nid,:rid,:hash,:q,:sources,:mode,:answer,:date)'),{'nid':nid,'rid':request_id,'hash':'a'*64,'q':'owner secret','sources':'[]','mode':'extractive','answer':'{"answered":false,"answer":"private","citations":[],"mode":"extractive","notice":"test"}','date':datetime.now(timezone.utc)})
    command.upgrade(config,'head')
    with engine.connect() as connection:
        assert connection.execute(text('SELECT user_id FROM chat_turns')).scalar()==owner_id
    app=create_app(url,initialize_schema=False)
    with TestClient(app) as client:
        member=auth(client,'member')
        owner_token=client.post('/v1/auth/login',json={'username':'original','password':'secure-password-123'}).json()['access_token']
        owner={'Authorization':f'Bearer {owner_token}'}
        invite=client.post(f'/v1/notebooks/{nid}/invitations',headers=owner,json={'username':'member','role':'viewer','consent':True}).json()
        assert client.post('/v1/collaboration/accept',headers={**member,'X-KnowLM-Invite':invite['token']},json={'consent':True}).status_code==200
        assert client.get(f'/v1/notebooks/{nid}/history',headers=member).json()['turns']==[]
        assert client.get(f'/v1/notebooks/{nid}/history',headers=owner).json()['turns'][0]['question']=='owner secret'
        assert client.post(f'/v1/notebooks/{nid}/ask',headers=member,json={'question':'member question','request_id':request_id}).status_code==200
    command.downgrade(config,'294375eff605')
    with engine.connect() as connection:
        # Downgrades cannot safely expose member chats as owner history.
        assert connection.execute(text('SELECT question FROM chat_turns')).scalars().all()==['owner secret']
    command.upgrade(config,'head');command.check(config)
    engine.dispose();app.state.engine.dispose()
