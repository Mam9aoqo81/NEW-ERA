from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
import uuid

import pytest
from sqlalchemy import select, func
from sqlalchemy.orm import Session

from knowlm.learning import Card, Deck, Quiz, QuizAttempt, ReviewEvent, schedule
from knowlm.worker import run_once
from test_api import client, auth, notebook

TEXT = ('تحدث عملية البناء الضوئي داخل البلاستيدات الخضراء في الخلايا النباتية. '
        'تستخدم النباتات الطاقة الضوئية لتحويل الماء وثاني أكسيد الكربون إلى سكريات. '
        'تحتوي البلاستيدات على صبغة الكلوروفيل التي تمتص الضوء من الشمس. '
        'افتتحت قناة السويس للملاحة سنة 1869 وتربط البحر المتوسط بالبحر الأحمر.')


def seed(client):
    headers = auth(client, 'student'); nid = notebook(client, headers)
    sid = client.post(f'/v1/notebooks/{nid}/sources/text', headers=headers, json={'title': 'نص اختباري', 'text': TEXT}).json()['id']
    return headers, nid, sid


def generated(client, headers, nid, sid):
    response = client.post(f'/v1/notebooks/{nid}/decks/generate', headers=headers,
                           json={'title': 'مراجعة النباتات', 'source_ids': [sid], 'count': 8})
    assert response.status_code == 201
    deck = response.json()
    assert deck['method'] == 'extractive_cloze'
    cards = client.get(f'/v1/decks/{deck["id"]}/cards', headers=headers).json()
    assert 2 <= len(cards) <= 8
    return deck, cards


def test_generated_cards_exact_sources_and_no_cross_source_leak(client):
    headers, nid, sid = seed(client)
    excluded = client.post(f'/v1/notebooks/{nid}/sources/text', headers=headers, json={'title': 'مستبعد', 'text': 'هذا النص مستبعد من توليد البطاقات ولا يجب ظهوره هنا.'}).json()['id']
    deck, cards = generated(client, headers, nid, sid)
    assert all(c['origin'] == 'extractive' and c['version'] == 1 for c in cards)
    for c in cards:
        ref = c['reference']
        assert ref['source_id'] == sid and ref['source_id'] != excluded
        assert ref['quote'] in TEXT and c['back'] in ref['quote']
        assert '____' in c['front']
        assert client.get(ref['url'], headers=headers).status_code == 200
    assert client.get(f'/v1/notebooks/{nid}/decks', headers=headers).json()[0]['id'] == deck['id']


def test_empty_and_foreign_sources_do_not_create_decks(client):
    headers, nid, sid = seed(client)
    for sources, status in (([],422),(['foreign'],404)):
        assert client.post(f'/v1/notebooks/{nid}/decks/generate', headers=headers,
                           json={'title':'لا تُحفظ', 'source_ids':sources}).status_code == status
    assert client.get(f'/v1/notebooks/{nid}/decks', headers=headers).json() == []


def test_manual_edit_soft_delete_and_version_conflict(client):
    headers, nid, _ = seed(client)
    deck = client.post(f'/v1/notebooks/{nid}/decks', headers=headers, json={'title':'يدوي'}).json()
    path = f'/v1/decks/{deck["id"]}/cards'
    card = client.post(path, headers=headers, json={'front':'السؤال', 'back':'الإجابة'}).json()
    assert card['origin'] == 'manual' and card['reference'] is None
    changed = client.put(f'/v1/cards/{card["id"]}', headers=headers, json={'front':'سؤال جديد','back':'جواب جديد','version':1})
    assert changed.status_code == 200 and changed.json()['version'] == 2
    assert changed.json()['origin'] == 'edited'
    assert client.put(f'/v1/cards/{card["id"]}', headers=headers, json={'front':'قديم','back':'قديم','version':1}).status_code == 409
    assert client.delete(f'/v1/cards/{card["id"]}', headers=headers).status_code == 204
    assert client.get(path, headers=headers).json() == []
    assert client.put(f'/v1/cards/{card["id"]}', headers=headers, json={'front':'س','back':'ج','version':2}).status_code == 404


