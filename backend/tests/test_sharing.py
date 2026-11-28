from datetime import datetime, timedelta, timezone
import json

import pytest
from sqlalchemy import select, func
from sqlalchemy.orm import Session

from knowlm.sharing import LearningShare
from test_api import client, auth, notebook
from test_learning import seed, generated


def prepare(client):
    headers,nid,sid=seed(client);deck,cards=generated(client,headers,nid,sid)
    return headers,nid,sid,deck,cards


def publish(client,headers,target,title='نسخة للمراجعة',**changes):
    preview=client.get(target+'/share-preview',headers=headers)
    assert preview.status_code==200
    body={'title':title,'consent':True,'expires_days':7,'preview_hash':preview.json()['preview_hash'],**changes}
    return client.post(target+'/shares',headers=headers,json=body)


def test_card_share_is_explicit_snapshot_not_notebook_access(client):
    headers,nid,sid,deck,cards=prepare(client);target=f'/v1/decks/{deck["id"]}'
    created=publish(client,headers,target)
    assert created.status_code==201
    share=created.json();assert len(share['token'])==43
    public_headers={'X-KnowLM-Share':share['token']}
    response=client.get('/v1/shared/view',headers=public_headers)
    assert response.status_code==200
    assert response.headers['cache-control']=='no-store'
    assert response.headers['referrer-policy']=='no-referrer'
    assert 'noindex' in response.headers['x-robots-tag']
    public=response.json()
    assert public['kind']=='cards' and public['title']=='نسخة للمراجعة'
    assert len(public['items'])==len(cards)
    assert all(set(c)=={'front','back'} for c in public['items'])
    serialized=json.dumps(public)
    assert all(value not in serialized for value in [nid,sid,deck['id'],cards[0]['id'],cards[0]['reference']['url']])
    assert 'source_id' not in serialized and 'reference' not in serialized
    assert client.get(f'/v1/notebooks/{nid}/sources').status_code==401
    listing=client.get(f'/v1/notebooks/{nid}/shares',headers=headers).json()
    assert listing[0]['id']==share['id']
    assert 'token' not in json.dumps(listing) and 'token_hash' not in json.dumps(listing)
    with Session(client.app.state.engine) as session:
        saved=session.get(LearningShare,share['id'])
        assert saved.token_hash!=share['token'] and share['token'] not in json.dumps(saved.snapshot)
    # Later edits do not silently modify the consented public snapshot.
    client.put(f'/v1/cards/{cards[0]["id"]}',headers=headers,json={'front':'changed','back':'new','version':1})
    assert client.get('/v1/shared/view',headers=public_headers).json()==public


def test_owner_must_preview_current_content_and_consent(client):
    headers,_,_,deck,cards=prepare(client);target=f'/v1/decks/{deck["id"]}'
    preview=client.get(target+'/share-preview',headers=headers).json()
    body={'title':'review','consent':False,'preview_hash':preview['preview_hash']}
    assert client.post(target+'/shares',headers=headers,json=body).status_code==422
    assert client.post(target+'/shares',headers=headers,json={**body,'consent':'true'}).status_code==422
    client.put(f'/v1/cards/{cards[0]["id"]}',headers=headers,json={'front':'changed','back':'new','version':1})
    assert client.post(target+'/shares',headers=headers,json={**body,'consent':True}).status_code==409
    for days in (0,31):assert publish(client,headers,target,expires_days=days).status_code==422
    with Session(client.app.state.engine) as session:assert session.scalar(select(func.count()).select_from(LearningShare))==0


def test_foreign_users_cannot_preview_create_list_or_revoke(client):
    owner,nid,_,deck,_=prepare(client);other=auth(client,'outsider');target=f'/v1/decks/{deck["id"]}'
    preview=client.get(target+'/share-preview',headers=owner).json()
    assert client.get(target+'/share-preview',headers=other).status_code==404
    assert client.post(target+'/shares',headers=other,json={'title':'copy','consent':True,'preview_hash':preview['preview_hash']}).status_code==404
    created=publish(client,owner,target).json()
    assert client.get(f'/v1/notebooks/{nid}/shares',headers=other).status_code==404
    assert client.delete(f'/v1/shares/{created["id"]}',headers=other).status_code==404
    assert client.get('/v1/shared/view',headers={'X-KnowLM-Share':created['token']}).status_code==200


