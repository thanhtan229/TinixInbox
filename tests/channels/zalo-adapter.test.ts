import test from 'node:test';
import assert from 'node:assert';
import { createHash } from 'node:crypto';
import { ZaloChannelAdapter } from '../../src/channels/zalo/zalo-adapter.ts';
import { ZaloClient } from '../../src/channels/zalo/zalo-client.ts';
import type { ChannelConnection } from '../../src/core/types.ts';

test('ZaloChannelAdapter: validateConnection handles valid and invalid formats', async () => {
  const adapter = new ZaloChannelAdapter();

  const validToken = await adapter.validateConnection('zalo_access_token_123456');
  assert.strictEqual(validToken.valid, true);

  const validJson = await adapter.validateConnection(
    JSON.stringify({ accessToken: 'valid_zalo_token_abc', appId: 'app123' })
  );
  assert.strictEqual(validJson.valid, true);

  const empty = await adapter.validateConnection('');
  assert.strictEqual(empty.valid, false);

  const invalidJson = await adapter.validateConnection(JSON.stringify({ appId: 'app123' }));
  assert.strictEqual(invalidJson.valid, false);
});

test('ZaloChannelAdapter: verifyWebhook accepts only the official Zalo event signature', async () => {
  const adapter = new ZaloChannelAdapter();
  const secret = 'oa-secret-key-xyz';
  const appId = 'app-1001';
  const timestamp = '1710000000000';
  const body = JSON.stringify({ app_id: appId, timestamp, event_name: 'user_send_text' });

  // Official Zalo sha256(appId + rawBody + timestamp + secretKey)
  const officialSig = createHash('sha256')
    .update(`${appId}${body}${timestamp}${secret}`)
    .digest('hex');

  const validOfficial = await adapter.verifyWebhook(
    body,
    { 'x-zevent-signature': `mac=${officialSig}`, timestamp, 'app-id': appId },
    secret
  );
  assert.strictEqual(validOfficial, true);

  const hmacSig = createHash('sha256').update(`${appId}${body}${timestamp}${secret}`).digest('hex');
  const wrongHeader = await adapter.verifyWebhook(body, { 'x-hub-signature-256': `sha256=${hmacSig}` }, secret);
  assert.strictEqual(wrongHeader, false);

  const hmacFallback = await adapter.verifyWebhook(
    body,
    { 'x-zevent-signature': createHash('sha256').update(`${body}${secret}`).digest('hex') },
    secret
  );
  assert.strictEqual(hmacFallback, false);

  const missingSignedFields = await adapter.verifyWebhook(
    JSON.stringify({ event_name: 'user_send_text' }),
    { 'x-zevent-signature': hmacSig },
    secret
  );
  assert.strictEqual(missingSignedFields, false);

  // Invalid signature
  const invalid = await adapter.verifyWebhook(
    body,
    { 'x-zevent-signature': 'mac=invalidhex' },
    secret
  );
  assert.strictEqual(invalid, false);

  // Missing signature
  const missing = await adapter.verifyWebhook(body, {}, secret);
  assert.strictEqual(missing, false);
});

test('ZaloChannelAdapter: parseWebhook parses event array or single event', async () => {
  const adapter = new ZaloChannelAdapter();
  const single = JSON.stringify({ event_name: 'user_send_text', sender: { id: 'u1' } });
  const events = await adapter.parseWebhook(single);
  assert.strictEqual(events.length, 1);
  assert.strictEqual((events[0] as any).event_name, 'user_send_text');
});

