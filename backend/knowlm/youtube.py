"""Strict YouTube identifiers and bounded, timestamp-preserving caption ingestion.

Only canonical video IDs reach the network adapter, never arbitrary user URLs.
The library uses YouTube's public caption endpoints, not an official guaranteed API.
"""
import html
import json
import math
import os
from pathlib import Path
import re
import subprocess
import sys
from urllib.parse import parse_qs, urlsplit

from knowlm.pdf import ExtractionError

VIDEO_ID = re.compile(r'[A-Za-z0-9_-]{11}')
MAX_TEXT = 500_000


def canonical_video(url):
    if not isinstance(url, str) or len(url) > 2048:
        raise ValueError('invalid_youtube_url')
    url = url.strip()
    if re.search(r'[\x00-\x20\x7f\\]', url):
        raise ValueError('invalid_youtube_url')
    try:
        parts = urlsplit(url)
        if parts.scheme not in ('https', 'http') or parts.username or parts.password or parts.port not in (None, 443):
            raise ValueError('invalid_youtube_url')
        if parts.hostname in ('youtu.be', 'www.youtu.be'):
            video_id = parts.path.strip('/')
        elif parts.hostname in ('youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com',
                                'www.youtube-nocookie.com', 'youtube-nocookie.com'):
            if parts.path == '/watch':
                values = parse_qs(parts.query, keep_blank_values=True).get('v', [])
                if len(values) != 1:
                    raise ValueError('invalid_youtube_url')
                video_id = values[0]
            else:
                match = re.fullmatch(r'/(?:shorts|embed|live)/([A-Za-z0-9_-]{11})/?', parts.path)
                if not match:
                    raise ValueError('invalid_youtube_url')
                video_id = match[1]
        else:
            raise ValueError('invalid_youtube_url')
        if not VIDEO_ID.fullmatch(video_id):
            raise ValueError('invalid_youtube_url')
        return video_id, f'https://www.youtube.com/watch?v={video_id}'
    except (ValueError, TypeError):
        raise ValueError('invalid_youtube_url') from None


def normalize_segments(segments):
    if not isinstance(segments, list) or not segments:
        raise ExtractionError('youtube_no_captions')
    if len(segments) > 20_000:
        raise ExtractionError('captions_too_large')
    result, total, previous = [], 0, -1.0
    for item in segments:
        if not isinstance(item, dict) or not isinstance(item.get('text'), str):
            raise ExtractionError('invalid_timed_captions')
        start, duration = item.get('start'), item.get('duration')
        if any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) for v in (start, duration)):
            raise ExtractionError('invalid_timed_captions')
        if start < 0 or start < previous or duration <= 0 or start + duration > 86_400:
            raise ExtractionError('invalid_timed_captions')
        previous = start
        text = html.unescape(re.sub(r'<[^>]*>', '', item['text'])).strip()
        total += len(text)
        if total > MAX_TEXT or len(text) > 10_000:
            raise ExtractionError('captions_too_large')
        if text:
            result.append({'text': text, 'start': float(start), 'duration': float(duration)})
    if not result:
        raise ExtractionError('youtube_no_captions')
    return result


TIME = r'(?:(\d{1,2}):)?([0-5]\d):([0-5]\d)[,.](\d{3})'
TIMING = re.compile(r'^' + TIME + r'\s+-->\s+' + TIME + r'(?:\s+.*)?$')


def parse_captions(text):
    if not isinstance(text, str) or len(text) > MAX_TEXT:
        raise ExtractionError('captions_too_large')
    segments = []
    for block in re.split(r'\n\s*\n', text.lstrip('\ufeff').replace('\r\n', '\n').replace('\r', '\n').strip()):
        lines = block.strip().splitlines()
        if not lines:
            continue
        if lines[0].startswith(('WEBVTT', 'NOTE', 'STYLE', 'REGION')):
            continue
        time_index = next((i for i, line in enumerate(lines) if '-->' in line), None)
        if time_index is None or time_index > 1:
            raise ExtractionError('invalid_timed_captions')
        match = TIMING.fullmatch(lines[time_index].strip())
        if not match:
            raise ExtractionError('invalid_timed_captions')
        values = match.groups()
        def seconds(offset):
            h, m, s, ms = values[offset:offset + 4]
            return int(h or 0)*3600 + int(m)*60 + int(s) + int(ms)/1000
        start, end = seconds(0), seconds(4)
        segments.append({'start': start, 'duration': end-start, 'text': '\n'.join(lines[time_index+1:])})
    return normalize_segments(segments)


def transcript_chunks(segments):
    """Preserve cue time ranges; do not invent PDF page numbers for videos."""
    segments = normalize_segments(segments)
    chunks, text, start, end = [], '', 0.0, 0.0
    for segment in segments:
        for offset in range(0, len(segment['text']), 1000):
            part = segment['text'][offset:offset+1000]
            if text and len(text) + len(part) + 1 > 1000:
                chunks.append({'text': text, 'start_seconds': start, 'end_seconds': end})
                text = ''
            if not text:
                start = segment['start']
            end = max(end if text else 0, segment['start'] + segment['duration'])
            text += ('\n' if text else '') + part
    if text:
        chunks.append({'text': text, 'start_seconds': start, 'end_seconds': end})
    return chunks


def fetch_transcript(video_id):
    if os.getenv('KNOWLM_YOUTUBE_FETCH_ENABLED', '1') != '1':
        raise ExtractionError('youtube_network_disabled')
    if not isinstance(video_id, str) or not VIDEO_ID.fullmatch(video_id):
        raise ExtractionError('invalid_youtube_url')
    env = os.environ.copy()
    env['PYTHONPATH'] = str(Path(__file__).resolve().parents[1]) + os.pathsep + env.get('PYTHONPATH', '')
    try:
        result = subprocess.run([sys.executable, '-m', 'knowlm.youtube_child'],
                                input=json.dumps({'video_id': video_id}).encode(),
                                capture_output=True, timeout=45, env=env)
    except subprocess.TimeoutExpired:
        raise ExtractionError('youtube_timeout')
    if result.returncode:
        raise ExtractionError('youtube_process_failure')
    try:
        data = json.loads(result.stdout)
        if 'error' in data:
            permitted = {'youtube_no_captions', 'youtube_unavailable', 'youtube_access_blocked',
                         'youtube_network_error', 'youtube_timeout', 'captions_too_large'}
            raise ExtractionError(data['error'] if data['error'] in permitted else 'youtube_fetch_failed')
        return normalize_segments(data['segments'])
    except (ValueError, KeyError, TypeError):
        raise ExtractionError('youtube_fetch_failed') from None
