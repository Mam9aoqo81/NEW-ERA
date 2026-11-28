"""Opt-in two-person WebRTC signaling. Media never traverses this API."""
import base64
from datetime import datetime, timedelta, timezone
import hashlib
import hmac
import os
import re
import uuid
from typing import Literal

from fastapi import Depends, HTTPException, Query, Response
from pydantic import BaseModel, ConfigDict, Field, StrictBool, model_validator
from sqlalchemy import DateTime, ForeignKey, Integer, JSON, String, UniqueConstraint, delete, func, select, update
from sqlalchemy.orm import Mapped, Session, mapped_column
from knowlm.main import Base, Notebook, User
from knowlm.collaboration import access


def now():
    return datetime.now(timezone.utc)


class CallSession(Base):
    __tablename__ = 'notebook_call_sessions'
    __table_args__ = (UniqueConstraint('notebook_id', 'user_id', name='uq_call_member'),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    notebook_id: Mapped[str] = mapped_column(ForeignKey('notebooks.id'), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey('users.id'), index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)


class CallSignal(Base):
    __tablename__ = 'notebook_call_signals'
    __table_args__ = ({'sqlite_autoincrement': True},)
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    sender_id: Mapped[str] = mapped_column(ForeignKey('notebook_call_sessions.id'), index=True)
    target_id: Mapped[str] = mapped_column(ForeignKey('notebook_call_sessions.id'), index=True)
    kind: Mapped[str] = mapped_column(String(10))
    payload: Mapped[dict] = mapped_column(JSON)


def erase_calls(session, ids):
    # Materialize IDs: deleting children must not change a subquery's parent set.
    ids = list(ids)
    if not ids:
        return
    session.execute(delete(CallSignal).where(CallSignal.sender_id.in_(ids) | CallSignal.target_id.in_(ids)).execution_options(synchronize_session=False))
    session.execute(delete(CallSession).where(CallSession.id.in_(ids)).execution_options(synchronize_session=False))


def erase_member_calls(session, notebook_id, user_id):
    erase_calls(session, session.scalars(select(CallSession.id).where(CallSession.notebook_id == notebook_id, CallSession.user_id == user_id)))


def purge_expired(engine):
    with Session(engine) as session:
        erase_calls(session, session.scalars(select(CallSession.id).where(CallSession.expires_at <= now())))
        session.commit()


class JoinInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    request_id: uuid.UUID
    consent: StrictBool


class HeartbeatInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    after: int = Field(default=0, ge=0)


class IceCandidate(BaseModel):
    model_config = ConfigDict(extra='forbid')
    candidate: str = Field(max_length=4096)
    sdpMid: str | None = Field(default=None, max_length=256)
    sdpMLineIndex: int | None = Field(default=None, ge=0, le=32)
    usernameFragment: str | None = Field(default=None, max_length=256)


class SignalInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    target_id: uuid.UUID
    kind: Literal['offer', 'answer', 'ice']
    sdp: str | None = Field(default=None, min_length=1, max_length=64000)
    candidate: IceCandidate | None = None

    @model_validator(mode='after')
    def valid(self):
        if self.kind == 'ice':
            if self.candidate is None or self.sdp is not None:
                raise ValueError('ICE requires only a candidate')
        elif self.sdp is None or self.candidate is not None:
            raise ValueError('Description requires only SDP')
        return self


def register_calls(app, db, current_user):
    stun = os.getenv('KNOWLM_CALL_STUN_URL', '')
    turn = os.getenv('KNOWLM_CALL_TURN_URL', '')
    secret = os.getenv('KNOWLM_CALL_TURN_SECRET', '')
    relay = os.getenv('KNOWLM_CALL_RELAY_ONLY', '0') == '1'
    pattern = r'(?:stun|stuns|turn|turns):[a-zA-Z0-9.\-\[\]:]+(?:\?transport=(?:udp|tcp))?'
    if (stun and (not re.fullmatch(pattern, stun) or not stun.startswith(('stun:', 'stuns:')))) or (turn and (not re.fullmatch(pattern, turn) or not turn.startswith(('turn:', 'turns:')))):
        raise ValueError('Invalid operator ICE URL')
    if bool(turn) != bool(secret) or (relay and not turn):
        raise ValueError('TURN URL and shared secret required together; relay-only requires TURN')

    def lock(notebook_id, session):
        session.execute(update(Notebook).where(Notebook.id == notebook_id).values(title=Notebook.title))
        session.expire_all()

    def own(notebook_id, session_id, user_id, session):
        access(notebook_id, user_id, session)
        row = session.get(CallSession, session_id)
        if not row or row.notebook_id != notebook_id or row.user_id != user_id or row.expires_at.replace(tzinfo=timezone.utc) <= now():
            raise HTTPException(404, 'Call session unavailable')
        return row

    def config(user_id):
        servers = []
        if stun:
            servers.append({'urls': stun})
        if turn:
            username = str(int(now().timestamp()) + 3600) + ':' + user_id
            credential = base64.b64encode(hmac.new(secret.encode(), username.encode(), hashlib.sha1).digest()).decode()
            servers.append({'urls': turn, 'username': username, 'credential': credential})
        return {'iceServers': servers, 'iceTransportPolicy': 'relay' if relay else 'all', 'has_turn': bool(turn)}

    @app.get('/v1/notebooks/{notebook_id}/call/config')
    def get_config(notebook_id: str, response: Response, user_id=Depends(current_user), session: Session=Depends(db)):
        access(notebook_id, user_id, session)
        response.headers['Cache-Control'] = 'no-store'
        return config(user_id)

    @app.post('/v1/notebooks/{notebook_id}/call/sessions', status_code=201)
    def join(notebook_id: str, body: JoinInput, response: Response, user_id=Depends(current_user), session: Session=Depends(db)):
        if not body.consent:
            raise HTTPException(422, 'Explicit call consent required')
        lock(notebook_id, session)
        access(notebook_id, user_id, session)
        session.execute(update(User).where(User.id == user_id).values(username=User.username))
        session.expire_all()
        expired = list(session.scalars(select(CallSession.id).where(CallSession.expires_at <= now())))
        erase_calls(session, expired)
        existing = session.get(CallSession, str(body.request_id))
        if existing:
            if existing.notebook_id != notebook_id or existing.user_id != user_id:
                raise HTTPException(409, 'Call request ID unavailable')
            existing.expires_at = now() + timedelta(seconds=90)
            session.commit()
            response.headers['Cache-Control'] = 'no-store'
            return {'id': existing.id}
        if session.scalar(select(CallSession.id).where(CallSession.notebook_id == notebook_id, CallSession.user_id == user_id)):
            raise HTTPException(409, 'Already joined from another tab; leave or wait for expiry')
        if session.scalar(select(func.count()).select_from(CallSession).where(CallSession.notebook_id == notebook_id)) >= 2:
            raise HTTPException(409, 'Call room is full')
        if session.scalar(select(func.count()).select_from(CallSession).where(CallSession.user_id == user_id)) >= 3:
            raise HTTPException(409, 'Call session quota reached')
        row = CallSession(id=str(body.request_id), notebook_id=notebook_id, user_id=user_id, expires_at=now() + timedelta(seconds=90))
        session.add(row); session.commit()
        response.headers['Cache-Control'] = 'no-store'
        return {'id': row.id}

    @app.get('/v1/notebooks/{notebook_id}/call/sessions/{session_id}')
    def poll(notebook_id: str, session_id: str, response: Response, after: int=Query(0, ge=0), user_id=Depends(current_user), session: Session=Depends(db)):
        own(notebook_id, session_id, user_id, session)
        peers = session.execute(select(CallSession, User.username).join(User, User.id == CallSession.user_id).where(CallSession.notebook_id == notebook_id, CallSession.id != session_id, CallSession.expires_at > now())).all()
        signals = list(session.scalars(select(CallSignal).where(CallSignal.target_id == session_id, CallSignal.id > after).order_by(CallSignal.id).limit(100)))
        response.headers['Cache-Control'] = 'no-store'
        return {'peers': [{'id': row.id, 'username': name} for row, name in peers], 'signals': [{'id': s.id, 'sender_id': s.sender_id, 'kind': s.kind, **s.payload} for s in signals], 'next_after': signals[-1].id if signals else after}

    @app.post('/v1/notebooks/{notebook_id}/call/sessions/{session_id}/heartbeat', status_code=204)
    def heartbeat(notebook_id: str, session_id: str, body: HeartbeatInput, user_id=Depends(current_user), session: Session=Depends(db)):
        lock(notebook_id, session)
        row = own(notebook_id, session_id, user_id, session)
        row.expires_at = now() + timedelta(seconds=90)
        session.execute(delete(CallSignal).where(CallSignal.target_id == session_id, CallSignal.id <= body.after))
        session.commit()
        return Response(status_code=204, headers={'Cache-Control': 'no-store'})

    @app.post('/v1/notebooks/{notebook_id}/call/sessions/{session_id}/signals', status_code=204)
    def signal(notebook_id: str, session_id: str, body: SignalInput, user_id=Depends(current_user), session: Session=Depends(db)):
        lock(notebook_id, session)
        own(notebook_id, session_id, user_id, session)
        target = session.get(CallSession, str(body.target_id))
        if not target or target.id == session_id or target.notebook_id != notebook_id or target.expires_at.replace(tzinfo=timezone.utc) <= now():
            raise HTTPException(404, 'Call peer unavailable')
        access(notebook_id, target.user_id, session)
        if session.scalar(select(func.count()).select_from(CallSignal).where(CallSignal.target_id == target.id)) >= 200:
            raise HTTPException(409, 'Call signaling quota reached')
        payload = {'candidate': body.candidate.model_dump()} if body.kind == 'ice' else {'sdp': body.sdp}
        session.add(CallSignal(sender_id=session_id, target_id=target.id, kind=body.kind, payload=payload))
        session.commit()
        return Response(status_code=204, headers={'Cache-Control': 'no-store'})

    @app.delete('/v1/notebooks/{notebook_id}/call/sessions/{session_id}', status_code=204)
    def leave(notebook_id: str, session_id: str, user_id=Depends(current_user), session: Session=Depends(db)):
        lock(notebook_id, session)
        row = session.get(CallSession, session_id)
        if row and (row.user_id != user_id or row.notebook_id != notebook_id):
            raise HTTPException(404, 'Call session unavailable')
        erase_calls(session, [session_id] if row else [])
        session.commit()
        return Response(status_code=204, headers={'Cache-Control': 'no-store'})
