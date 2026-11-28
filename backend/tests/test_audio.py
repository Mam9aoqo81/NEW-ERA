import io
import wave
import httpx
import pytest
from fastapi.testclient import TestClient
from knowlm.main import create_app
from knowlm.audio import AudioError, SpeechProvider, pcm, render_dialogue
from test_api import auth, notebook


def wav(rate=8000):
    out=io.BytesIO()
    with wave.open(out,'wb') as f:
        f.setnchannels(1); f.setsampwidth(2); f.setframerate(rate); f.writeframes(b'\0\0'*80)
    return out.getvalue()


class FakeSpeech:
    def __init__(self): self.calls=[]
    def render(self,text,speaker,timeout):
        self.calls.append((text,speaker))
        return wav()


def test_wav_stitching_is_real_pcm_and_rejects_invalid_outputs():
    fake=FakeSpeech()
    data=render_dialogue(fake,[{'text':'question','speaker':'host'},{'text':'quote','speaker':'reader'}])
    with wave.open(io.BytesIO(data),'rb') as f:
        assert f.getnframes()==160 and f.getframerate()==8000
    assert fake.calls==[('question','host'),('quote','reader')]
    for raw in [b'not wav',wav()[:-10]]:
        with pytest.raises(AudioError): pcm(raw)
    with pytest.raises(AudioError):render_dialogue(fake,[])
    with pytest.raises(AudioError):render_dialogue(fake,[{'text':'x'*8001,'speaker':'reader'}])
    class Different:
        def render(self,text,speaker,timeout):return wav(8000 if speaker=='host' else 16000)
    with pytest.raises(AudioError):render_dialogue(Different(),[{'text':'a','speaker':'host'},{'text':'b','speaker':'reader'}])


def test_provider_request_and_errors_are_bounded_and_sanitized():
    def handler(request):
        assert request.url.path=='/v1/audio/speech'
        assert b'"voice":"reader"' in request.content
        return httpx.Response(200,content=wav())
    provider=SpeechProvider('https://speech.example/v1','secret','tts','host','reader',httpx.MockTransport(handler))
    assert pcm(provider.render('private','reader',10))[0]==(1,2,8000)
    provider.transport=httpx.MockTransport(lambda r:httpx.Response(500,text='secret private'))
    with pytest.raises(AudioError, match='^Speech service unavailable$'):provider.render('private','reader',10)
    with pytest.raises(ValueError):SpeechProvider('http://bad','key','model','a','b')


def test_audio_authorization_consent_and_valid_download(tmp_path):
    provider=FakeSpeech()
    app=create_app(f'sqlite:///{tmp_path / "audio.db"}',speech_provider=provider)
    with TestClient(app) as client:
        owner=auth(client,'audioowner');other=auth(client,'audioother');nid=notebook(client,owner)
        client.post(f'/v1/notebooks/{nid}/sources/text',headers=owner,json={'title':'مصدر','text':'تحدث عملية البناء الضوئي داخل البلاستيدات الخضراء في الخلايا النباتية.'})
        artifact=client.post(f'/v1/notebooks/{nid}/study-artifacts',headers=owner,json={'kind':'podcast'}).json()
        url=f'/v1/study-artifacts/{artifact["id"]}/audio'
        assert client.get('/v1/audio/config',headers=owner).json()['enabled'] is True
        assert client.post(url,json={'consent':True}).status_code==401
        assert client.post(url,headers=other,json={'consent':True}).status_code==404
        assert provider.calls==[]
        assert client.post(url,headers=owner,json={'consent':False}).status_code==422
        assert client.post(url,headers=owner,json={'consent':'true'}).status_code==422
        assert provider.calls==[]
        response=client.post(url,headers=owner,json={'consent':True})
        assert response.status_code==200,response.text
        assert response.headers['content-type']=='audio/wav'
        assert response.headers['cache-control']=='no-store'
        import json
        cues=json.loads(response.headers['x-knowlm-audio-cues'])
        assert len(cues)==len(artifact['blocks'])
        assert cues[0]['start']==0 and cues[-1]['end']==0.01*len(cues)
        assert len(provider.calls)==len(artifact['blocks'])
        assert pcm(response.content)[0]==(1,2,8000)
        assert client.post(url,headers=owner,json={'consent':True}).status_code==429
        assert len(provider.calls)==len(artifact['blocks'])
    app.state.engine.dispose()


def test_deleted_notebook_cannot_return_inflight_audio(tmp_path):
    from sqlalchemy.orm import Session
    from knowlm.privacy import erase_notebook
    class DeletingSpeech(FakeSpeech):
        def render(self,text,speaker,timeout):
            if not self.calls:
                with Session(app.state.engine) as session:
                    erase_notebook(session,nid);session.commit()
            return super().render(text,speaker,timeout)
    provider=DeletingSpeech()
    app=create_app(f'sqlite:///{tmp_path / "delete.db"}',speech_provider=provider)
    with TestClient(app) as client:
        owner=auth(client,'deleted_audio');nid=notebook(client,owner)
        client.post(f'/v1/notebooks/{nid}/sources/text',headers=owner,json={'title':'مصدر','text':'تحدث عملية البناء الضوئي داخل البلاستيدات الخضراء في الخلايا النباتية.'})
        artifact=client.post(f'/v1/notebooks/{nid}/study-artifacts',headers=owner,json={'kind':'podcast'}).json()
        assert client.post(f'/v1/study-artifacts/{artifact["id"]}/audio',headers=owner,json={'consent':True}).status_code==404
    app.state.engine.dispose()


def test_cues_are_measured_from_pcm_frames_not_estimated_text_length():
    provider=FakeSpeech()
    raw,cues=render_dialogue(provider,[{'text':'long text'*100,'speaker':'host'},{'text':'b','speaker':'reader'}],include_cues=True)
    assert cues==[{'index':0,'start':0,'end':0.01},{'index':1,'start':0.01,'end':0.02}]
    with wave.open(io.BytesIO(raw),'rb') as f:
        assert cues[-1]['end']==f.getnframes()/f.getframerate()
