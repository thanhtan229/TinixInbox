# Tinix Inbox operations

## October 2026 review fixes

`npm run build` runs type checking and the TypeScript tests. Also run `node --test tests/poc/*.test.mjs` for the UI race and webhook relay regressions.

Meta setup now requires a rotated secret in `META_APP_SECRET`, `META_APP_ID`, `META_WEBHOOK_VERIFY_TOKEN`, an explicit `META_GRAPH_API_VERSION`, and `META_SECRET_ROTATED=true`. Rotate the exposed secret in the Meta console first; the flag records the operator's confirmation and does not rotate it remotely. Existing Meta connections with missing or different app credentials are revoked on startup. Reconnect through the UI after configuring `CHATWOOT_CALLBACK_URL`; reconnect reuses the existing connection and inbox binding. Token validation, webhook subscription and the API inbox's `secret` must all pass before activation. The API inbox `hmac_token` is a contact identity HMAC and is not used as the callback signing secret.

`TUNNEL-META.bat` targets the dedicated relay on 127.0.0.1:3184. It forwards only GET/POST Meta webhook routes with an explicit connection ID. Do not point an externally managed tunnel at the full backend; update its ingress to the relay. Unauthenticated operator APIs reject external Host names and forwarded/Cloudflare requests. Cross-origin operator requests are rejected. Keep the local UI on loopback; remote operator APIs require `TINIX_OPERATOR_TOKEN` and an authenticated client. This is still a shared token, not tenant RBAC.

Message submission via `POST /api/conversations/:id/messages` now requires a client-generated stable `operationId` (8–100 letters, digits, underscores or hyphens). Reuse it with the identical content and visibility on retries. Completed requests return their original result; in-flight/uncertain requests cannot create a second message. The native UI retains the operation in sessionStorage while its result is unresolved. The additive `send_operations` table persists the claim and the AI version before a Chatwoot request. Chatwoot `content_attributes.tinix_operation_id` ties callbacks to that claim, including callbacks received before the POST response. Human public sends take over; hybrid mode does not auto-send. Outbox dispatch rechecks AI flags and handoff version.

Disconnect creates a `disconnected` tombstone instead of deleting the channel row. History and credentials remain available for reading and controlled reconnect. Public sends, provider ingestion and queued dispatch are blocked; private notes remain available. Enabling a disconnected channel does not reconnect it. Paused/disconnected rows are excluded before outbox batch limits.

The startup and 60-second REST sweep uses paginated message history and persisted cursors with a five-minute overlap. Initial deployment establishes a recovery baseline; earlier missing outgoing messages are not automatically sent. A manual full sweep records those earlier gaps as `unknown`, requiring delivery verification. Existing `unknown` outbox rows never retry automatically. Inbound unknown outcomes can be completed when their stable external source ID is found remotely; absence alone does not authorize a replay. Older unknown messages without source IDs still require investigation. Contact and conversation creation use remote lookup to recover mappings after an interrupted request.

Inbound Meta media is fetched asynchronously from approved `fbcdn.net`/`fbsbx.com` hosts using HTTPS, validated public DNS pinned to the connection, validated redirects, deadlines, MIME policy and image/PDF signatures. Limits are 12 MB per file, 24 MB per message and five download attempts. Binary files are uploaded through the supported Chatwoot multipart message API into Active Storage. Transient preparation failures retry before any Chatwoot message write; rejected/unsupported files retain their normalized references locally and show a visible import notice. Raw provider URLs are not copied into user-facing DTOs or Chatwoot content attributes. Provider URL refresh and independent binary retention outside Chatwoot remain unimplemented. AI does not auto-reply to media-only or mixed-media input until model media understanding is implemented.

The attachment proxy maps local `localhost`/`127.0.0.1`/`::1` Active Storage links to the configured loopback origin only when protocol and port match. Other off-origin links and redirects remain blocked. Outbound messages containing attachments are held in `failed` with a diagnostic until provider attachment transport passes acceptance; the disabled attachment composer remains disabled.

Recovery resolves completed public/private send operations from Chatwoot operation markers even when their outbox already exists. Human public messages recovered without callback also take over the conversation. Manual reconciliation scans full paginated history; pre-baseline missing sends are recorded as `unknown` and are never automatically resent.

`scripts/start-meta-relay.ps1` starts the relay hidden, reuses an existing process only when its command line contains the exact absolute project script path, and refuses unrelated port owners. The remote named Cloudflare tunnel ingress is managed outside this local launcher and must be configured to the relay in the Cloudflare account.

## Credential encryption

Channel credentials and Chatwoot callback signing secrets are encrypted in SQLite with AES-256-GCM. New records use a versioned envelope containing a key ID. In local development, Tinix creates `data/.credential-key` on first start. Keep this file private and back it up separately from the database; losing it makes stored credentials unreadable. The root `.gitignore` excludes the data directory.

