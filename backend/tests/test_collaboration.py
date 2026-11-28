import uuid
from datetime import timedelta

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from knowlm.collaboration import Invitation, Membership, RoomMessage, now
from knowlm.main import ChatTurn
from test_api import client, auth, notebook
from test_sharing import prepare


def invite(client,owner,nid,username='member',role='viewer'):
    response=client.post(f'/v1/notebooks/{nid}/invitations',headers=owner,json={'username':username,'role':role,'consent':True})
    assert response.status_code==201,response.text
    return response.json()


def join(client,owner,nid,role='viewer',username='member'):
    member=auth(client,username)
    invitation=invite(client,owner,nid,username,role)
    headers={**member,'X-KnowLM-Invite':invitation['token']}
    assert client.post('/v1/collaboration/accept',headers=headers,json={'consent':True}).status_code==200
    return member


def test_bound_invitation_and_explicit_consent(client):
    owner,nid,_,deck,_=prepare(client);member=auth(client,'member');outsider=auth(client,'outsider')
    row=invite(client,owner,nid)
    assert len(row['token'])==43
    headers={**member,'X-KnowLM-Invite':row['token']}
    assert client.get('/v1/collaboration/invitation',headers={**outsider,'X-KnowLM-Invite':row['token']}).status_code==404
    assert client.get('/v1/collaboration/invitation',headers=headers).json()['role']=='viewer'
    assert client.post('/v1/collaboration/accept',headers=headers,json={'consent':False}).status_code==422
    assert client.post('/v1/collaboration/accept',headers=headers,json={'consent':'true'}).status_code==422
    assert client.get(f'/v1/decks/{deck["id"]}/cards',headers=member).status_code==404
    assert client.post('/v1/collaboration/accept',headers=headers,json={'consent':True}).status_code==200
    listed=client.get('/v1/notebooks',headers=member).json()
    assert listed[0]['id']==nid and listed[0]['role']=='viewer'
    with Session(client.app.state.engine) as session:
        assert session.get(Invitation,row['id']).token_hash!=row['token']
    settings=client.get(f'/v1/notebooks/{nid}/collaboration',headers=owner).json()
    assert settings['members'][0]['username']=='member' and 'token' not in str(settings)


def test_viewer_permissions_editor_updates_and_owner_only_publication(client):
    owner,nid,sid,deck,cards=prepare(client);member=join(client,owner,nid)
    assert client.get(f'/v1/notebooks/{nid}/sources',headers=member).status_code==200
    assert client.get(cards[0]['reference']['url'],headers=member).status_code==200
    assert client.get(f'/v1/notebooks/{nid}/study-artifacts',headers=member).status_code==200
    assert client.get(f'/v1/decks/{deck["id"]}/cards',headers=member).status_code==200
    assert client.post(f'/v1/notebooks/{nid}/sources/text',headers=member,json={'title':'new','text':'text'}).status_code==403
    assert client.post(f'/v1/notebooks/{nid}/decks',headers=member,json={'title':'new'}).status_code==403
    assert client.put(f'/v1/cards/{cards[0]["id"]}',headers=member,json={'front':'new','back':'new','version':1}).status_code==403
    assert client.delete(f'/v1/notebooks/{nid}',headers=member).status_code==404
    member_id=client.get('/v1/auth/me',headers=member).json()['id']
    assert client.patch(f'/v1/notebooks/{nid}/members/{member_id}',headers=member,json={'role':'editor'}).status_code==404
    assert client.patch(f'/v1/notebooks/{nid}/members/{member_id}',headers=owner,json={'role':'editor'}).status_code==200
    assert client.post(f'/v1/notebooks/{nid}/sources/text',headers=member,json={'title':'new','text':'text'}).status_code==201
    assert client.post(f'/v1/notebooks/{nid}/decks',headers=member,json={'title':'new'}).status_code==201
    assert client.get(f'/v1/decks/{deck["id"]}/share-preview',headers=member).status_code==404
    assert client.post(f'/v1/notebooks/{nid}/invitations',headers=member,json={'username':'third','role':'editor','consent':True}).status_code==404
    for body in [{'question':'البناء الضوئي','mode':'grounded'},{'question':'البناء الضوئي','semantic_consent':True,'source_ids':[sid]}]:
        assert client.post(f'/v1/notebooks/{nid}/ask',headers=member,json=body).status_code==403


