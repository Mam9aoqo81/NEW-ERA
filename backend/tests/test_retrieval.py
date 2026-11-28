from knowlm.evaluate import evaluate
from knowlm.retrieval import Evidence, retrieve, words


def test_authored_regression_set():
    report = evaluate()
    assert len(report['results']) >= 20
    assert all(row['passed'] for row in report['results']), report


def test_arabic_normalization():
    assert words('الْبِنَاءُ الضَّوْئِيُّ') == words('بناء ضوئي')
    assert not retrieve('ما هي', [Evidence('a', 's', 'source', 1, 'ما هي')])


def test_duplicates_do_not_fill_context():
    candidates = [Evidence(str(i), 'same', 'source', 1, 'Photosynthesis uses sunlight to produce food.') for i in range(4)]
    assert len(retrieve('photosynthesis sunlight', candidates)) == 1


def test_conflicting_sources_are_not_silently_collapsed():
    candidates = [Evidence('a', 'one', 'first', 1, 'The opening date was 1869.'),
                  Evidence('b', 'two', 'second', 1, 'The opening date was 1870.')]
    hits = retrieve('opening date', candidates)
    assert {h.evidence.source_id for h in hits} == {'one', 'two'}
