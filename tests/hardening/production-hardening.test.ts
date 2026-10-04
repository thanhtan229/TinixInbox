import test from 'node:test';
import assert from 'node:assert';
import { createHmac } from 'node:crypto';
import { getDatabase } from '../../src/persistence/db.ts';
import {
  CallbackEventRepository,
  ChannelConnectionRepository,
  ContactLinkRepository,
  ConversationLinkRepository,
  MessageLinkRepository,
  OutboxRepository,
} from '../../src/persistence/repositories.ts';
import { InboundService } from '../../src/services/inbound-service.ts';
import { OutboundService } from '../../src/services/outbound-service.ts';
import { OutboxService } from '../../src/services/outbox-service.ts';
import { SyntheticChannelAdapter } from '../../src/channels/synthetic/synthetic-adapter.ts';
import type { ConversationProvider, MessagePage } from '../../src/core/conversation-provider.ts';
import type { ChannelConnection } from '../../src/core/types.ts';

function createHardeningMockProvider(): ConversationProvider & { readonly incomingMessageCount: number } {
  let counter = 1;
  let incomingMessageCount = 0;
  return {
    providerName: 'hardening-mock',
    get incomingMessageCount() { return incomingMessageCount; },
    async ensureIdentity(input: any) {
      return { contactId: ++counter, sourceId: input.externalUserId };
    },
    async ensureConversation() {
      const id = ++counter;
      return { conversationId: id, displayId: id, status: 'open' };
    },
    async createIncomingMessage() {
      incomingMessageCount++;
      return { messageId: ++counter, conversationId: 1, content: 'msg', isPrivate: false, direction: 'incoming', status: 'sent', createdAt: new Date().toISOString() };
    },
    async createOutgoingMessage() {
      return { messageId: ++counter, conversationId: 1, content: 'reply', isPrivate: false, direction: 'outgoing', status: 'sent', createdAt: new Date().toISOString() };
    },
    async addPrivateNote() {
      return { messageId: ++counter, conversationId: 1, content: 'note', isPrivate: true, direction: 'outgoing', status: 'sent', createdAt: new Date().toISOString() };
    },
    async listMessages(): Promise<MessagePage> {
      return { messages: [] };
    },
    async updateSupportState() {},
    async assignConversation() {},
    async getAssignment() { return { agents: [], assignee: null }; },
    async downloadMessageAttachment() { throw new Error('unused'); },
    async reconcileConversation() { return { unprocessedOutgoingMessages: [] }; },
  };
}

