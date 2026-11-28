"""Private source-linked learning tools. Local generation is explicitly extractive.

SM-2 scheduling is deterministic, not an AI forgetting prediction. Quiz answers
are stored server-side and disclosed only in the scored attempt response.
"""
import hashlib
import json
import re
import secrets
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import Depends, HTTPException, Query
from pydantic import BaseModel, Field, StrictInt
from typing import Literal
from sqlalchemy import DateTime, ForeignKey, Integer, Float, JSON, String, Text, UniqueConstraint, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Mapped, Session, mapped_column

from knowlm.main import Base, Chunk, Source, uid


def now():
    return datetime.now(timezone.utc)


def iso(date):
    return date.replace(tzinfo=timezone.utc).isoformat() if date else None


class Deck(Base):
    __tablename__ = 'flashcard_decks'
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    notebook_id: Mapped[str] = mapped_column(ForeignKey('notebooks.id'), index=True)
    title: Mapped[str] = mapped_column(String(200))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class Card(Base):
    __tablename__ = 'flashcards'
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    deck_id: Mapped[str] = mapped_column(ForeignKey('flashcard_decks.id'), index=True)
    front: Mapped[str] = mapped_column(Text)
    back: Mapped[str] = mapped_column(Text)
    origin: Mapped[str] = mapped_column(String(20))
    version: Mapped[int] = mapped_column(Integer, default=1)
    reference: Mapped[dict | None] = mapped_column(JSON)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class ReviewState(Base):
    __tablename__ = 'review_states'
    user_id: Mapped[str] = mapped_column(ForeignKey('users.id'), primary_key=True)
    card_id: Mapped[str] = mapped_column(ForeignKey('flashcards.id'), primary_key=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    due_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    interval_days: Mapped[float] = mapped_column(Float, default=0)
    ease: Mapped[float] = mapped_column(Float, default=2.5)
    repetitions: Mapped[int] = mapped_column(Integer, default=0)


class ReviewEvent(Base):
    __tablename__ = 'review_events'
    __table_args__ = (UniqueConstraint('user_id', 'request_id', name='uq_review_request'),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey('users.id'), index=True)
    card_id: Mapped[str] = mapped_column(ForeignKey('flashcards.id'))
    card_version: Mapped[int] = mapped_column(Integer)
    request_id: Mapped[str] = mapped_column(String(36))
    request_hash: Mapped[str] = mapped_column(String(64))
    rating: Mapped[str] = mapped_column(String(10))
    result: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class Quiz(Base):
    __tablename__ = 'quizzes'
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    deck_id: Mapped[str] = mapped_column(ForeignKey('flashcard_decks.id'), index=True)
    title: Mapped[str] = mapped_column(String(200))
    questions: Mapped[list] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class QuizAttempt(Base):
    __tablename__ = 'quiz_attempts'
    __table_args__ = (UniqueConstraint('user_id', 'request_id', name='uq_quiz_attempt_request'),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    quiz_id: Mapped[str] = mapped_column(ForeignKey('quizzes.id'), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey('users.id'))
    request_id: Mapped[str] = mapped_column(String(36))
    request_hash: Mapped[str] = mapped_column(String(64))
    result: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class StudyArtifact(Base):
    __tablename__ = 'study_artifacts'
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    notebook_id: Mapped[str] = mapped_column(ForeignKey('notebooks.id'), index=True)
    kind: Mapped[str] = mapped_column(String(20))
    blocks: Mapped[list] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class ArtifactInput(BaseModel):
    language: Literal['ar', 'en'] = 'ar'
    kind: Literal['study_guide', 'faq', 'briefing', 'timeline', 'mindmap', 'podcast']
    source_ids: list[str] | None = Field(default=None, max_length=100)


class DeckInput(BaseModel):
    title: str = Field(min_length=1, max_length=200, pattern=r'\S')


class CardInput(BaseModel):
    front: str = Field(min_length=1, max_length=2000, pattern=r'\S')
    back: str = Field(min_length=1, max_length=2000, pattern=r'\S')


class CardEdit(CardInput):
    version: int = Field(ge=1)


class GenerateInput(DeckInput):
    source_ids: list[str] | None = Field(default=None, max_length=100)
    count: int = Field(default=8, ge=1, le=20)


class ReviewInput(BaseModel):
    request_id: uuid.UUID = Field(default_factory=uuid.uuid4)
    card_version: int = Field(ge=1)
    state_version: int = Field(ge=0)
    rating: str = Field(pattern=r'^(again|hard|good|easy)$')


class QuizInput(BaseModel):
    count: int = Field(default=8, ge=2, le=20)


class AttemptInput(BaseModel):
    request_id: uuid.UUID = Field(default_factory=uuid.uuid4)
    answers: dict[str, StrictInt] = Field(min_length=2, max_length=20)


def digest(data):
    return hashlib.sha256(json.dumps(data, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def schedule(state, rating, at):
    """SM-2 variant: 10-minute relearning lapse; successful intervals 1, 6, then EF."""
    quality = {'again': 1, 'hard': 3, 'good': 4, 'easy': 5}[rating]
    ease = min(3.5, max(1.3, (state.ease if state else 2.5) + .1 - (5-quality)*(.08+(5-quality)*.02)))
    repetitions = state.repetitions if state else 0
    if quality < 3:
        repetitions, interval, due = 0, 0.0, at + timedelta(minutes=10)
    else:
        repetitions += 1
        interval = 1 if repetitions == 1 else 6 if repetitions == 2 else max(1, round(state.interval_days * ease))
        interval = min(interval, 36500)
        due = at + timedelta(days=interval)
    return {'version': (state.version if state else 0) + 1, 'due_at': due,
            'interval_days': float(interval), 'ease': ease, 'repetitions': repetitions}


def reference(notebook_id, source, chunk, quote):
    timed = chunk.start_seconds is not None and source.external_url is not None
    return {'chunk_id': chunk.id, 'source_id': source.id, 'title': source.title,
            'quote': quote, 'page': None if timed or source.kind == 'docx' else chunk.page,
            'paragraph': chunk.page if source.kind == 'docx' else None,
            'locator_type': 'timestamp' if timed else 'paragraph' if source.kind == 'docx' else 'page',
            'start_seconds': chunk.start_seconds, 'end_seconds': chunk.end_seconds,
            'media_url': f'{source.external_url}&t={int(chunk.start_seconds)}s' if timed else None,
            'transcript_origin': source.transcript_origin, 'ocr': chunk.page in (source.ocr_pages or []),
            'url': f'/v1/notebooks/{notebook_id}/sources/{source.id}/chunks/{chunk.id}' if timed else f'/v1/notebooks/{notebook_id}/sources/{source.id}/paragraphs/{chunk.page}' if source.kind == 'docx' else f'/v1/notebooks/{notebook_id}/sources/{source.id}/pages/{chunk.page}'}


def make_cards(rows, notebook_id, count):
    """Create deletion cards from exact source sentences, never fabricated facts."""
    result, answers = [], set()
    for chunk, source in rows:
        for sentence in re.split(r'(?<=[.!؟])\s+|\n+', chunk.text):
            sentence = sentence.strip()
            if not 35 <= len(sentence) <= 400:
                continue
            terms = sorted(set(re.findall(r'[^\W\d_]{5,}', sentence, re.UNICODE)), key=lambda w: (-len(w), w))
            term = next((w for w in terms if w.casefold() not in answers), None)
            if not term:
                continue
            answers.add(term.casefold())
            result.append({'front': 'أكمل من المصدر: ' + sentence.replace(term, '____', 1),
                           'back': term, 'origin': 'extractive', 'reference': reference(notebook_id, source, chunk, sentence)})
            if len(result) >= count:
                return result
    return result


def register_learning(app, db, current_user, owned, readable=None):
    readable = readable or owned
    def deck_owned(deck_id, user_id, session, read=False):
        deck = session.get(Deck, deck_id)
        if not deck:
            raise HTTPException(404, 'Deck not found')
        (readable if read else owned)(deck.notebook_id, user_id, session)
        return deck

    def card_owned(card_id, user_id, session, read=False):
        card = session.get(Card, card_id)
        if not card or card.deleted_at is not None:
            raise HTTPException(404, 'Card not found')
        deck_owned(card.deck_id, user_id, session, read=read)
        return card

    def card_json(card, user_id, session):
        state = session.get(ReviewState, (user_id, card.id))
        return {'id': card.id, 'front': card.front, 'back': card.back, 'origin': card.origin,
                'version': card.version, 'reference': card.reference,
                'review': {'version': state.version if state else 0, 'due_at': iso(state.due_at) if state else None,
                           'interval_days': state.interval_days if state else 0,
                           'due': state is None or state.due_at.replace(tzinfo=timezone.utc) <= now()}}

    def deck_json(deck):
        return {'id': deck.id, 'title': deck.title, 'notebook_id': deck.notebook_id}

    @app.get('/v1/notebooks/{notebook_id}/decks')
    def decks(notebook_id: str, user_id=Depends(current_user), session: Session = Depends(db)):
        readable(notebook_id, user_id, session)
        return [deck_json(d) for d in session.scalars(select(Deck).where(Deck.notebook_id == notebook_id).order_by(Deck.created_at, Deck.id))]

    @app.post('/v1/notebooks/{notebook_id}/decks', status_code=201)
    def create_deck(notebook_id: str, body: DeckInput, user_id=Depends(current_user), session: Session = Depends(db)):
        owned(notebook_id, user_id, session)
        deck = Deck(notebook_id=notebook_id, title=body.title.strip())
        session.add(deck); session.commit()
        return deck_json(deck)

    @app.post('/v1/notebooks/{notebook_id}/decks/generate', status_code=201)
    def generate(notebook_id: str, body: GenerateInput, user_id=Depends(current_user), session: Session = Depends(db)):
        owned(notebook_id, user_id, session)
        query = select(Chunk, Source).join(Source, Chunk.source_id == Source.id).where(Source.notebook_id == notebook_id, Source.status == 'ready')
        if body.source_ids is not None:
            allowed = set(session.scalars(select(Source.id).where(Source.notebook_id == notebook_id)))
            if not set(body.source_ids) <= allowed:
                raise HTTPException(404, 'Source not found')
            query = query.where(Source.id.in_(body.source_ids))
        rows = session.execute(query.order_by(Source.id, Chunk.page, Chunk.chunk_index).limit(200)).all()
        generated = make_cards(rows, notebook_id, body.count)
        if not generated:
            raise HTTPException(422, 'Not enough source text to create deletion cards')
        deck = Deck(notebook_id=notebook_id, title=body.title.strip()); session.add(deck); session.flush()
        for data in generated:
            session.add(Card(deck_id=deck.id, **data))
        session.commit()
        return {**deck_json(deck), 'created_count': len(generated), 'method': 'extractive_cloze'}

    @app.get('/v1/decks/{deck_id}/cards')
    def cards(deck_id: str, due_only: bool = False, user_id=Depends(current_user), session: Session = Depends(db)):
        deck_owned(deck_id, user_id, session, read=True)
        rows = session.scalars(select(Card).where(Card.deck_id == deck_id, Card.deleted_at.is_(None)).order_by(Card.id)).all()
        result = [card_json(c, user_id, session) for c in rows]
        return [c for c in result if c['review']['due']] if due_only else result

    @app.post('/v1/decks/{deck_id}/cards', status_code=201)
    def add_card(deck_id: str, body: CardInput, user_id=Depends(current_user), session: Session = Depends(db)):
        deck_owned(deck_id, user_id, session)
        rows = session.scalars(select(Card.id).where(Card.deck_id == deck_id, Card.deleted_at.is_(None))).all()
        if len(rows) >= 200:
            raise HTTPException(409, 'Deck card limit reached')
        card = Card(deck_id=deck_id, front=body.front.strip(), back=body.back.strip(), origin='manual')
        session.add(card); session.commit()
        return card_json(card, user_id, session)

    @app.put('/v1/cards/{card_id}')
    def edit_card(card_id: str, body: CardEdit, user_id=Depends(current_user), session: Session = Depends(db)):
        card_owned(card_id, user_id, session)
        changed = session.execute(update(Card).where(Card.id == card_id, Card.version == body.version, Card.deleted_at.is_(None))
                                  .values(front=body.front.strip(), back=body.back.strip(), origin='edited', version=Card.version + 1))
        if not changed.rowcount:
            raise HTTPException(409, 'Card changed; refresh before editing')
        # Keep review events for audit; reset scheduling when learning content changes.
        state = session.get(ReviewState, (user_id, card_id))
        if state:
            session.delete(state)
        session.commit()
        return card_json(session.get(Card, card_id), user_id, session)

    @app.delete('/v1/cards/{card_id}', status_code=204)
    def remove_card(card_id: str, user_id=Depends(current_user), session: Session = Depends(db)):
        card = card_owned(card_id, user_id, session)
        card.deleted_at = now(); session.commit()

    @app.post('/v1/cards/{card_id}/reviews')
    def review(card_id: str, body: ReviewInput, user_id=Depends(current_user), session: Session = Depends(db)):
        card = card_owned(card_id, user_id, session, read=True)
        request_id, fingerprint = str(body.request_id), digest({'card_id': card_id, **body.model_dump(mode='json')})
        def replay():
            event = session.scalar(select(ReviewEvent).where(ReviewEvent.user_id == user_id, ReviewEvent.request_id == request_id))
            if event and event.request_hash != fingerprint:
                raise HTTPException(409, 'Request ID was already used for a different question')
            return event
        previous = replay()
        if previous:
            return previous.result
        state = session.get(ReviewState, (user_id, card_id))
        if card.version != body.card_version or (state.version if state else 0) != body.state_version:
            raise HTTPException(409, 'Review changed; reload the cards')
        next_state = schedule(state, body.rating, now())
        result = {**next_state, 'due_at': iso(next_state['due_at']), 'card_id': card_id, 'algorithm': 'sm2_variant'}
        try:
            # Fence against simultaneous edits/deletes while the review is recorded.
            locked = session.execute(update(Card).where(Card.id == card_id, Card.version == body.card_version, Card.deleted_at.is_(None)).values(version=Card.version))
            if not locked.rowcount:
                raise HTTPException(409, 'Review changed; reload the cards')
            if state:
                changed = session.execute(update(ReviewState).where(ReviewState.user_id == user_id, ReviewState.card_id == card_id, ReviewState.version == body.state_version).values(**next_state))
                if not changed.rowcount:
                    session.rollback()
                    previous = replay()
                    if previous: return previous.result
                    raise HTTPException(409, 'Review changed; reload the cards')
            else:
                session.add(ReviewState(user_id=user_id, card_id=card_id, **next_state))
            session.add(ReviewEvent(user_id=user_id, card_id=card_id, card_version=card.version,
                                    request_id=request_id, request_hash=fingerprint, rating=body.rating, result=result))
            session.commit()
        except IntegrityError:
            session.rollback()
            previous = replay()
            if previous: return previous.result
            raise HTTPException(409, 'Review changed; reload the cards')
        return result

    def quiz_owned(quiz_id, user_id, session):
        quiz = session.get(Quiz, quiz_id)
        if not quiz: raise HTTPException(404, 'Quiz not found')
        deck_owned(quiz.deck_id, user_id, session, read=True)
        return quiz

    def public_quiz(quiz):
        return {'id': quiz.id, 'title': quiz.title, 'questions': [
            {'id': q['id'], 'prompt': q['prompt'], 'choices': q['choices']} for q in quiz.questions]}

    @app.get('/v1/decks/{deck_id}/quizzes')
    def quizzes(deck_id: str, user_id=Depends(current_user), session: Session = Depends(db)):
        deck_owned(deck_id, user_id, session, read=True)
        return [{'id': q.id, 'title': q.title, 'count': len(q.questions)} for q in session.scalars(select(Quiz).where(Quiz.deck_id == deck_id).order_by(Quiz.created_at))]

    @app.post('/v1/decks/{deck_id}/quizzes', status_code=201)
    def create_quiz(deck_id: str, body: QuizInput, user_id=Depends(current_user), session: Session = Depends(db)):
        deck = deck_owned(deck_id, user_id, session)
        cards = session.scalars(select(Card).where(Card.deck_id == deck_id, Card.deleted_at.is_(None))).all()
        unique = {c.back: c for c in cards}
        if len(unique) < 2:
            raise HTTPException(422, 'At least two distinct card answers are required')
        cards = list(unique.values()); rng = secrets.SystemRandom(); rng.shuffle(cards)
        questions = []
        for card in cards[:body.count]:
            wrong = [c.back for c in cards if c.back != card.back]; rng.shuffle(wrong)
            choices = [card.back, *wrong[:3]]; rng.shuffle(choices)
            questions.append({'id': uid(), 'prompt': card.front, 'choices': choices,
                              'correct_index': choices.index(card.back), 'explanation': card.back,
                              'reference': card.reference, 'origin': card.origin})
        quiz = Quiz(deck_id=deck_id, title=deck.title, questions=questions)
        session.add(quiz); session.commit()
        return public_quiz(quiz)

    @app.get('/v1/quizzes/{quiz_id}')
    def get_quiz(quiz_id: str, user_id=Depends(current_user), session: Session = Depends(db)):
        return public_quiz(quiz_owned(quiz_id, user_id, session))

    @app.post('/v1/quizzes/{quiz_id}/attempts', status_code=201)
    def submit_quiz(quiz_id: str, body: AttemptInput, user_id=Depends(current_user), session: Session = Depends(db)):
        quiz = quiz_owned(quiz_id, user_id, session)
        request_id = str(body.request_id); fingerprint = digest({'quiz_id': quiz_id, 'answers': body.answers})
        previous = session.scalar(select(QuizAttempt).where(QuizAttempt.user_id == user_id, QuizAttempt.request_id == request_id))
        if previous:
            if previous.request_hash != fingerprint: raise HTTPException(409, 'Request ID was already used for a different question')
            return previous.result
        if set(body.answers) != {q['id'] for q in quiz.questions} or any(type(body.answers[q['id']]) is not int or not 0 <= body.answers[q['id']] < len(q['choices']) for q in quiz.questions):
            raise HTTPException(422, 'Answer every quiz question with a valid choice')
        scored = [{'id': q['id'], 'correct': body.answers[q['id']] == q['correct_index'], 'selected_index': body.answers[q['id']],
                   'correct_index': q['correct_index'], 'explanation': q['explanation'], 'reference': q['reference'], 'origin': q['origin']} for q in quiz.questions]
        result = {'quiz_id': quiz.id, 'correct': sum(q['correct'] for q in scored), 'total': len(scored), 'questions': scored}
        session.add(QuizAttempt(quiz_id=quiz_id, user_id=user_id, request_id=request_id, request_hash=fingerprint, result=result))
        try: session.commit()
        except IntegrityError:
            session.rollback()
            winner = session.scalar(select(QuizAttempt).where(QuizAttempt.user_id == user_id, QuizAttempt.request_id == request_id))
            if not winner or winner.request_hash != fingerprint: raise HTTPException(409, 'Request ID was already used for a different question')
            return winner.result
        return result

    @app.get('/v1/quizzes/{quiz_id}/attempts')
    def attempts(quiz_id: str, limit: int = Query(20, ge=1, le=100), user_id=Depends(current_user), session: Session = Depends(db)):
        quiz_owned(quiz_id, user_id, session)
        rows = session.scalars(select(QuizAttempt).where(QuizAttempt.quiz_id == quiz_id, QuizAttempt.user_id == user_id).order_by(QuizAttempt.created_at.desc()).limit(limit))
        return [{'id': a.id, 'created_at': iso(a.created_at), **a.result} for a in rows]


    def artifact_json(item):
        result = {'id': item.id, 'kind': item.kind, 'blocks': item.blocks,
                  'method': 'extractive', 'created_at': iso(item.created_at)}
        if item.kind == 'mindmap':
            # Structural containment only: never claim inferred semantic relations.
            nodes = [{'id': 'root', 'kind': 'root', 'label': 'المصادر المحددة'}]
            edges, sources = [], set()
            for index, block in enumerate(item.blocks):
                ref = block['reference']
                source_node = 'source:' + ref['source_id']
                if source_node not in sources:
                    sources.add(source_node)
                    nodes.append({'id': source_node, 'kind': 'source', 'label': ref['title']})
                    edges.append({'from': 'root', 'to': source_node, 'relation': 'contains'})
                passage_node = 'passage:' + str(index)
                nodes.append({'id': passage_node, 'kind': 'passage', 'label': block['text'], 'reference': ref})
                edges.append({'from': source_node, 'to': passage_node, 'relation': 'contains'})
            result['graph'] = {'nodes': nodes, 'edges': edges, 'relation_semantics': 'source_containment_only'}
        return result

    @app.get('/v1/notebooks/{notebook_id}/study-artifacts')
    def artifacts(notebook_id: str, user_id=Depends(current_user), session: Session = Depends(db)):
        notebook = readable(notebook_id, user_id, session)
        statement = select(StudyArtifact).where(StudyArtifact.notebook_id == notebook_id)
        if notebook.owner_id == user_id:
            # Keep all five saved audio outputs reachable even after >30 newer outputs.
            from knowlm.audio import AudioRecording
            from sqlalchemy import case
            statement = statement.order_by(case((StudyArtifact.id.in_(select(AudioRecording.artifact_id).where(AudioRecording.notebook_id == notebook_id)), 0), else_=1))
        return [artifact_json(a) for a in session.scalars(statement.order_by(StudyArtifact.created_at.desc()).limit(30))]

    @app.post('/v1/notebooks/{notebook_id}/study-artifacts', status_code=201)
    def generate_artifact(notebook_id: str, body: ArtifactInput, user_id=Depends(current_user), session: Session = Depends(db)):
        owned(notebook_id, user_id, session)
        query = select(Chunk, Source).join(Source, Chunk.source_id == Source.id).where(Source.notebook_id == notebook_id, Source.status == 'ready')
        if body.source_ids is not None:
            allowed = set(session.scalars(select(Source.id).where(Source.notebook_id == notebook_id)))
            if not set(body.source_ids) <= allowed: raise HTTPException(404, 'Source not found')
            query = query.where(Source.id.in_(body.source_ids))
        rows = session.execute(query.order_by(Source.id, Chunk.page, Chunk.chunk_index).limit(200)).all()
        blocks, seen = [], set()
        for chunk, source in rows:
            for sentence in re.split(r'(?<=[.!؟])\s+|\n+', chunk.text):
                sentence = sentence.strip()
                if not 25 <= len(sentence) <= 400 or sentence in seen: continue
                year = None
                if body.kind == 'timeline':
                    match = re.search(r'(?:عام|سنة|year|in)\s+([12][0-9]{3})', sentence, re.IGNORECASE)
                    if not match: continue
                    year = int(match[1])
                heading = str(year) if year else 'ماذا يذكر المقطع؟' if body.kind == 'faq' else source.title
                blocks.append({'heading': heading, 'text': sentence, 'year': year,
                               'reference': reference(notebook_id, source, chunk, sentence)})
                seen.add(sentence)
                if len(blocks) >= (5 if body.kind == 'briefing' else 20): break
            if len(blocks) >= (5 if body.kind == 'briefing' else 20): break
        if not blocks: raise HTTPException(422, 'No eligible source passages for this output')
        if body.kind == 'timeline': blocks.sort(key=lambda b: b['year'])
        if body.kind == 'podcast':
            # Fixed host prompts + literal source quotations, not invented discussion.
            dialogue = []
            for index, block in enumerate(blocks[:10]):
                question = ('What does the selected passage say?' if body.language == 'en' else 'ماذا يقول المقطع المختار؟')
                dialogue.append({**block, 'heading': 'Host' if body.language == 'en' else 'المحاور',
                                 'text': question, 'speaker': 'host', 'language': body.language,
                                 'origin': 'fixed_prompt'})
                dialogue.append({**block, 'heading': 'Reader' if body.language == 'en' else 'القارئ',
                                 'speaker': 'reader', 'language': body.language, 'origin': 'source_quote'})
            blocks = dialogue
        artifact = StudyArtifact(notebook_id=notebook_id, kind=body.kind, blocks=blocks)
        session.add(artifact); session.commit()
        return artifact_json(artifact)
