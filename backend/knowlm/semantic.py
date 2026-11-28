"""Opt-in bounded embedding retrieval. No private text is sent by default.

Vectors are request-scoped, never a cross-user cache. This exact-search adapter
is intentionally not a persistent pgvector index or a production relevance eval.
"""
import math
import os
from typing import Protocol
from urllib.parse import urlparse

import httpx

from knowlm.retrieval import RetrievalHit, retrieve


class EmbeddingError(Exception):
    pass


class EmbeddingProvider(Protocol):
    def embed(self, texts: list[str]) -> list[list[float]]: ...


def vectors_checked(vectors, count):
    if not isinstance(vectors, list) or len(vectors) != count:
        raise EmbeddingError('Invalid embedding response')
    dimension = None
    normalized = []
    for vector in vectors:
        if not isinstance(vector, list) or not 1 <= len(vector) <= 4096:
            raise EmbeddingError('Invalid embedding dimensions')
        if dimension is None:
            dimension = len(vector)
        if len(vector) != dimension or any(type(v) not in (int, float) or not math.isfinite(v) for v in vector):
            raise EmbeddingError('Invalid embedding values')
        norm = math.hypot(*vector)
        if not math.isfinite(norm) or norm == 0:
            raise EmbeddingError('Invalid embedding norm')
        normalized.append([v / norm for v in vector])
    return normalized


class OpenAIEmbeddings:
    def __init__(self, base_url, api_key, model, transport=None):
        parsed = urlparse(base_url)
        if parsed.scheme != 'https' or not parsed.netloc or parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise ValueError('Embedding base URL must use HTTPS without credentials or query')
        self.base_url, self.api_key, self.model, self.transport = base_url.rstrip('/'), api_key, model, transport

    def embed(self, texts):
        try:
            with httpx.Client(timeout=httpx.Timeout(30, connect=10), follow_redirects=False, transport=self.transport) as client:
                with client.stream('POST', self.base_url + '/embeddings',
                                   headers={'Authorization': f'Bearer {self.api_key}'},
                                   json={'model': self.model, 'input': texts, 'encoding_format': 'float'}) as response:
                    response.raise_for_status()
                    raw = bytearray()
                    for block in response.iter_bytes():
                        raw.extend(block)
                        if len(raw) > 8_000_000:
                            raise EmbeddingError('Embedding response exceeded size limit')
            import json
            data = json.loads(raw)['data']
            if not isinstance(data, list) or len(data) != len(texts):
                raise EmbeddingError('Invalid embedding count')
            indexed = {}
            for row in data:
                index = row['index']
                if type(index) is not int or not 0 <= index < len(texts) or index in indexed:
                    raise EmbeddingError('Invalid embedding index')
                indexed[index] = row['embedding']
            return vectors_checked([indexed[i] for i in range(len(texts))], len(texts))
        except (httpx.HTTPError, ValueError, KeyError, TypeError, IndexError, OverflowError):
            raise EmbeddingError('Embedding service unavailable or returned an invalid response') from None


def embedding_provider_from_env():
    if os.getenv('KNOWLM_EMBEDDINGS_ENABLED', '0') != '1':
        return None
    key, model = os.getenv('KNOWLM_EMBEDDINGS_API_KEY'), os.getenv('KNOWLM_EMBEDDINGS_MODEL')
    if not key or not model:
        raise ValueError('Enabled embeddings require an API key and model')
    return OpenAIEmbeddings(os.getenv('KNOWLM_EMBEDDINGS_BASE_URL', 'https://api.openai.com/v1'), key, model)


def hybrid_retrieve(question, candidates, provider, limit=3, threshold=0.65):
    if not candidates:
        return []
    # Never silently truncate a notebook: user must explicitly narrow selection.
    if len(candidates) > 128 or sum(len(c.text) for c in candidates) + len(question) > 100_000:
        raise EmbeddingError('Selected sources exceed semantic retrieval budget')
    vectors = vectors_checked(provider.embed([question] + [c.text for c in candidates]), len(candidates) + 1)
    scores = {c.chunk_id: sum(a*b for a, b in zip(vectors[0], vector))
              for c, vector in zip(candidates, vectors[1:])}
    semantic = sorted((c for c in candidates if scores[c.chunk_id] >= threshold),
                      key=lambda c: (-scores[c.chunk_id], c.chunk_id))
    lexical = retrieve(question, candidates, limit=len(candidates))
    # Require semantic agreement even for lexical matches; never fall back after
    # an outage or smuggle unsupported lexical-only results into semantic mode.
    ranks = {c.chunk_id: 1 / (60 + rank) for rank, c in enumerate(semantic, 1)}
    for rank, hit in enumerate(lexical, 1):
        if hit.evidence.chunk_id in ranks:
            ranks[hit.evidence.chunk_id] += 1 / (60 + rank)
    ordered = sorted(semantic, key=lambda c: (-ranks[c.chunk_id], c.chunk_id))
    return [RetrievalHit(c, ranks[c.chunk_id], scores[c.chunk_id]) for c in ordered[:limit]]