def test_revocation_removes_snapshot_and_expired_unknown_tokens_are_indistinguishable(client):
    headers,_,_,deck,_=prepare(client);target=f'/v1/decks/{deck["id"]}'
    one=publish(client,headers,target).json();two=publish(client,headers,target).json()
    assert client.delete(f'/v1/shares/{one["id"]}',headers=headers).status_code==204
    assert client.delete(f'/v1/shares/{one["id"]}',headers=headers).status_code==204
    with Session(client.app.state.engine) as session:
        assert session.get(LearningShare,one['id']).snapshot['items']==[]
        session.get(LearningShare,two['id']).expires_at=datetime.now(timezone.utc)-timedelta(seconds=1)
        session.commit()
    responses=[client.get('/v1/shared/view',headers={'X-KnowLM-Share':token}) for token in [one['token'],two['token'],'a'*43,'invalid']]
    assert all(r.status_code==404 for r in responses)
    assert all(r.json()==responses[0].json() for r in responses)
    assert client.get('/v1/shared/view').status_code==404
    # Query-string tokens are not accepted: avoid accidentally logging capabilities.
    assert client.get('/v1/shared/view?token='+two['token']).status_code==404


def test_shared_quiz_hides_key_and_grades_without_saving_visitor_attempts(client):
    from knowlm.learning import QuizAttempt
    headers,_,_,deck,_=prepare(client)
    quiz=client.post(f'/v1/decks/{deck["id"]}/quizzes',headers=headers,json={'count':3}).json()
    target=f'/v1/quizzes/{quiz["id"]}'
    preview=client.get(target+'/share-preview',headers=headers).json()
    created=publish(client,headers,target).json();public_headers={'X-KnowLM-Share':created['token']}
    view=client.get('/v1/shared/view',headers=public_headers).json()
    assert view['kind']=='quiz' and all(set(q)=={'prompt','choices'} for q in view['items'])
    answers=[q['correct_index'] for q in preview['snapshot']['items']]
    response=client.post('/v1/shared/grade',headers=public_headers,json={'answers':answers})
    assert response.status_code==200 and response.json()['correct']==response.json()['total']==3
    assert all(set(q)=={'correct','correct_index','explanation'} for q in response.json()['questions'])
    assert client.post('/v1/shared/grade',headers=public_headers,json={'answers':[True]*3}).status_code==422
    assert client.post('/v1/shared/grade',headers=public_headers,json={'answers':[99]*3}).status_code==422
    assert client.post('/v1/shared/grade',headers=public_headers,json={'answers':[0,1]}).status_code==422
    client.delete(f'/v1/shares/{created["id"]}',headers=headers)
    assert client.post('/v1/shared/grade',headers=public_headers,json={'answers':answers}).status_code==404
    with Session(client.app.state.engine) as session:assert session.scalar(select(func.count()).select_from(QuizAttempt))==0


@pytest.mark.parametrize('account',[False,True])
def test_parent_deletion_invalidates_public_shares(client,account):
    headers,nid,_,deck,_=prepare(client);share=publish(client,headers,f'/v1/decks/{deck["id"]}').json()
    if account:assert client.post('/v1/auth/delete-account',headers=headers,json={'password':'secure-password-123'}).status_code==204
    else:assert client.delete(f'/v1/notebooks/{nid}',headers=headers).status_code==204
    assert client.get('/v1/shared/view',headers={'X-KnowLM-Share':share['token']}).status_code==404
    with Session(client.app.state.engine) as session:assert session.get(LearningShare,share['id']) is None


def test_active_share_quota_is_released_by_revocation(client):
    headers,_,_,deck,_=prepare(client);target=f'/v1/decks/{deck["id"]}'
    created=[publish(client,headers,target).json() for _ in range(20)]
    assert all('token' in s for s in created)
    assert publish(client,headers,target).status_code==409
    assert client.delete(f'/v1/shares/{created[0]["id"]}',headers=headers).status_code==204
    assert publish(client,headers,target).status_code==201


def test_card_share_size_is_rejected_not_silently_truncated(client):
    from knowlm.learning import Card
    headers=auth(client,'owner');nid=notebook(client,headers)
    deck=client.post(f'/v1/notebooks/{nid}/decks',headers=headers,json={'title':'empty'}).json()
    target=f'/v1/decks/{deck["id"]}'
    assert client.get(target+'/share-preview',headers=headers).status_code==422
    with Session(client.app.state.engine) as session:
        session.add_all([Card(deck_id=deck['id'],front=f'question {i}',back='answer',origin='manual') for i in range(51)])
        session.commit()
    assert client.get(target+'/share-preview',headers=headers).status_code==422


def test_failed_notebook_erasure_restores_public_share_in_same_transaction(client):
    from sqlalchemy import event
    from knowlm.privacy import erase_notebook
    headers,nid,_,deck,_=prepare(client)
    created=publish(client,headers,f'/v1/decks/{deck["id"]}').json()
    engine=client.app.state.engine
    def fail(connection,cursor,statement,parameters,context,executemany):
        if statement.startswith('DELETE FROM sources'):raise RuntimeError('injected rollback')
    event.listen(engine,'before_cursor_execute',fail)
    try:
        with pytest.raises(RuntimeError):
            with Session(engine) as session:erase_notebook(session,nid);session.commit()
    finally:event.remove(engine,'before_cursor_execute',fail)
    assert client.get('/v1/shared/view',headers={'X-KnowLM-Share':created['token']}).status_code==200
