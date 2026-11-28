from test_api import client, auth, notebook
from knowlm.canvas import InkBoard
from sqlalchemy.orm import Session


def test_canvas_private_versioned_validated_and_deleted(client):
    owner = auth(client, 'inkowner')
    other = auth(client, 'inkother')
    nid = notebook(client, owner)
    url = f'/v1/notebooks/{nid}/canvas'
    body = {'version': 0, 'notes': 'ملاحظة خاصة', 'strokes': [{'color': '#164e63', 'width': 3, 'points': [{'x': 12, 'y': 45}]}], 'chunk_ids': []}
    assert client.get(url).status_code == 401
    assert client.get(url, headers=other).status_code == 404
    response = client.get(url, headers=owner)
    assert response.json()['version'] == 0
    assert response.headers['cache-control'] == 'no-store'
    assert client.put(url, headers=owner, json=body).json()['version'] == 1
    assert client.put(url, headers=owner, json=body).status_code == 409
    assert client.get(url, headers=owner).json()['notes'] == body['notes']
    body['version'] = 1
    assert client.put(url, headers=owner, json={**body, 'chunk_ids': ['unknown']}).status_code == 422
    assert client.put(url, headers=other, json=body).status_code == 404
    bad = {**body, 'strokes': [{'color': 'url(evil)', 'width': 3, 'points': [{'x': 0, 'y': 0}]}]}
    assert client.put(url, headers=owner, json=bad).status_code == 422
    body['notes'] = 'edited'
    assert client.put(url, headers=owner, json=body).json()['version'] == 2
    assert client.delete(f'/v1/notebooks/{nid}', headers=owner).status_code in (200, 204)
    with Session(client.app.state.engine) as session:
        assert session.get(InkBoard, (nid, client.get('/v1/auth/me', headers=owner).json()['id'])) is None


def test_canvas_reference_is_server_generated(client):
    owner = auth(client, 'references')
    nid = notebook(client, owner)
    client.post(f'/v1/notebooks/{nid}/sources/text', headers=owner, json={'title': 'الأحياء', 'text': 'تحدث عملية البناء الضوئي داخل البلاستيدات الخضراء.'})
    citation = client.post(f'/v1/notebooks/{nid}/ask', headers=owner, json={'question': 'البناء الضوئي'}).json()['citations'][0]
    url = f'/v1/notebooks/{nid}/canvas'
    body = {'version': 0, 'notes': '', 'strokes': [], 'chunk_ids': [citation['chunk_id']]}
    response = client.put(url, headers=owner, json=body)
    assert response.status_code == 200, response.text
    assert response.json()['references'][0]['source_id'] == citation['source_id']
    foreign = notebook(client, owner)
    assert client.put(f'/v1/notebooks/{foreign}/canvas', headers=owner, json=body).status_code == 422


def test_member_ink_is_private_revocable_and_erased_with_account(client):
    from test_collaboration import join
    owner = auth(client, 'boardowner')
    nid = notebook(client, owner)
    member = join(client, owner, nid)
    member_id = client.get('/v1/auth/me', headers=member).json()['id']
    url = f'/v1/notebooks/{nid}/canvas'
    body = {'version': 0, 'notes': 'private student ink', 'strokes': [], 'chunk_ids': []}
    assert client.put(url, headers=member, json=body).status_code == 200
    assert client.get(url, headers=owner).json()['notes'] == ''
    assert client.delete(f'/v1/notebooks/{nid}/members/{member_id}', headers=owner).status_code == 204
    assert client.get(url, headers=member).status_code == 404
    assert client.put(url, headers=member, json={**body, 'version': 1}).status_code == 404
    assert client.post('/v1/auth/delete-account', headers=member, json={'password': 'secure-password-123'}).status_code == 204
    with Session(client.app.state.engine) as session:
        assert session.get(InkBoard, (nid, member_id)) is None
    assert client.get(url, headers=owner).status_code == 200
