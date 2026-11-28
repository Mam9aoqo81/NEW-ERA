# Two-person notebook calls · 0.24.0

Opt-in browser WebRTC audio/video between two authenticated notebook members (including readers). Open **التعاون وغرفة الدفتر → مكالمة صوت وفيديو · شخصان**, select optional camera, accept the disclosure, then join. Audio-only is the default. Merely opening the panel does not request devices. There is no public dial-in, auto-answer, screen sharing, group SFU or server media recording.

## Deployment

Apply `alembic upgrade head` (revision `7092bdcd7dd7`) before starting API and worker. Browser media permissions require HTTPS, except trusted localhost development. Keep the worker running: it purges expired signaling leases every approximately 30 seconds, even when no ingestion job exists.

No public STUN or TURN service is silently configured. Without an operator configuration the UI warns that cross-network connections are not guaranteed. Optional server environment:

- `KNOWLM_CALL_STUN_URL=stun:stun.example.org:3478`
- `KNOWLM_CALL_TURN_URL=turn:relay.example.org:3478?transport=udp` (or `turns:` for a properly configured TLS relay)
- `KNOWLM_CALL_TURN_SECRET`: the TURN operator's shared REST authentication secret; keep server-side, never in frontend environment variables or source control.
- `KNOWLM_CALL_RELAY_ONLY=1`: require the configured TURN relay rather than direct ICE paths. Requires TURN URL and secret.

Configure a compatible TURN server separately (e.g. coturn REST shared-secret authentication), TLS certificates, external address, firewall/relay port ranges, bandwidth/account quotas, monitoring and abuse controls. This repository does not provision or test that infrastructure. Authenticated members receive HMAC-SHA1 TURN REST credentials valid for one hour, not the shared secret. Credentials are not refreshed during an ongoing call; leave/rejoin before expiry for longer conversations. Never promise unlimited calls or production readiness from local acceptance.

## Access, retention and privacy

API signaling uses the notebook's existing membership checks. One active session per user/notebook, two per notebook, at most three notebooks per user. A deterministic session-ID ordering chooses one offerer. The API transports SDP and ICE only; media goes through WebRTC directly or the configured TURN relay, not this API. Direct paths can reveal network addresses to the other participant; configured connectivity servers also receive connection metadata. The other participant can record outside this application. This is not an audited end-to-end-encryption product claim.

SDP/ICE are private, targeted, bounded (64,000-character SDP; 4,096-character ICE candidate; 200 outstanding signals per destination), polled one second apart and acknowledged/deleted every ten seconds. They are stored in the application database, not encrypted separately; backup/storage protection remains the operator's responsibility. Session leases expire after 90 seconds without heartbeats. Cleanup removes expired sessions/signals on subsequent join and via the worker; without a running worker, expired rows can remain until a later join. Graceful leave, membership removal, notebook deletion and account erasure delete related signaling transactionally. Logging proxies must not record request bodies or authorization headers.

Mute/camera toggle disables transmission, not device capture. Explicit leave, panel close, unmount/notebook navigation, offline/pagehide, signaling failures and revoked membership stop local tracks. A late permission result after cancellation is stopped as well. Best-effort leave uses keepalive; crashes rely on lease expiry. Connected WebRTC is not a centrally revocable media transport: cooperative clients poll permissions and close, but a modified client or already-received recording cannot be remotely erased. Background-tab suspension and brief network disconnection may end a call; reconnection is manual. Calls do not consume or publish uploaded sources.

## API

All routes require authentication and use `/v1/notebooks/{id}/call`:

- `GET /config`: no-store ICE configuration and TURN-presence flag.
- `POST /sessions`: `{request_id: UUID, consent: true}`, idempotent for the same own session ID.
- `GET /sessions/{id}?after=cursor`: own session only; peers and up to 100 targeted signals.
- `POST /sessions/{id}/signals`: target UUID and `offer`/`answer` plus SDP, or `ice` plus candidate.
- `POST /sessions/{id}/heartbeat`: `{after: cursor}` renews lease and acknowledges received signals.
- `DELETE /sessions/{id}`: idempotent own-session leave.

## Acceptance and limits

Nine backend tests cover consent/auth/membership, private targeted delivery, cross-notebook denial, capacity and per-user quotas, bounded backlog, acknowledgment, heartbeat/expiry/purge, member removal, owner/member account deletion and generated TURN credentials/config validation. Two component tests verify consent gating, explicit track shutdown and late permission cancellation.

Two real Chromium browser tests (desktop and mobile viewport) open two authenticated browser contexts, acquire **simulated camera/microphone sources**, negotiate actual `RTCPeerConnection` objects, assert remote decoded video and positive inbound audio/video RTP bytes, test mute and track shutdown after membership removal. Devices are simulated but signaling and local media transport are real. These are not physical-phone, human-listening, Safari, different-network, TURN-relay or long-duration tests. No cross-network reliability claim has been validated.
