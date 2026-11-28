import base64
from datetime import timedelta
import hashlib
import hmac
import uuid

from fastapi.testclient import TestClient
import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from knowlm.main import create_app
from knowlm.calls import CallSession, CallSignal, purge_expired
import knowlm.calls as calls
from test_api import client, auth, notebook
from test_collaboration import join as member_join


def setup(client):
    owner = auth(client, 'callowner'); nid = notebook(client, owner)
    member = member_join(client, owner, nid)
    return owner, member, nid


def enter(client, headers, nid, request_id=None):
    return client.post(f'/v1/notebooks/{nid}/call/sessions', headers=headers, json={'consent': True, 'request_id': request_id or str(uuid.uuid4())})


def test_call_requires_membership_and_explicit_consent_with_two_person_capacity(client):
    owner, member, nid = setup(client); outsider = auth(client, 'outsider')
    path = f'/v1/notebooks/{nid}/call'
    assert client.get(path+'/config').status_code == 401
    assert client.get(path+'/config', headers=outsider).status_code == 404
    config = client.get(path+'/config', headers=owner)
    assert config.headers['cache-control'] == 'no-store'
    assert config.json()['iceServers'] == [] and config.json()['has_turn'] is False
    for value in [False, 'true', 1]:
        assert client.post(path+'/sessions', headers=owner, json={'consent': value, 'request_id': str(uuid.uuid4())}).status_code == 422
    assert enter(client, outsider, nid).status_code == 404
    first = enter(client, owner, nid); assert first.status_code == 201
    own_id = first.json()['id']
    assert enter(client, owner, nid, own_id).json()['id'] == own_id
    assert enter(client, owner, nid).status_code == 409
    assert enter(client, member, nid).status_code == 201
    third = member_join(client, owner, nid, username='third')
    assert enter(client, third, nid).status_code == 409


def test_signals_are_targeted_not_public_and_acknowledged(client):
    owner, member, nid = setup(client)
    a, b = enter(client, owner, nid).json()['id'], enter(client, member, nid).json()['id']
    base = f'/v1/notebooks/{nid}/call/sessions'
    body = {'target_id': b, 'kind': 'offer', 'sdp': 'private SDP'}
    assert client.post(f'{base}/{a}/signals', headers=member, json=body).status_code == 404
    assert client.post(f'{base}/{a}/signals', headers=owner, json=body).status_code == 204
    assert client.get(f'{base}/{a}', headers=owner).json()['signals'] == []
    page = client.get(f'{base}/{b}', headers=member).json()
    assert page['peers'] == [{'id': a, 'username': 'callowner'}]
    assert page['signals'][0]['sdp'] == 'private SDP'
    assert client.get(f'{base}/{b}', headers=owner).status_code == 404
    assert client.post(f'{base}/{b}/heartbeat', headers=member, json={'after': page['next_after']}).status_code == 204
    assert client.get(f'{base}/{b}', headers=member).json()['signals'] == []
    assert client.post(f'{base}/{a}/signals', headers=owner, json={**body, 'target_id': a}).status_code == 404
    assert client.post(f'{base}/{a}/signals', headers=owner, json={**body, 'candidate': {'candidate': 'bad'}}).status_code == 422
    assert client.post(f'{base}/{a}/signals', headers=owner, json={**body, 'sdp': 'x'*64001}).status_code == 422
    assert client.post(f'{base}/{a}/signals', headers=owner, json={'target_id': b, 'kind': 'ice', 'candidate': {'candidate': 'candidate', 'sdpMid': '0', 'sdpMLineIndex': 0}}).status_code == 204


def test_foreign_notebook_signal_and_foreign_leave_are_denied(client):
    owner, member, nid = setup(client)
    a = enter(client, owner, nid).json()['id']
    foreign = notebook(client, member)
    b = enter(client, member, foreign).json()['id']
    base = f'/v1/notebooks/{nid}/call/sessions/{a}'
    assert client.post(base+'/signals', headers=owner, json={'target_id': b, 'kind': 'answer', 'sdp': 'private'}).status_code == 404
    assert client.delete(base, headers=member).status_code == 404
    assert client.delete(base, headers=owner).status_code == 204
    assert client.delete(base, headers=owner).status_code == 204


def test_removal_and_erasure_delete_call_signaling(client):
    owner, member, nid = setup(client)
    a, b = enter(client, owner, nid).json()['id'], enter(client, member, nid).json()['id']
    base = f'/v1/notebooks/{nid}/call/sessions'
    client.post(f'{base}/{a}/signals', headers=owner, json={'target_id': b, 'kind': 'offer', 'sdp': 'private'})
    member_id = client.get('/v1/auth/me', headers=member).json()['id']
    assert client.delete(f'/v1/notebooks/{nid}/members/{member_id}', headers=owner).status_code == 204
    assert client.get(f'{base}/{b}', headers=member).status_code == 404
    assert client.get(f'{base}/{a}', headers=owner).json()['peers'] == []
    with Session(client.app.state.engine) as session:
        assert session.get(CallSession, b) is None
        assert session.scalar(select(func.count()).select_from(CallSignal)) == 0
    assert client.post('/v1/auth/delete-account', headers=owner, json={'password': 'secure-password-123'}).status_code == 204
    with Session(client.app.state.engine) as session: assert session.get(CallSession, a) is None


