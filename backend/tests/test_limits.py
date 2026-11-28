from contextlib import ExitStack
from concurrent.futures import ThreadPoolExecutor
import time

from fastapi.testclient import TestClient
import pytest
from sqlalchemy import func, select
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from knowlm.main import create_app, Source, IngestionJob, User
from knowlm.limits import RateBucket, RateLimiter
from knowlm.pdf import ExtractionError
from knowlm.worker import run_once
from test_api import auth, notebook


@pytest.fixture
def limited(tmp_path, monkeypatch):
    with ExitStack() as stack:
        engines=[]
        def build(**env):
            for name,value in env.items():monkeypatch.setenv('KNOWLM_'+name,str(value))
            app=create_app(f'sqlite:///{tmp_path / "limits.db"}')
            clock=[int(time.time())//60*60+5]
            app.state.rate_limiter.clock=lambda:clock[0]
            engines.append(app.state.engine)
            return stack.enter_context(TestClient(app)),clock
        yield build
    for engine in engines:engine.dispose()


def test_auth_budget_cannot_be_reset_by_new_tokens_or_forwarded_headers(limited):
    c,clock=limited(AUTH_PER_MINUTE=2)
    assert c.post('/v1/auth/login',json={'username':'none','password':'not-a-password'}).status_code==401
    assert c.post('/v1/auth/login',json={}).status_code==422
    blocked=c.post('/v1/auth/register',json={'username':'new','password':'not-a-password'},headers={'X-Forwarded-For':'192.0.2.90','Authorization':'Bearer forged'})
    assert blocked.status_code==429 and blocked.headers['retry-after']=='55'
    assert blocked.headers['cache-control']=='no-store'
    clock[0]+=60
    assert c.post('/v1/auth/register',json={'username':'new','password':'not-a-password'}).status_code==201


def test_ask_budget_is_per_user_shared_across_sessions_and_restarts(limited):
    c,clock=limited(ASK_PER_MINUTE=1)
    a,b=auth(c,'alice'),auth(c,'bob');na,nb=notebook(c,a),notebook(c,b)
    assert c.post(f'/v1/notebooks/{na}/ask',headers=a,json={'question':'question'}).status_code==200
    token=c.post('/v1/auth/login',json={'username':'alice','password':'secure-password-123'}).json()['access_token']
    second={'Authorization':f'Bearer {token}'}
    assert c.post(f'/v1/notebooks/{na}/ask',headers=second,json={'question':'question'}).status_code==429
    assert c.post(f'/v1/notebooks/{nb}/ask',headers=b,json={'question':'question'}).status_code==200
    c2,clock2=limited(ASK_PER_MINUTE=1)
    clock2[0]=clock[0]
    assert c2.post(f'/v1/notebooks/{na}/ask',headers=a,json={'question':'question'}).status_code==429
    assert c.get(f'/v1/notebooks/{na}/history',headers=a).status_code==200


def test_atomic_request_budget_never_over_admits_concurrent_calls(limited):
    c,clock=limited(ASK_PER_MINUTE=3)
    limiter=c.app.state.rate_limiter
    with ThreadPoolExecutor(max_workers=8) as pool:
        results=list(pool.map(lambda _:limiter.check('/v1/notebooks/n/ask','POST','127.0.0.1',''),range(12)))
    assert results.count(None)==3 and len([r for r in results if r])==9
    clock[0]+=60
    assert limiter.check('/v1/notebooks/n/ask','POST','127.0.0.1','') is None
    with Session(c.app.state.engine) as session:
        assert session.scalar(select(func.count()).select_from(RateBucket))==2
        assert all(len(r.key)==64 for r in session.scalars(select(RateBucket)))


def test_budget_storage_failure_is_closed_not_unlimited(limited,monkeypatch):
    c,_=limited()
    def fail(*args):raise OperationalError('secret sql','secret content',Exception('private'))
    monkeypatch.setattr(c.app.state.rate_limiter,'check',fail)
    response=c.post('/v1/auth/login',json={})
    assert response.status_code==503 and 'secret' not in response.text
    assert c.get('/health').status_code==200  # liveness/read paths do not consume budgets


def test_notebook_quota_is_per_user_and_deletion_releases_capacity(limited):
    c,_=limited(MAX_NOTEBOOKS=1)
    a,b=auth(c,'alice'),auth(c,'bob');na=notebook(c,a);notebook(c,b)
    response=c.post('/v1/notebooks',headers=a,json={'title':'extra'})
    assert response.status_code==409 and response.json()['detail']=='Notebook quota reached'
    assert len(c.get('/v1/notebooks',headers=a).json())==1
    assert c.delete(f'/v1/notebooks/{na}',headers=a).status_code==204
    assert c.post('/v1/notebooks',headers=a,json={'title':'replacement'}).status_code==201


def test_source_quota_covers_every_ingestion_path(limited,monkeypatch):
    c,_=limited(MAX_SOURCES_PER_NOTEBOOK=1)
    a=auth(c,'alice');nid=notebook(c,a);base=f'/v1/notebooks/{nid}/sources'
    assert c.post(base+'/text',headers=a,json={'title':'first','text':'private'}).status_code==201
    monkeypatch.setattr('knowlm.pdf.extract_pdf',lambda raw:['source content'])
    responses=[
        c.post(base+'/text',headers=a,json={'title':'extra','text':'private'}),
        c.post(base+'/pdf',headers=a,files={'file':('a.pdf',b'%PDF-private')}),
        c.post(base+'/pdf-jobs',headers=a,files={'file':('a.pdf',b'%PDF-private')}),
        c.post(base+'/docx-jobs',headers=a,files={'file':('a.docx',b'PK\x03\x04private')}),
        c.post(base+'/youtube-jobs',headers=a,json={'url':'https://youtu.be/aB3dE5gH7jK','captions':'WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nThis is a valid caption.'}),
    ]
    assert all(r.status_code==409 and r.json()['detail']=='Source quota reached' for r in responses)
    assert len(c.get(base,headers=a).json())==1
    with Session(c.app.state.engine) as session:assert session.scalar(select(func.count()).select_from(IngestionJob))==0


def test_active_job_capacity_and_retry_do_not_bypass_limits(limited):
    c,_=limited(MAX_ACTIVE_JOBS_PER_NOTEBOOK=1,MAX_SOURCES_PER_NOTEBOOK=2)
    a=auth(c,'alice');nid=notebook(c,a);base=f'/v1/notebooks/{nid}/sources/pdf-jobs'
    def enqueue():return c.post(base,headers=a,files={'file':('a.pdf',b'%PDF-private')})
    first=enqueue().json()
    blocked=enqueue()
    assert blocked.status_code==409 and blocked.json()['detail']=='Active ingestion quota reached'
    def failed(raw):raise ExtractionError('unreadable_pdf')
    assert run_once(c.app.state.engine,extractor=failed)
    second=enqueue();assert second.status_code==202
    assert c.post(first['status_url']+'/retry',headers=a).status_code==409
    assert run_once(c.app.state.engine,extractor=lambda raw:['ready text'])
    # Source quota is full, but a retry reuses an existing source, not a new slot.
    assert c.post(first['status_url']+'/retry',headers=a).status_code==202
    assert run_once(c.app.state.engine,extractor=lambda raw:['recovered text'])
    assert all(s['status']=='ready' for s in c.get(f'/v1/notebooks/{nid}/sources',headers=a).json())


def test_account_deletion_clears_user_budgets_without_affecting_other_user(limited):
    c,_=limited()
    a,b=auth(c,'alice'),auth(c,'bob');notebook(c,a);notebook(c,b)
    with Session(c.app.state.engine) as session:
        aid=session.scalar(select(User.id).where(User.username=='alice'))
        bid=session.scalar(select(User.id).where(User.username=='bob'))
    assert c.post('/v1/auth/delete-account',headers=a,json={'password':'secure-password-123'}).status_code==204
    with Session(c.app.state.engine) as session:
        assert session.scalar(select(func.count()).select_from(RateBucket).where(RateBucket.user_id==aid))==0
        assert session.scalar(select(func.count()).select_from(RateBucket).where(RateBucket.user_id==bid))>0


def test_limits_must_be_positive_at_startup(limited):
    with pytest.raises(ValueError):limited(MAX_NOTEBOOKS=0)


def test_concurrent_notebook_creation_cannot_exceed_quota(limited):
    c,_=limited(MAX_NOTEBOOKS=1)
    headers=auth(c,'alice')
    with ThreadPoolExecutor(max_workers=6) as pool:
        results=list(pool.map(lambda _:c.post('/v1/notebooks',headers=headers,json={'title':'one slot'}).status_code,range(6)))
    assert results.count(201)==1
    assert all(status in (201,409,503) for status in results)
    assert len(c.get('/v1/notebooks',headers=headers).json())==1


def test_concurrent_source_creation_cannot_exceed_quota(limited):
    c,_=limited(MAX_SOURCES_PER_NOTEBOOK=1)
    headers=auth(c,'alice');nid=notebook(c,headers)
    with ThreadPoolExecutor(max_workers=6) as pool:
        results=list(pool.map(lambda _:c.post(f'/v1/notebooks/{nid}/sources/text',headers=headers,
                                               json={'title':'one slot','text':'private source'}).status_code,range(6)))
    assert results.count(201)==1
    assert all(status in (201,409,503) for status in results)
    assert len(c.get(f'/v1/notebooks/{nid}/sources',headers=headers).json())==1
