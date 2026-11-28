import uuid

import pytest
from sqlalchemy import func, select, event, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from knowlm.main import Notebook, Source, Chunk, IngestionJob, ChatTurn, User, AuthSession
from knowlm.learning import Deck, Card, ReviewState, ReviewEvent, Quiz, QuizAttempt, StudyArtifact
from knowlm.worker import run_once
from test_api import client, auth, notebook
from test_learning import TEXT

TABLES = [Notebook, Source, Chunk, IngestionJob, ChatTurn, Deck, Card, ReviewState, ReviewEvent, Quiz, QuizAttempt, StudyArtifact]


def populate(client, headers):
    nid = notebook(client,headers)
    sid = client.post(f'/v1/notebooks/{nid}/sources/text',headers=headers,json={'title':'خاص','text':TEXT}).json()['id']
    client.post(f'/v1/notebooks/{nid}/ask',headers=headers,json={'question':'البناء الضوئي'})
    deck = client.post(f'/v1/notebooks/{nid}/decks/generate',headers=headers,json={'title':'بطاقات','source_ids':[sid]}).json()
    card = client.get(f'/v1/decks/{deck["id"]}/cards',headers=headers).json()[0]
    client.post(f'/v1/cards/{card["id"]}/reviews',headers=headers,json={'rating':'good','card_version':1,'state_version':0})
    quiz = client.post(f'/v1/decks/{deck["id"]}/quizzes',headers=headers,json={}).json()
    client.post(f'/v1/quizzes/{quiz["id"]}/attempts',headers=headers,json={'answers':{q['id']:0 for q in quiz['questions']}})
    client.post(f'/v1/notebooks/{nid}/study-artifacts',headers=headers,json={'kind':'mindmap','source_ids':[sid]})
    pending = client.post(f'/v1/notebooks/{nid}/sources/pdf-jobs',headers=headers,files={'file':('private.pdf',b'%PDF-private')}).json()
    return nid, sid, deck, card, quiz, pending


def counts(engine):
    with Session(engine) as session:
        return {model.__tablename__:session.scalar(select(func.count()).select_from(model)) for model in TABLES}


def test_delete_all_notebook_records_and_preserve_other_notebooks(client):
    owner, other = auth(client,'owner'), auth(client,'other')
    data = populate(client,owner); nid,sid,deck,card,quiz,job=data
    before = counts(client.app.state.engine)
    assert all(value>0 for value in before.values())
    own_keep = populate(client,owner)[0]
    foreign_keep = populate(client,other)[0]
    total = counts(client.app.state.engine)
    assert client.delete(f'/v1/notebooks/{nid}',headers=owner).status_code==204
    after = counts(client.app.state.engine)
    assert after['notebooks']==2
    assert all(v==total[k]-before[k] for k,v in after.items() if k!='notebooks')
    assert client.get('/v1/notebooks',headers=owner).json()[0]['id']==own_keep
    assert client.get('/v1/notebooks',headers=other).json()[0]['id']==foreign_keep
    for path in [f'/v1/notebooks/{nid}/history', f'/v1/notebooks/{nid}/sources',job['status_url'],
                 f'/v1/decks/{deck["id"]}/cards',f'/v1/quizzes/{quiz["id"]}/attempts',
                 f'/v1/notebooks/{nid}/sources/{sid}/pages/1',f'/v1/notebooks/{nid}/study-artifacts']:
        assert client.get(path,headers=owner).status_code==404
    assert client.delete(f'/v1/notebooks/{nid}',headers=owner).status_code==404
    with Session(client.app.state.engine) as session:
        assert session.scalar(select(func.count()).select_from(User))==2
        assert session.scalar(select(func.count()).select_from(AuthSession))==2


def test_deletion_auth_and_owner_validation_have_no_side_effects(client):
    owner, other=auth(client,'owner'),auth(client,'other')
    nid,*_=populate(client,owner)
    before=counts(client.app.state.engine)
    assert client.delete(f'/v1/notebooks/{nid}').status_code==401
    assert client.delete(f'/v1/notebooks/{nid}',headers=other).status_code==404
    assert client.delete('/v1/notebooks/missing',headers=owner).status_code==404
    assert counts(client.app.state.engine)==before


def test_inflight_worker_cannot_republish_after_delete(client):
    headers=auth(client,'owner');nid=notebook(client,headers)
    job=client.post(f'/v1/notebooks/{nid}/sources/pdf-jobs',headers=headers,files={'file':('private.pdf',b'%PDF-private')}).json()
    def delayed(raw):
        assert raw==b'%PDF-private'
        assert client.delete(f'/v1/notebooks/{nid}',headers=headers).status_code==204
        return ['private text that must not be republished']
    assert run_once(client.app.state.engine,extractor=delayed)
    assert all(v==0 for v in counts(client.app.state.engine).values())
    assert not run_once(client.app.state.engine)
    assert client.get(job['status_url'],headers=headers).status_code==404


def test_delete_rolls_back_every_table_on_error(client):
    from knowlm.privacy import erase_notebook
    headers=auth(client,'owner');nid,*_=populate(client,headers)
    engine=client.app.state.engine;before=counts(engine)
    def fail(connection,cursor,statement,parameters,context,executemany):
        if statement.startswith('DELETE FROM chat_turns'):
            raise RuntimeError('injected failure')
    event.listen(engine,'before_cursor_execute',fail)
    try:
        with pytest.raises(RuntimeError):
            with Session(engine) as session:
                erase_notebook(session,nid)
                session.commit()
    finally:
        event.remove(engine,'before_cursor_execute',fail)
    assert counts(engine)==before


