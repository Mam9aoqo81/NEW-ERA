"""Transactional hard deletion of a private notebook's active database records.

This is not cryptographic erasure of SQLite pages, backups or external providers.
Child-first deletion supports schemas without ON DELETE CASCADE.
"""
from sqlalchemy import delete, select, update

from knowlm.main import ChatTurn, Chunk, IngestionJob, Notebook, Source, User, AuthSession
from knowlm.learning import Card, Deck, Quiz, QuizAttempt, ReviewEvent, ReviewState, StudyArtifact


def erase_notebook(session, notebook_id):
    from knowlm.audio import AudioRecording
    from knowlm.canvas import InkBoard
    # Serialize snapshot publication against parent erasure before deleting children.
    session.execute(update(Notebook).where(Notebook.id == notebook_id).values(title=Notebook.title))
    from knowlm.pomodoro import FocusTimer
    session.execute(delete(FocusTimer).where(FocusTimer.notebook_id == notebook_id).execution_options(synchronize_session=False))
    session.execute(delete(AudioRecording).where(AudioRecording.notebook_id == notebook_id).execution_options(synchronize_session=False))
    session.execute(delete(InkBoard).where(InkBoard.notebook_id == notebook_id).execution_options(synchronize_session=False))
    from knowlm.collaboration import Membership, Invitation, RoomMessage
    for model in (RoomMessage, Invitation, Membership):
        session.execute(delete(model).where(model.notebook_id == notebook_id).execution_options(synchronize_session=False))
    from knowlm.sharing import LearningShare, ShareImport, ShareReport
    session.execute(delete(ShareImport).where(ShareImport.notebook_id == notebook_id).execution_options(synchronize_session=False))
    session.execute(delete(ShareReport).where(ShareReport.share_id.in_(select(LearningShare.id).where(LearningShare.notebook_id == notebook_id))).execution_options(synchronize_session=False))
    from knowlm.community import CommunityPost, erase_posts
    erase_posts(session, select(CommunityPost.id).where(CommunityPost.share_id.in_(select(LearningShare.id).where(LearningShare.notebook_id == notebook_id))))
    session.execute(delete(LearningShare).where(LearningShare.notebook_id == notebook_id).execution_options(synchronize_session=False))
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


def erase_account(session, user_id):
    notebook_ids = list(session.scalars(select(Notebook.id).where(
        Notebook.owner_id == user_id).order_by(Notebook.id).with_for_update()))
    for notebook_id in notebook_ids:
        erase_notebook(session, notebook_id)
    from knowlm.canvas import InkBoard
    session.execute(delete(InkBoard).where(InkBoard.user_id == user_id).execution_options(synchronize_session=False))
    from knowlm.collaboration import Membership, Invitation, RoomMessage
    username = session.get(User,user_id).username
    session.execute(delete(Invitation).where(Invitation.username == username).execution_options(synchronize_session=False))
    for model in (Membership, RoomMessage, ChatTurn):
        session.execute(delete(model).where(model.user_id == user_id).execution_options(synchronize_session=False))
    from knowlm.community import PostComment, SavedPost, Follow, UserBlock
    for model in (PostComment, SavedPost):
        session.execute(delete(model).where(model.user_id == user_id).execution_options(synchronize_session=False))
    session.execute(delete(Follow).where((Follow.follower_id == user_id) | (Follow.publisher_id == user_id)).execution_options(synchronize_session=False))
    session.execute(delete(UserBlock).where((UserBlock.blocker_id == user_id) | (UserBlock.blocked_id == user_id)).execution_options(synchronize_session=False))
    # Also remove this user's own activity should shared notebooks be added later.
    from knowlm.sharing import ShareReport
    session.execute(delete(ShareReport).where(ShareReport.reporter_id == user_id).execution_options(synchronize_session=False))
    from knowlm.limits import RateBucket
    for model in (QuizAttempt, ReviewEvent, ReviewState, AuthSession, RateBucket):
        session.execute(delete(model).where(model.user_id == user_id).execution_options(synchronize_session=False))
    session.execute(delete(User).where(User.id == user_id).execution_options(synchronize_session=False))
    # No commit here: re-authentication route owns the single atomic transaction.
