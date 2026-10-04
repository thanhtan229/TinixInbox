import test from 'node:test';
import assert from 'node:assert';
import { createHmac } from 'node:crypto';
import { ShopeeChannelAdapter } from '../../src/channels/shopee/shopee-adapter.ts';
import { ShopeeClient } from '../../src/channels/shopee/shopee-client.ts';
import type { ChannelConnection } from '../../src/core/types.ts';

test('ShopeeChannelAdapter: validateConnection handles capability gating (BLOCKED_BY_PROVIDER)', async () => {
  const adapter = new ShopeeChannelAdapter();

  const valid = await adapter.validateConnection(
    JSON.stringify({ partnerId: 101, partnerKey: 'key_1', accessToken: 'token_1', shopId: 202 })
  );
  assert.strictEqual(valid.valid, false);
  assert.match(valid.error!, /BLOCKED_BY_PROVIDER/);

  const empty = await adapter.validateConnection('');
  assert.strictEqual(empty.valid, false);
  assert.match(empty.error!, /BLOCKED_BY_PROVIDER/);

  const missingKey = await adapter.validateConnection(
    JSON.stringify({ accessToken: 'token_1', shopId: 202 })
  );
  assert.strictEqual(missingKey.valid, false);
  assert.match(missingKey.error!, /BLOCKED_BY_PROVIDER/);
});

test('ShopeeChannelAdapter: verifyWebhook validates partner HMAC-SHA256 signature', async () => {
  const adapter = new ShopeeChannelAdapter();
  const secret = 'shopee-partner-key-999';
  const body = JSON.stringify({ code: 10, shop_id: 202, data: { conversation_id: 'conv-shopee-1' } });
  const sig = createHmac('sha256', secret).update(body).digest('hex');

  const valid = await adapter.verifyWebhook(body, { authorization: sig }, secret);
  assert.strictEqual(valid, true);

  const invalid = await adapter.verifyWebhook(body, { authorization: 'invalid-sig' }, secret);
  assert.strictEqual(invalid, false);

  const missing = await adapter.verifyWebhook(body, {}, secret);
  assert.strictEqual(missing, false);
});

test('ShopeeChannelAdapter: normalizeEvent normalizes buyer messages and filters shop echoes', async () => {
  const adapter = new ShopeeChannelAdapter();
  const mockConn: ChannelConnection = {
    id: 'conn-shopee-1',
    workspaceId: 'ws-test',
    provider: 'shopee',
    displayName: 'Shopee Official Store',
    externalAccountId: '202',
    status: 'connected',
    credentialsEncrypted: JSON.stringify({ accessToken: 'test-token' }),
    credentialVersion: 1,
    scopes: ['sellerchat'],
    metadata: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  // Buyer incoming text
  const buyerEvent = {
    code: 10,
    shop_id: 202,
    timestamp: 1710000000,
    data: {
      message_id: 'shopee-msg-1',
      conversation_id: 'conv-shopee-buyer-1',
      from_id: 999111,
      to_id: 202,
      content: { text: 'Shop giao hàng nhanh không?' },
      created_timestamp: 1710000001,
    },
  };

  const msgs = await adapter.normalizeEvent(buyerEvent, mockConn);
  assert.strictEqual(msgs.length, 1);
  assert.strictEqual(msgs[0].externalMessageId, 'shopee-msg-1');
  assert.strictEqual(msgs[0].externalConversationId, 'conv-shopee-buyer-1');
  assert.strictEqual(msgs[0].sender.externalId, '999111');
  assert.strictEqual(msgs[0].text, 'Shop giao hàng nhanh không?');
  assert.strictEqual(msgs[0].direction, 'incoming');

  // Shop echo (must be filtered!)
  const shopEchoEvent = {
    code: 10,
    shop_id: 202,
    timestamp: 1710000002,
    data: {
      message_id: 'shopee-msg-echo',
      conversation_id: 'conv-shopee-buyer-1',
      from_id: 202, // from_id === shop_id
      to_id: 999111,
      content: { text: 'Dạ shop giao hỏa tốc trong 2h ạ' },
    },
  };

  const echoMsgs = await adapter.normalizeEvent(shopEchoEvent, mockConn);
  assert.strictEqual(echoMsgs.length, 0);
});

test('ShopeeClient refuses to send until official Seller Chat access is verified', async () => {
  const client = new ShopeeClient();
  await assert.rejects(client.sendMessage({ partnerId: 1, partnerKey: 'key', accessToken: 'token', shopId: 2 }, 3, 'reply'), /BLOCKED_BY_PROVIDER/);

  const adapter = new ShopeeChannelAdapter(client);

  const res = await adapter.sendMessage({
    workspaceId: 'ws-test',
    channelConnectionId: 'conn-shopee-1',
    recipientExternalId: '999111',
    text: 'Shop chào bạn',
    correlationId: 'corr-shopee-1',
  });

  assert.strictEqual(res.success, false);
  assert.match(res.error!, /BLOCKED_BY_PROVIDER/);
});
