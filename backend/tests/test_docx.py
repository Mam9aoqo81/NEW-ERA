import io
import subprocess
from types import SimpleNamespace
import zipfile
from xml.sax.saxutils import escape

import pytest
from sqlalchemy.orm import Session

from knowlm.docx import extract_docx
from knowlm.main import IngestionJob
from knowlm.pdf import ExtractionError
from knowlm.worker import run_once
from test_api import client, auth, notebook

TYPES = ('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
         '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
         '<Default Extension="xml" ContentType="application/xml"/>'
         '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
TEXT = 'تحدث عملية البناء الضوئي داخل البلاستيدات الخضراء في الخلايا النباتية.'


def docx(paragraphs=None, *, body=None, types=TYPES, extras=None, compression=zipfile.ZIP_DEFLATED):
    if body is None:
        body = ''.join('<w:p><w:r><w:t>' + escape(p) + '</w:t></w:r></w:p>' for p in (paragraphs or ['', TEXT]))
    xml = '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + body + '</w:body></w:document>'
    out = io.BytesIO()
    with zipfile.ZipFile(out, 'w', compression=compression) as z:
        z.writestr('[Content_Types].xml', types)
        z.writestr('_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
        z.writestr('word/document.xml', xml)
        for name, value in (extras or {}).items():
            z.writestr(name, value)
    return out.getvalue()


def test_paragraph_order_blank_locations_tables_and_arabic():
    body = ('<w:p/><w:p><w:r><w:t>أهلا</w:t><w:tab/><w:t>بالعالم</w:t><w:br/><w:t>Hello</w:t></w:r></w:p>'
            '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>نص الجدول</w:t></w:r></w:p></w:tc></w:tr></w:tbl>')
    assert extract_docx(docx(body=body)) == ['', 'أهلا\tبالعالم\nHello', 'نص الجدول']


def test_no_deleted_text_field_code_headers_or_embedded_content():
    body = ('<w:p><w:r><w:t>المتن</w:t><w:instrText>SECRET INSTRUCTION</w:instrText></w:r>'
            '<w:del><w:r><w:t>DELETED</w:t></w:r></w:del>'
            '<w:drawing><w:p><w:r><w:t>TEXTBOX</w:t></w:r></w:p></w:drawing></w:p>')
    assert extract_docx(docx(body=body, extras={'word/header1.xml':'HEADER','word/_rels/document.xml.rels':'http://127.0.0.1/never-fetched'})) == ['المتن']


@pytest.mark.parametrize('raw,code',[
    (b'not zip','unreadable_docx'),
    (docx(paragraphs=['  ']),'docx_no_text'),
    (docx(types=TYPES.replace('document.main+xml','template.main+xml')),'unsupported_docx_type'),
    (docx(extras={'word/vbaProject.bin':b'code'}),'macro_docx_not_supported'),
    (docx(types='<!DOCTYPE Types [<!ENTITY x SYSTEM "file:///etc/passwd">]><Types>&x;</Types>'),'unreadable_docx'),
    (docx(extras={'bomb':b'0'*1000000}),'unsafe_docx_archive'),
    (docx(paragraphs=['x']*5001,compression=zipfile.ZIP_STORED),'docx_text_too_large'),
    (docx(paragraphs=['abcd '*100001],compression=zipfile.ZIP_STORED),'docx_text_too_large'),
    (b'x'*(10*1024*1024+1),'file_too_large'),
])
def test_rejected_documents(raw,code):
    with pytest.raises(ExtractionError) as exc: extract_docx(raw)
    assert exc.value.code == code


def test_zip_duplicate_members_rejected():
    out = io.BytesIO()
    with zipfile.ZipFile(out, 'w') as z:
        z.writestr('word/document.xml','first')
        with pytest.warns(UserWarning): z.writestr('word/document.xml','second')
    with pytest.raises(ExtractionError,match='unsafe_docx_archive'): extract_docx(out.getvalue())


def test_child_timeout_failure_and_invalid_contract(monkeypatch):
    import knowlm.docx as module
    def timeout(*args,**kwargs):
        assert kwargs['timeout'] == 30 and kwargs['input'] == b'private'
        raise subprocess.TimeoutExpired(args[0],30)
    monkeypatch.setattr(module.subprocess,'run',timeout)
    with pytest.raises(ExtractionError,match='extraction_timeout'): extract_docx(b'private')
    for result,code in [(SimpleNamespace(returncode=1,stdout=b''),'extraction_resource_or_process_failure'),
                        (SimpleNamespace(returncode=0,stdout=b'{"paragraphs": [123]}'),'invalid_extractor_output')]:
        monkeypatch.setattr(module.subprocess,'run',lambda *a,**kw: result)
        with pytest.raises(ExtractionError,match=code): extract_docx(b'private')


def test_persistent_docx_source_question_learning_history_and_ownership(client):
    headers, outsider = auth(client,'student'), auth(client,'outsider'); nid = notebook(client,headers)
    path = f'/v1/notebooks/{nid}/sources/docx-jobs'
    upload = {'file':('study.docx',docx(),'application/vnd.openxmlformats-officedocument.wordprocessingml.document')}
    assert client.post(path,headers=outsider,files=upload).status_code == 404
    response = client.post(path,headers=headers,files=upload)
    assert response.status_code == 202
    job = response.json()
    assert client.get(job['status_url'],headers=outsider).status_code == 404
    assert run_once(client.app.state.engine)
    assert client.get(job['status_url'],headers=headers).json()['status'] == 'completed'
    with Session(client.app.state.engine) as session: assert session.get(IngestionJob,job['id']).payload is None
    sources = client.get(f'/v1/notebooks/{nid}/sources',headers=headers).json()
    assert sources[0]['kind'] == 'docx' and sources[0]['status'] == 'ready'
    answer = client.post(f'/v1/notebooks/{nid}/ask',headers=headers,json={'question':'أين تحدث عملية البناء الضوئي؟','source_ids':[job['source_id']]}).json()
    assert answer['answered']
    ref = answer['citations'][0]
    assert '/paragraphs/2' in ref['url']
    assert ref['locator_type'] == 'paragraph' and ref['paragraph'] == 2 and ref['page'] is None
    page = client.get(ref['url'],headers=headers)
    assert page.status_code == 200 and page.json()['page'] is None and page.json()['paragraph'] == 2
    assert TEXT in page.json()['chunks'][0]['text']
    assert client.get(ref['url'],headers=outsider).status_code == 404
    history = client.get(f'/v1/notebooks/{nid}/history',headers=headers).json()
    assert history['turns'][0]['answer']['citations'][0] == ref
    artifact = client.post(f'/v1/notebooks/{nid}/study-artifacts',headers=headers,
                           json={'kind':'mindmap','source_ids':[job['source_id']]}).json()
    linked = artifact['blocks'][0]['reference']
    assert linked['locator_type'] == 'paragraph' and linked['paragraph'] == 2 and linked['page'] is None
    deck = client.post(f'/v1/notebooks/{nid}/decks/generate',headers=headers,
                       json={'title':'مراجعة','source_ids':[job['source_id']]}).json()
    card = client.get(f'/v1/decks/{deck["id"]}/cards',headers=headers).json()[0]
    assert card['reference']['paragraph'] == 2


def test_docx_failure_is_durable_retryable_and_does_not_publish_text(client):
    headers=auth(client,'student');nid=notebook(client,headers)
    response=client.post(f'/v1/notebooks/{nid}/sources/docx-jobs',headers=headers,files={'file':('broken.docx',b'PK\x03\x04broken')})
    assert response.status_code==202
    job=response.json();assert run_once(client.app.state.engine)
    state=client.get(job['status_url'],headers=headers).json()
    assert state['status']=='failed' and state['error_code']=='unreadable_docx'
    assert client.post(job['status_url']+'/retry',headers=headers).status_code==202
    assert run_once(client.app.state.engine)
    assert client.get(job['status_url'],headers=headers).json()['attempts']==2


@pytest.mark.parametrize('name,raw,status',[
    ('file.doc',b'PK\x03\x04xx',415),('file.docm',b'PK\x03\x04xx',415),
    ('file.docx',b'%PDF-not-word',415),('file.docx',b'PK\x03\x04'+b'x'*(10*1024*1024),413),
])
def test_docx_upload_type_and_size(client,name,raw,status):
    headers=auth(client,'student');nid=notebook(client,headers)
    assert client.post(f'/v1/notebooks/{nid}/sources/docx-jobs',headers=headers,files={'file':(name,raw)}).status_code==status
    assert client.get(f'/v1/notebooks/{nid}/sources',headers=headers).json()==[]
