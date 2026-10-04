# Chatwoot CE v4.18.0 Phase 0 POC

This is an isolated architecture POC, not Tinix production code. It uses synthetic message data only. The web UI and callback receiver bind to loopback; PostgreSQL and Redis have no host ports.

The Chatwoot image is pinned to the official CE tag and manifest-list digest:

```text
chatwoot/chatwoot:v4.18.0-ce
sha256:faaa58a911cda8f2ab9d717ddf8ca4332163b07da4c5da10711d896e5d667442
linux/amd64 manifest: sha256:97dbffa882e0e288ed22daf0ceeb45b8b58e5ac2acdd1050be0a80ab75d1789a
```

The official release is Chatwoot `v4.18.0`, commit `9f920b549c14491a4e587687a3eed5d21c6ccc7d`. The official Docker guide documents the `v*-ce` tag pattern and the `db:chatwoot_prepare` initialization command. The upstream compose file at the release tag still uses `latest`, so this POC pins its own image reference.

## Start on Windows PowerShell

From this directory:

```powershell
Copy-Item .env.example .env
```

Replace the three values for `SECRET_KEY_BASE`, `POSTGRES_PASSWORD`, and `REDIS_PASSWORD` with generated random strings. Set `REDIS_URL` to use the same Redis password. `.env` is ignored by this POC's `.gitignore` and must not be committed.

Then run:

```powershell
docker compose config --quiet
docker compose pull
docker compose run --rm web bundle exec rails db:chatwoot_prepare
docker compose up -d
Invoke-WebRequest http://localhost:3180/api -Method Head
```

The local POC bootstrap script creates a synthetic account, a service administrator, a human agent, and two API Inboxes through the Application API. It writes the receiver config and bootstrap summary into `poc_config`; API access tokens live in the separate `poc_credentials` volume, which is mounted only into Chatwoot's web container. The callback receiver cannot read those API tokens. Run the bootstrap once with:

```powershell
docker compose exec -T web bundle exec rails runner /poc/bootstrap-poc.rb
```

The script is bind-mounted read-only at `/poc/bootstrap-poc.rb`; `/poc-state` is the receiver config volume and `/poc-credentials` is the private API token volume. The bootstrap refuses to run again after it has written `bootstrap.json`; deleting the `poc_config` volume removes that guard, and deleting `poc_credentials` removes the API tokens. Each API Inbox starts with callback URL `http://callback-receiver:3181/webhooks/chatwoot`; the receiver selects the callback secret by Inbox ID in the signed payload, then verifies the account/Inbox allowlist.

Chatwoot SafeFetch rejects the private Docker callback URL. A temporary Cloudflare Quick Tunnel was used to verify Chatwoot's real signed callback over HTTPS, then stopped and the Inbox URLs were restored. Quick Tunnels are public, temporary test routes with no uptime guarantee; do not use them in production. The deployment still needs a reviewed, stable HTTPS endpoint. Do not enable `SAFE_FETCH_ALLOW_PRIVATE_NETWORK` globally to work around the restriction.

## POC receiver

Run its policy/signature tests with the installed Node runtime:

```powershell
node --test receiver-lib/callback.test.mjs
```

The receiver stores verified synthetic callback bodies in a persistent Docker volume at `/data/events.jsonl`, then ACKs. Its fake adapter accepts only mapped, public outgoing text with no attachments and writes a durable fake outbox/send journal. It rejects private notes, incoming echoes, updates, templates, attachments, and unmapped Inbox events. No real provider is called. `RECEIVER_FAILURE_MODE=500` or `timeout` simulates callback receiver failure; reset it to `off` and recreate the receiver afterward. Chatwoot Sidekiq logs include webhook job arguments, which can contain the Inbox signing secret and message content. Keep this POC synthetic and restrict access to its local Docker logs. `docker compose down -v` removes all POC volumes, including credentials.

The Tinix live bridge uses `CALLBACK-RELAY.bat` from the sibling app folder. It listens on loopback port 3183 and allows only signed Chatwoot callback POSTs to Tinix; its unit tests verify path filtering and raw-body/signature preservation. `TUNNEL.bat` forwards the temporary Quick Tunnel to port 3183, never to the full Tinix application port. This is a local synthetic POC aid, not a stable production ingress.

Inspect state without printing message bodies:

```powershell
docker compose exec callback-receiver sh -lc 'wc -l /data/events.jsonl /data/outbox.jsonl /data/fake-sends.jsonl'
```

Stop only this POC with `docker compose down`. This keeps its named volumes. To erase the isolated POC state, use `docker compose down -v` from this directory.

## Tinix live REST contract check

From the sibling `Tinix Inbox` application directory, this check runs the actual Tinix `InboundService` and `ChatwootConversationProvider` against the local Chatwoot CE API. It uses only synthetic customer/reply text and a disposable in-memory Tinix database. It verifies contact/conversation mapping, duplicate inbound suppression, one incoming message, one public outgoing message, assignment, and status changes. The outgoing message is written only to the isolated POC Chatwoot inbox; this check does not claim that a real channel provider received it.

Pass the POC token through the PowerShell process environment without printing it:

```powershell
$raw = docker compose -f poc/chatwoot-v418/compose.yaml exec -T web cat /poc-credentials/credentials.json
$creds = ($raw -join "`n") | ConvertFrom-Json
$env:CHATWOOT_API_TOKEN = $creds.adminToken
$env:CHATWOOT_ACCOUNT_ID = '1'
$env:CHATWOOT_INBOX_ID = '1'
$env:CHATWOOT_AGENT_ID = '2'
$env:CHATWOOT_BASE_URL = 'http://127.0.0.1:3180'
node --experimental-strip-types poc/chatwoot-v418/tinix-live-check.mjs
$code = $LASTEXITCODE
Remove-Item Env:CHATWOOT_API_TOKEN, Env:CHATWOOT_ACCOUNT_ID, Env:CHATWOOT_INBOX_ID, Env:CHATWOOT_AGENT_ID, Env:CHATWOOT_BASE_URL -ErrorAction SilentlyContinue
if ($code -ne 0) { throw "Tinix live contract check failed with exit code $code" }
```

The runner emits only sanitized IDs and pass/fail counts; it never prints the API token, signing secret, or message content. Its success validates Tinix-to-Chatwoot REST operations. Chatwoot-to-Tinix callback delivery and provider delivery still require separate acceptance checks.

## Current Phase 0 boundary

Tinix application source is maintained in the sibling `Tinix Inbox` directory; the workspace containing this POC also holds the plan, research, and UI instructions. `tinix-live-check.mjs` now verifies real Chatwoot CE REST operations through Tinix services for synthetic inbound, outgoing, assignment, and support status. Tinix callback durable receipt/outbox is still not live-verified. A stable HTTPS callback topology is open: the temporary Quick Tunnel used for synthetic verification was stopped, and Chatwoot SafeFetch rejected the private Docker URL. Do not enable `SAFE_FETCH_ALLOW_PRIVATE_NETWORK` globally. See `../../PHASE0_AUDIT.md` for the current gate assessment.
