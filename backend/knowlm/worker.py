"""Durable database-backed PDF worker. Run with python -m knowlm.worker.

Atomic claims and lease tokens fence stale workers from publishing results.
No external queue is required at this prototype's scale.
"""
import argparse
from datetime import datetime, timedelta, timezone
import logging
import os
import time

from sqlalchemy import create_engine, delete, select, update
from sqlalchemy.orm import Session

from knowlm.main import Chunk, IngestionJob, Source, uid
from knowlm.pdf import ExtractionError, extract_pdf

logger = logging.getLogger(__name__)


def run_once(engine, extractor=extract_pdf):
    now = datetime.now(timezone.utc)
    with Session(engine) as session:
        # A crashed worker's lease can be reclaimed; limit automatic attempts too.
        expired = session.scalars(select(IngestionJob).where(
            IngestionJob.status == 'processing', IngestionJob.lease_until < now)).all()
        for job in expired:
            changed = session.execute(update(IngestionJob).where(
                IngestionJob.id == job.id, IngestionJob.status == 'processing',
                IngestionJob.lease_token == job.lease_token, IngestionJob.lease_until < now
            ).execution_options(synchronize_session=False).values(status='pending' if job.attempts < 3 else 'failed',
                     error_code='worker_lease_expired', lease_token=None, lease_until=None))
            if changed.rowcount and job.attempts >= 3:
                session.execute(update(Source).where(Source.id == job.source_id).values(status='failed'))
        session.commit()
        candidate = session.scalar(select(IngestionJob.id).where(
            IngestionJob.status == 'pending', IngestionJob.attempts < 3
        ).order_by(IngestionJob.created_at, IngestionJob.id).limit(1))
        if not candidate:
            return False
        token = uid()
        claimed = session.execute(update(IngestionJob).where(
            IngestionJob.id == candidate, IngestionJob.status == 'pending'
        ).values(status='processing', lease_token=token,
                 lease_until=now + timedelta(seconds=90), attempts=IngestionJob.attempts + 1))
        session.commit()
        if not claimed.rowcount:
            return True
        payload = session.get(IngestionJob, candidate).payload
    error, pages = None, []
    try:
        if payload is None:
            raise ExtractionError('missing_payload')
        pages = extractor(payload)
    except ExtractionError as exc:
        error = exc.code
    except Exception:
        # Do not persist exception strings that might contain private content.
        error = 'internal_extraction_error'
    with Session(engine) as session:
        # Update first to obtain a write lock and fence expired/reclaimed workers.
        changed = session.execute(update(IngestionJob).where(
            IngestionJob.id == candidate, IngestionJob.status == 'processing',
            IngestionJob.lease_token == token, IngestionJob.lease_until > datetime.now(timezone.utc)
        ).values(status='failed' if error else 'completed', error_code=error,
                 lease_token=None, lease_until=None))
        if not changed.rowcount:
            session.rollback()
            return True
        job = session.get(IngestionJob, candidate)
        source = session.get(Source, job.source_id)
        source.status = 'failed' if error else 'ready'
        if not error:
            session.execute(delete(Chunk).where(Chunk.source_id == source.id))
            for page_number, text in enumerate(pages, 1):
                for index, start in enumerate(range(0, len(text), 900)):
                    part = text[start:start + 1000].strip()
                    if part:
                        session.add(Chunk(source_id=source.id, page=page_number, chunk_index=index, text=part))
            # No raw-file retention after successful extraction in this version.
            job.payload = None
        session.commit()
    return True


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--once', action='store_true', help='Process at most one job, then exit')
    args = parser.parse_args()
    directory = os.getenv('KNOWLM_DATA_DIR', 'backend/data')
    engine = create_engine(os.getenv('DATABASE_URL', f'sqlite:///{directory}/knowlm.db'))
    logging.basicConfig(level=logging.INFO)
    while True:
        worked = run_once(engine)
        if args.once:
            break
        if not worked:
            time.sleep(2)


if __name__ == '__main__':
    main()
