"""Explicit notebook membership; public sharing is still owner-only.

Membership grants all notebook sources and shared study artifacts, NEVER another
member's private chat, review schedule or quiz attempts. Room publishing is opt-in.
"""
from datetime import datetime, timedelta, timezone
import hashlib
import re
import secrets
import uuid
from typing import Literal

from fastapi import Depends, Header, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, StrictBool
from sqlalchemy import DateTime, ForeignKey, Integer, JSON, String, UniqueConstraint, delete, func, select, update
from sqlalchemy.orm import Mapped, Session, mapped_column

from knowlm.main import Base, ChatTurn, Notebook, User, uid


def now(): return datetime.now(timezone.utc)
def iso(value): return value.replace(tzinfo=timezone.utc).isoformat()


class Membership(Base):
    __tablename__='notebook_memberships'
    notebook_id: Mapped[str]=mapped_column(ForeignKey('notebooks.id'),primary_key=True)
    user_id: Mapped[str]=mapped_column(ForeignKey('users.id'),primary_key=True,index=True)
    role: Mapped[str]=mapped_column(String(10))


class Invitation(Base):
    __tablename__='notebook_invitations'
    id: Mapped[str]=mapped_column(String(36),primary_key=True,default=uid)
    notebook_id: Mapped[str]=mapped_column(ForeignKey('notebooks.id'),index=True)
    username: Mapped[str]=mapped_column(String(40))
    role: Mapped[str]=mapped_column(String(10))
    token_hash: Mapped[str]=mapped_column(String(64),unique=True)
    expires_at: Mapped[datetime]=mapped_column(DateTime(timezone=True))
    used_at: Mapped[datetime|None]=mapped_column(DateTime(timezone=True))


class RoomMessage(Base):
    __tablename__='notebook_room_messages'
    __table_args__=(UniqueConstraint('user_id','request_id',name='uq_room_request'),{'sqlite_autoincrement':True})
    id: Mapped[int]=mapped_column(Integer,primary_key=True,autoincrement=True)
    notebook_id: Mapped[str]=mapped_column(ForeignKey('notebooks.id'),index=True)
    user_id: Mapped[str]=mapped_column(ForeignKey('users.id'),index=True)
    request_id: Mapped[str]=mapped_column(String(36))
    request_hash: Mapped[str]=mapped_column(String(64))
    content: Mapped[dict]=mapped_column(JSON)
    created_at: Mapped[datetime]=mapped_column(DateTime(timezone=True),default=now)


class InviteInput(BaseModel):
    model_config=ConfigDict(extra='forbid')
    username: str=Field(min_length=3,max_length=40,pattern=r'^[a-zA-Z0-9_]+$')
    role: Literal['viewer','editor']='viewer'
    consent: StrictBool


class RoleInput(BaseModel):
    model_config=ConfigDict(extra='forbid')
    role: Literal['viewer','editor']


class AcceptInput(BaseModel):
    model_config=ConfigDict(extra='forbid')
    consent: StrictBool


class MessageInput(BaseModel):
    model_config=ConfigDict(extra='forbid')
    request_id: uuid.UUID
    text: str=Field(default='',max_length=2000)
    turn_id: int|None=Field(default=None,ge=1)
    consent: StrictBool


def access(notebook_id,user_id,session,*,write=False):
    notebook=session.get(Notebook,notebook_id)
    if not notebook: raise HTTPException(404,'Notebook not found')
    if notebook.owner_id!=user_id:
        member=session.get(Membership,(notebook_id,user_id))
        if not member: raise HTTPException(404,'Notebook not found')
        if write and member.role!='editor': raise HTTPException(403,'Notebook is read only')
    return notebook


