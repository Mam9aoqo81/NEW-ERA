"""Private per-student ink boards. Ink is not handwriting recognition."""
from fastapi import Depends, HTTPException, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import ForeignKey, Integer, JSON, String, select, update
from sqlalchemy.orm import Mapped, Session, mapped_column
from knowlm.main import Base, Notebook, Chunk, Source
from knowlm.learning import reference


class InkBoard(Base):
    __tablename__ = 'ink_boards'
    notebook_id: Mapped[str] = mapped_column(ForeignKey('notebooks.id'), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey('users.id'), primary_key=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    document: Mapped[dict] = mapped_column(JSON)


class Point(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)
    x: float = Field(ge=0, le=1000)
    y: float = Field(ge=0, le=600)


class Stroke(BaseModel):
    model_config = ConfigDict(extra='forbid')
    color: str = Field(pattern=r'^#[0-9a-fA-F]{6}$')
    width: int = Field(ge=1, le=12)
    points: list[Point] = Field(min_length=1, max_length=1000)


class BoardInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    version: int = Field(ge=0)
    strokes: list[Stroke] = Field(max_length=200)
    notes: str = Field(max_length=10000)
    chunk_ids: list[str] = Field(max_length=20)


def register_canvas(app, db, current_user, readable):
    def output(row, notebook_id, session):
        document = row.document if row else {'strokes': [], 'notes': '', 'chunk_ids': []}
        refs = []
        for chunk, source in session.execute(select(Chunk, Source).join(Source, Source.id == Chunk.source_id).where(Source.notebook_id == notebook_id, Chunk.id.in_(document['chunk_ids']))):
            refs.append(reference(notebook_id, source, chunk, chunk.text[:1000]))
        return {**document, 'version': row.version if row else 0, 'references': refs}

    @app.get('/v1/notebooks/{notebook_id}/canvas')
    def get(notebook_id: str, response: Response, user_id=Depends(current_user), session: Session=Depends(db)):
        response.headers["Cache-Control"] = "no-store"
        readable(notebook_id, user_id, session)
        return output(session.get(InkBoard, (notebook_id, user_id)), notebook_id, session)

    @app.put('/v1/notebooks/{notebook_id}/canvas')
    def put(notebook_id: str, body: BoardInput, user_id=Depends(current_user), session: Session=Depends(db)):
        # Serialize creation/update and notebook erasure; recheck access after locking.
        session.execute(update(Notebook).where(Notebook.id == notebook_id).values(title=Notebook.title))
        readable(notebook_id, user_id, session)
        row = session.get(InkBoard, (notebook_id, user_id), populate_existing=True)
        if body.version != (row.version if row else 0):
            raise HTTPException(409, 'Canvas changed; reload before saving')
        ids = list(dict.fromkeys(body.chunk_ids))
        found = list(session.scalars(select(Chunk.id).join(Source, Source.id == Chunk.source_id).where(Source.notebook_id == notebook_id, Chunk.id.in_(ids))))
        if set(found) != set(ids):
            raise HTTPException(422, 'Canvas references must belong to this notebook')
        document = {'strokes': [s.model_dump() for s in body.strokes], 'notes': body.notes, 'chunk_ids': ids}
        if row:
            row.document = document
            row.version += 1
        else:
            row = InkBoard(notebook_id=notebook_id, user_id=user_id, version=1, document=document)
            session.add(row)
        session.commit()
        return output(row, notebook_id, session)
