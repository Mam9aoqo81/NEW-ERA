import uuid
from datetime import timedelta

import pytest
from sqlalchemy import select, func
from sqlalchemy.orm import Session

from knowlm.learning import Card, Deck
from knowlm.main import Notebook
from knowlm.sharing import LearningShare, ShareImport, ShareReport, now
from knowlm.moderation import resolve
from test_api import client, auth
from test_sharing import prepare, publish


def setup(client):
    owner,nid,_,deck,cards=prepare(client)
    share=publish(client,owner,f'/v1/decks/{deck["id"]}').json()
    visitor=auth(client,'visitor')
    headers={**visitor,'X-KnowLM-Share':share['token']}
    return owner,nid,deck,cards,share,headers


def test_import_is_private_independent_and_idempotent(client):
    owner,nid,deck,cards,share,visitor=setup(client)
    body={'request_id':str(uuid.uuid4()),'consent':True}
    assert client.post('/v1/shared/import',headers={'X-KnowLM-Share':share['token']},json=body).status_code==401
    result=client.post('/v1/shared/import',headers=visitor,json=body)
    assert result.status_code==201
    copied=result.json()
    assert copied['notebook_id']!=nid and copied['deck_id']!=deck['id']
    public=client.get(f'/v1/decks/{copied["deck_id"]}/cards',headers=visitor).json()
    assert len(public)==len(cards)
    assert all(c['origin']=='shared' and c['reference'] is None for c in public)
    assert {c['id'] for c in public}.isdisjoint({c['id'] for c in cards})
    assert client.get(f'/v1/decks/{copied["deck_id"]}/cards',headers=owner).status_code==404
    assert client.get(f'/v1/decks/{deck["id"]}/cards',headers=visitor).status_code==404
    assert client.post('/v1/shared/import',headers=visitor,json=body).json()==copied
    client.delete(f'/v1/notebooks/{nid}',headers=owner)
    # Revocation does not recall independent copies; retry after a lost response is safe.
    assert client.post('/v1/shared/import',headers=visitor,json=body).json()==copied
    assert client.get(f'/v1/decks/{copied["deck_id"]}/cards',headers=visitor).json()==public
    assert client.post('/v1/shared/import',headers=visitor,json={**body,'request_id':str(uuid.uuid4())}).status_code==404
    assert client.delete(f'/v1/notebooks/{copied["notebook_id"]}',headers=visitor).status_code==204
    with Session(client.app.state.engine) as session:assert session.scalar(select(func.count()).select_from(ShareImport))==0


def test_import_validation_and_notebook_quota(client,monkeypatch):
    owner,nid,deck,_,share,visitor=setup(client)
    body={'request_id':str(uuid.uuid4()),'consent':True}
    for consent in (False,'true'):
        assert client.post('/v1/shared/import',headers=visitor,json={**body,'consent':consent}).status_code==422
    monkeypatch.setenv('KNOWLM_MAX_NOTEBOOKS','1')
    assert client.post('/v1/shared/import',headers=visitor,json=body).status_code==201
    assert client.post('/v1/shared/import',headers=visitor,json={**body,'request_id':str(uuid.uuid4())}).status_code==409
    other=publish(client,owner,f'/v1/decks/{deck["id"]}').json()
    assert client.post('/v1/shared/import',headers={**visitor,'X-KnowLM-Share':other['token']},json=body).status_code==409
    with Session(client.app.state.engine) as session:assert session.scalar(select(func.count()).select_from(ShareImport))==1


def test_quiz_expired_revoked_cannot_import(client):
    owner,_,deck,_,share,visitor=setup(client)
    body={'request_id':str(uuid.uuid4()),'consent':True}
    quiz=client.post(f'/v1/decks/{deck["id"]}/quizzes',headers=owner,json={'count':2}).json()
    qshare=publish(client,owner,f'/v1/quizzes/{quiz["id"]}').json()
    assert client.post('/v1/shared/import',headers={**visitor,'X-KnowLM-Share':qshare['token']},json=body).status_code==422
    client.delete(f'/v1/shares/{share["id"]}',headers=owner)
    assert client.post('/v1/shared/import',headers=visitor,json=body).status_code==404
    with Session(client.app.state.engine) as session:
        row=session.get(LearningShare,qshare['id']);row.expires_at=now()-timedelta(seconds=1);session.commit()
    assert client.post('/v1/shared/import',headers={**visitor,'X-KnowLM-Share':qshare['token']},json=body).status_code==404


def test_reports_deduplicate_and_operator_revocation_hides_content(client):
    owner,nid,_,_,share,visitor=setup(client)
    assert client.post('/v1/shared/report',headers={'X-KnowLM-Share':share['token']},json={'reason':'privacy'}).status_code==401
    for _ in range(2):
        response=client.post('/v1/shared/report',headers=visitor,json={'reason':'privacy'})
        assert response.status_code==202 and response.json()=={'status':'received'}
    assert client.post('/v1/shared/report',headers=visitor,json={'reason':'custom secret','details':'secret'}).status_code==422
    assert client.get('/v1/shared/view',headers=visitor).status_code==200
    with Session(client.app.state.engine) as session:
        rows=session.scalars(select(ShareReport)).all();assert len(rows)==1
        report_id=rows[0].id
        resolve(session,report_id,'revoke')
        assert session.get(LearningShare,share['id']).snapshot['items']==[]
        assert session.get(ShareReport,report_id).status=='actioned'
        with pytest.raises(ValueError):resolve(session,report_id,'dismiss')
    assert client.get('/v1/shared/view',headers=visitor).status_code==404
    assert client.post('/v1/shared/import',headers=visitor,json={'request_id':str(uuid.uuid4()),'consent':True}).status_code==404
    assert not client.get(f'/v1/notebooks/{nid}/shares',headers=owner).json()[0]['active']