def test_expired_leases_are_unreadable_and_purged(client, monkeypatch):
    owner, member, nid = setup(client)
    start = calls.now(); monkeypatch.setattr(calls, 'now', lambda: start)
    a, b = enter(client, owner, nid).json()['id'], enter(client, member, nid).json()['id']
    base = f'/v1/notebooks/{nid}/call/sessions'
    client.post(f'{base}/{a}/signals', headers=owner, json={'target_id': b, 'kind': 'offer', 'sdp': 'private'})
    monkeypatch.setattr(calls, 'now', lambda: start + timedelta(seconds=91))
    assert client.get(f'{base}/{a}', headers=owner).status_code == 404
    assert client.post(f'{base}/{b}/heartbeat', headers=member, json={'after': 0}).status_code == 404
    purge_expired(client.app.state.engine)
    with Session(client.app.state.engine) as session:
        assert session.scalar(select(func.count()).select_from(CallSignal)) == 0
        assert session.scalar(select(func.count()).select_from(CallSession)) == 0
    assert enter(client, owner, nid).status_code == 201


def test_turn_credentials_are_short_lived_and_secret_never_returned(tmp_path, monkeypatch):
    monkeypatch.setenv('KNOWLM_CALL_TURN_URL', 'turn:relay.example:3478?transport=udp')
    monkeypatch.setenv('KNOWLM_CALL_TURN_SECRET', 'operator-secret')
    monkeypatch.setenv('KNOWLM_CALL_RELAY_ONLY', '1')
    app = create_app(f'sqlite:///{tmp_path / "turn.db"}')
    with TestClient(app) as client:
        owner = auth(client, 'turnowner'); nid = notebook(client, owner)
        response = client.get(f'/v1/notebooks/{nid}/call/config', headers=owner)
        result = response.json(); assert result['has_turn'] and result['iceTransportPolicy'] == 'relay'
        assert 'operator-secret' not in response.text
        ice = result['iceServers'][0]
        assert 3590 <= int(ice['username'].split(':')[0]) - int(calls.now().timestamp()) <= 3600
        assert ice['credential'] == base64.b64encode(hmac.new(b'operator-secret', ice['username'].encode(), hashlib.sha1).digest()).decode()
    app.state.engine.dispose()


def test_heartbeat_renews_only_own_lease_and_signal_quota_is_bounded(client, monkeypatch):
    owner, member, nid = setup(client)
    start = calls.now(); monkeypatch.setattr(calls, 'now', lambda: start)
    a, b = enter(client, owner, nid).json()['id'], enter(client, member, nid).json()['id']
    base = f'/v1/notebooks/{nid}/call/sessions'
    with Session(client.app.state.engine) as session:
        session.add_all([CallSignal(sender_id=a, target_id=b, kind='offer', payload={'sdp': 'data'}) for _ in range(200)])
        session.commit()
    assert client.post(f'{base}/{a}/signals', headers=owner, json={'target_id': b, 'kind': 'answer', 'sdp': 'data'}).status_code == 409
    monkeypatch.setattr(calls, 'now', lambda: start + timedelta(seconds=80))
    assert client.post(f'{base}/{a}/heartbeat', headers=owner, json={'after': 0}).status_code == 204
    monkeypatch.setattr(calls, 'now', lambda: start + timedelta(seconds=91))
    page = client.get(f'{base}/{a}', headers=owner).json()
    assert page['peers'] == []
    assert client.get(f'{base}/{b}', headers=member).status_code == 404
    purge_expired(client.app.state.engine)
    with Session(client.app.state.engine) as session:
        assert session.get(CallSession, a) is not None and session.get(CallSession, b) is None
        assert session.scalar(select(func.count()).select_from(CallSignal)) == 0


def test_member_account_erasure_cleans_other_owners_call_room(client):
    owner, member, nid = setup(client)
    a, b = enter(client, owner, nid).json()['id'], enter(client, member, nid).json()['id']
    base = f'/v1/notebooks/{nid}/call/sessions'
    client.post(f'{base}/{a}/signals', headers=owner, json={'target_id': b, 'kind': 'offer', 'sdp': 'private'})
    assert client.post('/v1/auth/delete-account', headers=member, json={'password': 'secure-password-123'}).status_code == 204
    assert client.get(f'{base}/{a}', headers=owner).json()['peers'] == []
    with Session(client.app.state.engine) as session:
        assert session.get(CallSession, b) is None
        assert session.scalar(select(func.count()).select_from(CallSignal)) == 0


def test_per_user_session_quota_and_invalid_ice_configuration(client, monkeypatch, tmp_path):
    owner = auth(client, 'manycalls')
    for i in range(4):
        nid = notebook(client, owner)
        assert enter(client, owner, nid).status_code == (201 if i < 3 else 409)
    monkeypatch.setenv('KNOWLM_CALL_STUN_URL', 'https://not-an-ice-server.example')
    with pytest.raises(ValueError, match='Invalid operator ICE URL'):
        create_app(f'sqlite:///{tmp_path / "bad-ice.db"}')
