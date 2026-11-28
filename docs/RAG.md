# KnowLM: retrieval, generation and evaluation

## 1. Offline retrieval

`knowlm/retrieval.py` normalizes Arabic diacritics, alef/ya variants, tatweel, case,
and a conservative definite-article prefix. It does not perform full Arabic
stemming, translation, synonym expansion or semantic inference.

Candidates are first filtered in the API by notebook ownership, source selection
and `ready` status. The ranker must never receive inaccessible chunks.

1. Remove stop words and count words.
2. Require at least half of the question's distinct content words in each candidate.
3. Rank eligible chunks by BM25 and character-trigram cosine similarity separately.
4. Fuse ranks with reciprocal rank fusion (constant 60).
5. Suppress near-duplicate chunks on the same source/page and return at most three.

This is **lexical + subword fusion**, not vector/semantic hybrid search. Coverage
is a heuristic, not a calibrated confidence or truth score. Unsupported questions
sharing generic words may still retrieve irrelevant content; paraphrases without
shared terms may fail. The ranker scans a notebook in memory and is not a scalable
index. Long-term work: corpus evaluation, indexed lexical retrieval, stored
embeddings/pgvector, reranking and independent answerability checks.

## 2. Optional external answer generation

Requests remain compatible:

```json
{"question":"أين تحدث عملية البناء الضوئي؟","mode":"extractive"}
```

For explicitly requested generation:

```json
{"question":"أين تحدث عملية البناء الضوئي؟","mode":"grounded","source_ids":["SOURCE_UUID"]}
```

The server operator must configure these **environment variables** before starting
the API. Do not put secrets in source code, Git, screenshots or chat:

- `KNOWLM_LLM_ENABLED=1`
- `KNOWLM_LLM_API_KEY`: deployment secret for the selected provider.
- `KNOWLM_LLM_MODEL`: model available to that account, supporting JSON-object output.
- `KNOWLM_LLM_BASE_URL`: HTTPS base URL; defaults to `https://api.openai.com/v1`.

`create_app(..., answer_provider=...)` also accepts a provider implementing
`generate(question, evidence)` for integration tests or another deployment adapter.
ASGI startup reads the environment; direct application-factory use is explicit.
The `.env` example is not loaded automatically by Python.

Enabling generation does NOT make extractive-mode requests call the model. Only
`grounded` requests transmit the question and up to three selected text excerpts,
with chunk IDs, to the configured provider. Full documents, source titles,
passwords and notebook IDs are not part of the generated prompt. Consider provider
retention policies, consent and data residency before enabling it. Provider-side
billing can apply. No external model call was performed during implementation:
provider behavior is tested with injected fakes and HTTP mock transports. This
sandbox's outbound network policy does not allow live model-provider endpoints.

The provider adapter uses an HTTPS OpenAI-compatible `/chat/completions` endpoint,
requests JSON output, does not follow redirects, sets HTTP timeouts, bounds response
size, and rejects incomplete responses. Compatibility with a particular provider
still needs a live deployment integration test. No streaming response API yet.

## 3. Server-validated citations

The model may return only:

```json
{
  "claims": [
    {
      "text": "تحدث العملية داخل البلاستيدات الخضراء.",
      "references": [
        {
          "chunk_id": "RETRIEVED_CHUNK_UUID",
          "quote": "تحدث عملية البناء الضوئي داخل البلاستيدات الخضراء."
        }
      ]
    }
  ]
}
```

An empty `claims` array is a refusal. Each claim needs 1–3 references. No more
than eight claims are allowed. Unknown fields are forbidden. Each quote must be
10–1000 characters, a nonblank **exact substring** of the referenced retrieved
chunk, and the ID must belong to this request's authorized context. Each claim
is limited to 2000 characters.

The server—not the model—builds source IDs, titles, page numbers, citation markers
and protected page URLs from stored metadata. Invalid structure or citation
rejects the entire generated response with HTTP 502; no partial generated answer
is served. An unavailable/misconfigured provider returns 503 rather than silently
pretending that an extractive answer was generated. No evidence means a refusal
without a provider call. The provider can also refuse after inspecting evidence.

**Important limitation:** exact-quote checks establish provenance, not semantic
entailment. A generated claim can cite a real passage that does not support it.
The system does not yet independently verify claim truth, resolve contradictory
sources, detect all prompt injections, or grant a quality badge. The prompt treats
sources as untrusted data and asks the model to describe conflicts; that alone is
not a security guarantee. Source URLs are authenticated API paths, not signed
public download links. Clients must display answer text safely, not as raw HTML.

## 4. Reproducible evaluation

From repository root:

```bash
PYTHONPATH=backend python -m knowlm.evaluate --check
# Optional local report (backend/data is ignored):
PYTHONPATH=backend python -m knowlm.evaluate --check > backend/data/retrieval-report.json
```

The versioned fixture is `backend/evaluation/retrieval.json`: eight short authored
sources and 22 questions (11 Arabic, 10 English, one numeric bilingual case).
The report includes per-language recall@3, top-1 hit rate and refusal rate on the
explicitly unanswerable cases. `--check` exits nonzero for any missed expected
source or an unexpected hit on a negative case.

Current baseline: **22/22 cases pass**. This is deliberately a small synthetic
regression suite, **not a claim of 100% production accuracy**, semantic grounding,
Arabic curriculum coverage, or LLM quality. No generated-answer quality metric is
computed. The same fixtures were used while implementing the ranker; they are not
a held-out benchmark. Additional unit tests cover overlapping chunks and keeping
contradictory passages from distinct sources in context.

Before production, build a held-out licensed corpus with long Arabic PDFs, OCR
noise, tables, equations, dialects, paraphrases, conflicting editions and adversarial
instructions. Have reviewers label answerability, relevant spans and claim support;
measure citation precision, unsupported-claim rate, refusal precision/recall,
latency and cost independently of this lexical regression suite.
