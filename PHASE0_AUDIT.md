# Tinix Inbox V2 — Phase 0 Checkpoint

**Reviewed:** 2026-09-28  
**Status:** READY WITH LIMITATIONS — the Phase 1 production architecture gate is not fully cleared.

## Repository audit

- The task workspace `Tinix Inbox Codex` contains the supplied plan/instructions; application source is in the sibling `D:\___TOOLS\__TINIX\Tinix Inbox` folder where this report lives. No `.git` directory is present in the implementation folder, so repository status and diff review are unavailable.
- Runtime: Node.js 24 with native TypeScript type stripping and `node:sqlite`; tests use `node:test`. The app has no separate build, lint, or typecheck script.
- Persistence and durable work use SQLite repositories, a Tinix outbox, and a persisted provider-webhook event table. There is no external queue or object-storage integration in the app source.
- The local Tinix server uses `127.0.0.1:3182`; Chatwoot POC uses `127.0.0.1:3180` and the callback receiver uses `127.0.0.1:3181`.

## Chatwoot POC evidence and correction

The isolated POC Compose file pins Chatwoot CE v4.18.0 to digest `sha256:faaa58a911cda8f2ab9d717ddf8ca4332163b07da4c5da10711d896e5d667442`. At review time, Chatwoot web, Sidekiq, PostgreSQL, Redis, and the callback receiver were running; PostgreSQL and Redis reported healthy. The receiver's five local policy/signature tests pass.

Chatwoot SafeFetch rejects the private callback URL. A callback-only relay now accepts just `POST /webhooks/chatwoot` on loopback and forwards the raw body/signature headers to Tinix. `TUNNEL.bat` targets that relay rather than the full Tinix backend. The relay and tunnel have not been started in this checkpoint; a live signed callback through Tinix and a reviewed, stable production HTTPS topology remain open. Do not enable `SAFE_FETCH_ALLOW_PRIVATE_NETWORK` globally as a workaround.

The POC README also contains stale statements saying that no Tinix source exists and Phase 1 has not been implemented. The application source now exists in the sibling `Tinix Inbox` directory. POC results remain isolated evidence; passing the receiver's local tests alone does not verify live delivery through the Tinix server.

## Gate assessment

| Gate | Status | Evidence / remaining work |
|---|---|---|
| Exact Chatwoot CE version and local services | PASS for local POC | Pinned image and running Compose services observed. |
| POC callback receiver authentication and predicate | PASS for receiver tests | Five tests pass; POC uses synthetic events. |
| Private callback deployment topology | PARTIAL | Callback-only local relay and temporary tunnel launcher are implemented and unit-tested. They are not a stable production topology and have not been started for this checkpoint. |
| Tinix inbound/outgoing REST integration | PASS for synthetic POC | `poc/chatwoot-v418/tinix-live-check.mjs` exercised the actual Tinix inbound service and Chatwoot provider against CE v4.18.0. One duplicate inbound was suppressed; one incoming and one public outgoing message were present. Assignment and status APIs also passed. |
| Chatwoot callback → Tinix durable receipt/outbox | OPEN | Signed callback delivery through the Tinix HTTP receiver remains unverified; SafeFetch rejected the private Docker URL and stable HTTPS deployment topology remains unresolved. |
| Production credentials, secrets, and account access | NOT VERIFIED | No provider or Chatwoot production credentials were exercised. |

Do not describe the whole Phase 0 architecture gate as PASS until the open items have evidence. Local implementation and synthetic tests can proceed, but production readiness remains gated.
