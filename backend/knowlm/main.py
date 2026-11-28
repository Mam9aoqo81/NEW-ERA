"""KnowLM's private, source-grounded backend prototype.

Local retrieval is explicitly extractive, not a generative model or vector search.
"""
import hashlib
import json
import hmac
import os
from pathlib import Path
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Literal

from knowlm.database import make_engine
from knowlm.retrieval import Evidence, retrieve
from knowlm.semantic import EmbeddingError, hybrid_retrieve
from knowlm.generation import CitationError, ProviderError, validate_answer

from fastapi import Depends, FastAPI, File, HTTPException, UploadFile, Query
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field, ConfigDict, SecretStr, StrictBool
from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, Float, LargeBinary, JSON, UniqueConstraint, Index, select, update, delete
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker


def uid():
    return str(uuid.uuid4())


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = 'users'
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    username: Mapped[str] = mapped_column(String(40), unique=True)
    password_hash: Mapped[str] = mapped_column(Text)


class AuthSession(Base):
    __tablename__ = 'auth_sessions'
    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey('users.id'), index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class Notebook(Base):
    __tablename__ = 'notebooks'
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    owner_id: Mapped[str] = mapped_column(ForeignKey('users.id'), index=True)
    title: Mapped[str] = mapped_column(String(200))


class Source(Base):
    __tablename__ = 'sources'
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    notebook_id: Mapped[str] = mapped_column(ForeignKey('notebooks.id'), index=True)
    title: Mapped[str] = mapped_column(String(200))
    kind: Mapped[str] = mapped_column(String(10))
    status: Mapped[str] = mapped_column(String(20), default='ready')
    content_hash: Mapped[str] = mapped_column(String(64))
    external_url: Mapped[str | None] = mapped_column(String(512))
    transcript_origin: Mapped[str | None] = mapped_column(String(30))
    ocr_pages: Mapped[list | None] = mapped_column(JSON)


class Chunk(Base):
    __tablename__ = 'source_chunks'
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    source_id: Mapped[str] = mapped_column(ForeignKey('sources.id'), index=True)
    page: Mapped[int] = mapped_column(Integer)
    chunk_index: Mapped[int] = mapped_column(Integer)
    text: Mapped[str] = mapped_column(Text)
    start_seconds: Mapped[float | None] = mapped_column(Float)
    end_seconds: Mapped[float | None] = mapped_column(Float)


class IngestionJob(Base):
    __tablename__ = 'ingestion_jobs'
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    source_id: Mapped[str] = mapped_column(ForeignKey('sources.id'), unique=True)
    status: Mapped[str] = mapped_column(String(20), default='pending', index=True)
    payload: Mapped[bytes | None] = mapped_column(LargeBinary)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    error_code: Mapped[str | None] = mapped_column(String(50))
    lease_token: Mapped[str | None] = mapped_column(String(36))
    lease_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class ChatTurn(Base):
    """An immutable, atomic question + validated answer snapshot, never a draft."""
    __tablename__ = 'chat_turns'
    __table_args__ = (UniqueConstraint('notebook_id', 'user_id', 'request_id', name='uq_turn_request'),
                      Index('ix_chat_turns_notebook_id_id', 'notebook_id', 'id'),
                      {'sqlite_autoincrement': True})
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    notebook_id: Mapped[str] = mapped_column(ForeignKey('notebooks.id'))
    user_id: Mapped[str] = mapped_column(ForeignKey('users.id'), index=True)
    request_id: Mapped[str] = mapped_column(String(36))
    request_hash: Mapped[str] = mapped_column(String(64))
    question: Mapped[str] = mapped_column(Text)
    source_ids: Mapped[list] = mapped_column(JSON)
    mode: Mapped[str] = mapped_column(String(20))
    answer: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class Credentials(BaseModel):
    username: str = Field(min_length=3, max_length=40, pattern=r'^[a-zA-Z0-9_]+$')
    password: str = Field(min_length=10, max_length=128)


class AccountDeletionInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    password: SecretStr = Field(min_length=10, max_length=128)