In production, set `NODE_ENV=production` and provide either `TINIX_CREDENTIAL_ENCRYPTION_KEY` as exactly 64 hexadecimal characters (32 random bytes), or a key ring through `TINIX_CREDENTIAL_ENCRYPTION_KEYS` plus `TINIX_CREDENTIAL_ENCRYPTION_KEY_ID`. The key ring is a JSON object mapping IDs to 64-character hexadecimal keys. Keep all keys in the deployment secret store, not in source control or the database. Tinix refuses to start if the active key is missing. Existing plaintext and older ciphertext are re-encrypted on startup with the active key; keep a restorable backup of the database and keys before upgrading.

### Credential key rotation

To rotate without losing access to stored credentials:

1. Make and verify a restorable database backup.
2. Add the current key under its existing key ID and the new key under a fresh ID in `TINIX_CREDENTIAL_ENCRYPTION_KEYS`. Preserve the legacy `default` key while any `enc:v1` records may exist.
3. Set `TINIX_CREDENTIAL_ENCRYPTION_KEY_ID` to the new ID and restart Tinix. Startup reads old envelopes and re-encrypts connection credentials and callback secrets with the active key.
4. Confirm `/health` is healthy and query the local database to ensure no stored value uses an old key ID. Keep the old key in the key ring until that check and a restore check pass.
5. Remove the old key only after no ciphertext references it and the backup retention window has elapsed.

Do not replace the old key before the new process has migrated and verified every stored credential. Rotation requires temporary access to both old and new keys.

The key-ID envelope (`enc:v2`) is not readable by older Tinix builds that only understand `enc:v1`. Before the first rollout, keep a database backup from before re-encryption with the matching old build/key. After v2 ciphertext is written, rollback to an old build requires restoring that pre-upgrade database backup; otherwise use a forward fix with the key ring that can decrypt the current rows.

## Local development server

Start the backend from this directory with `npm start`; the default bind address is `127.0.0.1:3182`. Run `npm test` and `npm run typecheck` for validation. `BUILD.bat` runs those two checks; `npm run build` performs type checking and the TypeScript test suite. Check `GET /health` or run `STATUS.bat` (which reports both Chatwoot Docker status and Tinix Inbox status). `START.bat` automatically detects Docker Desktop and Chatwoot (port 3180), launches Docker Desktop and `docker compose up -d` if inactive, opens the app UI in desktop mode, and guards against duplicate instances; use `START.vbs` for silent background launching. `STOP.bat` terminates the configured Tinix Inbox port by default, or accepts `--all` to stop Chatwoot Docker containers as well. `RESTART.bat` idempotently stops existing processes, waits for port release, ensures Chatwoot stack is running, restarts the backend in background, and verifies `/health` responsiveness.

## Channel connection lifecycle

The Connections panel can pause and resume a channel. Pausing stores the previous connection status, blocks new provider webhooks and public sends, and leaves already queued outbox messages pending. A provider send that was already in flight may still complete. Resuming restores the saved status and allows pending sends to continue. Internal notes remain available while a channel is paused. The control is currently scoped to the local default workspace. Until Tinix authentication and role checks exist, production startup rejects a non-loopback `HOST`; do not expose operator APIs through an unauthenticated reverse proxy. The schema migration is additive; reverting the application code can leave the unused `disabled_previous_status` column in place.

## Chatwoot attachments in the native UI

The UI requests media from Tinix; Tinix resolves the message attachment through the mapped Chatwoot account and fetches it server-side with the Chatwoot API token. Downloads are limited to 12 MB and same-origin redirects. Only JPEG/PNG/GIF/WebP images, common audio, and MP4/WebM video are served inline. Other MIME types are forced to `application/octet-stream` with download disposition. Configure Chatwoot media URLs on the same origin as `CHATWOOT_BASE_URL`; external S3/CDN redirects remain unsupported until an explicit origin allowlist is configured. Native upload and outbound attachment delivery are not enabled.

## SQLite backup and restore

`BACKUP.bat` uses SQLite `VACUUM INTO` to create a consistent snapshot that includes committed WAL data, then verifies database integrity and required Tinix tables. The encrypted database does not include `data/.credential-key`; keep that key in the approved secret store and verify it separately before a restore drill.

Run `npm run drill:backup-restore` for a non-destructive drill against the configured database. It snapshots the live database, restores into an isolated temporary copy, compares core row counts, and rotates connection secrets in that copy with a fresh ephemeral key. It never replaces or re-encrypts the active database and prints no credential values. The temporary files are removed after the check.