def test_personal_chat_is_private_and_same_request_id_is_scoped_per_member(client):
    owner,nid,_,_,_=prepare(client);member=join(client,owner,nid)
    body={'question':'البناء الضوئي','request_id':str(uuid.uuid4())}
    a=client.post(f'/v1/notebooks/{nid}/ask',headers=owner,json=body)
    b=client.post(f'/v1/notebooks/{nid}/ask',headers=member,json=body)
    assert a.status_code==b.status_code==200
    assert a.json()['turn_id']!=b.json()['turn_id']
    for user in [owner,member]:
        history=client.get(f'/v1/notebooks/{nid}/history',headers=user).json()['turns']
        assert len(history)==1
    client.delete(f'/v1/notebooks/{nid}/history',headers=member)
    assert len(client.get(f'/v1/notebooks/{nid}/history',headers=owner).json()['turns'])==1
    assert client.get(f'/v1/notebooks/{nid}/history',headers=member).json()['turns']==[]


def test_room_publishing_is_explicit_and_foreign_answers_are_rejected(client):
    owner,nid,_,_,_=prepare(client);member=join(client,owner,nid)
    turn=client.post(f'/v1/notebooks/{nid}/ask',headers=owner,json={'question':'البناء الضوئي'}).json()
    path=f'/v1/notebooks/{nid}/room'
    body={'request_id':str(uuid.uuid4()),'turn_id':turn['turn_id'],'consent':True}
    assert client.get(path,headers=member).json()['messages']==[]
    assert client.post(path,headers=member,json=body).status_code==404
    assert client.post(path,headers=owner,json={**body,'consent':False}).status_code==422
    response=client.post(path,headers=owner,json=body)
    assert response.status_code==201
    saved=response.json()
    assert saved['content']['answer']=={k:v for k,v in turn.items() if k not in ('turn_id','request_id','created_at')}
    assert client.post(path,headers=owner,json=body).json()==saved
    assert client.post(path,headers=owner,json={**body,'text':'changed'}).status_code==409
    assert len(client.get(path,headers=member).json()['messages'])==1
    assert client.delete(path+f'/{saved["id"]}',headers=member).status_code==404
    assert client.delete(path+f'/{saved["id"]}',headers=owner).status_code==204
    new=client.post(path,headers=member,json={'request_id':str(uuid.uuid4()),'text':'<script>data only</script>','consent':True}).json()
    assert new['id']>saved['id']
    assert client.get(path+f'?after={saved["id"]}',headers=owner).json()['messages'][0]['id']==new['id']


def test_revocation_blocks_all_new_requests_and_old_invitation(client):
    owner,nid,_,deck,cards=prepare(client);member=join(client,owner,nid,'editor')
    pending=invite(client,owner,nid)
    member_id=client.get('/v1/auth/me',headers=member).json()['id']
    assert client.delete(f'/v1/notebooks/{nid}/members/{member_id}',headers=owner).status_code==204
    assert client.get('/v1/notebooks',headers=member).json()==[]
    for path in [f'/v1/notebooks/{nid}/sources',cards[0]['reference']['url'],f'/v1/decks/{deck["id"]}/cards',f'/v1/notebooks/{nid}/history',f'/v1/notebooks/{nid}/room']:
        assert client.get(path,headers=member).status_code==404
    assert client.post('/v1/collaboration/accept',headers={**member,'X-KnowLM-Invite':pending['token']},json={'consent':True}).status_code==404


@pytest.mark.parametrize('owner_delete',[False,True])
def test_account_deletion_cleans_memberships_private_chats_room_and_invitations(client,owner_delete):
    owner,nid,_,_,_=prepare(client);member=join(client,owner,nid)
    invite(client,owner,nid)
    client.post(f'/v1/notebooks/{nid}/ask',headers=member,json={'question':'البناء الضوئي'})
    client.post(f'/v1/notebooks/{nid}/room',headers=member,json={'request_id':str(uuid.uuid4()),'text':'hello','consent':True})
    assert client.post('/v1/auth/delete-account',headers=owner if owner_delete else member,json={'password':'secure-password-123'}).status_code==204
    with Session(client.app.state.engine) as session:
        for model in [Membership,Invitation,RoomMessage,ChatTurn]:
            assert session.scalar(select(func.count()).select_from(model))==0
    if not owner_delete: assert client.get(f'/v1/notebooks/{nid}/sources',headers=owner).status_code==200


