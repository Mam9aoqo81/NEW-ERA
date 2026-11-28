"""Optional consented TTS of saved podcast turns. No arbitrary client text or URLs."""
import io
import json
import os
import struct
import subprocess
import sys
import tempfile
from pathlib import Path
import time
import wave
from datetime import datetime
from urllib.parse import urlparse

import httpx
from fastapi import Depends, HTTPException, Response
from pydantic import BaseModel, ConfigDict, StrictBool
from sqlalchemy import ForeignKey, LargeBinary, JSON, Integer, String, DateTime, select, func, update
from sqlalchemy.orm import Mapped, mapped_column
from knowlm.main import Base, Notebook
from knowlm.learning import now
from sqlalchemy.orm import Session
from knowlm.learning import StudyArtifact

MAX_BYTES = 16_000_000


class AudioError(Exception):
    pass


def pcm(raw):
    try:
        if len(raw) > MAX_BYTES:
            raise AudioError('Audio too large')
        with wave.open(io.BytesIO(raw), 'rb') as wav:
            params = (wav.getnchannels(), wav.getsampwidth(), wav.getframerate())
            if params[0] not in (1, 2) or params[1] not in (1, 2, 3, 4) or not 8000 <= params[2] <= 48000 or wav.getcomptype() != 'NONE':
                raise AudioError('Unsupported PCM')
            frames = wav.getnframes()
            if not 0 < frames <= params[2] * 600:
                raise AudioError('Invalid duration')
            data = wav.readframes(frames)
            if len(data) != frames * params[0] * params[1]:
                raise AudioError('Truncated audio')
            return params, data
    except (wave.Error, EOFError, ValueError, OverflowError, struct.error):
        raise AudioError('Invalid WAV') from None


class LocalSpeechProvider:
    external_processing = False

    def __init__(self):
        import espeakng_loader
        if not os.path.isfile(espeakng_loader.get_library_path()):
            raise ValueError('Install requirements-audio.txt for local speech')

    def render(self, text, speaker, timeout):
        try:
            # Bound child output on disk; never collect unbounded stdout in RAM.
            with tempfile.TemporaryFile() as output:
                result = subprocess.run([sys.executable, str(Path(__file__).with_name('tts_child.py'))], input=json.dumps({'text': text, 'speaker': speaker}, ensure_ascii=False).encode(), stdout=output, stderr=subprocess.DEVNULL, timeout=min(timeout, 30), check=False)
                if result.returncode != 0:
                    raise AudioError('Local speech failed')
                output.seek(0)
                raw = output.read(MAX_BYTES + 1)
                if len(raw) > MAX_BYTES:
                    raise AudioError('Local audio too large')
                return raw
        except (OSError, subprocess.TimeoutExpired):
            raise AudioError('Local speech unavailable') from None


class AudioRecording(Base):
    __tablename__ = 'audio_recordings'
    artifact_id: Mapped[str] = mapped_column(ForeignKey('study_artifacts.id'), primary_key=True)
    notebook_id: Mapped[str] = mapped_column(ForeignKey('notebooks.id'), index=True)
    data: Mapped[bytes] = mapped_column(LargeBinary)
    byte_count: Mapped[int] = mapped_column(Integer)
    cues: Mapped[list] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class SpeechProvider:
    def __init__(self, base_url, key, model, host_voice, reader_voice, transport=None):
        url = urlparse(base_url)
        if url.scheme != 'https' or not url.netloc or url.username or url.password or url.query or url.fragment:
            raise ValueError('TTS base URL must be HTTPS without credentials or query')
        self.url = base_url.rstrip('/') + '/audio/speech'
        self.key, self.model, self.voices = key, model, {'host': host_voice, 'reader': reader_voice}
        self.transport = transport

    def render(self, text, speaker, timeout):
        deadline = time.monotonic() + timeout
        try:
            with httpx.Client(timeout=httpx.Timeout(timeout, connect=min(10, timeout)), follow_redirects=False, transport=self.transport) as client:
                with client.stream('POST', self.url, headers={'Authorization': 'Bearer ' + self.key}, json={'model': self.model, 'voice': self.voices[speaker], 'input': text, 'response_format': 'wav'}) as response:
                    response.raise_for_status()
                    raw = bytearray()
                    for block in response.iter_bytes():
                        raw.extend(block)
                        if time.monotonic() > deadline:
                            raise AudioError('Speech deadline exceeded')
                        if len(raw) > MAX_BYTES:
                            raise AudioError('Audio too large')
            return bytes(raw)
        except (httpx.HTTPError, KeyError):
            raise AudioError('Speech service unavailable') from None


