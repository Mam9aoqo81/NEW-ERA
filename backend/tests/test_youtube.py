from types import SimpleNamespace

import pytest
import requests
from youtube_transcript_api import _errors as yt_errors

from knowlm.pdf import ExtractionError
from knowlm.worker import run_once
from knowlm.youtube import canonical_video, normalize_segments, parse_captions, transcript_chunks
from knowlm.youtube_child import fetch
from test_api import client, auth, notebook

VIDEO = 'aB3dE5gH7jK'
CAPTIONS = '''WEBVTT

00:00:15.000 --> 00:00:22.500
تستخدم النباتات ضوء الشمس في عملية البناء الضوئي.

00:00:23.000 --> 00:00:29.000
تحتوي البلاستيدات الخضراء على صبغة الكلوروفيل.
'''


@pytest.mark.parametrize('url', [
    f'https://www.youtube.com/watch?v={VIDEO}&list=ignored&t=25',
    f'https://youtu.be/{VIDEO}?si=ignored',
    f'https://m.youtube.com/watch?v={VIDEO}',
    f'https://youtube.com/shorts/{VIDEO}',
    f'https://www.youtube.com/embed/{VIDEO}',
    f'https://youtube.com/live/{VIDEO}',
    f'https://www.youtube-nocookie.com/embed/{VIDEO}',
])
def test_canonical_youtube_links(url):
    assert canonical_video(url) == (VIDEO, f'https://www.youtube.com/watch?v={VIDEO}')


@pytest.mark.parametrize('url', [
    'http://127.0.0.1/private', 'https://youtube.com.evil.test/watch?v='+VIDEO,
    'https://youtube.com@evil.test/watch?v='+VIDEO, 'https://evil.test@youtube.com/watch?v='+VIDEO,
    'file:///etc/passwd', 'https://youtube.com/playlist?list=anything',
    'https://youtube.com/redirect?q=http://127.0.0.1', 'https://youtu.be/short',
    'https://youtube.com:8443/watch?v='+VIDEO, 'https://youtube.com/watch?v='+VIDEO+'&v='+VIDEO,
    'https://youtu.be/'+VIDEO+'/extra', 'https://youtube.com\\@evil.test/watch?v='+VIDEO,
    'https://youtube.com/watch?v=bad%0Avalue', 'https://youtu.be/'+VIDEO+'\n/evil',
])
def test_rejects_non_video_and_unsafe_links(url):
    with pytest.raises(ValueError):
        canonical_video(url)


def test_caption_parser_and_chunk_timing():
    segments = parse_captions(CAPTIONS)
    assert segments[0]['start'] == 15 and segments[0]['duration'] == 7.5
    chunks = transcript_chunks(segments)
    assert chunks[0]['start_seconds'] == 15 and chunks[0]['end_seconds'] == 29
    srt = '1\n00:01:02,300 --> 00:01:05,000\nA timed <b>caption</b> &amp; text.\n'
    parsed = parse_captions(srt)[0]
    assert parsed['start'] == 62.3 and parsed['duration'] == pytest.approx(2.7)
    assert parsed['text'] == 'A timed caption & text.'
    long = transcript_chunks([{'start': 10, 'duration': 4, 'text': 'a'*2500}])
    assert len(long) == 3 and all(c['start_seconds'] == 10 and len(c['text']) <= 1000 for c in long)


@pytest.mark.parametrize('text', ['plain untimed text', '00:00:05.000 --> 00:00:02.000\nBackwards',
                                 'WEBVTT\n\n00:70:00.000 --> 00:70:10.000\nBad minutes'])
def test_rejects_invalid_caption_files(text):
    with pytest.raises(ExtractionError):
        parse_captions(text)


@pytest.mark.parametrize('start,duration', [(float('nan'),2),(1,float('inf')),(-1,2),(1,0),(True,2),(86400,2)])
def test_rejects_bad_segment_times(start, duration):
    with pytest.raises(ExtractionError):
        normalize_segments([{'text':'caption','start':start,'duration':duration}])


def enqueue(c, headers, nid, **extra):
    return c.post(f'/v1/notebooks/{nid}/sources/youtube-jobs', headers=headers,
                  json={'url':f'https://youtu.be/{VIDEO}', 'title':'محاضرة النباتات', **extra})


