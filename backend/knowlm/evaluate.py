"""Repeatable lexical retrieval evaluation, entirely offline.

Run: PYTHONPATH=backend python -m knowlm.evaluate --check
"""
import argparse
import json
from pathlib import Path

from knowlm.retrieval import Evidence, retrieve

DEFAULT_DATA = Path(__file__).resolve().parents[1] / 'evaluation' / 'retrieval.json'


def evaluate(path=DEFAULT_DATA):
    dataset = json.loads(Path(path).read_text())
    corpus = [Evidence(s['id'], s['id'], s['id'], 1, s['text']) for s in dataset['sources']]
    results, groups = [], {}
    for case in dataset['cases']:
        actual = [hit.evidence.source_id for hit in retrieve(case['question'], corpus)]
        expected = set(case['expected'])
        recall = len(expected & set(actual)) / len(expected) if expected else None
        passed = recall == 1 if expected else not actual
        results.append({'id': case['id'], 'language': case['language'], 'expected': sorted(expected),
                        'actual': actual, 'recall_at_3': recall, 'passed': passed})
    for language in sorted({r['language'] for r in results} | {'all'}):
        rows = [r for r in results if language == 'all' or r['language'] == language]
        positive = [r for r in rows if r['expected']]
        negative = [r for r in rows if not r['expected']]
        groups[language] = {
            'cases': len(rows), 'passed': sum(r['passed'] for r in rows),
            'recall_at_3': sum(r['recall_at_3'] for r in positive) / len(positive) if positive else None,
            'top_1_hit_rate': sum(bool(r['actual']) and r['actual'][0] in r['expected'] for r in positive) / len(positive) if positive else None,
            'unanswerable_refusal_rate': sum(not r['actual'] for r in negative) / len(negative) if negative else None,
        }
    return {'dataset': str(path), 'retrieval': 'bm25_char_rrf',
            'warning': 'Synthetic regression set; does not measure semantic grounding, model quality, or production accuracy.',
            'summary': groups, 'results': results}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--dataset', type=Path, default=DEFAULT_DATA)
    parser.add_argument('--check', action='store_true', help='Fail if any regression case fails')
    args = parser.parse_args()
    report = evaluate(args.dataset)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if args.check and not all(row['passed'] for row in report['results']):
        raise SystemExit(1)


if __name__ == '__main__':
    main()
