"""Explicit public learning posts; never a public notebook or share capability."""
from datetime import datetime, timezone
from typing import Literal

from fastapi import Depends, HTTPException, Query
from fastapi.security import HTTPBearer
from pydantic import BaseModel, ConfigDict, Field, StrictBool
from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, delete, func, select, update
from sqlalchemy.orm import Mapped, Session, mapped_column

from knowlm.main import Base, Notebook, User, uid
from knowlm.sharing import LearningShare, ReportInput, ShareReport, SharedAnswers, fingerprint, now

COUNTRIES={'EG':'مصر','SA':'السعودية','AE':'الإمارات','JO':'الأردن','PS':'فلسطين','LB':'لبنان','SY':'سوريا','IQ':'العراق','KW':'الكويت','QA':'قطر','BH':'البحرين','OM':'عُمان','MA':'المغرب','DZ':'الجزائر','TN':'تونس','OTHER':'أخرى'}
STAGES={'primary':'ابتدائي','middle':'إعدادي/متوسط','secondary':'ثانوي','university':'جامعي','general':'عام'}
SUBJECTS={'arabic':'العربية','english':'الإنجليزية','math':'الرياضيات','biology':'الأحياء','physics':'الفيزياء','chemistry':'الكيمياء','history':'التاريخ','geography':'الجغرافيا','computing':'الحاسوب','other':'أخرى'}


class CommunityPost(Base):
    __tablename__='community_posts'
    id: Mapped[str]=mapped_column(String(36),primary_key=True,default=uid)
    share_id: Mapped[str]=mapped_column(ForeignKey('learning_shares.id'),unique=True)
    country: Mapped[str]=mapped_column(String(10),index=True)
    stage: Mapped[str]=mapped_column(String(20),index=True)
    subject: Mapped[str]=mapped_column(String(20),index=True)
    curriculum: Mapped[str]=mapped_column(String(100))
    created_at: Mapped[datetime]=mapped_column(DateTime(timezone=True),default=now,index=True)


class PostComment(Base):
    __tablename__='community_comments'
    id: Mapped[int]=mapped_column(Integer,primary_key=True,autoincrement=True)
    post_id: Mapped[str]=mapped_column(ForeignKey('community_posts.id'),index=True)
    user_id: Mapped[str]=mapped_column(ForeignKey('users.id'),index=True)
    text: Mapped[str]=mapped_column(Text)
    created_at: Mapped[datetime]=mapped_column(DateTime(timezone=True),default=now)


class SavedPost(Base):
    __tablename__='community_saves'
    user_id: Mapped[str]=mapped_column(ForeignKey('users.id'),primary_key=True)
    post_id: Mapped[str]=mapped_column(ForeignKey('community_posts.id'),primary_key=True)


class Follow(Base):
    __tablename__='community_follows'
    follower_id: Mapped[str]=mapped_column(ForeignKey('users.id'),primary_key=True)
    publisher_id: Mapped[str]=mapped_column(ForeignKey('users.id'),primary_key=True)


class UserBlock(Base):
    __tablename__='community_blocks'
    blocker_id: Mapped[str]=mapped_column(ForeignKey('users.id'),primary_key=True)
    blocked_id: Mapped[str]=mapped_column(ForeignKey('users.id'),primary_key=True)


class PublishInput(BaseModel):
    model_config=ConfigDict(extra='forbid')
    share_id: str=Field(min_length=36,max_length=36)
    preview_hash: str=Field(pattern=r'^[a-f0-9]{64}$')
    country: str=Field(max_length=10)
    stage: str=Field(max_length=20)
    subject: str=Field(max_length=20)
    curriculum: str=Field(min_length=1,max_length=100,pattern=r'\S')
    consent: StrictBool


class CommentInput(BaseModel):
    model_config=ConfigDict(extra='forbid')
    text: str=Field(min_length=1,max_length=1000,pattern=r'\S')
    consent: StrictBool


