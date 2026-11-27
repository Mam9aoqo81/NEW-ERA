"""Deterministic lexical retrieval: BM25 + character n-gram ranking.

No embeddings or semantic equivalence are claimed. All candidates must already
be permission-filtered by the caller. Character matches cannot bypass the
minimum word-coverage gate.
"""
from collections import Counter
from dataclasses import dataclass
import math
import re
import unicodedata

STOP = {'ما', 'هي', 'هو', 'في', 'من', 'عن', 'على', 'كيف', 'هل', 'اشرح', 'و',
        'اين', 'ماذا', 'اذكر', 'التي', 'الذي', 'the', 'is', 'a', 'an', 'what',
        'of', 'in', 'explain', 'where', 'does', 'do', 'and', 'to', 'how', 'are'}


def normalize(text):
    text = ''.join(c for c in unicodedata.normalize('NFKD', text.lower()) if not unicodedata.combining(c))
    return re.sub('[إأآ]', 'ا', text).replace('ى', 'ي').replace('ـ', '')


def words(text):
    result = []
    for word in re.findall(r'\w+', normalize(text)):
        if word in STOP or len(word) < 2:
            continue
        # A deliberately conservative Arabic definite-article normalization.
        if word.startswith('ال') and len(word) > 4:
            word = word[2:]
        result.append(word)
    return result


@dataclass(frozen=True)
class Evidence:
    chunk_id: str
    source_id: str
    title: str
    page: int
    text: str
    start_seconds: float | None = None
    end_seconds: float | None = None
    external_url: str | None = None
    transcript_origin: str | None = None


@dataclass(frozen=True)
class RetrievalHit:
    evidence: Evidence
    score: float
    coverage: float


def grams(text):
    text = ' '.join(words(text))
    return Counter(text[i:i + 3] for i in range(max(0, len(text) - 2)))


def cosine(a, b):
    denominator = math.sqrt(sum(v*v for v in a.values()) * sum(v*v for v in b.values()))
    return sum(v * b.get(k, 0) for k, v in a.items()) / denominator if denominator else 0.0


def retrieve(question, candidates, limit=3):
    terms = set(words(question))
    if not terms or not candidates:
        return []
    documents = [Counter(words(c.text)) for c in candidates]
    lengths = [sum(d.values()) for d in documents]
    average = sum(lengths) / max(len(lengths), 1) or 1
    frequencies = {t: sum(t in d for d in documents) for t in terms}
    eligible, lexical, character = {}, {}, {}
    qgrams = grams(question)
    for i, (candidate, document) in enumerate(zip(candidates, documents)):
        overlap = terms & document.keys()
        coverage = len(overlap) / len(terms)
        if not overlap or coverage < 0.5:
            continue
        score = 0.0
        for term in terms:
            tf = document.get(term, 0)
            idf = math.log(1 + (len(documents) - frequencies[term] + 0.5) / (frequencies[term] + 0.5))
            score += idf * tf * 2.2 / (tf + 1.2 * (0.25 + 0.75 * lengths[i] / average))
        eligible[i] = coverage
        lexical[i] = score
        character[i] = cosine(qgrams, grams(candidate.text))
    # Reciprocal rank fusion avoids mixing incompatible score magnitudes.
    ranks = {}
    for scores in (lexical, character):
        ordered = sorted(scores, key=lambda i: (-scores[i], candidates[i].chunk_id))
        for rank, i in enumerate(ordered, 1):
            ranks[i] = ranks.get(i, 0) + 1 / (60 + rank)
    ordered = sorted(ranks, key=lambda i: (-ranks[i], candidates[i].chunk_id))
    # Avoid returning near-identical overlapping chunks from the same source/page.
    selected = []
    for i in ordered:
        candidate = candidates[i]
        duplicate = False
        for hit in selected:
            old = hit.evidence
            if old.source_id == candidate.source_id and old.page == candidate.page and old.start_seconds == candidate.start_seconds:
                a, b = set(words(old.text)), set(words(candidate.text))
                if len(a & b) / max(len(a | b), 1) >= 0.85:
                    duplicate = True
                    break
        if not duplicate:
            selected.append(RetrievalHit(candidate, ranks[i], eligible[i]))
        if len(selected) == limit:
            break
    return selected