test('ZaloChannelAdapter: normalizeEvent creates UnifiedMessage and filters echoes', async () => {
  const adapter = new ZaloChannelAdapter();
  const mockConn: ChannelConnection = {
    id: 'conn-zalo-1',
    workspaceId: 'ws-test',
    provider: 'zalo',
    displayName: 'My Zalo OA',
    externalAccountId: 'oa-888',
    status: 'connected',
    credentialsEncrypted: JSON.stringify({ accessToken: 'test-token' }),
    credentialVersion: 1,
    scopes: ['oa_message'],
    metadata: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  // Normal user text
  const textEvent = {
    event_name: 'user_send_text',
    sender: { id: 'zalo-user-1' },
    recipient: { id: 'oa-888' },
    timestamp: 1710000001000,
    message: { msg_id: 'zmsg-101', text: 'Xin chào shop' },
  };

  const textMsgs = await adapter.normalizeEvent(textEvent, mockConn);
  assert.strictEqual(textMsgs.length, 1);
  assert.strictEqual(textMsgs[0].externalMessageId, 'zmsg-101');
  assert.strictEqual(textMsgs[0].sender.externalId, 'zalo-user-1');
  assert.strictEqual(textMsgs[0].text, 'Xin chào shop');
  assert.strictEqual(textMsgs[0].messageType, 'text');
  assert.strictEqual(textMsgs[0].direction, 'incoming');

  // Normal user image
  const imgEvent = {
    event_name: 'user_send_image',
    sender: { id: 'zalo-user-1' },
    recipient: { id: 'oa-888' },
    timestamp: 1710000002000,
    message: {
      msg_id: 'zmsg-102',
      attachments: [{ type: 'image', payload: { url: 'https://zalo.me/img.png' } }],
    },
  };

  const imgMsgs = await adapter.normalizeEvent(imgEvent, mockConn);
  assert.strictEqual(imgMsgs.length, 1);
  assert.strictEqual(imgMsgs[0].messageType, 'image');
  assert.strictEqual(imgMsgs[0].attachments[0].url, 'https://zalo.me/img.png');

  // Echo from OA (must be ignored!)
  const echoEvent = {
    event_name: 'oa_send_text',
    sender: { id: 'oa-888' },
    recipient: { id: 'zalo-user-1' },
    timestamp: 1710000003000,
    message: { msg_id: 'zmsg-echo', text: 'OA reply' },
  };

  const echoMsgs = await adapter.normalizeEvent(echoEvent, mockConn);
  assert.strictEqual(echoMsgs.length, 0);
});

test('ZaloChannelAdapter: sendMessage handles success and provider errors', async () => {
  // 1. Success
  const mockFetchSuccess: typeof fetch = async () => {
    return new Response(
      JSON.stringify({
        error: 0,
        message: 'Success',
        data: { message_id: 'zalo-sent-msg-1', user_id: 'zalo-user-1' },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  };

  const client = new ZaloClient({ fetchFn: mockFetchSuccess });
  const adapter = new ZaloChannelAdapter(client);

  let missingTokenCalls = 0;
  const noCredentialsAdapter = new ZaloChannelAdapter(new ZaloClient({ fetchFn: async () => {
    missingTokenCalls++;
    return new Response('{}', { status: 200 });
  } }));
  const missingTokenResult = await noCredentialsAdapter.sendMessage({
    workspaceId: 'ws-test', channelConnectionId: 'conn-zalo-1', recipientExternalId: 'zalo-user-1',
    text: 'Should not send', correlationId: 'corr-z-missing', metadata: {},
  });
  assert.strictEqual(missingTokenResult.success, false);
  assert.match(missingTokenResult.error!, /not configured/);
  assert.strictEqual(missingTokenCalls, 0);

  const res = await adapter.sendMessage({
    workspaceId: 'ws-test',
    channelConnectionId: 'conn-zalo-1',
    recipientExternalId: 'zalo-user-1',
    text: 'Shop chào bạn',
    correlationId: 'corr-z1',
    metadata: { accessToken: 'test-zalo-token' },
  });

  assert.strictEqual(res.success, true);
  assert.strictEqual(res.providerMessageId, 'zalo-sent-msg-1');

  // 2. Rate limit / Quota exceeded (-216)
  const mockFetchQuota: typeof fetch = async () => {
    return new Response(
      JSON.stringify({ error: -216, message: 'Out of quota for message' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  };

  const quotaAdapter = new ZaloChannelAdapter(new ZaloClient({ fetchFn: mockFetchQuota }));
  const quotaRes = await quotaAdapter.sendMessage({
    workspaceId: 'ws-test',
    channelConnectionId: 'conn-zalo-1',
    recipientExternalId: 'zalo-user-1',
    text: 'Shop chào bạn',
    correlationId: 'corr-z2',
    metadata: { accessToken: 'test-zalo-token' },
  });

  assert.strictEqual(quotaRes.success, false);
  assert.match(quotaRes.error!, /quota/i);

  // 3. Expired token (-213)
  const mockFetchTokenExpired: typeof fetch = async () => {
    return new Response(
      JSON.stringify({ error: -213, message: 'Invalid access token' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  };

  const expAdapter = new ZaloChannelAdapter(new ZaloClient({ fetchFn: mockFetchTokenExpired }));
  const expRes = await expAdapter.sendMessage({
    workspaceId: 'ws-test',
    channelConnectionId: 'conn-zalo-1',
    recipientExternalId: 'zalo-user-1',
    text: 'Shop chào bạn',
    correlationId: 'corr-z3',
    metadata: { accessToken: 'test-zalo-token' },
  });

  assert.strictEqual(expRes.success, false);
  assert.match(expRes.error!, /token/i);
});

test('ZaloChannelAdapter: refreshCredentials refreshes expired access token', async () => {
  const mockFetchRefresh: typeof fetch = async () => {
    return new Response(
      JSON.stringify({
        access_token: 'new-zalo-access-token',
        refresh_token: 'new-zalo-refresh-token',
        expires_in: '90000',
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  };

  const client = new ZaloClient({ fetchFn: mockFetchRefresh });
  const adapter = new ZaloChannelAdapter(client);

  const mockConn: ChannelConnection = {
    id: 'conn-zalo-1',
    workspaceId: 'ws-test',
    provider: 'zalo',
    displayName: 'My Zalo OA',
    externalAccountId: 'oa-888',
    status: 'connected',
    credentialsEncrypted: JSON.stringify({
      appId: 'my-app-id',
      secretKey: 'my-secret-key',
      accessToken: 'old-access-token',
      refreshToken: 'old-refresh-token',
    }),
    credentialVersion: 1,
    scopes: ['oa_message'],
    metadata: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const refreshRes = await adapter.refreshCredentials(mockConn);
  assert.strictEqual(refreshRes.refreshed, true);
  assert.ok(refreshRes.newCredentials);
  const parsed = JSON.parse(refreshRes.newCredentials!);
  assert.strictEqual(parsed.accessToken, 'new-zalo-access-token');
  assert.strictEqual(parsed.refreshToken, 'new-zalo-refresh-token');
});
