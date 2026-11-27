from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
import uuid

from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from knowlm.main import ChatTurn, create_app
from knowlm.generation import ProviderError
from test_api import client, auth, notebook


def seed(client):
    headers = auth(client, 'student')
    nid = notebook(client, headers)
    source = client.post(f'/v1/notebooks/{nid}/sources/text', headers=headers,
                         json={'title': 'الكتاب', 'text': 'تحدث عملية البناء الضوئي داخل البلاستيدات الخضراء.'}).json()
    return headers, nid, source['id']


def test_history_citations_survive_application_restart(tmp_path):
    url = f'sqlite:///{tmp_path / "persist.db"}'
    app = create_app(url)
    with TestClient(app) as first:
        headers, nid, sid = seed(first)
        response = first.post(f'/v1/notebooks/{nid}/ask', headers=headers,
                              json={'question': 'البناء الضوئي', 'source_ids': [sid]}).json()
    app.state.engine.dispose()
    restarted = create_app(url, initialize_schema=False)
    with TestClient(restarted) as second:
        rows = second.get(f'/v1/notebooks/{nid}/history', headers=headers).json()
        assert rows['next_before'] is None
        turn = rows['turns'][0]
        assert turn['id'] == response['turn_id']
        assert turn['request_id'] == response['request_id']
        assert turn['question'] == 'البناء الضوئي'
        assert turn['source_ids'] == [sid]
        assert turn['answer']['citations'] == response['citations']
        assert turn['created_at'].endswith('+00:00')
        assert second.get(turn['answer']['citations'][0]['url'], headers=headers).status_code == 200
    restarted.state.engine.dispose()


def test_idempotency_and_conflicting_reuse(client):
    headers, nid, sid = seed(client)
    path = f'/v1/notebooks/{nid}'
    payload = {'question': 'البناء الضوئي', 'source_ids': [sid], 'request_id': str(uuid.uuid4())}
    first = client.post(path + '/ask', headers=headers, json=payload)
    assert first.status_code == 200
    assert client.post(path + '/ask', headers=headers, json=payload).json() == first.json()
    # Canonicalize duplicate source selections for a stable idempotency key.
    assert client.post(path + '/ask', headers=headers, json={**payload, 'source_ids': [sid, sid]}).json() == first.json()
    assert client.post(path + '/ask', headers=headers, json={**payload, 'question': 'سؤال مختلف'}).status_code == 409
    assert len(client.get(path + '/history', headers=headers).json()['turns']) == 1


def test_history_isolation_and_scoped_clear(client):
    headers, nid, _ = seed(client)
    other = auth(client, 'another_student')
    another = notebook(client, headers)
    for target in (nid, another):
        assert client.post(f'/v1/notebooks/{target}/ask', headers=headers, json={'question': 'البناء الضوئي'}).status_code == 200
    path = f'/v1/notebooks/{nid}/history'
    assert client.get(path).status_code == 401
    assert client.get(path, headers=other).status_code == 404
    assert client.delete(path, headers=other).status_code == 404
    assert client.delete(path, headers=headers).status_code == 204
    assert client.get(path, headers=headers).json() == {'turns': [], 'next_before': None}
    assert len(client.get(f'/v1/notebooks/{another}/history', headers=headers).json()['turns']) == 1


def test_keyset_pagination_and_refusals(client):
    headers, nid, _ = seed(client)
    path = f'/v1/notebooks/{nid}'
    ids = []
    for i in range(7):
        result = client.post(path + '/ask', headers=headers, json={'question': f'quantum mechanics {i}'}).json()
        assert not result['answered'] and result['citations'] == []
        ids.append(result['turn_id'])
    first = client.get(path + '/history?limit=3', headers=headers).json()
    assert [t['id'] for t in first['turns']] == ids[4:]
    # A new message must not shift older keyset pages.
    client.post(path + '/ask', headers=headers, json={'question': 'البناء الضوئي'})
    second = client.get(path + f'/history?limit=3&before={first["next_before"]}', headers=headers).json()
    assert [t['id'] for t in second['turns']] == ids[1:4]
    third = client.get(path + f'/history?limit=3&before={second["next_before"]}', headers=headers).json()
    assert [t['id'] for t in third['turns']] == ids[:1]
    assert third['next_before'] is None
    for params in ('limit=0', 'limit=101', 'before=0', 'before=9999999999999999999999999999999'):
        assert client.get(path + '/history?' + params, headers=headers).status_code == 422


def test_invalid_requests_never_create_history(client):
    headers, nid, _ = seed(client)
    path = f'/v1/notebooks/{nid}'
    assert client.post(path + '/ask', headers=headers, json={'question': 'البناء الضوئي', 'mode': 'grounded'}).status_code == 503
    assert client.post(path + '/ask', headers=headers, json={'question': 'test', 'source_ids': ['foreign']}).status_code == 404
    assert client.post(path + '/ask', headers=headers, json={'question': 'test', 'request_id': 'not-a-uuid'}).status_code == 422
    assert client.get(path + '/history', headers=headers).json()['turns'] == []


def test_generation_errors_do_not_persist_and_replays_do_not_call_provider(tmp_path):
    class Provider:
        calls = 0
        fail = True
        def generate(self, question, evidence):
            self.calls += 1
            if self.fail:
                raise ProviderError('outage')
            return {'claims': []}
    provider = Provider()
    app = create_app(f'sqlite:///{tmp_path / "model.db"}', answer_provider=provider)
    with TestClient(app) as c:
        headers, nid, _ = seed(c)
        path = f'/v1/notebooks/{nid}'
        payload = {'question': 'البناء الضوئي', 'mode': 'grounded', 'request_id': str(uuid.uuid4())}
        assert c.post(path + '/ask', headers=headers, json=payload).status_code == 503
        assert c.get(path + '/history', headers=headers).json()['turns'] == []
        provider.fail = False
        result = c.post(path + '/ask', headers=headers, json=payload)
        assert result.status_code == 200
        assert c.post(path + '/ask', headers=headers, json=payload).json() == result.json()
        assert provider.calls == 2
    app.state.engine.dispose()


def test_concurrent_same_request_stores_one_snapshot(tmp_path):
    barrier = Barrier(2)
    class Provider:
        def generate(self, question, evidence):
            barrier.wait(timeout=5)
            return {'claims': []}
    app = create_app(f'sqlite:///{tmp_path / "concurrent.db"}', answer_provider=Provider())
    with TestClient(app) as c:
        headers, nid, _ = seed(c)
        payload = {'question': 'البناء الضوئي', 'mode': 'grounded', 'request_id': str(uuid.uuid4())}
        def send():
            return c.post(f'/v1/notebooks/{nid}/ask', headers=headers, json=payload)
        with ThreadPoolExecutor(max_workers=2) as pool:
            responses = list(pool.map(lambda _: send(), range(2)))
        assert [r.status_code for r in responses] == [200, 200]
        assert responses[0].json() == responses[1].json()
        with Session(app.state.engine) as session:
            assert session.scalar(select(func.count()).select_from(ChatTurn)) == 1
    app.state.engine.dispose()