def erase_posts(session,ids):
    for model in (PostComment,SavedPost):
        session.execute(delete(model).where(model.post_id.in_(ids)).execution_options(synchronize_session=False))
    session.execute(delete(CommunityPost).where(CommunityPost.id.in_(ids)).execution_options(synchronize_session=False))


def register_community(app,db,current_user,owned):
    bearer=HTTPBearer(auto_error=False)
    def optional_user(auth=Depends(bearer),session:Session=Depends(db)):
        return current_user(auth,session) if auth else None

    def hidden(user_id,session):
        if not user_id:return set()
        pairs=session.execute(select(UserBlock).where((UserBlock.blocker_id==user_id)|(UserBlock.blocked_id==user_id))).scalars()
        return {b.blocked_id if b.blocker_id==user_id else b.blocker_id for b in pairs}

    def query(user_id,session):
        statement=select(CommunityPost,LearningShare,User).join(LearningShare,CommunityPost.share_id==LearningShare.id).join(User,User.id==LearningShare.owner_id).where(LearningShare.revoked_at.is_(None),LearningShare.expires_at>now())
        blocked=hidden(user_id,session)
        if blocked:statement=statement.where(User.id.not_in(blocked))
        return statement

    def post(post_id,user_id,session):
        row=session.execute(query(user_id,session).where(CommunityPost.id==post_id)).first()
        if not row:raise HTTPException(404,'Public post unavailable')
        return row

    def public(row):
        p,s,u=row
        return {'id':p.id,'title':s.title,'publisher':{'id':u.id,'username':u.username},'kind':s.snapshot['kind'],
                'country':p.country,'stage':p.stage,'subject':p.subject,'curriculum':p.curriculum,
                'created_at':p.created_at.replace(tzinfo=timezone.utc).isoformat(),'expires_at':s.expires_at.replace(tzinfo=timezone.utc).isoformat(),
                'notice':'Owner-published, not fact-checked; private source references removed. Curriculum label is self-declared.'}

    def lock_user(user_id,session):
        session.execute(update(User).where(User.id==user_id).values(username=User.username))

    @app.get('/v1/community/catalog')
    def catalog():return {'countries':COUNTRIES,'stages':STAGES,'subjects':SUBJECTS}

    @app.get('/v1/community/feed')
    def feed(country:str|None=Query(None,max_length=10),stage:str|None=Query(None,max_length=20),subject:str|None=Query(None,max_length=20),
             curriculum:str|None=Query(None,max_length=100),publisher:str|None=Query(None,max_length=36),
             saved:bool=False,following:bool=False,offset:int=Query(0,ge=0,le=10000),user_id=Depends(optional_user),session:Session=Depends(db)):
        if (saved or following) and not user_id:raise HTTPException(401,'Authentication required')
        statement=query(user_id,session)
        for column,value in [(CommunityPost.country,country),(CommunityPost.stage,stage),(CommunityPost.subject,subject),(CommunityPost.curriculum,curriculum),(User.id,publisher)]:
            if value is not None:statement=statement.where(column==value)
        if saved:statement=statement.where(CommunityPost.id.in_(select(SavedPost.post_id).where(SavedPost.user_id==user_id)))
        if following:statement=statement.where(User.id.in_(select(Follow.publisher_id).where(Follow.follower_id==user_id)))
        rows=session.execute(statement.order_by(CommunityPost.created_at.desc(),CommunityPost.id).offset(offset).limit(21)).all()
        return {'posts':[public(row) for row in rows[:20]],'next_offset':offset+20 if len(rows)>20 else None}

    @app.get('/v1/community/me')
    def activity(user_id=Depends(current_user),session:Session=Depends(db)):
        blocks=session.execute(select(UserBlock,User.username).join(User,User.id==UserBlock.blocked_id).where(UserBlock.blocker_id==user_id))
        return {'saved':list(session.scalars(select(SavedPost.post_id).where(SavedPost.user_id==user_id))),
                'following':list(session.scalars(select(Follow.publisher_id).where(Follow.follower_id==user_id))),
                'blocked':[{'id':b.blocked_id,'username':name} for b,name in blocks]}

    @app.delete('/v1/community/me/{collection}',status_code=204)
    def clear_activity(collection:Literal['saves','follows'],user_id=Depends(current_user),session:Session=Depends(db)):
        statement=delete(SavedPost).where(SavedPost.user_id==user_id) if collection=='saves' else delete(Follow).where(Follow.follower_id==user_id)
        session.execute(statement);session.commit()
        from fastapi.responses import Response
        return Response(status_code=204)

    @app.get('/v1/community/publishers/{publisher_id}')
    def profile(publisher_id:str,user_id=Depends(optional_user),session:Session=Depends(db)):
        rows=session.execute(query(user_id,session).where(User.id==publisher_id)).all()
        if not rows:raise HTTPException(404,'Public post unavailable')
        return {'id':publisher_id,'username':rows[0][2].username,'active_posts':len(rows),'notice':'Publication count is not a quality or expertise score.'}

    @app.get('/v1/shares/{share_id}/public-preview')
    def preview(share_id:str,user_id=Depends(current_user),session:Session=Depends(db)):
        share=session.get(LearningShare,share_id)
        if not share or share.owner_id!=user_id or share.revoked_at or share.expires_at.replace(tzinfo=timezone.utc)<=now():raise HTTPException(404,'Shared content is unavailable')
        return {'title':share.title,'snapshot':share.snapshot,'preview_hash':fingerprint(share.snapshot)}

    @app.post('/v1/community/posts',status_code=201)
    def publish(body:PublishInput,user_id=Depends(current_user),session:Session=Depends(db)):
        if not body.consent:raise HTTPException(422,'Explicit public publishing consent is required')
        if body.country not in COUNTRIES or body.stage not in STAGES or body.subject not in SUBJECTS:raise HTTPException(422,'Invalid curriculum classification')
        share=session.get(LearningShare,body.share_id)
        if not share or share.owner_id!=user_id:raise HTTPException(404,'Shared content is unavailable')
        session.execute(update(Notebook).where(Notebook.id==share.notebook_id).values(title=Notebook.title));session.expire_all()
        share=session.get(LearningShare,body.share_id)
        if not share or share.revoked_at or share.expires_at.replace(tzinfo=timezone.utc)<=now():raise HTTPException(404,'Shared content is unavailable')
        owned(share.notebook_id,user_id,session)
        if body.preview_hash!=fingerprint(share.snapshot):raise HTTPException(409,'Content changed since sharing preview')
        existing=session.scalar(select(CommunityPost).where(CommunityPost.share_id==share.id))
        if existing:
            if (existing.country,existing.stage,existing.subject,existing.curriculum)!=(body.country,body.stage,body.subject,body.curriculum.strip()):raise HTTPException(409,'Unpublish before changing classification')
            return public((existing,share,session.get(User,user_id)))
        row=CommunityPost(share_id=share.id,country=body.country,stage=body.stage,subject=body.subject,curriculum=body.curriculum.strip())
        session.add(row);session.commit()
        return public((row,share,session.get(User,user_id)))

    @app.get('/v1/community/posts/{post_id}')
    def view(post_id:str,user_id=Depends(optional_user),session:Session=Depends(db)):
        row=post(post_id,user_id,session);snapshot=row[1].snapshot
        items=snapshot['items'] if snapshot['kind']=='cards' else [{'prompt':q['prompt'],'choices':q['choices']} for q in snapshot['items']]
        return {**public(row),'items':items}

    @app.post('/v1/community/posts/{post_id}/grade')
    def grade(post_id:str,body:SharedAnswers,user_id=Depends(optional_user),session:Session=Depends(db)):
        share=post(post_id,user_id,session)[1]
        if share.snapshot['kind']!='quiz':raise HTTPException(422,'Shared content is not a quiz')
        questions=share.snapshot['items']
        if len(body.answers)!=len(questions) or any(not 0<=a<len(q['choices']) for a,q in zip(body.answers,questions)):raise HTTPException(422,'Answer every quiz question with a valid choice')
        results=[{'correct':a==q['correct_index'],'correct_index':q['correct_index'],'explanation':q['explanation']} for a,q in zip(body.answers,questions)]
        return {'correct':sum(r['correct'] for r in results),'total':len(results),'questions':results}

    @app.delete('/v1/community/posts/{post_id}',status_code=204)
    def unpublish(post_id:str,user_id=Depends(current_user),session:Session=Depends(db)):
        row=post(post_id,user_id,session)
        if row[1].owner_id!=user_id:raise HTTPException(404,'Public post unavailable')
        session.execute(update(Notebook).where(Notebook.id==row[1].notebook_id).values(title=Notebook.title))
        erase_posts(session,[post_id]);session.commit()
        from fastapi.responses import Response
        return Response(status_code=204)

    @app.put('/v1/community/posts/{post_id}/save',status_code=204)
    def save(post_id:str,user_id=Depends(current_user),session:Session=Depends(db)):
        lock_user(user_id,session);post(post_id,user_id,session)
        if not session.get(SavedPost,(user_id,post_id)):
            count=session.scalar(select(func.count()).select_from(SavedPost).where(SavedPost.user_id==user_id))
            if count>=200:raise HTTPException(409,'Community quota reached')
            session.add(SavedPost(user_id=user_id,post_id=post_id));session.commit()
        from fastapi.responses import Response
        return Response(status_code=204)

    @app.delete('/v1/community/posts/{post_id}/save',status_code=204)
    def unsave(post_id:str,user_id=Depends(current_user),session:Session=Depends(db)):
        session.execute(delete(SavedPost).where(SavedPost.user_id==user_id,SavedPost.post_id==post_id));session.commit()
        from fastapi.responses import Response
        return Response(status_code=204)

    @app.get('/v1/community/posts/{post_id}/comments')
    def comments(post_id:str,user_id=Depends(optional_user),session:Session=Depends(db)):
        post(post_id,user_id,session)
        statement=select(PostComment,User.username).join(User,User.id==PostComment.user_id).where(PostComment.post_id==post_id)
        blocked=hidden(user_id,session)
        if blocked:statement=statement.where(PostComment.user_id.not_in(blocked))
        return [{'id':c.id,'user_id':c.user_id,'username':name,'text':c.text} for c,name in session.execute(statement.order_by(PostComment.id).limit(100))]

    @app.post('/v1/community/posts/{post_id}/comments',status_code=201)
    def comment(post_id:str,body:CommentInput,user_id=Depends(current_user),session:Session=Depends(db)):
        if not body.consent:raise HTTPException(422,'Explicit public publishing consent is required')
        row=post(post_id,user_id,session)
        session.execute(update(LearningShare).where(LearningShare.id==row[1].id).values(title=LearningShare.title))
        if session.scalar(select(func.count()).select_from(PostComment).where(PostComment.post_id==post_id))>=100:raise HTTPException(409,'Community quota reached')
        item=PostComment(post_id=post_id,user_id=user_id,text=body.text.strip());session.add(item);session.commit()
        return {'id':item.id,'user_id':user_id,'username':session.get(User,user_id).username,'text':item.text}

    @app.delete('/v1/community/posts/{post_id}/comments/{comment_id}',status_code=204)
    def remove_comment(post_id:str,comment_id:int,user_id=Depends(current_user),session:Session=Depends(db)):
        row=post(post_id,user_id,session);item=session.get(PostComment,comment_id)
        if not item or item.post_id!=post_id or user_id not in (item.user_id,row[1].owner_id):raise HTTPException(404,'Public comment unavailable')
        session.delete(item);session.commit()
        from fastapi.responses import Response
        return Response(status_code=204)

    @app.post('/v1/community/posts/{post_id}/report',status_code=202)
    def report(post_id:str,body:ReportInput,user_id=Depends(current_user),session:Session=Depends(db)):
        lock_user(user_id,session);share=post(post_id,user_id,session)[1]
        previous=session.scalar(select(ShareReport).where(ShareReport.reporter_id==user_id,ShareReport.share_id==share.id))
        if not previous:
            if session.scalar(select(func.count()).select_from(ShareReport).where(ShareReport.reporter_id==user_id,ShareReport.status=='pending'))>=20:raise HTTPException(409,'Pending report quota reached')
            session.add(ShareReport(reporter_id=user_id,share_id=share.id,reason=body.reason));session.commit()
        return {'status':'received'}

    @app.put('/v1/community/publishers/{publisher_id}/follow',status_code=204)
    def follow(publisher_id:str,user_id=Depends(current_user),session:Session=Depends(db)):
        lock_user(user_id,session)
        if publisher_id==user_id:raise HTTPException(422,'Cannot follow yourself')
        if not session.execute(query(user_id,session).where(User.id==publisher_id).limit(1)).first():raise HTTPException(404,'Public post unavailable')
        if not session.get(Follow,(user_id,publisher_id)):
            if session.scalar(select(func.count()).select_from(Follow).where(Follow.follower_id==user_id))>=200:raise HTTPException(409,'Community quota reached')
            session.add(Follow(follower_id=user_id,publisher_id=publisher_id));session.commit()
        from fastapi.responses import Response
        return Response(status_code=204)

    @app.delete('/v1/community/publishers/{publisher_id}/follow',status_code=204)
    def unfollow(publisher_id:str,user_id=Depends(current_user),session:Session=Depends(db)):
        session.execute(delete(Follow).where(Follow.follower_id==user_id,Follow.publisher_id==publisher_id));session.commit()
        from fastapi.responses import Response
        return Response(status_code=204)

    @app.put('/v1/community/publishers/{publisher_id}/block',status_code=204)
    def block(publisher_id:str,user_id=Depends(current_user),session:Session=Depends(db)):
        lock_user(user_id,session)
        if user_id==publisher_id:raise HTTPException(422,'Cannot block yourself')
        # An existing public post or public comment is required; no arbitrary account enumeration.
        visible=session.execute(query(user_id,session).where(User.id==publisher_id).limit(1)).first()
        commented=session.scalar(select(PostComment.id).join(CommunityPost,CommunityPost.id==PostComment.post_id).join(LearningShare,LearningShare.id==CommunityPost.share_id).where(PostComment.user_id==publisher_id,LearningShare.revoked_at.is_(None),LearningShare.expires_at>now()).limit(1))
        if not visible and not commented and not session.get(UserBlock,(user_id,publisher_id)):raise HTTPException(404,'Public post unavailable')
        if not session.get(UserBlock,(user_id,publisher_id)):
            if session.scalar(select(func.count()).select_from(UserBlock).where(UserBlock.blocker_id==user_id))>=200:raise HTTPException(409,'Community quota reached')
            session.add(UserBlock(blocker_id=user_id,blocked_id=publisher_id))
        session.execute(delete(Follow).where(((Follow.follower_id==user_id)&(Follow.publisher_id==publisher_id))|((Follow.follower_id==publisher_id)&(Follow.publisher_id==user_id))))
        session.commit()
        from fastapi.responses import Response
        return Response(status_code=204)

    @app.delete('/v1/community/publishers/{publisher_id}/block',status_code=204)
    def unblock(publisher_id:str,user_id=Depends(current_user),session:Session=Depends(db)):
        session.execute(delete(UserBlock).where(UserBlock.blocker_id==user_id,UserBlock.blocked_id==publisher_id));session.commit()
        from fastapi.responses import Response
        return Response(status_code=204)

    @app.middleware('http')
    async def no_community_cache(request,call_next):
        response=await call_next(request)
        if request.url.path.startswith('/v1/community/') or request.url.path.endswith('/public-preview'):
            response.headers['Cache-Control']='no-store';response.headers['Vary']='Authorization'
        return response