test('Production Hardening: High concurrency inbound processing with deduplication', async () => {
  const db = getDatabase(':memory:');
  const connRepo = new ChannelConnectionRepository(db);
  const contactRepo = new ContactLinkRepository(db);
  const convRepo = new ConversationLinkRepository(db);
  const msgRepo = new MessageLinkRepository(db);
  const provider = createHardeningMockProvider();

  const inboundService = new InboundService(provider, contactRepo, convRepo, msgRepo);
  const adapter = new SyntheticChannelAdapter();

  const connection: ChannelConnection = {
    id: 'conn-stress-1',
    workspaceId: 'ws-stress',
    provider: 'synthetic',
    displayName: 'Stress Test Channel',
    externalAccountId: 'stress-acc-1',
    status: 'connected',
    credentialsEncrypted: 'stress-secret',
    credentialVersion: 1,
    scopes: ['messages'],
    metadata: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  connRepo.create(connection);

  // Send 50 concurrent incoming messages (with 10 duplicates)
  const tasks: Promise<any>[] = [];
  for (let i = 0; i < 50; i++) {
    const msgIndex = i % 40; // 0 to 39, so items 40-49 are exact duplicates of 0-9
    const payload = JSON.stringify({
      message_id: `stress-msg-${msgIndex}`,
      sender_id: `customer-${msgIndex}`,
      text: `Stress test message ${msgIndex}`,
      timestamp: Date.now(),
    });

    tasks.push(
      inboundService.processInboundWebhook(adapter, connection, payload, { 'x-synthetic-signature': 'secret-stress-secret' }, 'stress-secret')
    );
  }

  const results = await Promise.all(tasks);
  assert.strictEqual(results.length, 50);

  // Exactly 40 unique message links should exist in the repository
  const allConversations = convRepo.listByWorkspace('ws-stress');
  assert.strictEqual(allConversations.length, 40);
  assert.strictEqual(provider.incomingMessageCount, 40);
});

test('Production Hardening: Bulk outbox dead-letter redrive', async () => {
  const db = getDatabase(':memory:');
  const connRepo = new ChannelConnectionRepository(db);
  const msgRepo = new MessageLinkRepository(db);
  const outboxRepo = new OutboxRepository(db);

  const connection: ChannelConnection = {
    id: 'conn-dl-1',
    workspaceId: 'ws-dl',
    provider: 'synthetic',
    displayName: 'Synthetic Channel',
    externalAccountId: 'acc-dl-1',
    status: 'connected',
    credentialsEncrypted: 'secret',
    credentialVersion: 1,
    scopes: ['messages'],
    metadata: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  connRepo.create(connection);

  const outboxService = new OutboxService(outboxRepo, msgRepo, connRepo);
  const adapter = new SyntheticChannelAdapter();
  outboxService.registerAdapter('synthetic', adapter);

  // Insert 5 dead-letter messages
  for (let i = 1; i <= 5; i++) {
    outboxRepo.create({
      id: `outbox-dl-${i}`,
      workspaceId: 'ws-dl',
      channelConnectionId: connection.id,
      conversationLinkId: 'conv-dl-1',
      chatwootAccountId: 1,
      chatwootMessageId: 900 + i,
      idempotencyKey: `idem-dl-${i}`,
      payloadSnapshot: JSON.stringify({ content: `Dead letter message ${i}`, recipientExternalId: 'rec-1' }),
      state: 'dead_letter',
      attemptCount: 5,
      correlationId: `corr-dl-${i}`,
      createdAt: new Date().toISOString(),
    });
  }

  // Verify they are dead-letter initially
  assert.strictEqual(outboxRepo.listPending(10).length, 0);

  // Redrive all dead-letters
  const redriveResult = await outboxService.redriveAllDeadLetter();
  assert.strictEqual(redriveResult.resetCount, 5);
  assert.strictEqual(redriveResult.sent, 5);
  assert.strictEqual(redriveResult.failed, 0);

  // All 5 items are now successfully sent
  for (let i = 1; i <= 5; i++) {
    const item = outboxRepo.findByIdempotencyKey(`idem-dl-${i}`);
    assert.strictEqual(item?.state, 'provider_accepted');
  }
});

test('Production Hardening: Strict cross-workspace tenant isolation', async () => {
  const db = getDatabase(':memory:');
  const connRepo = new ChannelConnectionRepository(db);
  const convRepo = new ConversationLinkRepository(db);

  connRepo.create({
    id: 'conn-ws1',
    workspaceId: 'tenant-alpha',
    provider: 'synthetic',
    displayName: 'Alpha Channel',
    externalAccountId: 'acc-alpha',
    status: 'connected',
    credentialsEncrypted: 'sec-alpha',
    credentialVersion: 1,
    scopes: ['messages'],
    metadata: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  connRepo.create({
    id: 'conn-ws2',
    workspaceId: 'tenant-beta',
    provider: 'synthetic',
    displayName: 'Beta Channel',
    externalAccountId: 'acc-beta',
    status: 'connected',
    credentialsEncrypted: 'sec-beta',
    credentialVersion: 1,
    scopes: ['messages'],
    metadata: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  convRepo.create({
    id: 'conv-alpha-1',
    workspaceId: 'tenant-alpha',
    channelConnectionId: 'conn-ws1',
    tinixThreadKey: 'thread-alpha-1',
    chatwootAccountId: 1,
    chatwootInboxId: 10,
    chatwootConversationRef: 'alpha-ref-1',
    chatwootConversationDisplayId: 101,
    state: 'open',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  // Verify Alpha only sees its own connections and conversations
  const alphaConns = connRepo.listByWorkspace('tenant-alpha');
  assert.strictEqual(alphaConns.length, 1);
  assert.strictEqual(alphaConns[0].id, 'conn-ws1');

  const alphaConvs = convRepo.listByWorkspace('tenant-alpha');
  assert.strictEqual(alphaConvs.length, 1);
  assert.strictEqual(alphaConvs[0].id, 'conv-alpha-1');

  // Verify Beta sees none of Alpha's data
  const betaConns = connRepo.listByWorkspace('tenant-beta');
  assert.strictEqual(betaConns.length, 1);
  assert.strictEqual(betaConns[0].id, 'conn-ws2');

  const betaConvs = convRepo.listByWorkspace('tenant-beta');
  assert.strictEqual(betaConvs.length, 0);
});

test('Production Hardening: concurrent duplicate Chatwoot callbacks and outbox workers send once', async () => {
  const db = getDatabase(':memory:');
  const connectionRepo = new ChannelConnectionRepository(db);
  const conversationRepo = new ConversationLinkRepository(db);
  const messageRepo = new MessageLinkRepository(db);
  const outboxRepo = new OutboxRepository(db);
  const callbackEventRepo = new CallbackEventRepository(db);
  const connection: ChannelConnection = {
    id: 'conn-callback-stress',
    workspaceId: 'ws-callback-stress',
    provider: 'synthetic',
    displayName: 'Synthetic callback stress',
    externalAccountId: 'synthetic-callback-stress',
    status: 'connected',
    credentialsEncrypted: 'callback-stress-credentials',
    credentialVersion: 1,
    scopes: ['messages'],
    metadata: {},
    chatwootAccountId: 1,
    chatwootInboxId: 11,
    chatwootCallbackSecretRef: 'callback-stress-secret',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  connectionRepo.create(connection);
  conversationRepo.create({
    id: 'conv-callback-stress',
    workspaceId: connection.workspaceId,
    channelConnectionId: connection.id,
    externalConversationId: 'stress-conversation',
    tinixThreadKey: 'stress-conversation',
    chatwootAccountId: 1,
    chatwootInboxId: 11,
    chatwootConversationRef: 'stress-ref',
    chatwootConversationDisplayId: 111,
    state: 'open',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  const payload = JSON.stringify({
    event: 'message_created',
    id: 8101,
    content: 'Concurrent callback stress',
    message_type: 'outgoing',
    private: false,
    account: { id: 1 },
    inbox: { id: 11 },
    conversation: { id: 111, contact_inbox: { source_id: 'stress-customer' } },
  });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = `sha256=${createHmac('sha256', 'callback-stress-secret')
    .update(`${timestamp}.${payload}`)
    .digest('hex')}`;
  const outboundService = new OutboundService(
    connectionRepo,
    conversationRepo,
    messageRepo,
    outboxRepo,
    callbackEventRepo
  );
  const adapter = new SyntheticChannelAdapter();
  const outboxService = new OutboxService(outboxRepo, messageRepo, connectionRepo);
  outboxService.registerAdapter('synthetic', adapter);

  const callbackResults = await Promise.all(Array.from({ length: 100 }, () =>
    outboundService.handleChatwootCallback(payload, signature, timestamp)));
  assert.strictEqual(callbackResults.filter((result) => result.status === 'accepted').length, 1);
  assert.strictEqual(callbackResults.filter((result) => result.status === 'duplicate').length, 99);
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM outbox_messages').get()?.count, 1);
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM chatwoot_callback_events').get()?.count, 100);

  await Promise.all(Array.from({ length: 16 }, () => outboxService.processPendingOutbox(20)));
  assert.strictEqual(adapter.sendCount, 1);
  assert.strictEqual(outboxRepo.findByIdempotencyKey('1:11:message_created:8101')?.state, 'provider_accepted');
});