class NotebookInput(BaseModel):
    title: str = Field(min_length=1, max_length=200, pattern=r'\S')


class TextInput(BaseModel):
    title: str = Field(min_length=1, max_length=200, pattern=r'\S')
    text: str = Field(min_length=1, max_length=500_000, pattern=r'\S')


class Question(BaseModel):
    request_id: uuid.UUID = Field(default_factory=uuid.uuid4)
    question: str = Field(min_length=1, max_length=2000, pattern=r'\S')
    source_ids: list[str] | None = Field(default=None, max_length=100)
    mode: Literal["extractive", "grounded"] = "extractive"
    semantic_consent: StrictBool = False


class YouTubeInput(BaseModel):
    url: str = Field(min_length=1, max_length=2048)
    title: str | None = Field(default=None, min_length=1, max_length=200, pattern=r'\S')
    captions: str | None = Field(default=None, min_length=1, max_length=500_000, pattern=r'\S')


def password_hash(password, salt=None):
    salt = salt or secrets.token_hex(16)
    digest = hashlib.scrypt(password.encode(), salt=salt.encode(), n=16384, r=8, p=1).hex()
    return f'{salt}:{digest}'


def create_app(database_url=None, *, initialize_schema=True, answer_provider=None, embedding_provider=None, speech_provider=None):
    from knowlm.calls import register_calls
    from knowlm.pomodoro import register_pomodoro
    from knowlm.audio import register_audio
    from knowlm.canvas import register_canvas
    from knowlm.community import register_community
    from knowlm.collaboration import Membership, access, register_collaboration
    from knowlm.sharing import register_sharing
    from knowlm.learning import register_learning
    from knowlm.limits import Limits, register_limits, quota_notebook, quota_source
    data = Path(os.getenv('KNOWLM_DATA_DIR', 'backend/data'))
    data.mkdir(parents=True, exist_ok=True)
    url = database_url or os.getenv('DATABASE_URL', f'sqlite:///{data / "knowlm.db"}')
    engine = make_engine(url)
    limits = Limits.from_env()
    # Prototype only: production must use reviewed database migrations.
    if initialize_schema:
        Base.metadata.create_all(engine)
    factory = sessionmaker(engine, expire_on_commit=False)
    app = FastAPI(title='KnowLM', version='0.24.0', description='Private notebooks, durable PDF ingestion, evaluated lexical retrieval and optional cited generation.')
    app.state.engine = engine
    register_limits(app, engine, limits)
    # FastAPI's default validation response includes raw input (including
    # passwords/private source text). Return field metadata, never input values.
    from fastapi.exceptions import RequestValidationError
    from fastapi.responses import JSONResponse

    @app.exception_handler(RequestValidationError)
    async def validation_error(request, exc):
        return JSONResponse(status_code=422, content={'detail': [
            {'type': error['type'], 'loc': list(error['loc']), 'msg': error['msg']}
            for error in exc.errors()
        ]})

    from sqlalchemy.exc import OperationalError

    @app.exception_handler(OperationalError)
    async def database_busy(request, exc):
        if engine.dialect.name == 'sqlite' and 'locked' in str(exc.orig).lower():
            return JSONResponse(status_code=503, content={'detail':'Request budget temporarily unavailable'},
                                headers={'Retry-After':'2','Cache-Control':'no-store'})
        # Do not turn unrelated SQL errors into successful or unlimited requests.
        return JSONResponse(status_code=503, content={'detail':'Database temporarily unavailable'},
                            headers={'Retry-After':'2','Cache-Control':'no-store'})

    bearer = HTTPBearer(auto_error=False)

    def db():
        with factory() as session:
            yield session

    def current_user(auth: HTTPAuthorizationCredentials | None = Depends(bearer), session: Session = Depends(db)):
        if not auth or auth.scheme.lower() != 'bearer':
            raise HTTPException(401, 'Authentication required')
        record = session.get(AuthSession, hashlib.sha256(auth.credentials.encode()).hexdigest())
        if not record or record.expires_at.replace(tzinfo=timezone.utc) <= datetime.now(timezone.utc):
            raise HTTPException(401, 'Invalid or expired session')
        return record.user_id

    def owned(notebook_id, user_id, session):
        notebook = session.get(Notebook, notebook_id)
        if not notebook or notebook.owner_id != user_id:
            raise HTTPException(404, 'Notebook not found')
        return notebook

    def readable(notebook_id,user_id,session):
        return access(notebook_id,user_id,session)

    def editable(notebook_id,user_id,session):
        return access(notebook_id,user_id,session,write=True)

    def store_source(notebook_id, title, kind, pages, session):
        quota_source(session, notebook_id, limits)
        source = Source(notebook_id=notebook_id, title=title, kind=kind,
                        content_hash=hashlib.sha256('\f'.join(pages).encode()).hexdigest(),
                        ocr_pages=getattr(pages,'ocr_pages',[]))
        session.add(source)
        session.flush()
        for page, text in enumerate(pages, 1):
            for index, start in enumerate(range(0, len(text), 900)):
                part = text[start:start + 1000].strip()
                if part:
                    session.add(Chunk(source_id=source.id, page=page, chunk_index=index, text=part))
        session.commit()
        return {'id': source.id, 'title': title, 'status': source.status, 'pages': len(pages)}

    @app.get('/', include_in_schema=False)
    def index():
        from fastapi.responses import RedirectResponse
        return RedirectResponse('/docs')

    @app.get('/health')
    def health():
        return {'status': 'ok', 'retrieval_mode': 'bm25_char_rrf', 'llm_configured': answer_provider is not None,
                'semantic_configured': embedding_provider is not None,
                'ocr_enabled': os.getenv('KNOWLM_OCR_ENABLED', '0') == '1',
                'youtube_auto_fetch_enabled': os.getenv('KNOWLM_YOUTUBE_FETCH_ENABLED', '1') == '1'}

    @app.post('/v1/auth/register', status_code=201)
    def register(body: Credentials, session: Session = Depends(db)):
        name = body.username.lower()
        if session.scalar(select(User).where(User.username == name)):
            raise HTTPException(409, 'Username unavailable')
        user = User(username=name, password_hash=password_hash(body.password))
        session.add(user)
        from sqlalchemy.exc import IntegrityError
        try:
            session.commit()
        except IntegrityError:
            session.rollback()
            raise HTTPException(409, 'Username unavailable')
        return {'id': user.id, 'username': user.username}

    @app.post('/v1/auth/login')
    def login(body: Credentials, session: Session = Depends(db)):
        user = session.scalar(select(User).where(User.username == body.username.lower()))
        stored = user.password_hash if user else password_hash('dummy-password-value')
        if not hmac.compare_digest(password_hash(body.password, stored.split(':')[0]), stored) or not user:
            raise HTTPException(401, 'Invalid credentials')
        token = secrets.token_urlsafe(32)
        session.add(AuthSession(token_hash=hashlib.sha256(token.encode()).hexdigest(), user_id=user.id,
                                expires_at=datetime.now(timezone.utc) + timedelta(hours=24)))
        session.commit()
        return {'access_token': token, 'token_type': 'bearer', 'expires_in': 86400}

    @app.get('/v1/auth/me')
    def me(user_id=Depends(current_user), session: Session = Depends(db)):
        user = session.get(User, user_id)
        return {'id': user.id, 'username': user.username}

    @app.post('/v1/auth/delete-account', status_code=204)
    def delete_account(body: AccountDeletionInput, user_id=Depends(current_user), session: Session = Depends(db)):
        user = session.scalar(select(User).where(User.id == user_id).with_for_update())
        if not user:
            raise HTTPException(401, 'Invalid or expired session')
        candidate = password_hash(body.password.get_secret_value(), user.password_hash.split(':')[0])
        if not hmac.compare_digest(candidate, user.password_hash):
            # Incorrect re-authentication must not revoke a valid session.
            raise HTTPException(403, 'Password confirmation failed')
        from knowlm.privacy import erase_account
        erase_account(session, user_id)
        session.commit()
        from fastapi.responses import Response
        return Response(status_code=204)

    @app.post('/v1/auth/logout', status_code=204)
    def logout(auth: HTTPAuthorizationCredentials = Depends(bearer), user_id=Depends(current_user), session: Session = Depends(db)):
        record = session.get(AuthSession, hashlib.sha256(auth.credentials.encode()).hexdigest())
        session.delete(record)
        session.commit()

    @app.post('/v1/notebooks', status_code=201)
    def create_notebook(body: NotebookInput, user_id=Depends(current_user), session: Session = Depends(db)):
        quota_notebook(session, user_id, limits)
        notebook = Notebook(title=body.title.strip(), owner_id=user_id)
        session.add(notebook)
        session.commit()
        return {'id': notebook.id, 'title': notebook.title}

    @app.delete('/v1/notebooks/{notebook_id}', status_code=204)
    def delete_notebook(notebook_id: str, user_id=Depends(current_user), session: Session = Depends(db)):
        # A notebook row lock serializes competing deletions on PostgreSQL.
        notebook = session.scalar(select(Notebook).where(Notebook.id == notebook_id, Notebook.owner_id == user_id).with_for_update())
        if not notebook or notebook.owner_id != user_id:
            raise HTTPException(404, 'Notebook not found')
        from knowlm.privacy import erase_notebook
        erase_notebook(session, notebook_id)
        session.commit()
        from fastapi.responses import Response
        return Response(status_code=204)

    @app.get('/v1/notebooks')
    def list_notebooks(user_id=Depends(current_user), session: Session = Depends(db)):
        memberships={m.notebook_id:m.role for m in session.scalars(select(Membership).where(Membership.user_id==user_id))}
        rows=session.scalars(select(Notebook).where((Notebook.owner_id==user_id) | Notebook.id.in_(memberships)))
        return [{'id':n.id,'title':n.title,'role':'owner' if n.owner_id==user_id else memberships[n.id]} for n in rows]

    @app.post('/v1/notebooks/{notebook_id}/sources/text', status_code=201)
    def add_text(notebook_id: str, body: TextInput, user_id=Depends(current_user), session: Session = Depends(db)):
        editable(notebook_id, user_id, session)
        return store_source(notebook_id, body.title, 'text', [body.text], session)

    @app.post('/v1/notebooks/{notebook_id}/sources/pdf', status_code=201)
    async def add_pdf(notebook_id: str, file: UploadFile = File(...), user_id=Depends(current_user), session: Session = Depends(db)):
        editable(notebook_id, user_id, session)
        try:
            raw = await file.read(10 * 1024 * 1024 + 1)
        finally:
            await file.close()
        if len(raw) > 10 * 1024 * 1024:
            raise HTTPException(413, 'PDF limit is 10 MiB')
        if not raw.startswith(b'%PDF-'):
            raise HTTPException(415, 'Expected a PDF file')
        # Compatibility endpoint: extraction is isolated; use /pdf-jobs for durable async work.
        from knowlm.pdf import extract_pdf, ExtractionError
        try:
            from starlette.concurrency import run_in_threadpool
            pages = await run_in_threadpool(extract_pdf, raw)
        except ExtractionError as exc:
            raise HTTPException(exc.status_code, exc.code)
        return store_source(notebook_id, (file.filename or 'Document')[:200], 'pdf', pages, session)

    @app.post('/v1/notebooks/{notebook_id}/sources/pdf-jobs', status_code=202)
    async def enqueue_pdf(notebook_id: str, file: UploadFile = File(...), user_id=Depends(current_user), session: Session = Depends(db)):
        editable(notebook_id, user_id, session)
        try:
            raw = await file.read(10 * 1024 * 1024 + 1)
        finally:
            await file.close()
        if len(raw) > 10 * 1024 * 1024:
            raise HTTPException(413, 'PDF limit is 10 MiB')
        if not raw.startswith(b'%PDF-'):
            raise HTTPException(415, 'Expected a PDF file')
        quota_source(session, notebook_id, limits, queued=True)
        source = Source(notebook_id=notebook_id, title=(file.filename or 'Document')[:200],
                        kind='pdf', status='processing', content_hash=hashlib.sha256(raw).hexdigest())
        session.add(source)
        session.flush()
        job = IngestionJob(source_id=source.id, payload=raw)
        session.add(job)
        session.commit()
        return {'id': job.id, 'source_id': source.id, 'status': job.status,
                'status_url': f'/v1/jobs/{job.id}'}

    @app.post('/v1/notebooks/{notebook_id}/sources/docx-jobs', status_code=202)
    async def enqueue_docx(notebook_id: str, file: UploadFile = File(...), user_id=Depends(current_user), session: Session = Depends(db)):
        editable(notebook_id, user_id, session)
        try:
            raw = await file.read(10 * 1024 * 1024 + 1)
        finally:
            await file.close()
        if len(raw) > 10 * 1024 * 1024:
            raise HTTPException(413, 'Document limit is 10 MiB')
        if not (file.filename or '').lower().endswith('.docx') or not raw.startswith(b'PK\x03\x04'):
            raise HTTPException(415, 'Expected a DOCX file')
        quota_source(session, notebook_id, limits, queued=True)
        source = Source(notebook_id=notebook_id, title=(file.filename or 'Document.docx')[:200],
                        kind='docx', status='processing', content_hash=hashlib.sha256(raw).hexdigest())
        session.add(source)
        session.flush()
        job = IngestionJob(source_id=source.id, payload=raw)
        session.add(job)
        session.commit()
        return {'id': job.id, 'source_id': source.id, 'status': job.status,
                'status_url': f'/v1/jobs/{job.id}'}

    @app.post('/v1/notebooks/{notebook_id}/sources/youtube-jobs', status_code=202)
    def enqueue_youtube(notebook_id: str, body: YouTubeInput, user_id=Depends(current_user), session: Session = Depends(db)):
        editable(notebook_id, user_id, session)
        from knowlm.youtube import canonical_video, parse_captions
        from knowlm.pdf import ExtractionError
        try:
            video_id, canonical = canonical_video(body.url)
        except ValueError:
            raise HTTPException(422, 'Invalid YouTube video URL')
        if body.captions is None and os.getenv('KNOWLM_YOUTUBE_FETCH_ENABLED', '1') != '1':
            raise HTTPException(503, 'Automatic YouTube captions are disabled on this server')
        if body.captions is not None:
            try:
                parse_captions(body.captions)
            except ExtractionError:
                raise HTTPException(422, 'Expected valid timed SRT or WebVTT captions')
        payload = json.dumps({'video_id': video_id, 'captions': body.captions}, ensure_ascii=False).encode()
        quota_source(session, notebook_id, limits, queued=True)
        source = Source(notebook_id=notebook_id, title=body.title or f'YouTube · {video_id}',
                        kind='youtube', status='processing', content_hash=hashlib.sha256(payload).hexdigest(),
                        external_url=canonical, transcript_origin='user_captions' if body.captions is not None else 'youtube_captions')
        session.add(source)
        session.flush()
        job = IngestionJob(source_id=source.id, payload=payload)
        session.add(job)
        session.commit()
        return {'id': job.id, 'source_id': source.id, 'status': job.status,
                'status_url': f'/v1/jobs/{job.id}'}

    def owned_job(job_id, user_id, session, read=False):
        job = session.get(IngestionJob, job_id)
        if not job:
            raise HTTPException(404, 'Job not found')
        source = session.get(Source, job.source_id)
        (readable if read else editable)(source.notebook_id, user_id, session)
        return job

    @app.get('/v1/jobs/{job_id}')
    def get_job(job_id: str, user_id=Depends(current_user), session: Session = Depends(db)):
        job = owned_job(job_id, user_id, session, read=True)
        return {'id': job.id, 'source_id': job.source_id, 'status': job.status,
                'attempts': job.attempts, 'error_code': job.error_code}

    @app.post('/v1/jobs/{job_id}/retry', status_code=202)
    def retry_job(job_id: str, user_id=Depends(current_user), session: Session = Depends(db)):
        job = owned_job(job_id, user_id, session)
        source = session.get(Source, job.source_id)
        if job.status != 'failed' or job.attempts >= 3:
            raise HTTPException(409, 'Only failed jobs with fewer than 3 attempts may be retried')
        quota_source(session, source.notebook_id, limits, queued=True, existing=True)
        result = session.execute(update(IngestionJob).where(IngestionJob.id == job.id,
                                 IngestionJob.status == 'failed', IngestionJob.attempts < 3).values(
                                 status='pending', error_code=None, lease_token=None, lease_until=None))
        if not result.rowcount:
            raise HTTPException(409, 'Only failed jobs with fewer than 3 attempts may be retried')
        source = session.get(Source, job.source_id)
        source.status = 'processing'
        session.commit()
        return {'id': job.id, 'status': 'pending'}


    @app.get('/v1/notebooks/{notebook_id}/sources')
    def list_sources(notebook_id: str, user_id=Depends(current_user), session: Session = Depends(db)):
        readable(notebook_id, user_id, session)
        rows = session.execute(select(Source, IngestionJob).outerjoin(
            IngestionJob, IngestionJob.source_id == Source.id).where(Source.notebook_id == notebook_id))
        return [{'id': s.id, 'title': s.title, 'kind': s.kind, 'status': s.status,
                 'external_url': s.external_url, 'transcript_origin': s.transcript_origin, 'ocr_pages': s.ocr_pages or [],
                 'job': {'id': job.id, 'attempts': job.attempts, 'error_code': job.error_code} if job else None}
                for s, job in rows]

    @app.get('/v1/notebooks/{notebook_id}/sources/{source_id}/paragraphs/{page}')
    @app.get('/v1/notebooks/{notebook_id}/sources/{source_id}/pages/{page}')
    def get_page(notebook_id: str, source_id: str, page: int, user_id=Depends(current_user), session: Session = Depends(db)):
        readable(notebook_id, user_id, session)
        source = session.get(Source, source_id)
        if not source or source.notebook_id != notebook_id:
            raise HTTPException(404, 'Source not found')
        chunks = session.scalars(select(Chunk).where(Chunk.source_id == source_id, Chunk.page == page).order_by(Chunk.chunk_index)).all()
        if not chunks:
            raise HTTPException(404, 'Page text not found')
        return {'source_id': source_id, 'page': None if source.kind == 'docx' else page,
                'paragraph': page if source.kind == 'docx' else None, 'ocr': page in (source.ocr_pages or []), 'chunks': [{'id': c.id, 'text': c.text} for c in chunks]}

    @app.get('/v1/notebooks/{notebook_id}/sources/{source_id}/chunks/{chunk_id}')
    def read_chunk(notebook_id: str, source_id: str, chunk_id: str, user_id=Depends(current_user), session: Session = Depends(db)):
        readable(notebook_id, user_id, session)
        source = session.get(Source, source_id)
        chunk = session.get(Chunk, chunk_id)
        if not source or source.notebook_id != notebook_id or not chunk or chunk.source_id != source_id:
            raise HTTPException(404, 'Source not found')
        return {'source_id': source_id, 'page': None if chunk.start_seconds is not None or source.kind == 'docx' else chunk.page,
                'paragraph': chunk.page if source.kind == 'docx' else None,
                'chunks': [{'id': chunk.id, 'text': chunk.text}],
                'start_seconds': chunk.start_seconds, 'end_seconds': chunk.end_seconds,
                'transcript_origin': source.transcript_origin}

    def turn_snapshot(turn):
        return {'id': turn.id, 'request_id': turn.request_id, 'question': turn.question,
                'source_ids': turn.source_ids, 'mode': turn.mode,
                'created_at': turn.created_at.replace(tzinfo=timezone.utc).isoformat(),
                'answer': turn.answer}

    def answer_snapshot(turn):
        return {**turn.answer, 'turn_id': turn.id, 'request_id': turn.request_id,
                'created_at': turn.created_at.replace(tzinfo=timezone.utc).isoformat()}

    @app.get('/v1/notebooks/{notebook_id}/history')
    def history(notebook_id: str, limit: int = Query(40, ge=1, le=100),
                before: int | None = Query(None, ge=1, le=9223372036854775807), user_id=Depends(current_user), session: Session = Depends(db)):
        readable(notebook_id, user_id, session)
        query = select(ChatTurn).where(ChatTurn.notebook_id == notebook_id, ChatTurn.user_id == user_id)
        if before is not None:
            query = query.where(ChatTurn.id < before)
        rows = session.scalars(query.order_by(ChatTurn.id.desc()).limit(limit + 1)).all()
        has_more = len(rows) > limit
        rows = rows[:limit]
        return {'turns': [turn_snapshot(t) for t in reversed(rows)],
                'next_before': rows[-1].id if has_more else None}

    @app.delete('/v1/notebooks/{notebook_id}/history', status_code=204)
    def clear_history(notebook_id: str, user_id=Depends(current_user), session: Session = Depends(db)):
        readable(notebook_id, user_id, session)
        session.execute(delete(ChatTurn).where(ChatTurn.notebook_id == notebook_id, ChatTurn.user_id == user_id))
        session.commit()

    @app.post('/v1/notebooks/{notebook_id}/ask')
    def ask(notebook_id: str, body: Question, user_id=Depends(current_user), session: Session = Depends(db)):
        notebook = readable(notebook_id, user_id, session)
        if notebook.owner_id != user_id and (body.mode == 'grounded' or body.semantic_consent):
            raise HTTPException(403,'External processing requires notebook owner')
        request_id = str(body.request_id)
        request_data = {'question': body.question, 'mode': body.mode,
                        'source_ids': sorted(set(body.source_ids)) if body.source_ids is not None else None}
        if body.semantic_consent:
            request_data['semantic_consent'] = True
        request_hash = hashlib.sha256(json.dumps(request_data, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
        previous = session.scalar(select(ChatTurn).where(ChatTurn.notebook_id == notebook_id, ChatTurn.user_id == user_id, ChatTurn.request_id == request_id))
        if previous:
            if previous.request_hash != request_hash:
                raise HTTPException(409, 'Request ID was already used for a different question')
            return answer_snapshot(previous)

        def persist(answer):
            # Persist question and complete validated answer in one transaction.
            # No draft or invalid provider output is ever written to history.
            session.expire_all()
            readable(notebook_id,user_id,session)
            turn = ChatTurn(notebook_id=notebook_id, user_id=user_id, request_id=request_id,
                            request_hash=request_hash, question=body.question,
                            source_ids=sorted({e.source_id for e in candidates}), mode=body.mode, answer=answer)
            session.add(turn)
            try:
                session.commit()
            except IntegrityError:
                session.rollback()
                turn = session.scalar(select(ChatTurn).where(ChatTurn.notebook_id == notebook_id, ChatTurn.user_id == user_id, ChatTurn.request_id == request_id))
                if not turn:
                    raise
                if turn.request_hash != request_hash:
                    raise HTTPException(409, 'Request ID was already used for a different question')
            return answer_snapshot(turn)

        if body.mode == 'grounded' and answer_provider is None:
            raise HTTPException(503, 'Generated mode is not configured; use extractive mode')
        if body.semantic_consent and body.source_ids is None:
            raise HTTPException(422, 'Select sources explicitly for semantic retrieval')
        query = select(Chunk, Source).join(Source, Source.id == Chunk.source_id).where(Source.notebook_id == notebook_id, Source.status == 'ready')
        if body.source_ids is not None:
            allowed = set(session.scalars(select(Source.id).where(Source.notebook_id == notebook_id)))
            if not set(body.source_ids) <= allowed:
                raise HTTPException(404, 'Source not found')
            query = query.where(Source.id.in_(body.source_ids))
        candidates = [Evidence(c.id, s.id, s.title, c.page, c.text, c.start_seconds, c.end_seconds, s.external_url, s.transcript_origin, s.kind, c.page in (s.ocr_pages or [])) for c, s in session.execute(query)]
        retrieval_mode = 'bm25_char_rrf'
        if body.semantic_consent:
            if embedding_provider is None:
                raise HTTPException(503, 'Semantic retrieval is not configured')
            try:
                hits = hybrid_retrieve(body.question, candidates, embedding_provider)
            except EmbeddingError:
                raise HTTPException(503, 'Semantic retrieval unavailable; narrow selected sources or retry later')
            retrieval_mode = 'embedding_bm25_rrf'
        else:
            hits = retrieve(body.question, candidates)
        evidence = [hit.evidence for hit in hits]

        def citation(item, quote):
            timestamped = item.start_seconds is not None and item.external_url is not None
            return {'chunk_id': item.chunk_id, 'source_id': item.source_id,
                    'title': item.title, 'page': None if timestamped or item.kind == 'docx' else item.page, 'quote': quote,
                    'paragraph': item.page if item.kind == 'docx' else None,
                    'locator_type': 'timestamp' if timestamped else 'paragraph' if item.kind == 'docx' else 'page',
                    'start_seconds': item.start_seconds, 'end_seconds': item.end_seconds,
                    'media_url': f'{item.external_url}&t={int(item.start_seconds)}s' if timestamped else None,
                    'transcript_origin': item.transcript_origin, 'ocr': item.ocr,
                    'url': f'/v1/notebooks/{notebook_id}/sources/{item.source_id}/chunks/{item.chunk_id}' if timestamped else f'/v1/notebooks/{notebook_id}/sources/{item.source_id}/paragraphs/{item.page}' if item.kind == 'docx' else f'/v1/notebooks/{notebook_id}/sources/{item.source_id}/pages/{item.page}'}

        if body.mode == 'grounded' and evidence:
            try:
                generated = validate_answer(answer_provider.generate(body.question, evidence), evidence)
            except CitationError:
                raise HTTPException(502, 'Generated answer rejected: invalid citation or structure')
            except ProviderError:
                raise HTTPException(503, 'Generation provider unavailable')
            lookup = {item.chunk_id: item for item in evidence}
            citations, rendered = [], []
            for claim in generated.claims:
                markers = []
                for reference in claim.references:
                    citations.append(citation(lookup[reference.chunk_id], reference.quote))
                    markers.append(f'[{len(citations)}]')
                rendered.append(claim.text + ' ' + ' '.join(markers))
            return persist({'mode': 'grounded', 'answered': bool(rendered),
                    'answer': '\n\n'.join(rendered) if rendered else 'لا توجد معلومات كافية في المصادر المحددة.',
                    'citations': citations, 'retrieval': retrieval_mode,
                    'notice': 'تم التحقق من وجود الاقتباسات في المصادر؛ هذا لا يضمن صحة كل استنتاج دلاليًا.'})
        citations = [citation(item, item.text) for item in evidence]
        return persist({'mode': body.mode, 'answered': bool(citations),
                'answer': '\n\n'.join(f'{c["quote"]} [{i}]' for i, c in enumerate(citations, 1)) if citations else 'لا توجد معلومات كافية في المصادر المحددة.',
                'citations': citations, 'retrieval': retrieval_mode,
                'notice': 'مقتطفات بحث دلالي تجريبي؛ التشابه لا يثبت دعم الإجابة أو صحة الادعاءات.' if body.semantic_consent else 'مقتطفات بحث نصي وليست إجابة مولدة أو تحققًا من صحة الادعاءات.'})

    register_calls(app, db, current_user)
    register_pomodoro(app, db, current_user)
    register_audio(app, db, current_user, owned, speech_provider)
    register_canvas(app, db, current_user, readable)
    register_community(app, db, current_user, owned)
    register_collaboration(app, db, current_user, owned)
    register_learning(app, db, current_user, editable, readable)
    register_sharing(app, db, current_user, owned)
    return app

