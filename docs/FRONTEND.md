# KnowLM web study workspace (0.14)

## Scope

A mobile-first RTL **web** application in React/TypeScript/Vite. This is not yet
a React Native/Expo application or a downloadable native app. The primary path is
connected to the real backend; there are no fake social feeds, follower counts,
quality badges or simulated model responses.

- Registration, login, session restoration through `GET /v1/auth/me`, server logout.
- Create/select private notebooks; confirmed notebook deletion removes all its active database records. See [PRIVACY.md](PRIVACY.md) for retention limits.
- Persist and restore complete question/answer/citation snapshots per notebook,
  with keyset pagination, explicit confirmed deletion and idempotent request retries.
- Add pasted text, enqueue PDF or DOCX extraction, or ingest a YouTube link with public or explicitly attached timed captions; poll source states every 3.5 seconds.
- Video citations show time ranges and a safe external timestamp link, not invented pages. See [YOUTUBE.md](YOUTUBE.md); automatic YouTube access is disabled in the current restricted preview.
- DOCX citations show extracted paragraph numbers, never invented Word pages. See [DOCX.md](DOCX.md).
- Study tools include private editable cards, SM-2 reviews, saved server-graded quizzes, extractive artifacts and interactive source-containment maps. See [LEARNING.md](LEARNING.md).
- Failed jobs show safe error descriptions and offer retry below the attempt cap.
- New ready sources are selected automatically once; deselecting a source is
  respected on subsequent refreshes. Questions send explicit selected source IDs.
- Default extractive questions need no external model. The generated option is
  disabled when `/health` reports no configured provider. Opting in displays an
  external-transmission warning. Configuration does not prove live model connectivity.
- Read cited source-page chunks through an authenticated request in a modal.
- Native `<dialog>` focus management, Arabic labels, keyboard submission (Enter,
  Shift+Enter for newline), reduced-motion support, mobile source/chat tabs.
- Focus mode hides notebook navigation, not the source evidence or safety notices.

## Current limitations

Chat history is now stored server-side and restored after notebook changes and
refresh. Source selection is not persisted across those events. Each question is
answered independently from its selected sources: archived messages are not sent
as additional model context. See [HISTORY.md](HISTORY.md) for the storage and API
contract, deletion semantics and concurrent-request limitations.
The original PDF is not rendered; citation reading shows extracted chunks and
highlights the matching chunk, not the exact on-page bounding box. Chunks can
overlap. Sample question suggestions are explicitly tied to the optional authored
photosynthesis source and are not AI-generated suggestions for arbitrary files.
The ready-made source button creates an actual text source only after user action.

Auth tokens are stored in `sessionStorage` for development convenience. Tokens are
accessible to JavaScript: production needs an explicit XSS threat review and an
appropriate BFF/HttpOnly-cookie or equivalent auth design, plus CSP, HTTPS, quotas,
rate limiting and other backend safeguards. Do not upload sensitive files.

## Development

From repository root, start the API and worker as described in README. Then:

```bash
cd frontend
npm ci
npm run dev -- --port 5173
```

Vite binds `0.0.0.0` and allows the Arena `.e2b.app` preview domain. The browser
uses `/v1/...` and `/health`; only Vite's server-side proxy uses `127.0.0.1:8000`.
No permissive backend CORS policy is needed. Frontend development uses local fonts
from an npm package and does not make external font requests.

## Build and checks

```bash
cd frontend
npm test                  # jsdom / Testing Library; mocked API, React StrictMode
npm run build             # TypeScript check plus production bundle
npm run format:check
npm audit
npm run preview -- --port 4173
```

The production bundle is in ignored `frontend/dist`. `vite preview` is for local
verification, **not a production service**. Deploy static assets behind HTTPS and
proxy `/v1` and `/health` to FastAPI on the same public origin. Do not point browser
code at a private localhost backend. The FastAPI root still opens API docs;
frontend and backend are separate development servers.

## Browser end-to-end tests

Tests use a real browser, API, database and running PDF worker. They create synthetic
accounts, notebooks and sources: run them against a **disposable development
database**, never a production deployment. For isolated testing, give the API and
worker the same separate `DATABASE_URL` and migrate it before starting either.

From `frontend`, with all three development services running:

```bash
npm run test:e2e
```

Two projects exercise 1440×1000 desktop and 390×844 mobile layouts. A second flow imports an authored VTT caption for a syntactically valid test video link, verifies the timestamp citation, manual-provenance warning, and restoration after refresh. It does not contact YouTube or claim that the test video exists. Each creates
an account, creates a notebook, adds the authored text source, asks a question,
opens an authenticated reference, restores chat after reloading the session,
switches between notebooks without mixing their histories, uploads the small
authored PDF fixture, waits for actual worker extraction, then asks a PDF-backed
question. It also cancels and confirms history deletion, reloads to check deletion
and verifies that source files were not removed.
They also assert no horizontal overflow and no browser runtime errors. These are
Chromium viewport checks, not Safari/VoiceOver/iOS-device certification.

The npm-installed `@sparticuz/chromium` supplies a headless Linux browser. A host
with normal browser shared libraries can run the default command. A minimal Linux
sandbox lacking NSS/NSPR can use the package's bundled libraries:

```bash
KNOWLM_BUNDLED_LIBS=1 npm run test:e2e
```

This unpacks test-only libraries to the OS temporary directory. They are not
application dependencies or committed binaries. You can set `KNOWLM_CHROMIUM_PATH`
to a compatible installed Chromium executable and `KNOWLM_TEST_URL` to the frontend
origin. Browser sandbox flags come from the headless test package; do not reuse
these settings as a production browser isolation policy. Web security is not
disabled by this project's test configuration.

Screenshots go to ignored `backend/data`; failure diagnostics go to ignored
`frontend/test-results`. The PDF fixture is a tiny authored one-page file containing
an English photosynthesis sentence, with no third-party copyrighted content.

## Verified in this workspace

- 39 frontend component/hook/integration tests.
- 14 browser tests (two added owner/anonymous-visitor flows cover card and quiz publishing and revocation) (the added rate-budget flow exhausts the real API budget, then replays its actual 429 to the UI to avoid minute-boundary flakiness). The previous 10 real-browser end-to-end tests (study/PDF, YouTube manual-caption, learning/maps, DOCX with notebook deletion, and account deletion/session revocation, desktop and mobile).
- Production build and TypeScript check.
- npm audit: no known vulnerabilities at the time of verification.
- Backend suite: 168 passed; one opt-in live YouTube test skipped (network restricted).

These checks do not establish production readiness or the quality of a live LLM
provider. The generated-answer provider remains disabled in this preview.
