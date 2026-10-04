import test from 'node:test';
import assert from 'node:assert';
import {
  computeInboundIdempotencyKey,
  validateUnifiedMessage,
} from '../../src/core/unified-message.ts';

test('computeInboundIdempotencyKey generates stable composite key', () => {
  const key = computeInboundIdempotencyKey('ws-1', 'conn-1', 'ext-msg-123');
  assert.strictEqual(key, 'ws-1:conn-1:ext-msg-123');
});

test('validateUnifiedMessage validates complete message', () => {
  const valid = validateUnifiedMessage({
    id: 'msg-1',
    workspaceId: 'ws-1',
    provider: 'meta',
    channelConnectionId: 'conn-1',
    externalConversationId: 'ext-conv-1',
    externalMessageId: 'ext-msg-1',
    direction: 'incoming',
    messageType: 'text',
    sender: { externalId: 'user-1' },
    attachments: [],
    sentAt: new Date().toISOString(),
    receivedAt: new Date().toISOString(),
  });
  assert.strictEqual(valid, true);
});

test('validateUnifiedMessage rejects incomplete message', () => {
  const invalid = validateUnifiedMessage({
    workspaceId: 'ws-1',
    // missing channelConnectionId, externalMessageId, etc.
  });
  assert.strictEqual(invalid, false);
});
