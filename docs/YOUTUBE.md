# YouTube sources — 0.6

## What is implemented

- A **YouTube** option in Add Source, accepting watch, youtu.be, mobile/music,
  Shorts, embed and live-video URLs with an 11-character video ID.
- Strict server-side parsing into a canonical `https://www.youtube.com/watch?v=ID`;
  tracking parameters/start offsets are removed from the stored source URL.
- Durable ingestion jobs with ownership checks, retries, leases and atomic chunk
  publishing, sharing the existing worker infrastructure with PDF ingestion.
- An optional public-caption fetch adapter using `youtube-transcript-api`, preferring
  Arabic then English captions, falling back to another available caption track.
- An explicit user-provided timed-caption alternative: paste SRT/WebVTT or read a
  local `.srt`/`.vtt` file into the form. No fake transcript is generated from a URL.
- Timestamp-preserving chunks and citations containing `start_seconds`,
  `end_seconds`, `locator_type=timestamp`, `page=null` and a canonical timestamp
  `media_url` that opens the video. The authenticated `url` reads the cited chunk.
- Saved history preserves these locators and provenance. Both extractive answers
  and optional LLM-generated answers use server-built citation metadata.
- Distinct `user_captions` / `youtube_captions` source provenance. Manually attached
  text is clearly marked as **not automatically matched to the video's contents**.

This is caption-text ingestion, not video understanding, audio downloading, speech
recognition, translation or verification that captions are correct. A public link
alone does not guarantee available transcripts. Private, age-restricted, removed,
caption-disabled and blocked videos may fail. There is no access-control bypass,
proxy rotation, credential scraping or automatic audio-download fallback.

## Preview limitation (important)

The current sandbox allows outbound traffic only to dependency/GitHub hosts, **not
YouTube**. Live public-caption extraction has NOT been verified here. Automatic
fetch is explicitly disabled in the running API and worker with:

```bash
KNOWLM_YOUTUBE_FETCH_ENABLED=0
```

The UI reads `/health` and explains this restriction instead of accepting a doomed
automatic fetch. It still supports a video link plus user-owned timed captions,
which has been tested end-to-end against the real backend and worker. Browser
tests use authored caption text and a syntactically valid test identifier; they
neither download captions from that video nor assert the video exists or matches
the test text. Public caption network behavior is covered by injected adapter fakes.

Do NOT describe automatic YouTube fetching as production-verified based on these
local tests. A live acceptance test in a permitted deployment remains required.

## Setup in a deployment with YouTube network access

1. Install the updated backend requirements (or the lock file).
2. Stop API/worker writes, back up data and run `alembic upgrade head`.
3. Configure the **same** `DATABASE_URL` and `KNOWLM_YOUTUBE_FETCH_ENABLED=1` for API
   and worker; restart both. The code default is enabled when the variable is
   omitted, so set it explicitly in restricted/offline deployments.
4. Test a permitted public video with available captions, including Arabic.
5. Test no-caption, unavailable, restricted, blocked and timeout cases too.

The library uses YouTube's public caption endpoints, not an official stable
caption-download guarantee. Hosting IPs may be blocked and upstream changes may
break extraction. Comply with platform terms and rights to the content; request
permission where required. Do not enable unofficial workarounds to bypass a block.
The `youtube_auto_fetch_enabled` health field reports **configuration**, not a
successful connectivity probe or a guarantee for a particular video.

## API

```http
POST /v1/notebooks/{notebook_id}/sources/youtube-jobs
Authorization: Bearer <session>
Content-Type: application/json
```

Automatic-caption request, in an enabled deployment:

```json
{"url":"https://www.youtube.com/watch?v=VIDEO_ID_HERE","title":"عنوان اختياري"}
```

`VIDEO_ID_HERE` is a placeholder; supply the real 11-character video ID. The server
uses the submitted title, or `YouTube · <ID>` when absent. Video-title metadata is
not fetched or invented. Playlist/channel/search/redirect URLs without a supported
video form are rejected. URL userinfo, nonstandard ports, non-YouTube hosts and
invalid/duplicate video IDs are rejected before creating a job. No arbitrary
user-provided URL is passed to an HTTP client: only the validated ID is given to
the fixed YouTube adapter. Third-party upstream redirects still require appropriate
network/egress isolation in production.

Manual timed-caption alternative, usable offline:

```json
{
  "url":"https://www.youtube.com/watch?v=VIDEO_ID_HERE",
  "title":"عنوان اختياري",
  "captions":"WEBVTT\n\n00:00:15.000 --> 00:00:22.000\nالنص الذي تملك حق استخدامه.\n"
}
```

Successful enqueue returns 202 with `id`, `source_id`, `status=pending` and
`status_url`. Poll `/v1/jobs/{id}` or refresh the notebook's sources. Invalid video
URLs/timed captions return 422. Automatic requests on an explicitly disabled
server return 503 without creating a source/job. A supplied valid caption file
never calls the external adapter.

## Limits, failure handling and security

- Automatic extraction is isolated in a child process with 512 MiB address-space,
  20 CPU seconds, a 45-second parent wall timeout and individual HTTP timeouts.
- Caption limit: 500,000 normalized text characters, 20,000 cues, and a 24-hour
  upper timestamp. An individual cue is limited to 10,000 characters.
- Cue times must be finite, ordered by start, nonnegative and have positive duration;
  overlapping captions are allowed. Long text is chunked at at most 1000 characters.
- Ranges refer to the original cue/chunk boundaries, not exact word-level alignment.
- No timed chunk is published until the whole job succeeds. Invalid timestamps
  produce a failed job rather than invented times or a ready-but-empty source.
- Safe failure codes include `youtube_no_captions`, `youtube_unavailable`,
  `youtube_access_blocked`, `youtube_network_error`, `youtube_timeout`,
  `invalid_timed_captions` and `captions_too_large`.
- No raw upstream exceptions are returned to the user. Failed jobs can be retried
  up to the existing three-attempt cap; retrying does not cure missing captions.
- Stored payloads are cleared after success, and text/citations remain private.
- The viewer does not embed/play a video automatically. Opening the explicit
  external timestamp link contacts YouTube; it uses a new tab and `noopener noreferrer`.
- There are still no complete retention policies, global quotas or production
  process/container/egress isolation. These remain release blockers for public use.

## Verification

```bash
PYTHONPATH=backend pytest -q backend/tests
npm test --prefix frontend
# API + worker + frontend running on a disposable database:
KNOWLM_BUNDLED_LIBS=1 npm run test:e2e --prefix frontend
```

An **opt-in**, skipped-by-default live smoke test is provided. In an environment
with authorized network access, set a permitted captioned video URL yourself:

```bash
KNOWLM_LIVE_YOUTUBE_URL='https://www.youtube.com/watch?v=YOUR_REAL_ID' \
  PYTHONPATH=backend pytest -q backend/tests/test_youtube_live.py
```

Replace the placeholder; this test really contacts YouTube and must not be run on
private/unlicensed content. It checks actual caption extraction and bounded time
ranges, not caption factual accuracy or a guarantee for all videos. The test was
**not run live** in the current restricted sandbox.
