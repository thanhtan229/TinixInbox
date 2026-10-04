import test from 'node:test';
import assert from 'node:assert/strict';
import { createAppServer, isLoopbackAddress, resolvePublicFilePath } from '../../src/api/server.ts';
import type { CallbackController } from '../../src/api/callback-controller.ts';
import type { WebhookController } from '../../src/api/webhook-controller.ts';
import type { InboxController } from '../../src/api/inbox-controller.ts';
import { assertSafeRuntimeHost } from '../../src/config/env.ts';
import { request } from 'node:http';

test('unauthenticated proxied operator APIs and cross-origin writes fail closed', async () => {
  const app = createAppServer({ port: 0, host: '127.0.0.1', operatorToken: '',
    callbackController: {} as CallbackController, webhookController: {} as WebhookController,
    inboxController: { getConnections: () => [] } as unknown as InboxController });
  await app.start();
  try {
    const address = app.server.address(); assert.ok(address && typeof address === 'object');
    const base = `http://127.0.0.1:${address.port}`;
    assert.equal((await fetch(base + '/api/connections')).status, 200);
    assert.equal((await fetch(base + '/api/connections', { headers: { 'cf-connecting-ip': '203.0.113.1' } })).status, 401);
    assert.equal((await fetch(base + '/api/connections', { headers: { 'x-forwarded-for': '203.0.113.1' } })).status, 401);
    const publicHostStatus = await new Promise<number | undefined>((resolve, reject) => {
      const req = request(base + '/api/connections', { headers: { Host: 'public.example' } }, res => {
        res.resume(); resolve(res.statusCode);
      }); req.on('error', reject); req.end();
    });
    assert.equal(publicHostStatus, 401);
    assert.equal((await fetch(base + '/api/connections', { method: 'POST', headers: { Origin: 'https://evil.test' } })).status, 403);
  } finally { await app.stop(); }
});

test('production server stays loopback-only until Tinix authentication is implemented', () => {
  assert.doesNotThrow(() => assertSafeRuntimeHost('production', '127.0.0.1'));
  assert.doesNotThrow(() => assertSafeRuntimeHost('production', '127.42.0.7'));
  assert.doesNotThrow(() => assertSafeRuntimeHost('production', '::1'));
  assert.doesNotThrow(() => assertSafeRuntimeHost('development', '0.0.0.0'));
  assert.throws(
    () => assertSafeRuntimeHost('production', '0.0.0.0'),
    /no built-in authentication\/RBAC.*HOST must remain loopback/
  );
});

test('Prometheus metrics are loopback-only and expose aggregate delivery state without payload data', async () => {
  assert.equal(isLoopbackAddress('127.0.0.1'), true);
  assert.equal(isLoopbackAddress('127.8.4.2'), true);
  assert.equal(isLoopbackAddress('::1'), true);
  assert.equal(isLoopbackAddress('::ffff:127.0.0.1'), true);
  assert.equal(isLoopbackAddress('10.0.0.2'), false);
  assert.equal(isLoopbackAddress('::ffff:192.168.1.20'), false);

  const app = createAppServer({
    port: 0,
    host: '127.0.0.1',
    callbackController: {} as CallbackController,
    webhookController: {} as WebhookController,
    inboxController: {
      getPrometheusMetrics: () => '# TYPE tinix_inbox_outbox_messages gauge\ntinix_inbox_outbox_messages{state="unknown"} 2\n',
    } as unknown as InboxController,
  });
  await app.start();
  try {
    const address = app.server.address();
    assert.ok(address && typeof address === 'object');
    const response = await fetch(`http://127.0.0.1:${address.port}/metrics`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') || '', /text\/plain; version=0\.0\.4/);
    const body = await response.text();
    assert.match(body, /state="unknown"\} 2/);
    assert.doesNotMatch(body, /customer|credential|token|secret/i);
  } finally {
    await app.stop();
  }
});
test('static file resolution confines decoded paths to the public directory', () => {
  const root = 'D:/tinix/public';
  assert.ok(resolvePublicFilePath(root, '/index.html'));
  assert.strictEqual(resolvePublicFilePath(root, '/%2e%2e/secrets.txt'), null);
  assert.strictEqual(resolvePublicFilePath(root, '/%5c..%5csecrets.txt'), null);
  assert.strictEqual(resolvePublicFilePath(root, '/%00secret'), null);
  assert.strictEqual(resolvePublicFilePath(root, '/%E0%A4%A'), null);
});

