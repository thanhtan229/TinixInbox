import test from 'node:test';
import assert from 'node:assert/strict';
import { getDatabase } from '../../src/persistence/db.ts';
import { ChannelConnectionRepository, MessageLinkRepository, OutboxRepository } from '../../src/persistence/repositories.ts';
import { OutboxService } from '../../src/services/outbox-service.ts';
import { SyntheticChannelAdapter } from '../../src/channels/synthetic/synthetic-adapter.ts';

function setup() {
  const db = getDatabase(':memory:');
  const connections = new ChannelConnectionRepository(db);
  const messages = new MessageLinkRepository(db);
  const outbox = new OutboxRepository(db);
  connections.create({
    id: 'conn-synthetic', workspaceId: 'ws-1', provider: 'synthetic', displayName: 'Test',
    externalAccountId: 'synthetic-1', status: 'connected', credentialsEncrypted: 'test-only',
    credentialVersion: 1, scopes: [], metadata: {}, chatwootAccountId: 1, chatwootInboxId: 1,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  });
  const service = new OutboxService(outbox, messages, connections);
  return { connections, messages, outbox, service };
}

function outboxRecord(id: string) {
  return {
    id, workspaceId: 'ws-1', channelConnectionId: 'conn-synthetic', conversationLinkId: 'conv-1',
    chatwootAccountId: 1, chatwootMessageId: Number(id.slice(-1)) || 1, idempotencyKey: `idem-${id}`,
    payloadSnapshot: JSON.stringify({ content: 'Hello', recipientExternalId: 'customer-1' }),
    state: 'pending' as const, attemptCount: 0, correlationId: `corr-${id}`, createdAt: new Date().toISOString(),
  };
}

test('outbox claims one dispatch when callback and poll worker race', async () => {
  const { outbox, service } = setup();
  outbox.create(outboxRecord('outbox-1'));
  let calls = 0;
  const adapter = new SyntheticChannelAdapter();
  adapter.sendMessage = async () => {
    calls++;
    await new Promise((resolve) => setTimeout(resolve, 20));
    return { success: true, providerMessageId: 'provider-1', sentAt: new Date().toISOString() };
  };
  service.registerAdapter('synthetic', adapter);

  await Promise.all([service.dispatchItem('outbox-1'), service.dispatchItem('outbox-1')]);
  assert.strictEqual(calls, 1);
  assert.strictEqual(outbox.findByIdempotencyKey('idem-outbox-1')?.state, 'provider_accepted');
});

test('unknown provider outcome is retained and never retried automatically', async () => {
  const { outbox, service } = setup();
  outbox.create(outboxRecord('outbox-2'));
  const adapter = new SyntheticChannelAdapter();
  adapter.sendMessage = async () => ({
    success: false, failureKind: 'unknown', sentAt: new Date().toISOString(), error: 'Response lost after dispatch',
  });
  service.registerAdapter('synthetic', adapter);

  assert.strictEqual(await service.dispatchItem('outbox-2'), false);
  assert.strictEqual(outbox.findByIdempotencyKey('idem-outbox-2')?.state, 'unknown');
  assert.strictEqual(outbox.listPending().length, 0);
  assert.strictEqual(await service.retryOutboxItem('outbox-2'), false);
});

test('disabled channel holds queued sends until the connection is resumed', async () => {
  const { connections, outbox, service } = setup();
  outbox.create(outboxRecord('outbox-4'));
  const adapter = new SyntheticChannelAdapter();
  service.registerAdapter('synthetic', adapter);
  connections.setEnabled('ws-1', 'conn-synthetic', false);

  assert.strictEqual(await service.dispatchItem('outbox-4'), false);
  assert.deepStrictEqual(await service.processPendingOutbox(), { processed: 0, sent: 0, failed: 0 });
  assert.strictEqual(adapter.sendCount, 0);
  assert.strictEqual(outbox.findByIdempotencyKey('idem-outbox-4')?.state, 'pending');

  connections.setEnabled('ws-1', 'conn-synthetic', true);
  assert.strictEqual(await service.dispatchItem('outbox-4'), true);
  assert.strictEqual(adapter.sendCount, 1);
});

test('outbox releases a send claim if the channel pauses between claim and dispatch', async () => {
  const { connections, outbox, service } = setup();
  outbox.create(outboxRecord('outbox-5'));
  const adapter = new SyntheticChannelAdapter();
  service.registerAdapter('synthetic', adapter);
  const claimForSend = outbox.claimForSend.bind(outbox);
  outbox.claimForSend = (id: string) => {
    const claimed = claimForSend(id);
    connections.setEnabled('ws-1', 'conn-synthetic', false);
    return claimed;
  };

  assert.strictEqual(await service.dispatchItem('outbox-5'), false);
  assert.strictEqual(adapter.sendCount, 0);
  assert.strictEqual(outbox.findByIdempotencyKey('idem-outbox-5')?.state, 'pending');
});

test('restart recovery changes interrupted sending rows to unknown', () => {
  const { messages, outbox, service } = setup();
  const item = { ...outboxRecord('outbox-3'), state: 'sending' as const, claimedAt: new Date().toISOString() };
  outbox.create(item);
  messages.create({
    id: 'message-3', workspaceId: item.workspaceId, channelConnectionId: item.channelConnectionId,
    conversationLinkId: item.conversationLinkId, direction: 'outgoing', origin: 'human',
    chatwootAccountId: item.chatwootAccountId, chatwootMessageId: item.chatwootMessageId,
    outboxId: item.id, deliveryState: 'sending', correlationId: item.correlationId,
    createdAt: item.createdAt, updatedAt: item.createdAt,
  });

  assert.strictEqual(service.recoverInterruptedSends(), 1);
  assert.strictEqual(outbox.findByIdempotencyKey('idem-outbox-3')?.state, 'unknown');
  assert.strictEqual(messages.findByChatwootMessageId(1, item.chatwootMessageId)?.deliveryState, 'unknown');
});
