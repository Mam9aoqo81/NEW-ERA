from datetime import timedelta
import json

import pytest
from sqlalchemy import select,func
from sqlalchemy.orm import Session

from knowlm.community import CommunityPost,PostComment,SavedPost,Follow,UserBlock
from knowlm.sharing import LearningShare,ShareReport,now
from knowlm.moderation import resolve
from test_api import client,auth
from test_sharing import prepare,publish


def setup(client):
    owner,nid,sid,deck,cards=prepare(client)
    share=publish(client,owner,f'/v1/decks/{deck["id"]}').json()
    preview=client.get(f'/v1/shares/{share["id"]}/public-preview',headers=owner).json()
    body={'share_id':share['id'],'preview_hash':preview['preview_hash'],'country':'EG','stage':'secondary','subject':'biology','curriculum':'عام 2026/2027','consent':True}
    return owner,nid,sid,deck,cards,share,body


def create(client,owner,body):
    response=client.post('/v1/community/posts',headers=owner,json=body)
    assert response.status_code==201,response.text
    return response.json()


def test_unlisted_never_appears_without_explicit_public_consent(client):
    owner,nid,sid,_,cards,share,body=setup(client)
    assert client.get('/v1/community/feed').json()['posts']==[]
    assert client.post('/v1/community/posts',headers=owner,json={**body,'consent':False}).status_code==422
    assert client.post('/v1/community/posts',headers=owner,json={**body,'consent':'true'}).status_code==422
    assert client.post('/v1/community/posts',headers=owner,json={**body,'country':'invalid'}).status_code==422
    post=create(client,owner,body)
    assert create(client,owner,body)==post
    public=client.get('/v1/community/posts/'+post['id'])
    assert public.status_code==200 and public.headers['cache-control']=='no-store'
    data=public.json();assert len(data['items'])==len(cards)
    assert all(set(c)=={'front','back'} for c in data['items'])
    for private in [nid,sid,share['id'],share['token'],cards[0]['reference']['url'],'preview_hash','token_hash']:
        assert private not in json.dumps(data)
    assert client.get('/v1/community/feed?country=EG&stage=secondary&subject=biology&curriculum=عام%202026/2027').json()['posts'][0]['id']==post['id']
    assert client.get('/v1/community/feed?country=SA').json()['posts']==[]
    assert client.get('/v1/community/publishers/'+post['publisher']['id']).json()['active_posts']==1
    assert client.get(f'/v1/notebooks/{nid}/sources').status_code==401


def test_foreign_publish_and_unpublish_are_denied(client):
    owner,_,_,_,_,share,body=setup(client);other=auth(client,'other')
    assert client.get(f'/v1/shares/{share["id"]}/public-preview',headers=other).status_code==404
    assert client.post('/v1/community/posts',headers=other,json=body).status_code==404
    post=create(client,owner,body)
    assert client.delete('/v1/community/posts/'+post['id'],headers=other).status_code==404
    assert client.post('/v1/community/posts',headers=owner,json={**body,'preview_hash':'a'*64}).status_code==409


def test_private_saves_following_comments_and_blocking(client):
    owner,_,_,_,_,_,body=setup(client);post=create(client,owner,body);other=auth(client,'reader')
    path='/v1/community/posts/'+post['id'];publisher=post['publisher']['id']
    assert client.put(path+'/save').status_code==401
    for _ in range(2):
        assert client.put(path+'/save',headers=other).status_code==204
        assert client.put(f'/v1/community/publishers/{publisher}/follow',headers=other).status_code==204
    assert len(client.get('/v1/community/feed?saved=true',headers=other).json()['posts'])==1
    assert len(client.get('/v1/community/feed?following=true',headers=other).json()['posts'])==1
    assert client.get('/v1/community/me',headers=owner).json()['saved']==[]
    assert client.post(path+'/comments',headers=other,json={'text':'private','consent':False}).status_code==422
    comment=client.post(path+'/comments',headers=other,json={'text':'<script>text only</script>','consent':True}).json()
    assert client.get(path+'/comments').json()[0]['text']=='<script>text only</script>'
    assert client.delete(path+'/comments/'+str(comment['id']),headers=auth(client,'third')).status_code==404
    assert client.put(f'/v1/community/publishers/{publisher}/block',headers=other).status_code==204
    assert client.get(path,headers=other).status_code==404
    assert client.get(path+'/comments',headers=other).status_code==404
    assert client.get('/v1/community/feed',headers=other).json()['posts']==[]
    assert client.get('/v1/community/me',headers=other).json()['following']==[]
    # A public post remains public to anonymous readers. Blocking is not secrecy.
    assert client.get(path).status_code==200
    assert client.get('/v1/community/feed',headers=owner).json()['posts']
    assert client.delete(f'/v1/community/publishers/{publisher}/block',headers=other).status_code==204
    assert client.get(path,headers=other).status_code==200
    assert client.delete(path+'/comments/'+str(comment['id']),headers=owner).status_code==204
    assert client.delete(path+'/save',headers=other).status_code==204
    assert client.get('/v1/community/me',headers=other).json()['saved']==[]


