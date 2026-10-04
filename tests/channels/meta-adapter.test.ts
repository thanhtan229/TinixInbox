import test from 'node:test';
import assert from 'node:assert';
import { createHmac } from 'node:crypto';
import { MetaChannelAdapter } from '../../src/channels/meta/meta-adapter.ts';
import { MetaClient } from '../../src/channels/meta/meta-client.ts';
import type { ChannelConnection } from '../../src/core/types.ts';

test('MetaChannelAdapter: verifyWebhook validates valid X-Hub-Signature-256', async () => {
  const adapter = new MetaChannelAdapter();
  const secret = 'meta-app-secret-123';
  const body = JSON.stringify({ object: 'page', entry: [] });
  const sig = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;

  const valid = await adapter.verifyWebhook(body, { 'x-hub-signature-256': sig }, secret);
  assert.strictEqual(valid, true);

  const invalid = await adapter.verifyWebhook(body, { 'x-hub-signature-256': 'sha256=invalid' }, secret);
  assert.strictEqual(invalid, false);

  const missing = await adapter.verifyWebhook(body, {}, secret);
  assert.strictEqual(missing, false);
});

test('MetaChannelAdapter: parseWebhook extracts messaging events', async () => {
  const adapter = new MetaChannelAdapter();
  const payload = {
    object: 'page',
    entry: [
      {
        id: 'page-101',
        time: 1710000000,
        messaging: [
          {
            sender: { id: 'psid-user-1' },
            recipient: { id: 'page-101' },
            timestamp: 1710000001,
            message: { mid: 'm_mid_123', text: 'Hello Facebook' },
          },
        ],
      },
    ],
  };

  const events = await adapter.parseWebhook(JSON.stringify(payload));
  assert.strictEqual(events.length, 1);
  const evt = events[0] as any;
  assert.strictEqual(evt.sender.id, 'psid-user-1');
  assert.strictEqual(evt.message.text, 'Hello Facebook');
});

test('MetaChannelAdapter: normalizeEvent creates UnifiedMessage and ignores echoes', async () => {
  const adapter = new MetaChannelAdapter();
  const mockConn: ChannelConnection = {
    id: 'conn-meta-1',
    workspaceId: 'ws-test',
    provider: 'meta',
    displayName: 'My FB Page',
    externalAccountId: 'page-101',
    status: 'connected',
    credentialsEncrypted: 'enc-creds',
    credentialVersion: 1,
    scopes: ['pages_messaging'],
    metadata: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  // Normal incoming message
  const normalEvent = {
    sender: { id: 'psid-user-1' },
    recipient: { id: 'page-101' },
    timestamp: 1710000001,
    message: { mid: 'm_mid_123', text: 'Hi from customer' },
  };

  const msgs = await adapter.normalizeEvent(normalEvent, mockConn);
  assert.strictEqual(msgs.length, 1);
  assert.strictEqual(msgs[0].externalMessageId, 'm_mid_123');
  assert.strictEqual(msgs[0].sender.externalId, 'psid-user-1');
  assert.strictEqual(msgs[0].text, 'Hi from customer');
  assert.strictEqual(msgs[0].direction, 'incoming');

  // Echo message (outgoing from page) must be ignored
  const echoEvent = {
    sender: { id: 'page-101' },
    recipient: { id: 'psid-user-1' },
    timestamp: 1710000002,
    message: { mid: 'm_mid_echo', text: 'Hi back', is_echo: true },
  };

  const echoMsgs = await adapter.normalizeEvent(echoEvent, mockConn);
  assert.strictEqual(echoMsgs.length, 0); // Ignored!
});

test('MetaChannelAdapter: sendMessage handles success and error cases', async () => {
  // Mock fetch function simulating Meta Graph API
  let requestedUrl = '';
  const mockFetchSuccess: typeof fetch = async (url) => {
    requestedUrl = String(url);
    return new Response(JSON.stringify({ recipient_id: 'psid-user-1', message_id: 'm_sent_999' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const successClient = new MetaClient({ graphApiVersion: 'v99.1', fetchFn: mockFetchSuccess });
  const successAdapter = new MetaChannelAdapter(successClient);

  const res = await successAdapter.sendMessage({
    workspaceId: 'ws-test',
    channelConnectionId: 'conn-meta-1',
    recipientExternalId: 'psid-user-1',
    text: 'Reply from agent',
    correlationId: 'corr-1',
    metadata: { accessToken: 'test-meta-token', pageId: 'page-101' },
  });

  assert.strictEqual(res.success, true);
  assert.strictEqual(res.providerMessageId, 'm_sent_999');
  assert.match(requestedUrl, /graph\.facebook\.com\/v99\.1\/page-101\/messages$/);

  // Test Rate Limit (429) mapping
  const mockFetchRateLimit: typeof fetch = async () => {
    return new Response(
      JSON.stringify({
        error: { message: 'Too many requests', type: 'OAuthException', code: 4 },
      }),
      { status: 429, headers: { 'Content-Type': 'application/json' } }
    );
  };

  const rateLimitClient = new MetaClient({ fetchFn: mockFetchRateLimit });
  const rateLimitAdapter = new MetaChannelAdapter(rateLimitClient);

  const failRes = await rateLimitAdapter.sendMessage({
    workspaceId: 'ws-test',
    channelConnectionId: 'conn-meta-1',
    recipientExternalId: 'psid-user-1',
    text: 'Reply',
    correlationId: 'corr-2',
    metadata: { accessToken: 'test-meta-token', pageId: 'page-101' },
  });

  assert.strictEqual(failRes.success, false);
  assert.match(failRes.error!, /rate limit/i);
});

test('MetaChannelAdapter: does not send when credentials are missing', async () => {
  let fetchCalled = false;
  const adapter = new MetaChannelAdapter(new MetaClient({ fetchFn: async () => {
    fetchCalled = true;
    return new Response('{}', { status: 200 });
  } }));

  const result = await adapter.sendMessage({
    workspaceId: 'ws-test',
    channelConnectionId: 'conn-meta-1',
    recipientExternalId: 'psid-user-1',
    text: 'Reply',
    correlationId: 'corr-no-token',
  });

  assert.strictEqual(result.success, false);
  assert.match(result.error!, /token.*not configured/i);
  assert.strictEqual(fetchCalled, false);
});