def test_review_persists_schedule_idempotency_and_cas(client):
    headers, nid, sid = seed(client); deck, cards = generated(client, headers, nid, sid)
    card = cards[0]; path = f'/v1/cards/{card["id"]}/reviews'
    payload = {'rating':'good','card_version':1,'state_version':0,'request_id':str(uuid.uuid4())}
    start = datetime.now(timezone.utc)
    result = client.post(path, headers=headers, json=payload)
    assert result.status_code == 200
    assert result.json()['algorithm'] == 'sm2_variant' and result.json()['interval_days'] == 1
    assert datetime.fromisoformat(result.json()['due_at']) >= start + timedelta(days=1)
    assert client.post(path, headers=headers, json=payload).json() == result.json()
    assert client.post(path, headers=headers, json={**payload,'request_id':str(uuid.uuid4())}).status_code == 409
    assert client.post(path, headers=headers, json={**payload,'rating':'easy'}).status_code == 409
    due = client.get(f'/v1/decks/{deck["id"]}/cards?due_only=true', headers=headers).json()
    assert card['id'] not in [c['id'] for c in due]
    with Session(client.app.state.engine) as session:
        assert session.scalar(select(func.count()).select_from(ReviewEvent)) == 1
    # Editing invalidates the old scheduling state but preserves event audit.
    changed = client.put(f'/v1/cards/{card["id"]}', headers=headers, json={'front':'جديد','back':'جديد','version':1}).json()
    assert changed['review']['version'] == 0 and changed['review']['due']
    assert client.post(path, headers=headers, json={'rating':'good','card_version':1,'state_version':0}).status_code == 409


def test_schedule_deterministic_lapse_and_bounds():
    at = datetime(2026,11,27,tzinfo=timezone.utc)
    first = schedule(None,'good',at)
    assert first['interval_days'] == 1 and first['repetitions'] == 1
    second = schedule(SimpleNamespace(**first),'good',at)
    assert second['interval_days'] == 6
    third = schedule(SimpleNamespace(**second),'good',at)
    assert third['interval_days'] == 15
    lapse = schedule(SimpleNamespace(**third),'again',at)
    assert lapse['repetitions'] == 0 and lapse['due_at'] == at + timedelta(minutes=10)
    state = SimpleNamespace(version=99,repetitions=99,ease=1.3,interval_days=999999999)
    assert schedule(state,'again',at)['ease'] == 1.3
    assert schedule(state,'easy',at)['interval_days'] == 36500


def test_quiz_answers_hidden_server_grading_and_saved_attempt(client):
    headers, nid, sid = seed(client); deck, _ = generated(client, headers, nid, sid)
    quiz = client.post(f'/v1/decks/{deck["id"]}/quizzes', headers=headers, json={'count':3})
    assert quiz.status_code == 201
    quiz = quiz.json()
    assert all(set(q) == {'id','prompt','choices'} for q in quiz['questions'])
    with Session(client.app.state.engine) as session:
        private = session.get(Quiz,quiz['id'])
        correct = {q['id']:q['correct_index'] for q in private.questions}
    payload = {'request_id':str(uuid.uuid4()),'answers':correct}
    path = f'/v1/quizzes/{quiz["id"]}/attempts'
    score = client.post(path, headers=headers, json=payload)
    assert score.status_code == 201
    assert score.json()['correct'] == score.json()['total'] == len(quiz['questions'])
    assert all(q['correct'] and q['reference'] for q in score.json()['questions'])
    assert client.post(path, headers=headers, json=payload).json() == score.json()
    assert len(client.get(path, headers=headers).json()) == 1
    assert client.get(f'/v1/quizzes/{quiz["id"]}', headers=headers).json() == quiz
    with Session(client.app.state.engine) as session:
        assert session.scalar(select(func.count()).select_from(QuizAttempt)) == 1
    # The old quiz is a snapshot: editing a card cannot change its grading key.
    card = client.get(f'/v1/decks/{deck["id"]}/cards',headers=headers).json()[0]
    client.put(f'/v1/cards/{card["id"]}',headers=headers,json={'front':'جديد','back':'جديد','version':1})
    assert client.get(f'/v1/quizzes/{quiz["id"]}',headers=headers).json() == quiz