def speech_provider_from_env():
    mode = os.getenv('KNOWLM_TTS_MODE', 'provider')
    if mode not in ('local', 'provider'):
        raise ValueError('KNOWLM_TTS_MODE must be local or provider')
    if mode == 'local':
        return LocalSpeechProvider() if os.getenv('KNOWLM_TTS_ENABLED', '0') == '1' else None
    if os.getenv('KNOWLM_TTS_ENABLED', '0') != '1':
        return None
    names = ['API_KEY', 'MODEL', 'HOST_VOICE', 'READER_VOICE']
    values = [os.getenv('KNOWLM_TTS_' + name) for name in names]
    if not all(values):
        raise ValueError('Enabled TTS requires key, model and two configured voices')
    return SpeechProvider(os.getenv('KNOWLM_TTS_BASE_URL', 'https://api.openai.com/v1'), *values)


def render_dialogue(provider, blocks, *, include_cues=False):
    if not blocks or len(blocks) > 20 or sum(len(b['text']) for b in blocks) > 8000:
        raise AudioError('Dialogue exceeds audio limits')
    started = time.monotonic()
    parts, expected, total = [], None, 0
    cues = []
    for block in blocks:
        remaining = 90 - (time.monotonic() - started)
        if remaining <= 0:
            raise AudioError('Speech deadline exceeded')
        params, data = pcm(provider.render(block['text'], block['speaker'], min(remaining, 30)))
        if time.monotonic() - started > 90:
            raise AudioError('Speech deadline exceeded')
        if expected and params != expected:
            raise AudioError('Incompatible speech formats')
        expected = params
        bytes_per_second = params[0] * params[1] * params[2]
        cues.append({'index': len(cues), 'start': total / bytes_per_second, 'end': (total + len(data)) / bytes_per_second})
        total += len(data)
        if total > MAX_BYTES - 100 or total / (params[0] * params[1] * params[2]) > 600:
            raise AudioError('Combined audio exceeds limits')
        parts.append(data)
    output = io.BytesIO()
    with wave.open(output, 'wb') as wav:
        wav.setnchannels(expected[0]); wav.setsampwidth(expected[1]); wav.setframerate(expected[2])
        for part in parts:
            wav.writeframesraw(part)
    return (output.getvalue(), cues) if include_cues else output.getvalue()


class AudioInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    consent: StrictBool
    save: StrictBool = False


