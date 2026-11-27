import json
import httpx
import pytest
from fastapi.testclient import TestClient

from knowlm.generation import OpenAICompatibleProvider, ProviderError, provider_from_env
from knowlm.main import create_app
from test_api import auth, notebook


class FakeProvider:
    def __init__(self, mode='valid'):
        self.mode, self.calls = mode, []

    def generate(self, question, evidence):
        self.calls.append(evidence)
        if self.mode == 'outage':
            raise ProviderError('private detail that must not leak')
        if self.mode == 'refuse':
            return {'claims': []}
        if self.mode == 'malformed':
            return {'answer': 'unstructured answer without sources'}
        return {'claims': [{'text': 'تحدث العملية داخل البلاستيدات الخضراء.', 'references': [{
            'chunk_id': 'foreign-chunk' if self.mode == 'foreign' else evidence[0].chunk_id,
            'quote': 'اقتباس غير موجود إطلاقًا' if self.mode == 'fabricated' else evidence[0].text,
        }]}]}


def setup(tmp_path, mode='valid'):
    provider = FakeProvider(mode)
    app = create_app(f'sqlite:///{tmp_path / "generated.db"}', answer_provider=provider)
    return app, provider


def seed(client):
    headers = auth(client, 'student')
    nid = notebook(client, headers)
    response = client.post(f'/v1/notebooks/{nid}/sources/text', headers=headers,
                           json={'title': 'الأحياء', 'text': 'تحدث عملية البناء الضوئي داخل البلاستيدات الخضراء.'})
    return headers, nid, response.json()['id']


def test_opt_in_generation_and_server_citations(tmp_path):
    app, provider = setup(tmp_path)
    with TestClient(app) as client:
        headers, nid, sid = seed(client)
        path = f'/v1/notebooks/{nid}/ask'
        assert client.post(path, headers=headers, json={'question': 'البناء الضوئي'}).json()['mode'] == 'extractive'
        assert not provider.calls
        result = client.post(path, headers=headers, json={'question': 'البناء الضوئي', 'mode': 'grounded'}).json()
        assert result['answered'] and result['mode'] == 'grounded'
        assert '[1]' in result['answer']
        assert result['citations'][0]['source_id'] == sid
        assert result['citations'][0]['page'] == 1
        assert client.get(result['citations'][0]['url'], headers=headers).status_code == 200
        assert len(provider.calls) == 1
        client.post(path, headers=headers, json={'question': 'quantum mechanics', 'mode': 'grounded'})
        client.post(path, headers=headers, json={'question': 'البناء الضوئي', 'mode': 'grounded', 'source_ids': []})
        assert len(provider.calls) == 1
    app.state.engine.dispose()


@pytest.mark.parametrize('mode,status', [('foreign', 502), ('fabricated', 502), ('malformed', 502), ('outage', 503)])
def test_rejects_bad_generated_output(tmp_path, mode, status):
    app, provider = setup(tmp_path, mode)
    with TestClient(app) as client:
        headers, nid, _ = seed(client)
        response = client.post(f'/v1/notebooks/{nid}/ask', headers=headers, json={'question': 'البناء الضوئي', 'mode': 'grounded'})
        assert response.status_code == status
        assert 'private detail' not in response.text
        assert 'citations' not in response.json()
    app.state.engine.dispose()


def test_model_can_refuse(tmp_path):
    app, provider = setup(tmp_path, 'refuse')
    with TestClient(app) as client:
        headers, nid, _ = seed(client)
        result = client.post(f'/v1/notebooks/{nid}/ask', headers=headers, json={'question': 'البناء الضوئي', 'mode': 'grounded'}).json()
        assert not result['answered'] and result['citations'] == []
    app.state.engine.dispose()


def test_no_key_no_provider(client):
    headers, nid, _ = seed(client)
    assert client.post(f'/v1/notebooks/{nid}/ask', headers=headers, json={'question': 'البناء الضوئي', 'mode': 'grounded'}).status_code == 503


# Import the shared pytest fixture without depending on an external provider.
from test_api import client


def test_provider_transport_and_safe_errors():
    def handler(request):
        assert request.headers['Authorization'] == 'Bearer test-only-key'
        body = json.loads(request.content)
        assert body['response_format']['type'] == 'json_object'
        return httpx.Response(200, json={'choices': [{'finish_reason': 'stop', 'message': {'content': '{"claims":[]}'}}]})
    provider = OpenAICompatibleProvider('https://example.test/v1', 'test-only-key', 'test-model', transport=httpx.MockTransport(handler))
    assert provider.generate('question', []) == {'claims': []}
    provider.transport = httpx.MockTransport(lambda request: httpx.Response(429, text='private prompt'))
    with pytest.raises(ProviderError) as exc:
        provider.generate('question', [])
    assert 'private prompt' not in str(exc.value)


def test_provider_disabled_by_default(monkeypatch):
    monkeypatch.delenv('KNOWLM_LLM_ENABLED', raising=False)
    assert provider_from_env() is None
    monkeypatch.setenv('KNOWLM_LLM_ENABLED', '1')
    monkeypatch.delenv('KNOWLM_LLM_API_KEY', raising=False)
    with pytest.raises(ValueError):
        provider_from_env()


@pytest.mark.parametrize('response', [
    httpx.Response(200, json={'choices': [{'finish_reason': 'length', 'message': {'content': '{"claims":[]}'}}]}),
    httpx.Response(200, json={'choices': [{'finish_reason': 'stop', 'message': {'content': 'not JSON'}}]}),
    httpx.Response(200, content=b'x' * 256_001),
    httpx.Response(302, headers={'Location': 'https://other.test/collect'}),
])
def test_rejects_truncated_malformed_large_and_redirected_responses(response):
    provider = OpenAICompatibleProvider('https://example.test/v1', 'test-only-key', 'model',
                                        transport=httpx.MockTransport(lambda request: response))
    with pytest.raises(ProviderError):
        provider.generate('question', [])


def test_only_selected_authorized_evidence_reaches_provider(tmp_path):
    app, provider = setup(tmp_path)
    with TestClient(app) as client:
        headers, nid, sid = seed(client)
        client.post(f'/v1/notebooks/{nid}/sources/text', headers=headers,
                    json={'title': 'Excluded', 'text': 'البناء الضوئي نص غير محدد لا يجب إرساله.'})
        other = auth(client, 'another_student')
        response = client.post(f'/v1/notebooks/{nid}/ask', headers=other,
                               json={'question': 'البناء الضوئي', 'mode': 'grounded'})
        assert response.status_code == 404 and not provider.calls
        response = client.post(f'/v1/notebooks/{nid}/ask', headers=headers,
                               json={'question': 'البناء الضوئي', 'mode': 'grounded', 'source_ids': [sid]})
        assert response.status_code == 200
        assert {e.source_id for e in provider.calls[0]} == {sid}
    app.state.engine.dispose()
