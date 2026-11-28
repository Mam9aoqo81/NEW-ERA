import io
import json
import os
from pathlib import Path
from types import SimpleNamespace

import pytest
from pypdf import PdfReader, PdfWriter
from sqlalchemy.orm import Session

from knowlm.pdf import ExtractionError, PDFPages, extract_pdf
from knowlm.ocr_engine import OCRError, recognize_pages
from knowlm.main import IngestionJob, Source
from knowlm.worker import run_once
from test_api import client, auth, notebook

FIXTURE = Path(__file__).parent / 'fixtures' / 'ocr-bilingual.pdf'
MODELS = os.getenv('KNOWLM_TEST_OCR_DATA_PATH')


def test_fixture_is_image_only_with_stable_page_numbers():
    reader = PdfReader(FIXTURE)
    assert len(reader.pages) == 2
    assert all(not p.extract_text().strip() for p in reader.pages)


def test_ocr_disabled_keeps_explicit_failure(monkeypatch):
    monkeypatch.setenv('KNOWLM_OCR_ENABLED', '0')
    with pytest.raises(ExtractionError, match='ocr_required'):
        extract_pdf(FIXTURE.read_bytes())


def test_page_limit_and_configuration_before_engine_imports():
    with pytest.raises(OCRError, match='ocr_page_limit'):
        recognize_pages(b'pdf', [''] * 11, None)
    with pytest.raises(OCRError, match='ocr_not_configured'):
        recognize_pages(b'pdf', [''], None)
    assert recognize_pages(b'pdf', ['normal text'], None) == (['normal text'], [])


@pytest.mark.parametrize('metadata', [[0], [3], [True], [1,1], 'secret'])
def test_child_metadata_is_validated(monkeypatch, metadata):
    monkeypatch.setattr('subprocess.run', lambda *a, **k: SimpleNamespace(returncode=0, stdout=json.dumps({'pages':['','text'],'ocr_pages':metadata}).encode()))
    with pytest.raises(ExtractionError, match='invalid_extractor_output'):
        extract_pdf(b'pdf')


def test_worker_persists_provenance_with_chunks(client):
    headers=auth(client,'student');nid=notebook(client,headers)
    job=client.post(f'/v1/notebooks/{nid}/sources/pdf-jobs',headers=headers,files={'file':('scan.pdf',b'%PDF-test','application/pdf')}).json()
    assert run_once(client.app.state.engine,extractor=lambda _:PDFPages(['','Photosynthesis uses sunlight.'],[2]))
    sources=client.get(f'/v1/notebooks/{nid}/sources',headers=headers).json()
    assert sources[0]['ocr_pages']==[2]
    answer=client.post(f'/v1/notebooks/{nid}/ask',headers=headers,json={'question':'Photosynthesis sunlight'}).json()
    assert answer['citations'][0]['ocr'] and answer['citations'][0]['page']==2
    page=client.get(answer['citations'][0]['url'],headers=headers)
    assert page.status_code==200 and page.json()['ocr']
    with Session(client.app.state.engine) as session:
        assert session.get(IngestionJob,job['id']).payload is None
        assert session.get(Source,job['source_id']).ocr_pages==[2]


@pytest.mark.skipif(not MODELS, reason='Set KNOWLM_TEST_OCR_DATA_PATH and install optional OCR dependencies')
def test_real_local_arabic_english_ocr_and_private_page_citations(client,monkeypatch):
    monkeypatch.setenv('KNOWLM_OCR_ENABLED','1')
    monkeypatch.setenv('KNOWLM_OCR_DATA_PATH',MODELS)
    pages=extract_pdf(FIXTURE.read_bytes())
    assert pages.ocr_pages==[2] and pages[0]==''
    assert 'Photosynthesis uses sunlight' in pages[1]
    assert 'النباتات' in pages[1] and 'الشمس' in pages[1]
    owner=auth(client,'owner');other=auth(client,'other');nid=notebook(client,owner)
    job=client.post(f'/v1/notebooks/{nid}/sources/pdf-jobs',headers=owner,files={'file':('scanned.pdf',FIXTURE.read_bytes(),'application/pdf')}).json()
    assert run_once(client.app.state.engine)
    assert client.get(job['status_url'],headers=owner).json()['status']=='completed'
    answer=client.post(f'/v1/notebooks/{nid}/ask',headers=owner,json={'question':'النباتات الشمس'}).json()
    assert answer['answered']
    citation=answer['citations'][0]
    assert citation['page']==2 and citation['ocr']
    assert client.get(citation['url'],headers=other).status_code==404
    assert 'الشمس' in client.get(citation['url'],headers=owner).json()['chunks'][0]['text']


@pytest.mark.skipif(not MODELS, reason='Requires optional local OCR setup')
def test_real_ocr_rejects_large_raster_before_render(monkeypatch):
    monkeypatch.setenv('KNOWLM_OCR_ENABLED','1');monkeypatch.setenv('KNOWLM_OCR_DATA_PATH',MODELS)
    writer=PdfWriter();writer.add_blank_page(width=100000,height=100000)
    out=io.BytesIO();writer.write(out)
    with pytest.raises(ExtractionError,match='ocr_page_too_large'):extract_pdf(out.getvalue())


def test_model_setup_verifies_checksums_without_replacing_existing_files(tmp_path,monkeypatch):
    import base64
    import hashlib
    from knowlm import ocr_models
    good=b'authored test model'
    monkeypatch.setattr(ocr_models,'MODELS',{'eng':('blob',hashlib.sha256(good).hexdigest())})
    class Response:
        def __init__(self,data):self.data=data
        def __enter__(self):return self
        def __exit__(self,*a):pass
        def read(self,limit):return json.dumps({'encoding':'base64','content':base64.b64encode(self.data).decode()}).encode()
    monkeypatch.setattr('urllib.request.urlopen',lambda *a,**k:Response(b'corrupted'))
    with pytest.raises(ValueError,match='checksum'):ocr_models.install(tmp_path)
    assert not list(tmp_path.iterdir())
    monkeypatch.setattr('urllib.request.urlopen',lambda *a,**k:Response(good))
    ocr_models.install(tmp_path)
    assert (tmp_path/'eng.traineddata').read_bytes()==good
    monkeypatch.setattr('urllib.request.urlopen',lambda *a,**k:pytest.fail('must reuse verified file'))
    ocr_models.install(tmp_path)


def test_low_confidence_is_not_published_and_resources_close(monkeypatch):
    import sys
    from unittest.mock import MagicMock
    image=MagicMock();bitmap=MagicMock();bitmap.to_pil.return_value=image
    page=MagicMock();page.get_size.return_value=(600,800);page.render.return_value=bitmap
    document=MagicMock();document.__len__.return_value=1;document.__getitem__.return_value=page
    document.__enter__.return_value=document
    api=MagicMock();api.__enter__.return_value=api;api.GetUTF8Text.return_value='unreliable text';api.MeanTextConf.return_value=15
    monkeypatch.setitem(sys.modules,'pypdfium2',SimpleNamespace(PdfDocument=lambda _:document))
    monkeypatch.setitem(sys.modules,'tesserocr',SimpleNamespace(PyTessBaseAPI=lambda **kwargs:api,PSM=SimpleNamespace(AUTO=3)))
    with pytest.raises(OCRError,match='ocr_low_confidence'):
        recognize_pages(b'pdf',[''],'models')
    image.close.assert_called_once();bitmap.close.assert_called_once();page.close.assert_called_once()