@pytest.mark.parametrize('answers',[{}, {'foreign':0}, {'foreign':True,'another':1}])
def test_invalid_quiz_attempts_not_saved(client,answers):
    headers,nid,sid=seed(client);deck,_=generated(client,headers,nid,sid)
    quiz=client.post(f'/v1/decks/{deck["id"]}/quizzes',headers=headers,json={'count':2}).json()
    path=f'/v1/quizzes/{quiz["id"]}/attempts'
    assert client.post(path,headers=headers,json={'answers':answers}).status_code == 422
    assert client.get(path,headers=headers).json() == []


def test_need_distinct_answers_for_quiz(client):
    headers,nid,_=seed(client)
    deck=client.post(f'/v1/notebooks/{nid}/decks',headers=headers,json={'title':'فارغة'}).json()
    assert client.post(f'/v1/decks/{deck["id"]}/quizzes',headers=headers,json={}).status_code == 422


def test_learning_routes_are_owner_scoped(client):
    headers,nid,sid=seed(client);deck,cards=generated(client,headers,nid,sid)
    other=auth(client,'another_student')
    quiz=client.post(f'/v1/decks/{deck["id"]}/quizzes',headers=headers,json={}).json()
    requests=[('GET',f'/v1/notebooks/{nid}/decks',None),('POST',f'/v1/notebooks/{nid}/decks',{'title':'bad'}),
              ('GET',f'/v1/decks/{deck["id"]}/cards',None),('POST',f'/v1/decks/{deck["id"]}/cards',{'front':'s','back':'s'}),
              ('PUT',f'/v1/cards/{cards[0]["id"]}',{'front':'s','back':'s','version':1}),('DELETE',f'/v1/cards/{cards[0]["id"]}',None),
              ('POST',f'/v1/cards/{cards[0]["id"]}/reviews',{'rating':'good','card_version':1,'state_version':0}),
              ('GET',f'/v1/quizzes/{quiz["id"]}',None),('GET',f'/v1/quizzes/{quiz["id"]}/attempts',None),
              ('POST',f'/v1/quizzes/{quiz["id"]}/attempts',{'answers':{q['id']:0 for q in quiz['questions']}})]
    for method,path,body in requests:
        assert client.request(method,path,headers=other,json=body).status_code == 404
    assert client.get(f'/v1/decks/{deck["id"]}/cards').status_code == 401


@pytest.mark.parametrize('kind',['study_guide','faq','briefing','timeline'])
def test_study_outputs_are_exact_saved_and_private(client,kind):
    headers,nid,sid=seed(client)
    path=f'/v1/notebooks/{nid}/study-artifacts'
    output=client.post(path,headers=headers,json={'kind':kind,'source_ids':[sid]})
    assert output.status_code == 201
    data=output.json()
    assert data['method'] == 'extractive'
    assert all(b['text'] in TEXT and b['text']==b['reference']['quote'] for b in data['blocks'])
    if kind=='timeline':assert data['blocks'][0]['year']==1869
    assert client.get(path,headers=headers).json()[0] == data
    other=auth(client,'another_student')
    assert client.get(path,headers=other).status_code == 404
    assert client.post(path,headers=headers,json={'kind':kind,'source_ids':[]}).status_code == 422


def test_youtube_flashcards_keep_timestamp_citations(client):
    headers=auth(client,'student');nid=notebook(client,headers)
    captions='WEBVTT\n\n00:00:15.000 --> 00:00:29.000\nتحدث عملية البناء الضوئي داخل البلاستيدات الخضراء في الخلايا النباتية.\n'
    sid=client.post(f'/v1/notebooks/{nid}/sources/youtube-jobs',headers=headers,json={'url':'https://youtu.be/aB3dE5gH7jK','captions':captions}).json()['source_id']
    assert run_once(client.app.state.engine)
    response=client.post(f'/v1/notebooks/{nid}/decks/generate',headers=headers,json={'title':'فيديو','source_ids':[sid]})
    assert response.status_code == 201
    cards=client.get(f'/v1/decks/{response.json()["id"]}/cards',headers=headers).json()
    assert cards[0]['reference']['start_seconds']==15
    assert cards[0]['reference']['page'] is None
    assert cards[0]['reference']['media_url'].endswith('&t=15s')


