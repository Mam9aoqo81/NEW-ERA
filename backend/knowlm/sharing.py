"""Explicit unlisted learning snapshots, never access to a private notebook."""
from datetime import datetime, timedelta, timezone
import hashlib
import json
import re
import secrets
import uuid
from typing import Literal

from fastapi import Depends, Header, HTTPException
from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictInt
from sqlalchemy import DateTime, ForeignKey, JSON, String, UniqueConstraint, func, select, update
from sqlalchemy.orm import Mapped, Session, mapped_column

from knowlm.main import Base, Notebook, User, uid
from knowlm.learning import Card, Deck, Quiz


def now(): return datetime.now(timezone.utc)
def iso(value): return value.replace(tzinfo=timezone.utc).isoformat() if value else None


class LearningShare(Base):
    __tablename__ = 'learning_shares'
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    owner_id: Mapped[str] = mapped_column(ForeignKey('users.id'), index=True)
    notebook_id: Mapped[str] = mapped_column(ForeignKey('notebooks.id'), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    title: Mapped[str] = mapped_column(String(200))
    snapshot: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class ShareImport(Base):
    __tablename__ = 'share_imports'
    __table_args__ = (UniqueConstraint('user_id', 'request_id', name='uq_share_import_request'),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey('users.id'), index=True)
    notebook_id: Mapped[str] = mapped_column(ForeignKey('notebooks.id'), index=True)
    deck_id: Mapped[str] = mapped_column(ForeignKey('flashcard_decks.id'))
    request_id: Mapped[str] = mapped_column(String(36))
    token_hash: Mapped[str] = mapped_column(String(64))


class ShareReport(Base):
    __tablename__ = 'share_reports'
    __table_args__ = (UniqueConstraint('reporter_id', 'share_id', name='uq_share_report_user'),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    reporter_id: Mapped[str] = mapped_column(ForeignKey('users.id'), index=True)
    share_id: Mapped[str] = mapped_column(ForeignKey('learning_shares.id'), index=True)
    reason: Mapped[str] = mapped_column(String(30))
    status: Mapped[str] = mapped_column(String(20), default='pending', index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class ImportInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    request_id: uuid.UUID
    consent: StrictBool


class ReportInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    reason: Literal['privacy', 'copyright', 'harmful', 'incorrect', 'spam']


class ShareInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    title: str = Field(min_length=1,max_length=200,pattern=r'\S')
    expires_days: int = Field(default=7,ge=1,le=30)
    consent: StrictBool
    preview_hash: str = Field(pattern=r'^[a-f0-9]{64}$')


class SharedAnswers(BaseModel):
    model_config = ConfigDict(extra='forbid')
    answers: list[StrictInt] = Field(min_length=2,max_length=20)


def fingerprint(snapshot):
    return hashlib.sha256(json.dumps(snapshot,ensure_ascii=False,sort_keys=True).encode()).hexdigest()


def register_sharing(app, db, current_user, owned):
    def deck_owned(deck_id,user_id,session):
        deck=session.get(Deck,deck_id)
        if not deck: raise HTTPException(404,'Deck not found')
        owned(deck.notebook_id,user_id,session)
        return deck

    def lock_parent(deck_id,user_id,session):
        deck=deck_owned(deck_id,user_id,session)
        locked=session.execute(update(Notebook).where(Notebook.id==deck.notebook_id,Notebook.owner_id==user_id).values(title=Notebook.title))
        if locked.rowcount!=1: raise HTTPException(404,'Notebook not found')
        session.expire_all()

    def deck_snapshot(deck_id,user_id,session):
        deck=deck_owned(deck_id,user_id,session)
        cards=session.scalars(select(Card).where(Card.deck_id==deck_id,Card.deleted_at.is_(None)).order_by(Card.id).limit(51)).all()
        if not cards or len(cards)>50: raise HTTPException(422,'Share requires 1 to 50 cards')
        # Explicit allowlist: no citations, source titles/URLs, IDs, schedules or origin metadata.
        return deck.notebook_id, {'kind':'cards','items':[{'front':c.front,'back':c.back} for c in cards]}

    def quiz_snapshot(quiz_id,user_id,session):
        quiz=session.get(Quiz,quiz_id)
        if not quiz: raise HTTPException(404,'Quiz not found')
        deck=deck_owned(quiz.deck_id,user_id,session)
        return deck.notebook_id, {'kind':'quiz','items':[{'prompt':q['prompt'],'choices':q['choices'],
            'correct_index':q['correct_index'],'explanation':q['explanation']} for q in quiz.questions]}

    def preview(pair):
        _,snapshot=pair
        return {'snapshot':snapshot,'preview_hash':fingerprint(snapshot)}

    @app.get('/v1/decks/{deck_id}/share-preview')
    def preview_deck(deck_id:str,user_id=Depends(current_user),session:Session=Depends(db)):
        return preview(deck_snapshot(deck_id,user_id,session))

    @app.get('/v1/quizzes/{quiz_id}/share-preview')
    def preview_quiz(quiz_id:str,user_id=Depends(current_user),session:Session=Depends(db)):
        return preview(quiz_snapshot(quiz_id,user_id,session))

    def create(pair,body,user_id,session):
        nid,snapshot=pair
        if not body.consent: raise HTTPException(422,'Explicit sharing consent is required')
        if not secrets.compare_digest(body.preview_hash,fingerprint(snapshot)):
            raise HTTPException(409,'Content changed since sharing preview')
        session.execute(update(User).where(User.id==user_id).values(username=User.username))
        active=session.scalar(select(func.count()).select_from(LearningShare).where(
            LearningShare.owner_id==user_id,LearningShare.revoked_at.is_(None),LearningShare.expires_at>now()))
        if active>=20: raise HTTPException(409,'Active share quota reached')
        token=secrets.token_urlsafe(32)
        share=LearningShare(owner_id=user_id,notebook_id=nid,title=body.title.strip(),snapshot=snapshot,
                            token_hash=hashlib.sha256(token.encode()).hexdigest(),expires_at=now()+timedelta(days=body.expires_days))
        session.add(share);session.commit()
        return {'id':share.id,'token':token,'expires_at':iso(share.expires_at)}

    @app.post('/v1/decks/{deck_id}/shares',status_code=201)
    def share_deck(deck_id:str,body:ShareInput,user_id=Depends(current_user),session:Session=Depends(db)):
        lock_parent(deck_id,user_id,session)
        return create(deck_snapshot(deck_id,user_id,session),body,user_id,session)

    @app.post('/v1/quizzes/{quiz_id}/shares',status_code=201)
    def share_quiz(quiz_id:str,body:ShareInput,user_id=Depends(current_user),session:Session=Depends(db)):
        quiz=session.get(Quiz,quiz_id)
        if not quiz: raise HTTPException(404,'Quiz not found')
        lock_parent(quiz.deck_id,user_id,session)
        return create(quiz_snapshot(quiz_id,user_id,session),body,user_id,session)

    @app.get('/v1/notebooks/{notebook_id}/shares')
    def shares(notebook_id:str,user_id=Depends(current_user),session:Session=Depends(db)):
        owned(notebook_id,user_id,session)
        rows=session.scalars(select(LearningShare).where(LearningShare.notebook_id==notebook_id).order_by(LearningShare.created_at.desc()).limit(100))
        return [{'id':s.id,'title':s.title,'kind':s.snapshot['kind'],'expires_at':iso(s.expires_at),
                 'active':s.revoked_at is None and s.expires_at.replace(tzinfo=timezone.utc)>now()} for s in rows]

    @app.delete('/v1/shares/{share_id}',status_code=204)
    def revoke(share_id:str,user_id=Depends(current_user),session:Session=Depends(db)):
        share=session.get(LearningShare,share_id)
        if not share or share.owner_id!=user_id: raise HTTPException(404,'Shared content is unavailable')
        # Remove content, not only access, from a revoked snapshot.
        share.revoked_at=now();share.snapshot={'kind':share.snapshot['kind'],'items':[]}
        session.commit()
        from fastapi.responses import Response
        return Response(status_code=204)

    def shared(token,session):
        if not token or not re.fullmatch(r'[A-Za-z0-9_-]{43}',token):
            raise HTTPException(404,'Shared content is unavailable')
        share=session.scalar(select(LearningShare).where(LearningShare.token_hash==hashlib.sha256(token.encode()).hexdigest(),
            LearningShare.revoked_at.is_(None),LearningShare.expires_at>now()))
        if not share: raise HTTPException(404,'Shared content is unavailable')
        return share

    @app.middleware('http')
    async def private_cache(request,call_next):
        response=await call_next(request)
        if request.url.path.startswith('/v1/shared/'):
            response.headers['Cache-Control']='no-store'
            response.headers['X-Robots-Tag']='noindex, nofollow'
            response.headers['Referrer-Policy']='no-referrer'
        return response

    @app.get('/v1/shared/view')
    def view(x_knowlm_share:str|None=Header(default=None),session:Session=Depends(db)):
        share=shared(x_knowlm_share,session)
        snapshot=share.snapshot
        items=snapshot['items'] if snapshot['kind']=='cards' else [{'prompt':q['prompt'],'choices':q['choices']} for q in snapshot['items']]
        return {'title':share.title,'kind':snapshot['kind'],'items':items,'expires_at':iso(share.expires_at),
                'notice':'Unlisted owner-published copy. Private citations removed; not fact-checked.'}

    @app.post('/v1/shared/import', status_code=201)
    def import_cards(body:ImportInput,x_knowlm_share:str|None=Header(default=None),
                     user_id=Depends(current_user),session:Session=Depends(db)):
        if not body.consent: raise HTTPException(422,'Explicit import consent is required')
        if not x_knowlm_share or not re.fullmatch(r'[A-Za-z0-9_-]{43}',x_knowlm_share):
            raise HTTPException(404,'Shared content is unavailable')
        token_hash=hashlib.sha256(x_knowlm_share.encode()).hexdigest()
        # Serialize idempotency and notebook quota for this importer.
        session.execute(update(User).where(User.id==user_id).values(username=User.username))
        previous=session.scalar(select(ShareImport).where(ShareImport.user_id==user_id,ShareImport.request_id==str(body.request_id)))
        if previous:
            if previous.token_hash!=token_hash: raise HTTPException(409,'Import request ID already used')
            return {'notebook_id':previous.notebook_id,'deck_id':previous.deck_id}
        share=shared(x_knowlm_share,session)
        if share.snapshot['kind']!='cards': raise HTTPException(422,'Only shared cards can be imported')
        # Lock against revocation/deletion; read again after acquiring the lock.
        session.execute(update(LearningShare).where(LearningShare.id==share.id).values(title=LearningShare.title))
        session.expire_all()
        share=shared(x_knowlm_share,session)
        from knowlm.limits import Limits, quota_notebook
        quota_notebook(session,user_id,Limits.from_env())
        notebook=Notebook(owner_id=user_id,title=('نسخة مشتركة · '+share.title)[:200])
        session.add(notebook);session.flush()
        deck=Deck(notebook_id=notebook.id,title=share.title)
        session.add(deck);session.flush()
        for item in share.snapshot['items']:
            session.add(Card(deck_id=deck.id,front=item['front'],back=item['back'],origin='shared',reference=None))
        session.add(ShareImport(user_id=user_id,notebook_id=notebook.id,deck_id=deck.id,
                                request_id=str(body.request_id),token_hash=token_hash))
        session.commit()
        return {'notebook_id':notebook.id,'deck_id':deck.id}

    @app.post('/v1/shared/report', status_code=202)
    def report(body:ReportInput,x_knowlm_share:str|None=Header(default=None),
               user_id=Depends(current_user),session:Session=Depends(db)):
        session.execute(update(User).where(User.id==user_id).values(username=User.username))
        share=shared(x_knowlm_share,session)
        previous=session.scalar(select(ShareReport).where(ShareReport.reporter_id==user_id,ShareReport.share_id==share.id))
        if not previous:
            pending=session.scalar(select(func.count()).select_from(ShareReport).where(ShareReport.reporter_id==user_id,ShareReport.status=='pending'))
            if pending>=20: raise HTTPException(409,'Pending report quota reached')
            session.add(ShareReport(reporter_id=user_id,share_id=share.id,reason=body.reason))
            session.commit()
        return {'status':'received'}

    @app.post('/v1/shared/grade')
    def grade(body:SharedAnswers,x_knowlm_share:str|None=Header(default=None),session:Session=Depends(db)):
        share=shared(x_knowlm_share,session)
        if share.snapshot['kind']!='quiz': raise HTTPException(422,'Shared content is not a quiz')
        questions=share.snapshot['items']
        if len(body.answers)!=len(questions) or any(not 0<=answer<len(q['choices']) for answer,q in zip(body.answers,questions)):
            raise HTTPException(422,'Answer every quiz question with a valid choice')
        results=[{'correct':answer==q['correct_index'],'correct_index':q['correct_index'],'explanation':q['explanation']}
                 for answer,q in zip(body.answers,questions)]
        return {'correct':sum(q['correct'] for q in results),'total':len(results),'questions':results}
