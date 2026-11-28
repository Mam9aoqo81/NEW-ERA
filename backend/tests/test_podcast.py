from test_api import client, auth, notebook
from test_learning import seed
from test_collaboration import join


def test_dialogue_is_saved_bounded_source_selected_and_exact(client):
    headers, nid, sid = seed(client)
    other_source = client.post(f'/v1/notebooks/{nid}/sources/text', headers=headers, json={'title': 'غير مختار', 'text': 'هذا نص آخر لن يظهر في حوار المراجعة لأنه لم يتم اختياره.'}).json()['id']
    path = f'/v1/notebooks/{nid}/study-artifacts'
    response = client.post(path, headers=headers, json={'kind': 'podcast', 'source_ids': [sid], 'language': 'ar'})
    assert response.status_code == 201, response.text
    item = response.json()
    assert item['method'] == 'extractive'
    turns = item['blocks']
    assert 2 <= len(turns) <= 20 and len(turns) % 2 == 0
    for host, reader in zip(turns[::2], turns[1::2]):
        assert host['speaker'] == 'host' and host['origin'] == 'fixed_prompt'
        assert host['text'] == 'ماذا يقول المقطع المختار؟'
        assert reader['speaker'] == 'reader' and reader['origin'] == 'source_quote'
        assert reader['text'] == reader['reference']['quote']
        assert reader['language'] == 'ar'
        assert reader['reference']['source_id'] == sid != other_source
        assert host['reference'] == reader['reference']
        assert client.get(reader['reference']['url'], headers=headers).status_code == 200
    assert client.get(path, headers=headers).json()[0] == item
    english = client.post(path, headers=headers, json={'kind': 'podcast', 'source_ids': [sid], 'language': 'en'}).json()
    assert english['blocks'][0]['text'] == 'What does the selected passage say?'
    assert english['blocks'][1]['text'] == turns[1]['text']  # Never silently translate evidence.


def test_dialogue_is_private_and_selection_is_authorized(client):
    owner, nid, sid = seed(client)
    path = f'/v1/notebooks/{nid}/study-artifacts'
    outsider = auth(client, 'podcast_outsider')
    foreign = notebook(client, outsider)
    body = {'kind': 'podcast', 'source_ids': [sid]}
    assert client.post(path, json=body).status_code == 401
    assert client.post(path, headers=outsider, json=body).status_code == 404
    assert client.post(f'/v1/notebooks/{foreign}/study-artifacts', headers=outsider, json=body).status_code == 404
    assert client.post(path, headers=owner, json={**body, 'source_ids': []}).status_code == 422
    assert client.post(path, headers=owner, json={**body, 'language': 'invalid'}).status_code == 422
    member = join(client, owner, nid)
    assert client.post(path, headers=member, json=body).status_code == 403
