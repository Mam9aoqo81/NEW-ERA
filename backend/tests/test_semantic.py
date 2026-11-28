import json
import math

import httpx
import pytest
from fastapi.testclient import TestClient

from knowlm.main import create_app
from knowlm.retrieval import Evidence
from knowlm.semantic import EmbeddingError, OpenAIEmbeddings, hybrid_retrieve, vectors_checked
from test_api import auth, notebook


class Embeddings:
    def __init__(self): self.calls = []
    def embed(self, texts):
        self.calls.append(texts)
        return [[1.0, 0.0] if 'unrelated' not in text else [0.0, 1.0] for text in texts]


def test_semantic_matches_without_shared_words_and_rejects_unrelated():
    provider = Embeddings()
    a = Evidence('1','s','book',1,'Plants convert sunlight into sugar.')
    b = Evidence('2','s','book',1,'unrelated quantum field')
    hits = hybrid_retrieve('How do leaves produce food?', [a,b], provider)
    assert [h.evidence.chunk_id for h in hits] == ['1']
    assert provider.calls == [['How do leaves produce food?', a.text, b.text]]


def test_budget_before_any_external_call():
    provider = Embeddings()
    with pytest.raises(EmbeddingError):
        hybrid_retrieve('question', [Evidence(str(i),'s','title',1,'text') for i in range(129)], provider)
    with pytest.raises(EmbeddingError):
        hybrid_retrieve('question', [Evidence('1','s','title',1,'x'*100001)], provider)
    assert not provider.calls
    assert hybrid_retrieve('question', [], provider) == []


@pytest.mark.parametrize('vectors', [[], [[True]], [[math.nan]], [[math.inf]], [[0]], [[1],[1,2]], ['secret']])
def test_malformed_vectors_rejected(vectors):
    with pytest.raises(EmbeddingError): vectors_checked(vectors, 2 if len(vectors)==2 else 1)


def test_http_adapter_reorders_indexes_and_limits_configuration():
    def handler(request):
        assert request.url.path == '/v1/embeddings'
        assert json.loads(request.content)['input'] == ['question','text']
        return httpx.Response(200,json={'data':[{'index':1,'embedding':[0,2]},{'index':0,'embedding':[2,0]}]})
    provider = OpenAIEmbeddings('https://example.com/v1','key','model',httpx.MockTransport(handler))
    assert provider.embed(['question','text']) == [[1,0],[0,1]]
    for url in ['http://example.com','https://user:pass@example.com','https://example.com?secret=yes']:
        with pytest.raises(ValueError): OpenAIEmbeddings(url,'key','model')


@pytest.mark.parametrize('data', [[], [{'index':0,'embedding':[1]},{'index':0,'embedding':[1]}], [{'index':True,'embedding':[1]},{'index':1,'embedding':[1]}]])
def test_http_invalid_response(data):
    provider = OpenAIEmbeddings('https://example.com','key','model',httpx.MockTransport(lambda _:httpx.Response(200,json={'data':data})))
    with pytest.raises(EmbeddingError): provider.embed(['question','text'])


def test_api_explicit_consent_permission_filtering_and_idempotency(tmp_path):
    provider = Embeddings()
    app = create_app(f'sqlite:///{tmp_path / "semantic.db"}', embedding_provider=provider)
    with TestClient(app) as client:
        owner = auth(client,'owner'); other = auth(client,'other'); nid = notebook(client,owner)
        ids = [client.post(f'/v1/notebooks/{nid}/sources/text', headers=owner, json={'title':'private','text':text}).json()['id']
               for text in ['Plants convert sunlight into sugar.', 'unrelated private excluded text']]
        path = f'/v1/notebooks/{nid}/ask'
        assert client.get('/health').json()['semantic_configured']
        assert not client.post(path,headers=owner,json={'question':'leaves produce food'}).json()['answered']
        assert not provider.calls
        assert client.post(path,headers=owner,json={'question':'food','semantic_consent':True}).status_code == 422
        assert not provider.calls
        body = {'question':'leaves produce food','semantic_consent':True,'source_ids':[ids[0]],'request_id':'11111111-1111-4111-8111-111111111111'}
        assert client.post(path,headers=other,json=body).status_code == 404
        assert client.post(path,headers=owner,json={**body,'source_ids':['foreign']}).status_code == 404
        assert not provider.calls
        response = client.post(path,headers=owner,json=body)
        assert response.status_code == 200
        result = response.json()
        assert result['answered'] and result['retrieval'] == 'embedding_bm25_rrf'
        assert {c['source_id'] for c in result['citations']} == {ids[0]}
        assert provider.calls == [['leaves produce food', 'Plants convert sunlight into sugar.']]
        assert client.post(path,headers=owner,json=body).json() == result
        assert len(provider.calls) == 1
        assert client.post(path,headers=owner,json={**body,'semantic_consent':False}).status_code == 409
        assert client.post(path,headers=owner,json={**body,'semantic_consent':'true'}).status_code == 422
    app.state.engine.dispose()


def test_provider_failure_does_not_leak_or_persist_answer(tmp_path):
    class Broken:
        def embed(self,texts): raise EmbeddingError('private secret')
    app = create_app(f'sqlite:///{tmp_path / "failed.db"}', embedding_provider=Broken())
    with TestClient(app) as client:
        owner=auth(client,'owner');nid=notebook(client,owner)
        sid=client.post(f'/v1/notebooks/{nid}/sources/text',headers=owner,json={'title':'private','text':'private text'}).json()['id']
        response=client.post(f'/v1/notebooks/{nid}/ask',headers=owner,json={'question':'food','semantic_consent':True,'source_ids':[sid]})
        assert response.status_code==503 and 'private secret' not in response.text
        assert client.get(f'/v1/notebooks/{nid}/history',headers=owner).json()['turns']==[]
    app.state.engine.dispose()


def test_unconfigured_semantic_fails_closed(tmp_path):
    app=create_app(f'sqlite:///{tmp_path / "disabled.db"}')
    with TestClient(app) as client:
        owner=auth(client,'owner');nid=notebook(client,owner)
        assert not client.get('/health').json()['semantic_configured']
        assert client.post(f'/v1/notebooks/{nid}/ask',headers=owner,json={'question':'food','semantic_consent':True,'source_ids':[]}).status_code==503
    app.state.engine.dispose()


def test_environment_configuration_requires_explicit_operator_opt_in(monkeypatch):
    from knowlm.semantic import embedding_provider_from_env
    monkeypatch.setenv('KNOWLM_EMBEDDINGS_ENABLED','0')
    assert embedding_provider_from_env() is None
    monkeypatch.setenv('KNOWLM_EMBEDDINGS_ENABLED','1')
    monkeypatch.delenv('KNOWLM_EMBEDDINGS_API_KEY',raising=False)
    monkeypatch.delenv('KNOWLM_EMBEDDINGS_MODEL',raising=False)
    with pytest.raises(ValueError):embedding_provider_from_env()
    monkeypatch.setenv('KNOWLM_EMBEDDINGS_API_KEY','test')
    monkeypatch.setenv('KNOWLM_EMBEDDINGS_MODEL','model')
    assert isinstance(embedding_provider_from_env(),OpenAIEmbeddings)
