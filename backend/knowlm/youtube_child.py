"""Bounded public-caption network adapter. Never downloads audio or bypasses access."""
import json
import resource
import sys


import requests
from youtube_transcript_api import YouTubeTranscriptApi
from youtube_transcript_api import _errors as errors
from knowlm.pdf import ExtractionError
from knowlm.youtube import VIDEO_ID, normalize_segments


class TimedSession(requests.Session):
    def request(self, method, url, **kwargs):
        kwargs.setdefault('timeout', (8, 12))
        return super().request(method, url, **kwargs)


def fetch(video_id, client=None):
    if not isinstance(video_id, str) or not VIDEO_ID.fullmatch(video_id):
        return {'error': 'youtube_fetch_failed'}
    try:
        transcripts = (client or YouTubeTranscriptApi(http_client=TimedSession())).list(video_id)
        try:
            chosen = transcripts.find_transcript(['ar', 'en'])
        except errors.NoTranscriptFound:
            chosen = next(iter(transcripts), None)
            if chosen is None:
                return {'error': 'youtube_no_captions'}
        snippets = chosen.fetch()
        segments = normalize_segments([{'text': s.text, 'start': s.start, 'duration': s.duration} for s in snippets])
        return {'segments': segments}
    except (errors.TranscriptsDisabled, errors.NoTranscriptFound):
        return {'error': 'youtube_no_captions'}
    except (errors.VideoUnavailable, errors.VideoUnplayable, errors.AgeRestricted):
        return {'error': 'youtube_unavailable'}
    except (errors.IpBlocked, errors.RequestBlocked, errors.PoTokenRequired):
        return {'error': 'youtube_access_blocked'}
    except requests.exceptions.Timeout:
        return {'error': 'youtube_timeout'}
    except requests.exceptions.RequestException:
        return {'error': 'youtube_network_error'}
    except ExtractionError as exc:
        return {'error': exc.code}
    except Exception:
        return {'error': 'youtube_fetch_failed'}


if __name__ == '__main__':
    resource.setrlimit(resource.RLIMIT_AS, (512*1024*1024, 512*1024*1024))
    resource.setrlimit(resource.RLIMIT_CPU, (20, 20))
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    try:
        request = json.loads(sys.stdin.buffer.read(4096))
        result = fetch(request.get('video_id'))
    except Exception:
        result = {'error': 'youtube_fetch_failed'}
    print(json.dumps(result, ensure_ascii=False))