def register_collaboration(app,db,current_user,owned):
    def lock(notebook_id,session):
        session.execute(update(Notebook).where(Notebook.id==notebook_id).values(title=Notebook.title))
        session.expire_all()

    def invitation(token,user_id,session):
        if not token or not re.fullmatch(r'[A-Za-z0-9_-]{43}',token): raise HTTPException(404,'Invitation unavailable')
        row=session.scalar(select(Invitation).where(Invitation.token_hash==hashlib.sha256(token.encode()).hexdigest(),Invitation.expires_at>now(),Invitation.used_at.is_(None)))
        user=session.get(User,user_id)
        if not row or not user or row.username!=user.username: raise HTTPException(404,'Invitation unavailable')
        return row

    @app.post('/v1/notebooks/{notebook_id}/invitations',status_code=201)
    def invite(notebook_id:str,body:InviteInput,user_id=Depends(current_user),session:Session=Depends(db)):
        lock(notebook_id,session);notebook=owned(notebook_id,user_id,session)
        if not body.consent: raise HTTPException(422,'Explicit collaboration consent is required')
        username=body.username.lower()
        if username==session.get(User,user_id).username: raise HTTPException(422,'Cannot invite notebook owner')
        pending=session.scalar(select(func.count()).select_from(Invitation).where(Invitation.notebook_id==notebook_id,Invitation.expires_at>now(),Invitation.used_at.is_(None)))
        if pending>=20: raise HTTPException(409,'Invitation quota reached')
        token=secrets.token_urlsafe(32)
        row=Invitation(notebook_id=notebook.id,username=username,role=body.role,token_hash=hashlib.sha256(token.encode()).hexdigest(),expires_at=now()+timedelta(days=7))
        session.add(row);session.commit()
        return {'id':row.id,'token':token,'expires_at':iso(row.expires_at)}

    @app.get('/v1/notebooks/{notebook_id}/collaboration')
    def settings(notebook_id:str,user_id=Depends(current_user),session:Session=Depends(db)):
        notebook=access(notebook_id,user_id,session)
        me=session.get(Membership,(notebook_id,user_id))
        result={'role':'owner' if notebook.owner_id==user_id else me.role}
        if notebook.owner_id==user_id:
            rows=session.execute(select(Membership,User.username).join(User,User.id==Membership.user_id).where(Membership.notebook_id==notebook_id))
            result['members']=[{'user_id':m.user_id,'username':name,'role':m.role} for m,name in rows]
            invites=session.scalars(select(Invitation).where(Invitation.notebook_id==notebook_id,Invitation.expires_at>now(),Invitation.used_at.is_(None)).order_by(Invitation.expires_at.desc()))
            result['invitations']=[{'id':i.id,'username':i.username,'role':i.role,'expires_at':iso(i.expires_at)} for i in invites]
        return result

    @app.delete('/v1/notebooks/{notebook_id}/invitations/{invite_id}',status_code=204)
    def cancel(notebook_id:str,invite_id:str,user_id=Depends(current_user),session:Session=Depends(db)):
        owned(notebook_id,user_id,session)
        session.execute(delete(Invitation).where(Invitation.id==invite_id,Invitation.notebook_id==notebook_id));session.commit()
        from fastapi.responses import Response
        return Response(status_code=204)

    @app.get('/v1/collaboration/invitation')
    def inspect(x_knowlm_invite:str|None=Header(default=None),user_id=Depends(current_user),session:Session=Depends(db)):
        row=invitation(x_knowlm_invite,user_id,session)
        notebook=session.get(Notebook,row.notebook_id)
        if not notebook: raise HTTPException(404,'Invitation unavailable')
        return {'title':notebook.title,'role':row.role,'expires_at':iso(row.expires_at)}

    @app.post('/v1/collaboration/accept')
    def accept(body:AcceptInput,x_knowlm_invite:str|None=Header(default=None),user_id=Depends(current_user),session:Session=Depends(db)):
        if not body.consent: raise HTTPException(422,'Explicit collaboration consent is required')
        row=invitation(x_knowlm_invite,user_id,session)
        nid=row.notebook_id
        lock(nid,session);row=invitation(x_knowlm_invite,user_id,session)
        if not session.get(Membership,(nid,user_id)):
            count=session.scalar(select(func.count()).select_from(Membership).where(Membership.notebook_id==nid))
            joined=session.scalar(select(func.count()).select_from(Membership).where(Membership.user_id==user_id))
            if count>=20 or joined>=20: raise HTTPException(409,'Membership quota reached')
            session.add(Membership(notebook_id=nid,user_id=user_id,role=row.role))
        # Existing membership is not silently upgraded by a different old invitation.
        row.used_at=now();session.commit()
        return {'notebook_id':nid}

    @app.patch('/v1/notebooks/{notebook_id}/members/{member_id}')
    def role(notebook_id:str,member_id:str,body:RoleInput,user_id=Depends(current_user),session:Session=Depends(db)):
        lock(notebook_id,session);owned(notebook_id,user_id,session)
        member=session.get(Membership,(notebook_id,member_id))
        if not member: raise HTTPException(404,'Member not found')
        member.role=body.role;session.commit();return {'role':member.role}

    @app.delete('/v1/notebooks/{notebook_id}/members/{member_id}',status_code=204)
    def remove(notebook_id:str,member_id:str,user_id=Depends(current_user),session:Session=Depends(db)):
        lock(notebook_id,session);owned(notebook_id,user_id,session)
        member=session.get(Membership,(notebook_id,member_id))
        if member:
            username=session.get(User,member_id).username
            session.execute(delete(Invitation).where(Invitation.notebook_id==notebook_id,Invitation.username==username))
            session.delete(member)
        session.commit()
        from fastapi.responses import Response
        return Response(status_code=204)

    @app.delete('/v1/notebooks/{notebook_id}/membership',status_code=204)
    def leave(notebook_id:str,user_id=Depends(current_user),session:Session=Depends(db)):
        lock(notebook_id,session)
        notebook=access(notebook_id,user_id,session)
        if notebook.owner_id==user_id: raise HTTPException(409,'Owner cannot leave notebook')
        session.execute(delete(Membership).where(Membership.notebook_id==notebook_id,Membership.user_id==user_id))
        username=session.get(User,user_id).username
        session.execute(delete(Invitation).where(Invitation.notebook_id==notebook_id,Invitation.username==username))
        session.commit()
        from fastapi.responses import Response
        return Response(status_code=204)

    def message_json(message,session):
        user=session.get(User,message.user_id)
        return {'id':message.id,'user_id':message.user_id,'username':user.username if user else 'حساب محذوف',
                'content':message.content,'created_at':iso(message.created_at)}

    @app.get('/v1/notebooks/{notebook_id}/room')
    def messages(notebook_id:str,after:int=Query(0,ge=0),limit:int=Query(100,ge=1,le=1000),user_id=Depends(current_user),session:Session=Depends(db)):
        access(notebook_id,user_id,session)
        rows=session.scalars(select(RoomMessage).where(RoomMessage.notebook_id==notebook_id,RoomMessage.id>after).order_by(RoomMessage.id).limit(limit)).all()
        return {'messages':[message_json(m,session) for m in rows],'next_after':rows[-1].id if rows else after}

    @app.post('/v1/notebooks/{notebook_id}/room',status_code=201)
    def post_message(notebook_id:str,body:MessageInput,user_id=Depends(current_user),session:Session=Depends(db)):
        lock(notebook_id,session);access(notebook_id,user_id,session)
        if not body.consent: raise HTTPException(422,'Explicit room publishing consent is required')
        fingerprint=hashlib.sha256(body.model_dump_json(exclude={'request_id'}).encode()).hexdigest()
        previous=session.scalar(select(RoomMessage).where(RoomMessage.user_id==user_id,RoomMessage.request_id==str(body.request_id)))
        if previous:
            if previous.notebook_id!=notebook_id or previous.request_hash!=fingerprint: raise HTTPException(409,'Room request ID already used')
            return message_json(previous,session)
        if not body.text.strip() and body.turn_id is None: raise HTTPException(422,'Room message is empty')
        content={'text':body.text.strip()}
        if body.turn_id is not None:
            turn=session.get(ChatTurn,body.turn_id)
            if not turn or turn.notebook_id!=notebook_id or turn.user_id!=user_id: raise HTTPException(404,'Answer not found')
            content['question']=turn.question;content['answer']=turn.answer
        count=session.scalar(select(func.count()).select_from(RoomMessage).where(RoomMessage.notebook_id==notebook_id))
        if count>=1000: raise HTTPException(409,'Room message quota reached')
        row=RoomMessage(notebook_id=notebook_id,user_id=user_id,request_id=str(body.request_id),request_hash=fingerprint,content=content)
        session.add(row);session.commit();return message_json(row,session)

    @app.delete('/v1/notebooks/{notebook_id}/room/{message_id}',status_code=204)
    def delete_message(notebook_id:str,message_id:int,user_id=Depends(current_user),session:Session=Depends(db)):
        notebook=access(notebook_id,user_id,session)
        message=session.get(RoomMessage,message_id)
        if not message or message.notebook_id!=notebook_id or user_id not in (message.user_id,notebook.owner_id): raise HTTPException(404,'Message not found')
        session.delete(message);session.commit()
        from fastapi.responses import Response
        return Response(status_code=204)

    @app.middleware('http')
    async def no_invitation_cache(request,call_next):
        response=await call_next(request)
        if request.url.path.startswith('/v1/collaboration/') or '/room' in request.url.path or '/collaboration' in request.url.path or '/invitations' in request.url.path:
            response.headers['Cache-Control']='no-store'
            response.headers['Referrer-Policy']='no-referrer'
        return response
