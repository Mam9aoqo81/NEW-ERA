from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from knowlm.main import Chunk, IngestionJob
from knowlm.pdf import ExtractionError
from knowlm.worker import run_once
from test_api import client, auth, notebook


def enqueue(client, headers, nid):
    response = client.post(f'/v1/notebooks/{nid}/sources/pdf-jobs', headers=headers,
                           files={'file': ('sample.pdf', b'%PDF-test', 'application/pdf')})
    assert response.status_code == 202
    return response.json()


def test_persistent_job_and_retry(client):
    a, b = auth(client, 'alice'), auth(client, 'bob')
    nid = notebook(client, a)
    job = enqueue(client, a, nid)
    path = job['status_url']
    assert client.get(path, headers=b).status_code == 404
    assert client.post(path + '/retry', headers=b).status_code == 404
    assert client.get(path, headers=a).json()['status'] == 'pending'
    assert client.post(path + '/retry', headers=a).status_code == 409
    engine = client.app.state.engine

    def broken(raw):
        raise ExtractionError('ocr_required')

    assert run_once(engine, extractor=broken)
    state = client.get(path, headers=a).json()
    assert state['status'] == 'failed' and state['error_code'] == 'ocr_required'
    assert client.post(path + '/retry', headers=a).status_code == 202
    assert run_once(engine, extractor=lambda raw: ['', 'Photosynthesis uses sunlight.'])
    state = client.get(path, headers=a).json()
    assert state['status'] == 'completed' and state['attempts'] == 2
    result = client.post(f'/v1/notebooks/{nid}/ask', headers=a, json={'question': 'Photosynthesis sunlight'}).json()
    assert result['citations'][0]['page'] == 2
    with Session(engine) as session:
        assert session.get(IngestionJob, job['id']).payload is None
        assert session.scalar(select(func.count()).select_from(Chunk)) == 1
    assert not run_once(engine)
    assert client.post(path + '/retry', headers=a).status_code == 409


def test_crash_recovery_and_attempt_limit(client):
    headers = auth(client, 'student')
    nid = notebook(client, headers)
    job = enqueue(client, headers, nid)
    engine = client.app.state.engine
    with Session(engine) as session:
        row = session.get(IngestionJob, job['id'])
        row.status, row.attempts, row.lease_token = 'processing', 1, 'dead-worker'
        row.lease_until = datetime.now(timezone.utc) - timedelta(seconds=1)
        session.commit()
    assert run_once(engine, extractor=lambda raw: ['recovered content'])
    assert client.get(job['status_url'], headers=headers).json()['attempts'] == 2
    other = enqueue(client, headers, nid)
    with Session(engine) as session:
        row = session.get(IngestionJob, other['id'])
        row.status, row.attempts, row.lease_token = 'processing', 3, 'dead-worker'
        row.lease_until = datetime.now(timezone.utc) - timedelta(seconds=1)
        session.commit()
    assert not run_once(engine)
    assert client.get(other['status_url'], headers=headers).json()['status'] == 'failed'
    assert client.post(other['status_url'] + '/retry', headers=headers).status_code == 409


def test_stale_worker_cannot_publish(client):
    headers = auth(client, 'student')
    nid = notebook(client, headers)
    job = enqueue(client, headers, nid)
    engine = client.app.state.engine

    def stolen_lease(raw):
        with Session(engine) as session:
            row = session.get(IngestionJob, job['id'])
            row.lease_token = 'replacement-worker'
            session.commit()
        return ['must not publish']

    assert run_once(engine, extractor=stolen_lease)
    with Session(engine) as session:
        assert session.scalar(select(func.count()).select_from(Chunk)) == 0
        assert session.get(IngestionJob, job['id']).status == 'processing'


def test_real_worker_rejects_invalid_pdf(client):
    headers = auth(client, 'student')
    job = enqueue(client, headers, notebook(client, headers))
    assert run_once(client.app.state.engine)
    state = client.get(job['status_url'], headers=headers).json()
    assert state['status'] == 'failed' and state['error_code'] == 'unreadable_pdf'


def test_second_worker_does_not_extract_claimed_job(client):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Event

    headers = auth(client, 'student')
    job = enqueue(client, headers, notebook(client, headers))
    engine = client.app.state.engine
    entered, release = Event(), Event()

    def slow_extract(raw):
        entered.set()
        assert release.wait(timeout=5)
        return ['Only one published result']

    with ThreadPoolExecutor(max_workers=1) as pool:
        first = pool.submit(run_once, engine, slow_extract)
        try:
            assert entered.wait(timeout=5)
            assert not run_once(engine, extractor=lambda raw: ['duplicate'])
        finally:
            release.set()
        assert first.result(timeout=5)
    assert client.get(job['status_url'], headers=headers).json()['attempts'] == 1
    with Session(engine) as session:
        assert session.scalar(select(func.count()).select_from(Chunk)) == 1


def test_source_list_exposes_only_safe_job_metadata(client):
    headers = auth(client, 'student')
    nid = notebook(client, headers)
    job = enqueue(client, headers, nid)
    result = client.get(f'/v1/notebooks/{nid}/sources', headers=headers).json()
    assert result[0]['job'] == {'id': job['id'], 'attempts': 0, 'error_code': None}
    assert 'payload' not in result[0]['job']
    assert 'lease_token' not in result[0]['job']
