from datetime import timedelta
from sqlalchemy.orm import Session
from test_api import client,auth,notebook
from test_collaboration import join
from knowlm.pomodoro import FocusTimer
import knowlm.pomodoro as timers


def test_timer_is_shared_server_timed_and_versioned(client,monkeypatch):
    owner=auth(client,'timerowner');nid=notebook(client,owner)
    member=join(client,owner,nid,role='editor');outsider=auth(client,'timerother')
    path=f'/v1/notebooks/{nid}/pomodoro'
    start=timers.now();monkeypatch.setattr(timers,'now',lambda:start)
    initial=client.get(path,headers=owner)
    assert initial.headers['cache-control']=='no-store'
    assert initial.json()['version']==0 and initial.json()['remaining_seconds']==1500
    assert client.get(path).status_code==401
    assert client.get(path,headers=outsider).status_code==404
    running=client.post(path,headers=owner,json={'action':'start','version':0})
    assert running.status_code==200,running.text
    assert running.json()['running'] and running.json()['version']==1
    monkeypatch.setattr(timers,'now',lambda:start+timedelta(seconds=100))
    assert client.get(path,headers=member).json()['remaining_seconds']==1400
    assert client.post(path,headers=member,json={'action':'pause','version':0}).status_code==409
    paused=client.post(path,headers=member,json={'action':'pause','version':1}).json()
    assert paused['version']==2 and not paused['running'] and paused['remaining_seconds']==1400
    monkeypatch.setattr(timers,'now',lambda:start+timedelta(seconds=500))
    assert client.get(path,headers=owner).json()['remaining_seconds']==1400
    assert client.post(path,headers=owner,json={'action':'start','version':2}).status_code==200
    monkeypatch.setattr(timers,'now',lambda:start+timedelta(seconds=1901))
    finished=client.get(path,headers=member).json()
    assert finished['finished'] and not finished['running'] and finished['remaining_seconds']==0
    rest=client.post(path,headers=member,json={'action':'next','version':3}).json()
    assert rest['phase']=='break' and rest['remaining_seconds']==300 and not rest['running']
    assert client.post(path,headers=member,json={'action':'next','version':4}).status_code==409
    assert client.post(path,headers=owner,json={'action':'reset','version':4}).json()['version']==5
    assert client.post(path,headers=owner,json={'action':'start','version':5}).status_code==200
    monkeypatch.setattr(timers,'now',lambda:start+timedelta(seconds=2202))
    assert client.get(path,headers=owner).json()['finished']
    work=client.post(path,headers=member,json={'action':'next','version':6}).json()
    assert work['phase']=='work' and work['remaining_seconds']==1500 and not work['running']


def test_viewer_permissions_removal_validation_and_deletion(client):
    owner=auth(client,'timerprivate');nid=notebook(client,owner)
    viewer=join(client,owner,nid);path=f'/v1/notebooks/{nid}/pomodoro'
    assert client.get(path,headers=viewer).json()['can_control'] is False
    assert client.post(path,headers=viewer,json={'action':'start','version':0}).status_code==403
    for body in [{'action':'bad','version':0},{'action':'start','version':True},{'action':'start','version':-1},{'action':'start','version':0,'seconds':1}]:
        assert client.post(path,headers=owner,json=body).status_code==422
    assert client.post(path,headers=owner,json={'action':'start','version':0}).status_code==200
    uid=client.get('/v1/auth/me',headers=viewer).json()['id']
    assert client.delete(f'/v1/notebooks/{nid}/members/{uid}',headers=owner).status_code==204
    assert client.get(path,headers=viewer).status_code==404
    assert client.delete(f'/v1/notebooks/{nid}',headers=owner).status_code==204
    with Session(client.app.state.engine) as session: assert session.get(FocusTimer,nid) is None
