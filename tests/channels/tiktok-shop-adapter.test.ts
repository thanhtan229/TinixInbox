import test from 'node:test';
import assert from 'node:assert';
import { createHmac } from 'node:crypto';
import { TikTokShopChannelAdapter } from '../../src/channels/tiktok-shop/tiktok-shop-adapter.ts';
import { TikTokShopClient } from '../../src/channels/tiktok-shop/tiktok-shop-client.ts';
import type { ChannelConnection } from '../../src/core/types.ts';

test('TikTokShopChannelAdapter: validateConnection handles capability gating (BLOCKED_BY_PROVIDER)', async () => {
  const adapter = new TikTokShopChannelAdapter();

  const valid = await adapter.validateConnection(
    JSON.stringify({ accessToken: 'valid_tts_token_123', shopCipher: 'cipher_1', appKey: 'app-1', appSecret: 'secret-1' })
  );
  assert.strictEqual(valid.valid, false);
  assert.match(valid.error!, /BLOCKED_BY_PROVIDER/);

  const empty = await adapter.validateConnection('');
  assert.strictEqual(empty.valid, false);
  assert.match(empty.error!, /BLOCKED_BY_PROVIDER/);

  const missingToken = await adapter.validateConnection(JSON.stringify({ shopCipher: 'cipher_1' }));
  assert.strictEqual(missingToken.valid, false);
  assert.match(missingToken.error!, /BLOCKED_BY_PROVIDER/);
});

test('TikTokShopChannelAdapter: verifyWebhook validates partner HMAC-SHA256 signature', async () => {
  const adapter = new TikTokShopChannelAdapter();
  const secret = 'tts-app-secret-456';
  const body = JSON.stringify({ event_type: 1, data: { conversation_id: 'conv-tts-1' } });
  const sig = createHmac('sha256', secret).update(body).digest('hex');

  const valid = await adapter.verifyWebhook(body, { authorization: sig }, secret);
  assert.strictEqual(valid, true);

  const invalid = await adapter.verifyWebhook(body, { authorization: 'invalid' }, secret);
  assert.strictEqual(invalid, false);

  const missing = await adapter.verifyWebhook(body, {}, secret);
  assert.strictEqual(missing, false);
});

test('TikTokShopChannelAdapter: normalizeEvent normalizes buyer messages and filters seller echoes', async () => {
  const adapter = new TikTokShopChannelAdapter();
  const mockConn: ChannelConnection = {
    id: 'conn-tts-1',
    workspaceId: 'ws-test',
    provider: 'tiktok_shop',
    displayName: 'TikTok Shop Official',
    externalAccountId: 'shop-888',
    status: 'connected',
    credentialsEncrypted: JSON.stringify({ accessToken: 'test-token' }),
    credentialVersion: 1,
    scopes: ['seller.customer_service'],
    metadata: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  // Buyer incoming text
  const buyerEvent = {
    event_type: 1,
    data: {
      conversation_id: 'conv-buyer-101',
      sender: { id: 'buyer-999', role: 'BUYER' as const, name: 'Linh Nguyen' },
      message_id: 'tts-msg-1',
      message_type: 'TEXT' as const,
      content: JSON.stringify({ text: 'Sản phẩm này còn size M không shop?' }),
      create_time: 1710000000,
    },
  };

  const msgs = await adapter.normalizeEvent(buyerEvent, mockConn);
  assert.strictEqual(msgs.length, 1);
  assert.strictEqual(msgs[0].externalMessageId, 'tts-msg-1');
  assert.strictEqual(msgs[0].externalConversationId, 'conv-buyer-101');
  assert.strictEqual(msgs[0].sender.externalId, 'buyer-999');
  assert.strictEqual(msgs[0].text, 'Sản phẩm này còn size M không shop?');
  assert.strictEqual(msgs[0].direction, 'incoming');

  // Seller echo (must be filtered!)
  const sellerEchoEvent = {
    event_type: 1,
    data: {
      conversation_id: 'conv-buyer-101',
      sender: { id: 'seller-shop', role: 'SELLER' as const },
      message_id: 'tts-msg-echo',
      message_type: 'TEXT' as const,
      content: JSON.stringify({ text: 'Chào bạn, còn bạn nhé' }),
    },
  };

  const echoMsgs = await adapter.normalizeEvent(sellerEchoEvent, mockConn);
  assert.strictEqual(echoMsgs.length, 0);
});

test('TikTokShopClient cannot issue the stale unsigned send request', async () => {
  const client = new TikTokShopClient();
  await assert.rejects(client.sendMessage('token', 'conversation-1', 'reply'), /BLOCKED_BY_PROVIDER/);

  const adapter = new TikTokShopChannelAdapter(client);
  const res = await adapter.sendMessage({
    workspaceId: 'ws-test', channelConnectionId: 'conn-tts-1',
    recipientExternalId: 'conv-buyer-101', text: 'Shop chào bạn', correlationId: 'corr-tts-1',
  });
  assert.strictEqual(res.success, false);
  assert.match(res.error!, /BLOCKED_BY_PROVIDER/);
});