@pytest.mark.parametrize('delete_reporter',[False,True])
def test_report_privacy_deletion(client,delete_reporter):
    owner,nid,_,_,share,visitor=setup(client)
    client.post('/v1/shared/report',headers=visitor,json={'reason':'incorrect'})
    if delete_reporter:
        assert client.post('/v1/auth/delete-account',headers=visitor,json={'password':'secure-password-123'}).status_code==204
        assert client.get('/v1/shared/view',headers={'X-KnowLM-Share':share['token']}).status_code==200
    else:
        assert client.delete(f'/v1/notebooks/{nid}',headers=owner).status_code==204
    with Session(client.app.state.engine) as session:assert session.scalar(select(func.count()).select_from(ShareReport))==0


def test_dismissal_does_not_revoke(client):
    _,_,_,_,share,visitor=setup(client)
    client.post('/v1/shared/report',headers=visitor,json={'reason':'spam'})
    with Session(client.app.state.engine) as session:
        resolve(session,session.scalar(select(ShareReport.id)),'dismiss')
    assert client.get('/v1/shared/view',headers=visitor).status_code==200


def test_concurrent_import_retry_creates_only_one_copy(client):
    from concurrent.futures import ThreadPoolExecutor
    _,_,_,_,_,visitor=setup(client)
    body={'request_id':str(uuid.uuid4()),'consent':True}
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses=list(pool.map(lambda _:client.post('/v1/shared/import',headers=visitor,json=body),range(2)))
    assert [r.status_code for r in responses]==[201,201]
    assert responses[0].json()==responses[1].json()
    with Session(client.app.state.engine) as session:
        assert session.scalar(select(func.count()).select_from(ShareImport))==1


def test_import_transaction_does_not_leave_partial_copy(client):
    from sqlalchemy import event
    _,_,_,_,_,visitor=setup(client)
    body={'request_id':str(uuid.uuid4()),'consent':True}
    engine=client.app.state.engine
    with Session(engine) as session:before=session.scalar(select(func.count()).select_from(Notebook))
    def fail(connection,cursor,statement,parameters,context,executemany):
        if statement.startswith('INSERT INTO share_imports'):raise RuntimeError('injected failure')
    event.listen(engine,'before_cursor_execute',fail)
    try:
        with pytest.raises(RuntimeError):client.post('/v1/shared/import',headers=visitor,json=body)
    finally:event.remove(engine,'before_cursor_execute',fail)
    with Session(engine) as session:
        assert session.scalar(select(func.count()).select_from(Notebook))==before
        assert session.scalar(select(func.count()).select_from(ShareImport))==0
    assert client.post('/v1/shared/import',headers=visitor,json=body).status_code==201


def test_pending_report_quota_and_deduplication(client):
    from knowlm.main import User
    _,_,_,_,share,visitor=setup(client)
    with Session(client.app.state.engine) as session:
        reporter=session.scalar(select(User).where(User.username=='visitor'))
        original=session.get(LearningShare,share['id'])
        for i in range(20):
            extra=LearningShare(owner_id=original.owner_id,notebook_id=original.notebook_id,token_hash=f'{i:064x}',title='other',snapshot=original.snapshot,expires_at=original.expires_at)
            session.add(extra);session.flush()
            session.add(ShareReport(reporter_id=reporter.id,share_id=extra.id,reason='spam'))
        session.commit()
    assert client.post('/v1/shared/report',headers=visitor,json={'reason':'spam'}).status_code==409
    with Session(client.app.state.engine) as session:
        resolve(session,session.scalar(select(ShareReport.id).where(ShareReport.status=='pending')),'dismiss')
    assert client.post('/v1/shared/report',headers=visitor,json={'reason':'spam'}).status_code==202
    assert client.post('/v1/shared/report',headers=visitor,json={'reason':'privacy'}).status_code==202


def test_moderation_cli_requires_explicit_database_and_can_list_show_dismiss(client,monkeypatch,capsys):
    import sys
    from knowlm.moderation import main
    _,_,_,_,share,visitor=setup(client)
    client.post('/v1/shared/report',headers=visitor,json={'reason':'copyright'})
    monkeypatch.setattr(sys,'argv',['moderation','pending'])
    monkeypatch.delenv('DATABASE_URL',raising=False)
    with pytest.raises(SystemExit):main()
    capsys.readouterr()
    monkeypatch.setenv('DATABASE_URL',str(client.app.state.engine.url))
    main()
    import json
    rows=json.loads(capsys.readouterr().out)
    assert len(rows)==1 and set(rows[0])=={'id','reason','created_at'}
    report_id=rows[0]['id']
    monkeypatch.setattr(sys,'argv',['moderation','show',report_id]);main()
    shown=json.loads(capsys.readouterr().out)
    assert shown['reason']=='copyright' and shown['snapshot']['kind']=='cards'
    assert share['token'] not in str(shown)
    monkeypatch.setattr(sys,'argv',['moderation','dismiss',report_id]);main()
    assert capsys.readouterr().out.strip()=='Resolved'
    assert client.get('/v1/shared/view',headers=visitor).status_code==200