def test_expired_cancelled_invitations_and_leave(client):
    owner,nid,_,_,_=prepare(client);member=auth(client,'member')
    expired=invite(client,owner,nid)
    with Session(client.app.state.engine) as session:
        session.get(Invitation,expired['id']).expires_at=now()-timedelta(seconds=1);session.commit()
    assert client.get('/v1/collaboration/invitation',headers={**member,'X-KnowLM-Invite':expired['token']}).status_code==404
    active=invite(client,owner,nid)
    assert client.delete(f'/v1/notebooks/{nid}/invitations/{active["id"]}',headers=owner).status_code==204
    assert client.get('/v1/collaboration/invitation',headers={**member,'X-KnowLM-Invite':active['token']}).status_code==404
    next_invite=invite(client,owner,nid)
    assert client.post('/v1/collaboration/accept',headers={**member,'X-KnowLM-Invite':next_invite['token']},json={'consent':True}).status_code==200
    assert client.delete(f'/v1/notebooks/{nid}/membership',headers=member).status_code==204
    assert client.get(f'/v1/notebooks/{nid}/sources',headers=member).status_code==404
    assert client.delete(f'/v1/notebooks/{nid}/membership',headers=owner).status_code==409


def test_viewer_review_and_quiz_results_are_personal(client):
    owner,nid,_,deck,cards=prepare(client);member=join(client,owner,nid)
    card=cards[0]
    response=client.post(f'/v1/cards/{card["id"]}/reviews',headers=member,json={'card_version':1,'state_version':0,'rating':'good'})
    assert response.status_code==200
    mine=client.get(f'/v1/decks/{deck["id"]}/cards',headers=member).json()
    original=client.get(f'/v1/decks/{deck["id"]}/cards',headers=owner).json()
    assert next(c for c in mine if c['id']==card['id'])['review']['version']==1
    assert next(c for c in original if c['id']==card['id'])['review']['version']==0
    quiz=client.post(f'/v1/decks/{deck["id"]}/quizzes',headers=owner,json={'count':2}).json()
    public=client.get(f'/v1/quizzes/{quiz["id"]}',headers=member).json()
    result=client.post(f'/v1/quizzes/{quiz["id"]}/attempts',headers=member,json={'answers':{q['id']:0 for q in public['questions']}})
    assert result.status_code==201
    assert client.get(f'/v1/quizzes/{quiz["id"]}/attempts',headers=owner).json()==[]
    assert len(client.get(f'/v1/quizzes/{quiz["id"]}/attempts',headers=member).json())==1


def test_invitation_and_room_quotas(client):
    owner,nid,_,_,_=prepare(client)
    for _ in range(20): invite(client,owner,nid)
    assert client.post(f'/v1/notebooks/{nid}/invitations',headers=owner,json={'username':'member','role':'viewer','consent':True}).status_code==409
    user_id=client.get('/v1/auth/me',headers=owner).json()['id']
    with Session(client.app.state.engine) as session:
        session.add_all([RoomMessage(notebook_id=nid,user_id=user_id,request_id=str(uuid.uuid4()),request_hash='a'*64,content={'text':'authored'}) for _ in range(1000)])
        session.commit()
    assert client.post(f'/v1/notebooks/{nid}/room',headers=owner,json={'request_id':str(uuid.uuid4()),'text':'over quota','consent':True}).status_code==409
    page=client.get(f'/v1/notebooks/{nid}/room',headers=owner).json()
    assert len(page['messages'])==100
    assert client.delete(f'/v1/notebooks/{nid}/room/{page["messages"][0]["id"]}',headers=owner).status_code==204
    assert client.post(f'/v1/notebooks/{nid}/room',headers=owner,json={'request_id':str(uuid.uuid4()),'text':'allowed','consent':True}).status_code==201


def test_membership_limit_is_atomic(client):
    from knowlm.main import User
    owner,nid,_,_,_=prepare(client);member=auth(client,'member')
    invitation=invite(client,owner,nid)
    with Session(client.app.state.engine) as session:
        for i in range(20):
            user=User(username=f'seed_{i}',password_hash='not-a-login');session.add(user);session.flush()
            session.add(Membership(notebook_id=nid,user_id=user.id,role='viewer'))
        session.commit()
    response=client.post('/v1/collaboration/accept',headers={**member,'X-KnowLM-Invite':invitation['token']},json={'consent':True})
    assert response.status_code==409
    with Session(client.app.state.engine) as session:
        assert session.get(Invitation,invitation['id']).used_at is None
        assert session.scalar(select(func.count()).select_from(Membership))==20


def test_room_concurrent_retry_publishes_once(client):
    from concurrent.futures import ThreadPoolExecutor
    owner,nid,_,_,_=prepare(client)
    body={'request_id':str(uuid.uuid4()),'text':'one message','consent':True}
    with ThreadPoolExecutor(max_workers=2) as pool:
        results=list(pool.map(lambda _:client.post(f'/v1/notebooks/{nid}/room',headers=owner,json=body),range(2)))
    assert all(r.status_code==201 for r in results)
    assert results[0].json()==results[1].json()
    with Session(client.app.state.engine) as session:assert session.scalar(select(func.count()).select_from(RoomMessage))==1
