"""Notebook-shared 25/5 timer; persisted deadlines, no audio/video transport."""
from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import Depends, HTTPException, Response
from pydantic import BaseModel, ConfigDict, Field, StrictInt
from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, Boolean, update
from sqlalchemy.orm import Mapped, Session, mapped_column
from knowlm.main import Base, Notebook
from knowlm.collaboration import access


def now():
    return datetime.now(timezone.utc)


class FocusTimer(Base):
    __tablename__ = 'notebook_focus_timers'
    notebook_id: Mapped[str] = mapped_column(ForeignKey('notebooks.id'), primary_key=True)
    phase: Mapped[str] = mapped_column(String(10), default='work')
    version: Mapped[int] = mapped_column(Integer, default=1)
    running: Mapped[bool] = mapped_column(Boolean, default=False)
    remaining_seconds: Mapped[float] = mapped_column(Float, default=1500)
    ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class TimerAction(BaseModel):
    model_config = ConfigDict(extra='forbid')
    action: Literal['start', 'pause', 'reset', 'next']
    version: StrictInt = Field(ge=0)


def duration(phase):
    return 1500 if phase == 'work' else 300


def remaining(row, at):
    if row.running and row.ends_at:
        return max(0, (row.ends_at.replace(tzinfo=timezone.utc) - at).total_seconds())
    return row.remaining_seconds


def snapshot(row, can_control, at):
    left = remaining(row, at) if row else 1500
    return {'version': row.version if row else 0, 'phase': row.phase if row else 'work',
            'running': bool(row and row.running and left > 0), 'remaining_seconds': left,
            'finished': left <= 0, 'server_now': at.isoformat(),
            'ends_at': row.ends_at.replace(tzinfo=timezone.utc).isoformat() if row and row.ends_at else None,
            'can_control': can_control}


def register_pomodoro(app, db, current_user):
    def permission(notebook_id, user_id, session, write=False):
        notebook = access(notebook_id, user_id, session, write=write)
        if notebook.owner_id == user_id:
            return True
        from knowlm.collaboration import Membership
        member = session.get(Membership, (notebook_id, user_id))
        return bool(member and member.role == 'editor')

    @app.get('/v1/notebooks/{notebook_id}/pomodoro')
    def get(notebook_id: str, response: Response, user_id=Depends(current_user), session: Session=Depends(db)):
        can_control = permission(notebook_id, user_id, session)
        response.headers['Cache-Control'] = 'no-store'
        return snapshot(session.get(FocusTimer, notebook_id), can_control, now())

    @app.post('/v1/notebooks/{notebook_id}/pomodoro')
    def change(notebook_id: str, body: TimerAction, response: Response, user_id=Depends(current_user), session: Session=Depends(db)):
        session.execute(update(Notebook).where(Notebook.id == notebook_id).values(title=Notebook.title))
        session.expire_all()
        permission(notebook_id, user_id, session, write=True)
        row = session.get(FocusTimer, notebook_id)
        if body.version != (row.version if row else 0):
            raise HTTPException(409, 'Timer changed; refresh and try again')
        at = now()
        if not row:
            row = FocusTimer(notebook_id=notebook_id, phase='work', version=0, running=False, remaining_seconds=1500)
            session.add(row)
        left = remaining(row, at)
        if body.action == 'start':
            if left <= 0:
                raise HTTPException(409, 'Reset or advance the finished timer')
            if row.running:
                raise HTTPException(409, 'Timer is already running')
            row.running = True
            row.ends_at = at + timedelta(seconds=left)
        elif body.action == 'pause':
            if not row.running or left <= 0:
                raise HTTPException(409, 'Timer is not running')
            row.remaining_seconds = left
            row.running = False
            row.ends_at = None
        elif body.action == 'reset':
            row.remaining_seconds = duration(row.phase)
            row.running = False
            row.ends_at = None
        else:
            if left > 0:
                raise HTTPException(409, 'Finish the current phase before advancing')
            row.phase = 'break' if row.phase == 'work' else 'work'
            row.remaining_seconds = duration(row.phase)
            row.running = False
            row.ends_at = None
        row.version += 1
        session.commit()
        response.headers['Cache-Control'] = 'no-store'
        return snapshot(row, True, now())
