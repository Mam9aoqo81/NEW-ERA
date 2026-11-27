import pytest
from fastapi.testclient import TestClient
from knowlm.main import create_app


@pytest.fixture
def client(tmp_path):
    app = create_app(f'sqlite:///{tmp_path / "test.db"}')
    with TestClient(app) as c:
        yield c
    app.state.engine.dispose()


def auth(client, name):
    body = {'username': name, 'password': 'secure-password-123'}
    assert client.post('/v1/auth/register', json=body).status_code == 201
    token = client.post('/v1/auth/login', json=body).json()['access_token']
    return {'Authorization': f'Bearer {token}'}


def notebook(client, headers):
    return client.post('/v1/notebooks', headers=headers, json={'title': 'الأحياء'}).json()['id']


def test_source_citations_and_refusal(client):
    headers = auth(client, 'student')
    nid = notebook(client, headers)
    text = 'تحدث عملية البناء الضوئي داخل البلاستيدات الخضراء.'
    sid = client.post(f'/v1/notebooks/{nid}/sources/text', headers=headers, json={'title': 'كتاب الأحياء', 'text': text}).json()['id']
    result = client.post(f'/v1/notebooks/{nid}/ask', headers=headers, json={'question': 'البناء الضوئي'}).json()
    assert result['answered'] and result['mode'] == 'extractive'
    citation = result['citations'][0]
    assert citation['source_id'] == sid and citation['page'] == 1
    assert citation['quote'] == text
    assert client.get(citation['url'], headers=headers).json()['chunks'][0]['text'] == text
    for question in ['quantum mechanics', 'ما هي']:
        result = client.post(f'/v1/notebooks/{nid}/ask', headers=headers, json={'question': question}).json()
        assert not result['answered'] and result['citations'] == []
    assert not client.post(f'/v1/notebooks/{nid}/ask', headers=headers, json={'question': 'البناء الضوئي', 'source_ids': []}).json()['answered']


def test_isolation(client):
    a, b = auth(client, 'alice'), auth(client, 'bob')
    nid = notebook(client, a)
    sid = client.post(f'/v1/notebooks/{nid}/sources/text', headers=a, json={'title': 'خاص', 'text': 'معلومات خاصة'}).json()['id']
    assert client.get('/v1/notebooks', headers=b).json() == []
    assert client.get(f'/v1/notebooks/{nid}/sources', headers=b).status_code == 404
    assert client.get(f'/v1/notebooks/{nid}/sources/{sid}/pages/1', headers=b).status_code == 404
    assert client.post(f'/v1/notebooks/{nid}/ask', headers=b, json={'question': 'معلومات'}).status_code == 404
    assert client.post(f'/v1/notebooks/{nid}/sources/text', headers=b, json={'title': 'bad', 'text': 'bad'}).status_code == 404
    bid = notebook(client, b)
    assert client.post(f'/v1/notebooks/{bid}/ask', headers=b, json={'question': 'معلومات', 'source_ids': [sid]}).status_code == 404


def test_auth_and_validation(client):
    assert client.get('/v1/notebooks').status_code == 401
    headers = auth(client, 'student')
    assert client.post('/v1/auth/login', json={'username': 'student', 'password': 'wrong-password'}).status_code == 401
    assert client.post('/v1/auth/register', json={'username': 'STUDENT', 'password': 'another-password'}).status_code == 409
    assert client.post('/v1/notebooks', headers=headers, json={'title': '   '}).status_code == 422
    assert client.post('/v1/auth/logout', headers=headers).status_code == 204
    assert client.get('/v1/notebooks', headers=headers).status_code == 401


def test_pdf_rejections(client):
    headers = auth(client, 'student')
    nid = notebook(client, headers)
    path = f'/v1/notebooks/{nid}/sources/pdf'
    assert client.post(path, headers=headers, files={'file': ('fake.pdf', b'not a pdf', 'application/pdf')}).status_code == 415
    assert client.post(path, headers=headers, files={'file': ('broken.pdf', b'%PDF-broken', 'application/pdf')}).status_code == 422
    assert client.post(path, headers=headers, files={'file': ('big.pdf', b'%PDF-' + b'a' * (10 * 1024 * 1024), 'application/pdf')}).status_code == 413


def test_pdf_page_citation(client):
    from pypdf import PdfWriter
    from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject
    import io
    writer = PdfWriter()
    writer.add_blank_page(width=600, height=800)
    page = writer.add_blank_page(width=600, height=800)
    font = DictionaryObject({NameObject('/Type'): NameObject('/Font'), NameObject('/Subtype'): NameObject('/Type1'), NameObject('/BaseFont'): NameObject('/Helvetica')})
    page[NameObject('/Resources')] = DictionaryObject({NameObject('/Font'): DictionaryObject({NameObject('/F1'): writer._add_object(font)})})
    stream = DecodedStreamObject()
    stream.set_data(b'BT /F1 12 Tf 50 700 Td (Photosynthesis uses sunlight.) Tj ET')
    page[NameObject('/Contents')] = writer._add_object(stream)
    out = io.BytesIO()
    writer.write(out)
    headers = auth(client, 'student')
    nid = notebook(client, headers)
    response = client.post(f'/v1/notebooks/{nid}/sources/pdf', headers=headers, files={'file': ('biology.pdf', out.getvalue(), 'application/pdf')})
    assert response.status_code == 201
    result = client.post(f'/v1/notebooks/{nid}/ask', headers=headers, json={'question': 'Photosynthesis sunlight'}).json()
    assert result['answered'] and result['citations'][0]['page'] == 2


def test_current_user_requires_a_valid_session(client):
    assert client.get('/v1/auth/me').status_code == 401
    headers = auth(client, 'student')
    result = client.get('/v1/auth/me', headers=headers)
    assert result.status_code == 200
    assert result.json()['username'] == 'student'
    assert set(result.json()) == {'id', 'username'}
