import { createServer } from 'node:http';
import { mkdir, open, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { isOutboundCandidate, semanticMessageKey, verifySignature } from './receiver-lib/callback.mjs';

const port = 3181;
const configuredToleranceSeconds = Number(process.env.CALLBACK_TIMESTAMP_TOLERANCE_SECONDS || 300);
const toleranceSeconds = Number.isInteger(configuredToleranceSeconds)
  && configuredToleranceSeconds >= 0
  && configuredToleranceSeconds <= 3600
  ? configuredToleranceSeconds
  : 300;
const failureMode = process.env.RECEIVER_FAILURE_MODE || 'off';
const dataDirectory = '/data';
const configPath = '/poc-state/receiver-config.json';
const eventsPath = `${dataDirectory}/events.jsonl`;
const outboxPath = `${dataDirectory}/outbox.jsonl`;
const sendsPath = `${dataDirectory}/fake-sends.jsonl`;
const seenOutboxKeys = new Set();
const pendingOutboxKeys = new Set();
const recordedSendKeys = new Set();
let processing = Promise.resolve();

async function loadConfig() {
  try {
    const config = JSON.parse(await readFile(configPath, 'utf8'));
    return {
      accountId: String(config.accountId ?? ''),
      allowedInboxIds: new Set((config.allowedInboxIds ?? []).map(String)),
      secretsByInbox: config.secretsByInbox ?? {},
    };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return {
      accountId: process.env.CHATWOOT_ACCOUNT_ID || '',
      allowedInboxIds: new Set((process.env.CHATWOOT_ALLOWED_INBOX_IDS || '').split(',').map((id) => id.trim()).filter(Boolean)),
      secretsByInbox: JSON.parse(process.env.CHATWOOT_CALLBACK_SECRETS_JSON || '{}'),
    };
  }
}

await mkdir(dataDirectory, { recursive: true });
try {
  const lines = (await readFile(outboxPath, 'utf8')).split('\n').filter(Boolean);
  for (const line of lines) seenOutboxKeys.add(JSON.parse(line).key);
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

try {
  const lines = (await readFile(sendsPath, 'utf8')).split('\n').filter(Boolean);
  for (const line of lines) recordedSendKeys.add(JSON.parse(line).key);
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

async function appendDurably(path, value) {
  const file = await open(path, 'a');
  try {
    await file.writeFile(`${JSON.stringify(value)}\n`, 'utf8');
    await file.sync();
  } finally {
    await file.close();
  }
}

async function enqueueFakeSend(payload) {
  const config = await loadConfig();
  const inboxId = String(payload.inbox.id);
  if (!isOutboundCandidate(payload, { accountId: config.accountId, inboxId })) return;
  const key = semanticMessageKey(payload);
  if (!key || pendingOutboxKeys.has(key)) return;

  pendingOutboxKeys.add(key);
  try {
    if (!seenOutboxKeys.has(key)) {
      await appendDurably(outboxPath, { key, accountId: config.accountId, inboxId, messageId: String(payload.id), queuedAt: new Date().toISOString() });
      seenOutboxKeys.add(key);
    }
    if (recordedSendKeys.has(key)) return;
    const providerMessageId = `synthetic-${createHash('sha256').update(key).digest('hex').slice(0, 16)}`;
    await appendDurably(sendsPath, { key, providerMessageId, sentAt: new Date().toISOString(), text: payload.content ?? '' });
    recordedSendKeys.add(key);
  } finally {
    pendingOutboxKeys.delete(key);
  }
}

async function recoverJournal() {
  try {
    const lines = (await readFile(eventsPath, 'utf8')).split('\n').filter(Boolean);
    for (const line of lines) {
      const record = JSON.parse(line);
      if (record.payload) await enqueueFakeSend(record.payload);
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

async function readBody(request) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > 4 * 1024 * 1024) throw Object.assign(new Error('payload_too_large'), { statusCode: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

const server = createServer(async (request, response) => {
  if (request.method === 'GET' && request.url === '/healthz') {
    const config = await loadConfig();
    response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, accountConfigured: Boolean(config.accountId), inboxesConfigured: config.allowedInboxIds.size }));
    return;
  }

  if (request.method !== 'POST' || request.url !== '/webhooks/chatwoot') {
    response.writeHead(404).end();
    return;
  }

  const mediaType = String(request.headers['content-type'] || '').split(';', 1)[0].trim().toLowerCase();
  if (mediaType !== 'application/json') {
    response.writeHead(415).end('unsupported_content_type');
    return;
  }

  let rawBody;
  try {
    rawBody = await readBody(request);
  } catch (error) {
    response.writeHead(error.statusCode || 400).end(error.message);
    return;
  }

  let payload;
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch {
    response.writeHead(400).end('invalid_json');
    return;
  }

  const config = await loadConfig();
  const inboxId = String(payload?.inbox?.id ?? '');
  if (!config.allowedInboxIds.has(inboxId)) {
    response.writeHead(403).end('inbox_not_allowed');
    return;
  }

  const verification = verifySignature({
    rawBody,
    timestamp: request.headers['x-chatwoot-timestamp'],
    signature: request.headers['x-chatwoot-signature'],
    secret: config.secretsByInbox[inboxId],
    nowSeconds: Math.floor(Date.now() / 1000),
    toleranceSeconds,
  });
  if (!verification.ok) {
    response.writeHead(401).end(verification.reason);
    return;
  }

  if (String(payload?.account?.id ?? '') !== config.accountId || inboxId === '') {
    response.writeHead(403).end('account_or_inbox_mismatch');
    return;
  }

  if (failureMode === '500') {
    response.writeHead(500).end('poc_receiver_failure');
    return;
  }
  if (failureMode === 'timeout') {
    setTimeout(() => response.destroy(), 8000);
    return;
  }

  const eventKey = semanticMessageKey(payload);
  const record = {
    key: eventKey,
    deliveryId: request.headers['x-chatwoot-delivery'] || null,
    payloadHash: createHash('sha256').update(rawBody).digest('hex'),
    receivedAt: new Date().toISOString(),
    payload,
  };

  try {
    await appendDurably(eventsPath, record);
  } catch {
    response.writeHead(500).end('durable_persist_failed');
    return;
  }

  response.writeHead(200, { 'content-type': 'application/json' }).end('{"accepted":true}');

  // Forward to Tinix host application
  const tinixUpstream = process.env.TINIX_CALLBACK_UPSTREAM || 'http://host.docker.internal:3182/webhooks/chatwoot';
  fetch(tinixUpstream, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-chatwoot-signature': String(request.headers['x-chatwoot-signature'] || ''),
      'x-chatwoot-timestamp': String(request.headers['x-chatwoot-timestamp'] || ''),
      'x-chatwoot-delivery': String(request.headers['x-chatwoot-delivery'] || ''),
    },
    body: rawBody,
    signal: AbortSignal.timeout(10_000),
  }).then(async (res) => {
    process.stdout.write(`[Relay->Tinix] ${res.status} for eventKey=${eventKey}\n`);
  }).catch((err) => {
    process.stderr.write(`[Relay->Tinix Error] ${err.message}\n`);
  });

  if (eventKey) {
    processing = processing.then(() => enqueueFakeSend(payload)).catch((error) => {
      process.stderr.write(`poc_async_processing_error=${error.message}\n`);
    });
  }
});

await recoverJournal();
server.listen(port, '0.0.0.0', () => process.stdout.write(`poc_callback_receiver_listening=${port}\n`));
