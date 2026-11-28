"""Transactional hard deletion of a private notebook's active database records.

This is not cryptographic erasure of SQLite pages, backups or external providers.
Child-first deletion supports schemas without ON DELETE CASCADE.
"""
from sqlalchemy import delete, select

from knowlm.main import ChatTurn, Chunk, IngestionJob, Notebook, Source
from knowlm.learning import Card, Deck, Quiz, QuizAttempt, ReviewEvent, ReviewState, StudyArtifact


def erase_notebook(session, notebook_id):
    sources = select(Source.id).where(Source.notebook_id == notebook_id)
    decks = select(Deck.id).where(Deck.notebook_id == notebook_id)
    cards = select(Card.id).where(Card.deck_id.in_(decks))
    quizzes = select(Quiz.id).where(Quiz.deck_id.in_(decks))
    # Remove the worker's publication/lease row first. A stale worker's fenced
    # UPDATE then affects zero rows and cannot re-create text after deletion.
    statements = [
        delete(IngestionJob).where(IngestionJob.source_id.in_(sources)),
        delete(QuizAttempt).where(QuizAttempt.quiz_id.in_(quizzes)),
        delete(Quiz).where(Quiz.deck_id.in_(decks)),
        delete(ReviewEvent).where(ReviewEvent.card_id.in_(cards)),
        delete(ReviewState).where(ReviewState.card_id.in_(cards)),
        delete(Card).where(Card.deck_id.in_(decks)),
        delete(Deck).where(Deck.notebook_id == notebook_id),
        delete(StudyArtifact).where(StudyArtifact.notebook_id == notebook_id),
        delete(ChatTurn).where(ChatTurn.notebook_id == notebook_id),
        delete(Chunk).where(Chunk.source_id.in_(sources)),
        delete(Source).where(Source.notebook_id == notebook_id),
        delete(Notebook).where(Notebook.id == notebook_id),
    ]
    for statement in statements:
        session.execute(statement.execution_options(synchronize_session=False))
    # Caller commits once, never per table: failures must roll back all records.