def register_audio(app, db, current_user, owned, provider):
    @app.get('/v1/audio/config')
    def config(user_id=Depends(current_user)):
        return {'enabled': provider is not None, 'format': 'wav', 'external_processing': getattr(provider, 'external_processing', True), 'engine': 'local_espeak' if isinstance(provider, LocalSpeechProvider) else 'provider'}

    def artifact_owned(artifact_id, user_id, session):
        item = session.get(StudyArtifact, artifact_id)
        if not item:
            raise HTTPException(404, 'Study output not found')
        owned(item.notebook_id, user_id, session)
        return item

    def audio_response(raw, cues):
        return Response(raw, media_type='audio/wav', headers={'Cache-Control': 'no-store', 'Content-Disposition': 'attachment; filename="knowlm-review.wav"', 'X-Content-Type-Options': 'nosniff', 'X-KnowLM-Audio-Cues': json.dumps(cues, separators=(',', ':'))})

    @app.get('/v1/study-artifacts/{artifact_id}/audio/status')
    def status(artifact_id: str, user_id=Depends(current_user), session: Session=Depends(db)):
        artifact_owned(artifact_id, user_id, session)
        row = session.execute(select(AudioRecording.byte_count, AudioRecording.created_at).where(AudioRecording.artifact_id == artifact_id)).first()
        return Response(json.dumps({'saved': row is not None, 'bytes': row[0] if row else 0}), media_type='application/json', headers={'Cache-Control': 'no-store'})

    @app.get('/v1/study-artifacts/{artifact_id}/audio')
    def saved(artifact_id: str, user_id=Depends(current_user), session: Session=Depends(db)):
        artifact_owned(artifact_id, user_id, session)
        row = session.get(AudioRecording, artifact_id)
        if not row:
            raise HTTPException(404, 'Saved audio not found')
        return audio_response(row.data, row.cues)

    @app.delete('/v1/study-artifacts/{artifact_id}/audio', status_code=204)
    def delete_saved(artifact_id: str, user_id=Depends(current_user), session: Session=Depends(db)):
        item = artifact_owned(artifact_id, user_id, session)
        session.execute(update(Notebook).where(Notebook.id == item.notebook_id).values(title=Notebook.title))
        row = session.get(AudioRecording, artifact_id)
        if row:
            session.delete(row)
        session.commit()
        return Response(status_code=204, headers={'Cache-Control': 'no-store'})

    @app.post('/v1/study-artifacts/{artifact_id}/audio')
    def audio(artifact_id: str, body: AudioInput, user_id=Depends(current_user), session: Session=Depends(db)):
        item = session.get(StudyArtifact, artifact_id)
        if not item:
            raise HTTPException(404, 'Study output not found')
        owned(item.notebook_id, user_id, session)
        if not body.consent:
            raise HTTPException(422, 'Explicit audio processing consent required')
        if item.kind != 'podcast':
            raise HTTPException(422, 'Study output is not a podcast')
        if provider is None:
            raise HTTPException(503, 'Server speech generation is disabled')
        if body.save and session.get(AudioRecording, artifact_id):
            raise HTTPException(409, 'Delete the saved recording before regenerating')
        if body.save:
            count, used = session.execute(select(func.count(), func.coalesce(func.sum(AudioRecording.byte_count), 0)).where(AudioRecording.notebook_id == item.notebook_id)).one()
            if count >= 5 or used >= 32_000_000:
                raise HTTPException(409, 'Saved audio quota reached; delete older recordings')
        notebook_id, original = item.notebook_id, item.blocks
        # Never hold a notebook write lock during an external request.
        session.rollback()
        try:
            raw, cues = render_dialogue(provider, original, include_cues=True)
        except AudioError:
            raise HTTPException(502, 'Speech service failed or returned unsupported audio') from None
        # Account/notebook deletion or changed content prevents returning a stale result.
        session.expire_all()
        owned(notebook_id, user_id, session)
        fresh = session.get(StudyArtifact, artifact_id, populate_existing=True)
        if not fresh or fresh.blocks != original:
            raise HTTPException(409, 'Study output changed during speech generation')
        if body.save:
            session.execute(update(Notebook).where(Notebook.id == notebook_id).values(title=Notebook.title))
            session.expire_all()
            owned(notebook_id, user_id, session)
            if not session.get(StudyArtifact, artifact_id, populate_existing=True):
                raise HTTPException(404, 'Study output not found')
            if session.get(AudioRecording, artifact_id, populate_existing=True):
                raise HTTPException(409, 'Delete the saved recording before regenerating')
            count, used = session.execute(select(func.count(), func.coalesce(func.sum(AudioRecording.byte_count), 0)).where(AudioRecording.notebook_id == notebook_id)).one()
            if count >= 5 or used + len(raw) > 32_000_000:
                raise HTTPException(409, 'Saved audio quota reached; delete older recordings')
            session.add(AudioRecording(artifact_id=artifact_id, notebook_id=notebook_id, data=raw, byte_count=len(raw), cues=cues))
            session.commit()
        return audio_response(raw, cues)