test('unexpected API errors do not expose internal messages to clients', async () => {
  const app = createAppServer({
    port: 0,
    host: '127.0.0.1',
    publicDir: 'public',
    callbackController: {} as CallbackController,
    webhookController: {} as WebhookController,
    inboxController: {
      getConversations() { throw new Error('provider-token=must-not-leak'); },
    } as unknown as InboxController,
  });
  await app.start();
  const originalConsoleError = console.error;
  let serverLog = '';
  console.error = (...args: unknown[]) => { serverLog += args.map(String).join(' '); };
  try {
    const address = app.server.address();
    assert.ok(address && typeof address === 'object');
    const response = await fetch(`http://127.0.0.1:${address.port}/api/conversations`);
    const payload = await response.json() as { error: string; correlationId?: string };
    assert.strictEqual(response.status, 500);
    assert.strictEqual(payload.error, 'Internal server error');
    assert.ok(payload.correlationId);
    assert.doesNotMatch(JSON.stringify(payload), /must-not-leak/);
  } finally {
    console.error = originalConsoleError;
    await app.stop();
  }
  assert.doesNotMatch(serverLog, /must-not-leak/);
});

test('Chatwoot callback route requires JSON content type before invoking the receiver', async () => {
  let callbackCalls = 0;
  const app = createAppServer({
    port: 0,
    host: '127.0.0.1',
    publicDir: 'public',
    callbackController: {
      async handleCallback() {
        callbackCalls += 1;
        return { status: 200, body: { ok: true } };
      },
    } as unknown as CallbackController,
    webhookController: {} as WebhookController,
    inboxController: {} as InboxController,
  });
  await app.start();
  try {
    const address = app.server.address();
    assert.ok(address && typeof address === 'object');
    const response = await fetch(`http://127.0.0.1:${address.port}/webhooks/chatwoot`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: '{"event":"message_created"}',
    });
    assert.strictEqual(response.status, 415);
    assert.deepStrictEqual(await response.json(), { error: 'Content-Type must be application/json' });
    assert.strictEqual(callbackCalls, 0);
  } finally {
    await app.stop();
  }
});

test('operator authentication protects API routes when operatorToken is configured', async () => {
  const secretToken = 'secret-operator-token-12345';
  const app = createAppServer({
    port: 0,
    host: '127.0.0.1',
    publicDir: 'public',
    operatorToken: secretToken,
    callbackController: {} as CallbackController,
    webhookController: {} as WebhookController,
    inboxController: {
      getHealth: () => ({ status: 'ok' }),
      getConversations: async () => [{ id: 'conv-1' }],
      getUnknownOutboxMessages: () => [{ id: 'out-unknown-1' }],
      getDeadLetterOutboxMessages: () => [{ id: 'out-dead-1' }],
      getUnknownInboundMessages: () => [{ externalMessageId: 'in-unknown-1' }],
    } as unknown as InboxController,
  });
  await app.start();
  try {
    const address = app.server.address();
    assert.ok(address && typeof address === 'object');
    const base = `http://127.0.0.1:${address.port}`;

    // 1. Health is always unauthenticated
    const health = await fetch(`${base}/api/health`);
    assert.strictEqual(health.status, 200);

    // 2. Unauthenticated request to /api/conversations is rejected
    const unauth = await fetch(`${base}/api/conversations`);
    assert.strictEqual(unauth.status, 401);
    const unauthBody = await unauth.json() as { error: string };
    assert.match(unauthBody.error, /Unauthorized/);

    // 3. Invalid token is rejected
    const invalid = await fetch(`${base}/api/conversations`, {
      headers: { Authorization: 'Bearer wrong-token' },
    });
    assert.strictEqual(invalid.status, 401);

    // 4. Valid token in Authorization Bearer header is accepted
    const validBearer = await fetch(`${base}/api/conversations`, {
      headers: { Authorization: `Bearer ${secretToken}` },
    });
    assert.strictEqual(validBearer.status, 200);
    assert.deepStrictEqual(await validBearer.json(), [{ id: 'conv-1' }]);

    // 5. Valid token in X-Tinix-Token header is accepted
    const validHeader = await fetch(`${base}/api/conversations`, {
      headers: { 'X-Tinix-Token': secretToken },
    });
    assert.strictEqual(validHeader.status, 200);

    // 6. Inspection routes are protected and return data with valid token
    const unknownOutbox = await fetch(`${base}/api/outbox/unknown`, {
      headers: { Authorization: `Bearer ${secretToken}` },
    });
    assert.strictEqual(unknownOutbox.status, 200);
    assert.deepStrictEqual(await unknownOutbox.json(), [{ id: 'out-unknown-1' }]);

    const deadLetter = await fetch(`${base}/api/outbox/dead-letter`, {
      headers: { Authorization: `Bearer ${secretToken}` },
    });
    assert.strictEqual(deadLetter.status, 200);
    assert.deepStrictEqual(await deadLetter.json(), [{ id: 'out-dead-1' }]);

    const unknownInbound = await fetch(`${base}/api/inbound/unknown`, {
      headers: { Authorization: `Bearer ${secretToken}` },
    });
    assert.strictEqual(unknownInbound.status, 200);
    assert.deepStrictEqual(await unknownInbound.json(), [{ externalMessageId: 'in-unknown-1' }]);
  } finally {
    await app.stop();
  }
});