Stop the Tinix backend before running `RESTORE.bat <backup.db>` for an actual restore. Restore verifies the source, stages and validates a copy, and creates a verified pre-restore snapshot before replacing the destination. After restore, start Tinix, check `/health`, and confirm stored credentials decrypt with the deployment key ring. The isolated drill validates backup/restore and rotation mechanics; a production restore still requires its deployment key material and an operator-controlled maintenance window.

## Meta Graph API

Set `META_GRAPH_API_VERSION` explicitly for each deployment after checking the target app's supported Graph API version and permissions. Production startup fails closed when the version is absent or malformed. The development fallback exists for local adapter tests only and is not a production compatibility claim. The Send API endpoint and permission requirements are documented in Meta's [Messenger Platform API collection](https://www.postman.com/meta/messenger-platform-api/documentation/iyp204x/messenger-platform-api); real Page authorization, token lifecycle, and delivery still require an approved app/account test.

## Provider webhook processing

Only typed retryable errors are retried, with exponential backoff capped at 60 seconds and a five-attempt limit. Retryable events that reach the limit move to `dead_letter`; permanent failures remain `failed`. Restart recovery requeues events that were `processing`. A dedicated authenticated review/redrive surface is still required before production operations.

## Provider capability gates

TikTok Shop and Shopee outbound transports are intentionally fail-closed. The old client paths must not be treated as production integrations; send remains blocked until current official endpoint/authentication behavior, app permissions, and authorized seller E2E are verified. TikTok Shop currently documents the `seller.customer_service` scope and API-versioned endpoints, with final scope availability controlled by app review. See the [phase review evidence](PHASE_REVIEWS_V2.md).

Zalo webhook verification accepts only `X-ZEvent-Signature` using the documented SHA-256 input `app_id + raw JSON body + timestamp + OA secret`. Do not configure a generic HMAC signature in place of the OA webhook secret.

## Temporary Chatwoot callback POC

Chatwoot CE SafeFetch rejects private callback URLs. For a synthetic local POC only, `CALLBACK-RELAY.bat` starts a loopback relay on port 3183. It forwards only `POST /webhooks/chatwoot` to Tinix port 3182 and preserves the raw body plus Chatwoot signature headers. `TUNNEL.bat` exposes only that relay port through a temporary Cloudflare Quick Tunnel; it does not expose the Tinix UI or `/api` routes.

To run the callback POC, start the local Tinix backend, start `CALLBACK-RELAY.bat` in one terminal, then start `TUNNEL.bat` in another. Set the resulting HTTPS URL plus `/webhooks/chatwoot` on the isolated Chatwoot API Inbox. Stop the tunnel and relay after the synthetic check. Quick Tunnels have temporary URLs and no uptime guarantee; they are not a production topology. Production requires an approved stable HTTPS endpoint that routes only the signed Chatwoot callback path.

## Gemini AI Agent & Natural Human Persona

Tinix AI Agent runs directly inside Tinix Inbox without third-party orchestrator bypass:

1. Set `GEMINI_API_KEY` in `.env` or system environment variables. Without a valid key, AI generation fails closed and sends no canned response.
2. Tinix uses model `gemini-2.5-flash` by default (configurable via `GEMINI_MODEL`).
3. Persona: Natural human customer support style, concise (1-3 sentences), warm Vietnamese tone, avoiding robot greetings or boilerplate.
4. Business Tools (`lookup_order`, `lookup_customer`, `create_crm_lead`, `send_internal_notification`) are registered as Function Calling declarations with Gemini. Set `N8N_WEBHOOK_BASE_URL` and `N8N_WEBHOOK_AUTH_TOKEN` to enable real business workflows; requests use a bearer token, and production endpoints must use HTTPS. Tinix sends `Idempotency-Key` on CRM lead and internal notification writes, derived from the inbound message correlation and action name. The n8n workflow must persist and enforce this key before performing side effects; the header alone does not guarantee deduplication. Fake local order/customer data is available only when `BUSINESS_TOOLS_DEMO_MODE=true` outside production; never use that mode for customer conversations.
5. The UI supports human takeover. Resume is available through the Tinix API after the Gemini runtime is configured. A failed/missing AI runtime does not send a canned reply; resolve the runtime issue before enabling AI for customers. Concurrency protection aborts a pending AI response if a human takes over during generation.

## Realtime Server-Sent Events (SSE)

Tinix Inbox provides native realtime updates via `GET /api/events` (Server-Sent Events):

- Emits `message_created`, `delivery_updated`, and `handoff_updated` instantly.
- The Native UI (`http://127.0.0.1:3182/`) connects to `/api/events` on load.
- Heartbeats (`: ping`) are sent every 15 seconds to keep the connection healthy.
- If SSE disconnects, the UI refreshes through a six-second polling cycle.
