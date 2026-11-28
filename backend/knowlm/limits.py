"""Small database-backed fixed-window budgets; not an edge DDoS firewall."""
from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import os
import re
import time

from fastapi import HTTPException
from sqlalchemy import ForeignKey, Integer, String, delete, func, select, update
from sqlalchemy.orm import Mapped, Session, mapped_column
from sqlalchemy.exc import IntegrityError, OperationalError

from knowlm.main import Base, AuthSession, Notebook, Source, User


class RateBucket(Base):
    __tablename__ = 'rate_buckets'
    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str | None] = mapped_column(ForeignKey('users.id'), index=True)
    scope: Mapped[str] = mapped_column(String(20))
    expires_at: Mapped[int] = mapped_column(Integer, index=True)
    count: Mapped[int] = mapped_column(Integer)


@dataclass(frozen=True)
class Limits:
    auth: int = 60
    mutations: int = 120
    audio: int = 3
    ask: int = 30
    ingestion: int = 10
    account_delete: int = 5
    notebooks: int = 20
    sources: int = 100
    active_jobs: int = 4

    @classmethod
    def from_env(cls):
        names = {'audio':'AUDIO_PER_MINUTE','auth':'AUTH_PER_MINUTE','mutations':'MUTATIONS_PER_MINUTE','ask':'ASK_PER_MINUTE',
                 'ingestion':'INGESTION_PER_MINUTE','account_delete':'ACCOUNT_DELETE_PER_MINUTE',
                 'notebooks':'MAX_NOTEBOOKS','sources':'MAX_SOURCES_PER_NOTEBOOK',
                 'active_jobs':'MAX_ACTIVE_JOBS_PER_NOTEBOOK'}
        values = {key:int(os.getenv('KNOWLM_'+name, getattr(cls(),key))) for key,name in names.items()}
        if any(not 1 <= value <= 1_000_000 for value in values.values()):
            raise ValueError('KnowLM limits must be integers from 1 to 1000000')
        return cls(**values)


def quota_notebook(session, user_id, limits):
    # A write lock serializes count+insert on both SQLite and PostgreSQL.
    session.execute(update(User).where(User.id == user_id).values(username=User.username))
    count = session.scalar(select(func.count()).select_from(Notebook).where(Notebook.owner_id == user_id))
    if count >= limits.notebooks:
        raise HTTPException(409, 'Notebook quota reached')


def quota_source(session, notebook_id, limits, *, queued=False, existing=False):
    session.execute(update(Notebook).where(Notebook.id == notebook_id).values(title=Notebook.title))
    count = session.scalar(select(func.count()).select_from(Source).where(Source.notebook_id == notebook_id))
    if not existing and count >= limits.sources:
        raise HTTPException(409, 'Source quota reached')
    if queued:
        active = session.scalar(select(func.count()).select_from(Source).where(
            Source.notebook_id == notebook_id, Source.status == 'processing'))
        if active >= limits.active_jobs:
            raise HTTPException(409, 'Active ingestion quota reached')


class RateLimiter:
    def __init__(self, engine, limits, clock=time.time):
        self.engine, self.limits, self.clock = engine, limits, clock

    def check(self, path, method, host, authorization):
        if method not in ('POST','PUT','PATCH','DELETE') or not path.startswith('/v1/'):
            return None
        if path in ('/v1/auth/login','/v1/auth/register'):
            scope = 'auth'
        elif re.fullmatch(r'/v1/study-artifacts/[^/]+/audio', path):
            scope = 'audio'
        elif path == '/v1/auth/delete-account':
            scope = 'account_delete'
        elif re.fullmatch(r'/v1/notebooks/[^/]+/ask',path):
            scope = 'ask'
        elif re.fullmatch(r'/v1/notebooks/[^/]+/sources/(?:text|pdf|pdf-jobs|docx-jobs|youtube-jobs)',path):
            scope = 'ingestion'
        else:
            scope = 'mutations'
        at = int(self.clock()); end = (at // 60 + 1) * 60
        user_id = None
        scheme, _, token = authorization.partition(' ')
        if scope != 'auth' and scheme.lower() == 'bearer' and token:
            with Session(self.engine) as session:
                auth = session.get(AuthSession, hashlib.sha256(token.encode()).hexdigest())
                if auth and auth.expires_at.replace(tzinfo=timezone.utc).timestamp() > at:
                    user_id = auth.user_id
        try:
            return self.consume(scope, host, user_id, at, end)
        except IntegrityError:
            # Account deletion may commit between auth lookup and budget insert.
            if user_id is None: raise
            return self.consume(scope, host, None, at, end)

    def consume(self, scope, host, user_id, at, end):
        principal = 'user:'+user_id if user_id else 'ip:'+host
        with Session(self.engine) as session:
            budgets = [('mutations',self.limits.mutations)]
            if scope != 'mutations': budgets.append((scope,getattr(self.limits,scope)))
            denied = None
            session.execute(delete(RateBucket).where(RateBucket.expires_at <= at))
            if self.engine.dialect.name == 'sqlite':
                from sqlalchemy.dialects.sqlite import insert
            elif self.engine.dialect.name == 'postgresql':
                from sqlalchemy.dialects.postgresql import insert
            else:
                raise RuntimeError('Rate budgets require SQLite or PostgreSQL')
            for group, limit in budgets:
                # Hashes are pseudonymous, not guaranteed anonymization of IPs.
                key = hashlib.sha256(f'{group}|{principal}|{end}'.encode()).hexdigest()
                statement = insert(RateBucket).values(key=key,user_id=user_id,scope=group,expires_at=end,count=1)
                from sqlalchemy import case
                statement = statement.on_conflict_do_update(index_elements=[RateBucket.key],set_={
                    'count':case((RateBucket.count <= limit, RateBucket.count+1),else_=RateBucket.count)
                }).returning(RateBucket.count)
                count = session.scalar(statement)
                if count > limit: denied = max(1,end-at)
            session.commit()
            return denied


def register_limits(app, engine, limits):
    from fastapi.responses import JSONResponse
    from starlette.concurrency import run_in_threadpool
    limiter = RateLimiter(engine,limits)
    app.state.rate_limiter = limiter
    app.state.limits = limits

    @app.middleware('http')
    async def budgets(request, call_next):
        # Never trust arbitrary X-Forwarded-For headers here. ASGI proxy trust
        # belongs to deployment configuration and is documented separately.
        if request.method not in ('POST','PUT','PATCH','DELETE') or not request.url.path.startswith('/v1/'):
            return await call_next(request)
        try:
            wait = await run_in_threadpool(limiter.check, request.url.path.rstrip('/'),request.method,
                                           request.client.host if request.client else 'unknown',
                                           request.headers.get('authorization',''))
        except OperationalError:
            # Fail closed: never bypass budgets when their storage is unavailable.
            return JSONResponse(status_code=503, content={'detail':'Request budget temporarily unavailable'},
                                headers={'Retry-After':'2','Cache-Control':'no-store'})
        if wait:
            return JSONResponse(status_code=429, content={'detail':'Request rate limit reached'},
                                headers={'Retry-After':str(wait),'Cache-Control':'no-store'})
        return await call_next(request)