def test_mindmap_graph_is_saved_bounded_and_exactly_source_linked(client):
    headers, nid, sid = seed(client)
    second = client.post(f'/v1/notebooks/{nid}/sources/text', headers=headers,
                         json={'title': 'نص اختباري', 'text': 'هذه فقرة مستقلة تصف دورة الماء وتبخر المياه من البحار والمحيطات.'}).json()['id']
    path = f'/v1/notebooks/{nid}/study-artifacts'
    response = client.post(path, headers=headers, json={'kind': 'mindmap', 'source_ids': [sid, second]})
    assert response.status_code == 201
    data = response.json(); graph = data['graph']
    assert graph['relation_semantics'] == 'source_containment_only'
    assert len(data['blocks']) <= 20
    nodes = {n['id']: n for n in graph['nodes']}
    assert len(nodes) == len(graph['nodes'])
    assert nodes['root']['kind'] == 'root'
    assert len([n for n in nodes.values() if n['kind'] == 'source']) == 2
    passages = [n for n in nodes.values() if n['kind'] == 'passage']
    assert len(passages) == len(data['blocks'])
    for edge in graph['edges']:
        assert edge['relation'] == 'contains'
        assert edge['from'] in nodes and edge['to'] in nodes
        child = nodes[edge['to']]
        if child['kind'] == 'passage':
            assert edge['from'] == 'source:' + child['reference']['source_id']
            assert child['label'] == child['reference']['quote']
            assert client.get(child['reference']['url'], headers=headers).status_code == 200
        else:
            assert edge['from'] == 'root' and child['kind'] == 'source'
    assert len(graph['edges']) == len(nodes) - 1
    assert client.get(path, headers=headers).json()[0] == data
    # Source selection must also apply to the graph, not only to text blocks.
    selected = client.post(path, headers=headers, json={'kind': 'mindmap', 'source_ids': [second]}).json()
    assert [n['id'] for n in selected['graph']['nodes'] if n['kind'] == 'source'] == ['source:' + second]
    other = auth(client, 'map_outsider')
    assert client.get(path, headers=other).status_code == 404
    assert client.post(path, headers=other, json={'kind':'mindmap','source_ids':[sid]}).status_code == 404
    assert client.post(path, headers=headers, json={'kind':'mindmap','source_ids':[]}).status_code == 422


def test_non_map_artifacts_do_not_change_response_shape(client):
    headers, nid, sid = seed(client)
    response = client.post(f'/v1/notebooks/{nid}/study-artifacts', headers=headers,
                           json={'kind':'briefing','source_ids':[sid]})
    assert response.status_code == 201
    assert 'graph' not in response.json()


def test_youtube_mindmap_uses_timed_private_references(client):
    headers = auth(client, 'student'); nid = notebook(client, headers)
    captions = 'WEBVTT\n\n00:00:15.000 --> 00:00:29.000\nتحدث عملية البناء الضوئي داخل البلاستيدات الخضراء في الخلايا النباتية.\n'
    sid = client.post(f'/v1/notebooks/{nid}/sources/youtube-jobs', headers=headers,
                      json={'url':'https://youtu.be/aB3dE5gH7jK','captions':captions}).json()['source_id']
    assert run_once(client.app.state.engine)
    response = client.post(f'/v1/notebooks/{nid}/study-artifacts', headers=headers,
                           json={'kind':'mindmap','source_ids':[sid]})
    assert response.status_code == 201
    passage = next(n for n in response.json()['graph']['nodes'] if n['kind']=='passage')
    ref = passage['reference']
    assert ref['page'] is None and ref['start_seconds'] == 15
    assert ref['media_url'].endswith('&t=15s')
    assert client.get(ref['url'], headers=headers).status_code == 200
    assert client.get(ref['url']).status_code == 401
