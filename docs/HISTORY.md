# Durable notebook history (0.5)

## Scope and storage

Each private notebook has one implicit question/answer thread. `chat_turns` stores
complete snapshots: the question, effective ready-source scope, answer mode, final
answer text, notices, citations, creation time and an idempotency key/hash. A turn
is written only after retrieval and, when used, generation/citation validation
succeed. A valid insufficient-evidence refusal is saved too. Provider errors,
invalid citations, denied source access and invalid requests do not create a turn.

The question and answer are committed atomically in a single row. Snapshot
citations preserve the text and page/source metadata originally served. Citation
page reads still require current notebook ownership. There is no new public
sharing endpoint, and the history API never exposes session credentials.

**This is persistence, not conversational model memory.** Prior messages are not
included in the retrieval query or model prompt. Questions such as “explain that”
without a retrievable concept may be refused. Collaboration, multiple named
threads, editing saved answers, full account deletion and configurable retention
remain future work. Pre-0.5 browser-only conversations cannot be recovered.

## Migration

Stop API writes, back up the database, then from repository root:

```bash
source .venv/bin/activate
alembic upgrade head
alembic check
```

Revision `dacd3f365f80` adds `chat_turns` and its indexes/unique constraint without
modifying existing user, notebook or source rows. Restart the API with
`KNOWLM_AUTO_SCHEMA=0`. SQLite migration tests include an upgrade from the previous
head with existing users, notebooks and sources. PostgreSQL migrations are still
not integration-tested in this environment.

Downgrading this revision deletes the history table and all saved conversations;
back up before doing so. It does not delete the source tables.

## Ask and retry contract

```http
POST /v1/notebooks/{notebook_id}/ask
Authorization: Bearer <session>
Content-Type: application/json
```

```json
{
  "question": "ما هي عملية البناء الضوئي؟",
  "source_ids": ["SOURCE_UUID"],
  "mode": "extractive",
  "request_id": "e4d1e095-53d0-4540-9a70-37f0e68c2b02"
}
```

`request_id` is an optional UUID for API backward compatibility: omitted keys
receive a new server UUID. The frontend always supplies a fresh UUID for a new
question and reuses that UUID and the exact original payload when retrying after
an error or lost response.

The response retains the previous answer fields and adds `turn_id`, `request_id`
and `created_at`. A unique `(notebook_id, request_id)` constraint prevents duplicate
saved turns, including concurrent submissions. A completed request replay returns
the original saved response without calling the provider again. Reusing the key
with a different question, source scope or mode returns HTTP 409. Source IDs are
canonicalized as a sorted set; an omitted scope differs from an empty scope.

Two concurrent first-time requests can both perform generation before one wins
the database insert. The loser returns the winning snapshot. **This is not an
exactly-once external billing guarantee.** A future request reservation/queue is
needed to avoid duplicate simultaneous provider work. Idempotency lasts while
the saved turn exists; clearing history also removes its replay key.

## Reading history

```http
GET /v1/notebooks/{notebook_id}/history?limit=40&before=123
```

- Authentication and notebook ownership are checked before any read.
- `limit`: 1–100, default 40.
- `before`: optional positive 64-bit integer, exclusive saved-turn ID.
- The newest requested page is selected by descending ID and returned in
  chronological order. IDs reflect insertion order, not provider-start order.
- `next_before` is the oldest ID in the returned page when more rows exist;
  otherwise it is `null`.
- A compound `(notebook_id, id)` index supports scoped keyset pagination.
- Fetching older pages is stable when newer turns are inserted concurrently.

Response shape:

```json
{
  "turns": [
    {
      "id": 123,
      "request_id": "e4d1e095-53d0-4540-9a70-37f0e68c2b02",
      "question": "...",
      "source_ids": ["SOURCE_UUID"],
      "mode": "extractive",
      "created_at": "2026-11-27T22:00:00+00:00",
      "answer": {
        "mode": "extractive",
        "answered": false,
        "answer": "لا توجد معلومات كافية في المصادر المحددة.",
        "citations": [],
        "retrieval": "bm25_char_rrf",
        "notice": "..."
      }
    }
  ],
  "next_before": null
}
```

The UI restores the newest 40 turns, loads earlier turns on demand without jumping
to the bottom, and cancels its fetches when the notebook is unmounted. It blocks
new questions until initial history is loaded, so a late load cannot overwrite a
newly submitted local turn. Failed local requests show an explicit retry action;
unsaved local errors themselves are not part of server history. Aborting the
browser request on navigation does not guarantee cancellation of server processing;
a completed server answer can appear when the notebook is reopened.

## Clearing history

```http
DELETE /v1/notebooks/{notebook_id}/history
```

Returns 204 and removes only that notebook's saved turns from the live database.
The UI requires a confirmation, disables deletion during local sends/history
loads, and clears visible messages only after successful server deletion. Sources,
source chunks, notebook metadata and other notebooks' histories are unaffected.

This does not erase previous database backups, third-party model logs or ongoing
requests from other tabs/clients. A concurrent in-flight request may save a new
turn after deletion. There is no cross-tab synchronization or global generation
cancellation yet. Configurable retention and full erasure policies are required
before handling sensitive educational data in production.
