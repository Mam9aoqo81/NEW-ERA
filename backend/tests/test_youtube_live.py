"""Explicit opt-in live upstream smoke test; never runs in the offline suite."""
import os
import pytest
from knowlm.youtube import canonical_video, fetch_transcript, transcript_chunks


@pytest.mark.skipif(not os.getenv('KNOWLM_LIVE_YOUTUBE_URL'), reason='Requires an explicitly supplied permitted video and live YouTube network access')
def test_live_public_captions(monkeypatch):
    monkeypatch.setenv('KNOWLM_YOUTUBE_FETCH_ENABLED','1')
    video_id, _ = canonical_video(os.environ['KNOWLM_LIVE_YOUTUBE_URL'])
    chunks = transcript_chunks(fetch_transcript(video_id))
    assert chunks and all(c['text'] and 0 <= c['start_seconds'] < c['end_seconds'] <= 86400 for c in chunks)