def test_report_reuses_operator_revocation_and_hides_feed_profile_and_content(client):
    owner,_,_,_,_,_,body=setup(client);post=create(client,owner,body);other=auth(client,'reader')
    path='/v1/community/posts/'+post['id']
    for _ in range(2):assert client.post(path+'/report',headers=other,json={'reason':'privacy'}).status_code==202
    with Session(client.app.state.engine) as session:
        assert session.scalar(select(func.count()).select_from(ShareReport))==1
        resolve(session,session.scalar(select(ShareReport.id)),'revoke')
    assert client.get('/v1/community/feed').json()['posts']==[]
    assert client.get(path).status_code==404
    assert client.get('/v1/community/publishers/'+post['publisher']['id']).status_code==404


@pytest.mark.parametrize('mode',['unpublish','notebook','account','expiry','revoke'])
def test_visibility_and_privacy_lifecycle(client,mode):
    owner,nid,_,_,_,share,body=setup(client);post=create(client,owner,body);reader=auth(client,'reader');path='/v1/community/posts/'+post['id']
    client.put(path+'/save',headers=reader)
    client.post(path+'/comments',headers=reader,json={'text':'comment','consent':True})
    if mode=='unpublish':assert client.delete(path,headers=owner).status_code==204
    elif mode=='notebook':assert client.delete(f'/v1/notebooks/{nid}',headers=owner).status_code==204
    elif mode=='account':assert client.post('/v1/auth/delete-account',headers=owner,json={'password':'secure-password-123'}).status_code==204
    elif mode=='revoke':assert client.delete(f'/v1/shares/{share["id"]}',headers=owner).status_code==204
    else:
        with Session(client.app.state.engine) as session:
            session.get(LearningShare,share['id']).expires_at=now()-timedelta(seconds=1);session.commit()
    assert client.get(path).status_code==404
    assert client.get(path+'/comments').status_code==404
    assert client.get('/v1/community/feed?saved=true',headers=reader).json()['posts']==[]
    if mode in ['unpublish','notebook','account']:
        with Session(client.app.state.engine) as session:
            for model in [CommunityPost,PostComment,SavedPost]:assert session.scalar(select(func.count()).select_from(model))==0
    if mode=='unpublish':assert client.get('/v1/shared/view',headers={'X-KnowLM-Share':share['token']}).status_code==200


def test_reader_deletion_removes_social_activity_but_not_others_posts(client):
    owner,_,_,_,_,_,body=setup(client);post=create(client,owner,body);reader=auth(client,'reader');path='/v1/community/posts/'+post['id'];publisher=post['publisher']['id']
    client.put(path+'/save',headers=reader);client.put(f'/v1/community/publishers/{publisher}/follow',headers=reader)
    client.post(path+'/comments',headers=reader,json={'text':'comment','consent':True})
    client.put(f'/v1/community/publishers/{publisher}/block',headers=reader)
    assert client.post('/v1/auth/delete-account',headers=reader,json={'password':'secure-password-123'}).status_code==204
    assert client.get(path).status_code==200
    with Session(client.app.state.engine) as session:
        for model in [PostComment,SavedPost,Follow,UserBlock]:assert session.scalar(select(func.count()).select_from(model))==0


def test_public_quiz_hides_key_and_grades_without_private_source_access(client):
    owner,_,_,deck,_,_,_=setup(client)
    quiz=client.post(f'/v1/decks/{deck["id"]}/quizzes',headers=owner,json={'count':2}).json()
    share=publish(client,owner,f'/v1/quizzes/{quiz["id"]}').json()
    preview=client.get(f'/v1/shares/{share["id"]}/public-preview',headers=owner).json()
    post=create(client,owner,{'share_id':share['id'],'preview_hash':preview['preview_hash'],'country':'EG','stage':'secondary','subject':'biology','curriculum':'test','consent':True})
    path='/v1/community/posts/'+post['id']
    public=client.get(path).json()
    assert all(set(q)=={'prompt','choices'} for q in public['items'])
    answers=[q['correct_index'] for q in preview['snapshot']['items']]
    grade=client.post(path+'/grade',json={'answers':answers})
    assert grade.status_code==200 and grade.json()['correct']==2
    assert client.post(path+'/grade',json={'answers':[True,True]}).status_code==422