def test_foreign_keys_reject_late_writes_to_deleted_parent(client):
    headers=auth(client,'owner');nid=notebook(client,headers)
    assert client.delete(f'/v1/notebooks/{nid}',headers=headers).status_code==204
    with Session(client.app.state.engine) as session:
        assert session.scalar(text('PRAGMA foreign_keys'))==1
        session.add(Source(notebook_id=nid,title='late',kind='text',content_hash='a'*64))
        with pytest.raises(IntegrityError):session.commit()


def test_account_erases_all_owned_data_and_sessions_not_other_users(client):
    owner, other = auth(client,'owner'), auth(client,'other')
    populate(client,owner);populate(client,owner)
    populate(client,other)
    second_token = client.post('/v1/auth/login',json={'username':'owner','password':'secure-password-123'}).json()['access_token']
    second_headers={'Authorization':f'Bearer {second_token}'}
    assert client.post('/v1/auth/delete-account',headers=owner,json={'password':'secure-password-123'}).status_code==204
    assert client.get('/v1/auth/me',headers=owner).status_code==401
    assert client.get('/v1/auth/me',headers=second_headers).status_code==401
    assert client.post('/v1/auth/login',json={'username':'owner','password':'secure-password-123'}).status_code==401
    assert len(client.get('/v1/notebooks',headers=other).json())==1
    assert client.get('/v1/auth/me',headers=other).status_code==200
    with Session(client.app.state.engine) as session:
        assert session.scalar(select(func.count()).select_from(User))==1
        assert session.scalar(select(func.count()).select_from(AuthSession))==1
        assert session.scalar(select(func.count()).select_from(Notebook))==1
        assert session.scalar(select(User.username))=='other'
        ownerless = session.execute(text('PRAGMA foreign_key_check')).all()
        assert ownerless==[]
    # Remaining user can still access every kind of saved learning data.
    nid=client.get('/v1/notebooks',headers=other).json()[0]['id']
    assert client.get(f'/v1/notebooks/{nid}/study-artifacts',headers=other).json()
    assert client.get(f'/v1/notebooks/{nid}/decks',headers=other).json()


def test_account_delete_requires_current_password_and_keeps_valid_session(client):
    headers=auth(client,'owner');populate(client,headers)
    before=counts(client.app.state.engine)
    assert client.post('/v1/auth/delete-account',headers=headers,json={'password':'wrong-password'}).status_code==403
    assert counts(client.app.state.engine)==before
    assert client.get('/v1/auth/me',headers=headers).status_code==200
    for body in ({}, {'password':'short'}, {'password':'x'*129}, {'password':'secure-password-123','user_id':'someone-else'}):
        assert client.post('/v1/auth/delete-account',headers=headers,json=body).status_code==422
    assert client.post('/v1/auth/delete-account',json={'password':'secure-password-123'}).status_code==401
    assert counts(client.app.state.engine)==before


def test_empty_account_can_be_deleted(client):
    headers=auth(client,'owner')
    assert client.post('/v1/auth/delete-account',headers=headers,json={'password':'secure-password-123'}).status_code==204
    with Session(client.app.state.engine) as session:
        assert session.scalar(select(func.count()).select_from(User))==0
        assert session.scalar(select(func.count()).select_from(AuthSession))==0


def test_account_deletion_rollback_preserves_all_notebooks_and_sessions(client):
    from knowlm.privacy import erase_account
    headers=auth(client,'owner');populate(client,headers);populate(client,headers)
    engine=client.app.state.engine;before=counts(engine)
    with Session(engine) as session: user_id=session.scalar(select(User.id))
    def fail(connection,cursor,statement,parameters,context,executemany):
        if statement.startswith('DELETE FROM users'):
            raise RuntimeError('injected failure')
    event.listen(engine,'before_cursor_execute',fail)
    try:
        with pytest.raises(RuntimeError):
            with Session(engine) as session:
                erase_account(session,user_id);session.commit()
    finally:event.remove(engine,'before_cursor_execute',fail)
    assert counts(engine)==before
    assert client.get('/v1/auth/me',headers=headers).status_code==200


def test_inflight_worker_cannot_publish_after_account_deletion(client):
    headers=auth(client,'owner');nid=notebook(client,headers)
    client.post(f'/v1/notebooks/{nid}/sources/pdf-jobs',headers=headers,files={'file':('private.pdf',b'%PDF-private')})
    def delayed(raw):
        assert client.post('/v1/auth/delete-account',headers=headers,json={'password':'secure-password-123'}).status_code==204
        return ['must not reappear']
    assert run_once(client.app.state.engine,extractor=delayed)
    assert all(value==0 for value in counts(client.app.state.engine).values())
    assert client.get('/v1/auth/me',headers=headers).status_code==401


def test_auth_validation_never_echoes_plaintext_passwords(client):
    headers=auth(client,'owner')
    secret='private-short'
    for path,body in [('/v1/auth/delete-account',{'password':secret*20}),
                      ('/v1/auth/login',{'username':'owner','password':'SECRET'}),
                      ('/v1/auth/register',{'username':'invalid name','password':secret})]:
        response=client.post(path,headers=headers,json=body)
        assert response.status_code==422
        assert secret not in response.text and 'SECRET' not in response.text
        assert all('input' not in item and 'ctx' not in item for item in response.json()['detail'])