def test_timed_source_worker_citations_history_and_isolation(client):
    headers = auth(client, 'student')
    nid = notebook(client, headers)
    response = enqueue(client, headers, nid, captions=CAPTIONS)
    assert response.status_code == 202
    job = response.json()
    assert run_once(client.app.state.engine, youtube_extractor=lambda _: pytest.fail('manual captions must not make a network call'))
    sources = client.get(f'/v1/notebooks/{nid}/sources', headers=headers).json()
    assert sources[0]['status'] == 'ready'
    assert sources[0]['external_url'] == f'https://www.youtube.com/watch?v={VIDEO}'
    assert sources[0]['transcript_origin'] == 'user_captions'
    result = client.post(f'/v1/notebooks/{nid}/ask', headers=headers, json={'question':'البناء الضوئي'}).json()
    citation = result['citations'][0]
    assert citation['page'] is None and citation['locator_type'] == 'timestamp'
    assert citation['start_seconds'] == 15 and citation['end_seconds'] == 29
    assert citation['media_url'] == f'https://www.youtube.com/watch?v={VIDEO}&t=15s'
    page = client.get(citation['url'], headers=headers).json()
    assert page['chunks'][0]['text'] == citation['quote']
    other = auth(client, 'another_student')
    assert client.get(citation['url'], headers=other).status_code == 404
    assert client.get(job['status_url'], headers=other).status_code == 404
    assert client.post(f'/v1/notebooks/{nid}/sources/youtube-jobs', headers=other,
                       json={'url':f'https://youtu.be/{VIDEO}'}).status_code == 404
    assert client.get(f'/v1/notebooks/{nid}/history', headers=headers).json()['turns'][0]['answer']['citations'] == result['citations']


def test_remote_caption_adapter_worker_and_safe_failure(client):
    headers = auth(client,'student')
    nid = notebook(client,headers)
    job = enqueue(client,headers,nid).json()
    def blocked(video_id):
        assert video_id == VIDEO
        raise ExtractionError('youtube_access_blocked')
    assert run_once(client.app.state.engine,youtube_extractor=blocked)
    state = client.get(job['status_url'],headers=headers).json()
    assert state['error_code'] == 'youtube_access_blocked' and state['status'] == 'failed'
    assert client.post(job['status_url']+'/retry',headers=headers).status_code == 202
    assert run_once(client.app.state.engine,youtube_extractor=lambda _:parse_captions(CAPTIONS))
    assert client.get(job['status_url'],headers=headers).json()['status'] == 'completed'
    assert client.get(f'/v1/notebooks/{nid}/sources',headers=headers).json()[0]['transcript_origin'] == 'youtube_captions'


def test_reject_before_queueing(client):
    headers=auth(client,'student');nid=notebook(client,headers)
    assert enqueue(client,headers,nid,url='http://127.0.0.1/').status_code == 422
    assert enqueue(client,headers,nid,captions='untimed text').status_code == 422
    assert client.get(f'/v1/notebooks/{nid}/sources',headers=headers).json() == []


def test_caption_network_library_contract_without_live_network():
    class Transcript:
        def fetch(self):
            return [SimpleNamespace(text='Photosynthesis uses sunlight.', start=31, duration=5)]
    class List:
        def find_transcript(self,languages):
            assert languages == ['ar','en']
            return Transcript()
    class Client:
        def list(self,video_id):
            assert video_id == VIDEO
            return List()
    assert fetch(VIDEO,Client()) == {'segments':[{'text':'Photosynthesis uses sunlight.','start':31.0,'duration':5.0}]}


@pytest.mark.parametrize('exception,code', [
    (yt_errors.TranscriptsDisabled(VIDEO),'youtube_no_captions'),
    (yt_errors.VideoUnavailable(VIDEO),'youtube_unavailable'),
    (yt_errors.RequestBlocked(VIDEO),'youtube_access_blocked'),
    (requests.exceptions.Timeout(),'youtube_timeout'),
    (requests.exceptions.ConnectionError('private details'),'youtube_network_error'),
])
def test_public_network_failure_mapping(exception,code):
    class Client:
        def list(self,video_id):raise exception
    assert fetch(VIDEO,Client()) == {'error':code}


def test_disabled_network_still_allows_user_caption_import(client, monkeypatch):
    from knowlm.youtube import fetch_transcript
    monkeypatch.setenv('KNOWLM_YOUTUBE_FETCH_ENABLED','0')
    headers=auth(client,'student');nid=notebook(client,headers)
    assert client.get('/health').json()['youtube_auto_fetch_enabled'] is False
    assert enqueue(client,headers,nid).status_code == 503
    assert enqueue(client,headers,nid,captions=CAPTIONS).status_code == 202
    assert run_once(client.app.state.engine)
    with pytest.raises(ExtractionError) as error:
        fetch_transcript(VIDEO)
    assert error.value.code == 'youtube_network_disabled'


def test_subprocess_caption_contract_and_timeout(monkeypatch):
    import subprocess
    from knowlm.youtube import fetch_transcript
    monkeypatch.setenv('KNOWLM_YOUTUBE_FETCH_ENABLED','1')
    def fake_run(command, **kwargs):
        import json
        assert command[-1] == 'knowlm.youtube_child'
        assert json.loads(kwargs['input']) == {'video_id':VIDEO}
        assert kwargs['timeout'] == 45
        return SimpleNamespace(returncode=0,stdout=json.dumps({'segments':parse_captions(CAPTIONS)}).encode())
    monkeypatch.setattr(subprocess,'run',fake_run)
    assert fetch_transcript(VIDEO)[0]['start'] == 15
    def timeout(*args,**kwargs):raise subprocess.TimeoutExpired('worker',45)
    monkeypatch.setattr(subprocess,'run',timeout)
    with pytest.raises(ExtractionError) as error:fetch_transcript(VIDEO)
    assert error.value.code == 'youtube_timeout'
