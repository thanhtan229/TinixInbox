import test from 'node:test';
import assert from 'node:assert';
import { getDatabase } from '../../src/persistence/db.ts';
import {
  AIStateRepository,
  ChannelConnectionRepository,
  ConversationLinkRepository,
  MessageLinkRepository,
  OutboxRepository,
} from '../../src/persistence/repositories.ts';
import { InboxController } from '../../src/api/inbox-controller.ts';
import { HandoffPolicy } from '../../src/agent/handoff-policy.ts';
import { OutboxService } from '../../src/services/outbox-service.ts';
import { ReconciliationService } from '../../src/services/reconciliation-service.ts';
import type { ConversationProvider, MessagePage } from '../../src/core/conversation-provider.ts';
import { SyntheticChannelAdapter } from '../../src/channels/synthetic/synthetic-adapter.ts';

function createMockProvider(): ConversationProvider {
  return {
    providerName: 'test',
    async ensureIdentity() {
      return { contactId: 10, contactInboxId: 20, sourceId: 'src-1' };
    },
    async ensureConversation() {
      return { conversationId: 100, displayId: 501, status: 'open' };
    },
    async createIncomingMessage() {
      return { messageId: 1001, conversationId: 501, content: 'test', isPrivate: false, direction: 'incoming', status: 'sent', createdAt: new Date().toISOString() };
    },
    async createOutgoingMessage() {
      return { messageId: 1002, conversationId: 501, content: 'reply', isPrivate: false, direction: 'outgoing', status: 'sent', createdAt: new Date().toISOString() };
    },
    async addPrivateNote() {
      return { messageId: 1003, conversationId: 501, content: 'private note', isPrivate: true, direction: 'outgoing', status: 'sent', createdAt: new Date().toISOString() };
    },
    async listMessages(): Promise<MessagePage> {
      return {
        messages: [
          { messageId: 1001, conversationId: 501, content: 'hello customer', isPrivate: false, direction: 'incoming', status: 'sent', createdAt: new Date().toISOString(), attachments: [{ type: 'image', fileName: 'photo.png', mimeType: 'image/png', url: 'http://chatwoot.local/signed-secret' }] },
          { messageId: 1002, conversationId: 501, content: 'reply agent', isPrivate: false, direction: 'outgoing', status: 'sent', createdAt: new Date().toISOString() },
        ],
      };
    },
    async updateSupportState() {},
    async assignConversation() {},
    async getAssignment() { return { agents: [{ id: 7, name: 'Inbox Agent' }], assignee: null }; },
    async listConversationSummaries(input) {
      return new Map(input.conversations.map((conversation) => [conversation.conversationLinkId, {
        assignee: { id: 7, name: 'Inbox Agent' }, contactName: 'Synthetic Customer',
      }]));
    },
    async downloadMessageAttachment() { throw new Error('unused'); },
    async reconcileConversation() { return { unprocessedOutgoingMessages: [] }; },
  };
}

test('InboxController: Complete Native UI APIs (health, connections, conversations, takeover, retry)', async () => {
  const db = getDatabase(':memory:');

  const connRepo = new ChannelConnectionRepository(db);
  const convRepo = new ConversationLinkRepository(db);
  const msgRepo = new MessageLinkRepository(db);
  const outboxRepo = new OutboxRepository(db);
  const aiStateRepo = new AIStateRepository(db);

  const mockProvider = createMockProvider();
  const handoffPolicy = new HandoffPolicy(aiStateRepo);
  const reconService = new ReconciliationService(mockProvider, convRepo, msgRepo, outboxRepo);
  const outboxService = new OutboxService(outboxRepo, msgRepo, connRepo);

  const syntheticAdapter = new SyntheticChannelAdapter();
  outboxService.registerAdapter('synthetic', syntheticAdapter);

  const controller = new InboxController(
    connRepo,
    convRepo,
    msgRepo,
    mockProvider,
    handoffPolicy,
    aiStateRepo,
    reconService,
    outboxRepo,
    outboxService,
    undefined,
    true
  );

  // 1. Health check
  const health = controller.getHealth();
  assert.strictEqual(health.status, 'ok');
  assert.strictEqual(health.service, 'tinix-inbox');
  assert.strictEqual(health.aiConfigured, true);

  // 2. Create and list connections
  const newConn = controller.createConnection({
    workspaceId: 'ws-test',
    provider: 'synthetic',
    displayName: 'Test Channel',
    externalAccountId: 'acc-synth-1',
    credentialsEncrypted: 'test-synth-token',
  });
  assert.ok(newConn.id);
  assert.strictEqual(newConn.displayName, 'Test Channel');
  assert.strictEqual(newConn.status, 'pending');
  assert.strictEqual('credentialsEncrypted' in newConn, false);
  assert.strictEqual('chatwootCallbackSecretRef' in newConn, false);

  const conns = controller.getConnections('ws-test');
  assert.strictEqual(conns.length, 1);
  assert.strictEqual(conns[0].id, newConn.id);
  assert.strictEqual('credentialsEncrypted' in conns[0], false);

  // 3. Create conversation link and check getConversations
  convRepo.create({
    id: 'conv-link-1',
    workspaceId: 'ws-test',
    channelConnectionId: newConn.id,
    tinixThreadKey: 'thread-customer-99',
    chatwootAccountId: 1,
    chatwootInboxId: 1,
    chatwootConversationRef: '100',
    chatwootConversationDisplayId: 501,
    state: 'open',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  const convs = await controller.getConversations('ws-test');
  assert.strictEqual(convs.length, 1);
  assert.strictEqual(convs[0].displayId, 501);
  assert.strictEqual(convs[0].aiMode, 'ai');
  assert.deepStrictEqual(convs[0].assignee, { id: 7, name: 'Inbox Agent' });
  assert.equal(convs[0].contactName, 'Synthetic Customer');

  assert.deepStrictEqual(await controller.assignConversation('conv-link-1', 7), {
    agents: [{ id: 7, name: 'Inbox Agent' }], assignee: null,
  });
  await assert.rejects(controller.assignConversation('conv-link-1', 99), /not a member of this conversation inbox/);

  connRepo.setEnabled('ws-test', newConn.id, false);
  assert.equal((await controller.getConversations('ws-test'))[0].connectionStatus, 'disabled');
  await assert.rejects(controller.sendMessage('conv-link-1', 'Should stay local', false), /Channel connection is disabled/);
  connRepo.setEnabled('ws-test', newConn.id, true);

  await controller.updateConversationStatus('conv-link-1', 'resolved');
  assert.strictEqual(convRepo.findById('conv-link-1')?.state, 'resolved');
  await controller.updateConversationStatus('conv-link-1', 'open');
  assert.strictEqual(convRepo.findById('conv-link-1')?.state, 'open');

  // 4. Takeover & Resume AI
  controller.takeoverConversation('conv-link-1', 'agent-dan');
  const convsAfterTakeover = await controller.getConversations('ws-test');
  assert.strictEqual(convsAfterTakeover[0].aiMode, 'human');

  controller.resumeAI('conv-link-1');
  const convsAfterResume = await controller.getConversations('ws-test');
  assert.strictEqual(convsAfterResume[0].aiMode, 'ai');

  const unconfiguredController = new InboxController(
    connRepo,
    convRepo,
    msgRepo,
    mockProvider,
    handoffPolicy,
    aiStateRepo,
    reconService,
    outboxRepo,
    outboxService
  );
  assert.throws(
    () => unconfiguredController.resumeAI('conv-link-1'),
    /Gemini runtime is not configured/
  );


  // 5. Send message and list messages
  connRepo.updateStatus(newConn.id, 'connected');
  const sentMsg = await controller.sendMessage('conv-link-1', 'Hello from operator', false);
  assert.strictEqual(sentMsg.messageId, 1002);
  assert.strictEqual(sentMsg.isPrivate, false);

  const sentPrivate = await controller.sendMessage('conv-link-1', 'Internal memo', true);
  assert.strictEqual(sentPrivate.messageId, 1003);
  assert.strictEqual(sentPrivate.isPrivate, true);

  const messages = await controller.getMessages('conv-link-1');
  assert.strictEqual(messages.length, 2);
  assert.strictEqual(messages[0].content, 'hello customer');
  assert.deepStrictEqual(messages[0].attachments, [{
    type: 'image', mimeType: 'image/png', fileName: 'photo.png', sizeBytes: undefined,
    url: '/api/conversations/conv-link-1/messages/1001/attachments/0',
  }]);
  assert.strictEqual(JSON.stringify(messages[0].attachments).includes('chatwoot.local'), false);

  // 6. Test Outbox Retry
  // Create an outbox message in dead_letter state
  outboxRepo.create({
    id: 'outbox-retry-1',
    workspaceId: 'ws-test',
    channelConnectionId: newConn.id,
    conversationLinkId: 'conv-link-1',
    chatwootAccountId: 1,
    chatwootMessageId: 777,
    idempotencyKey: 'idem-retry-777',
    payloadSnapshot: JSON.stringify({ content: 'Retryable message', recipientExternalId: 'rec-1' }),
    state: 'dead_letter',
    attemptCount: 5,
    correlationId: 'corr-retry-1',
    createdAt: new Date().toISOString(),
  });

  // Verify retryMessage
  const retryResult = await controller.retryMessage(777, 1);
  assert.strictEqual(retryResult.success, true);

  // Check outbox status is now provider_accepted
  const updatedOutbox = outboxRepo.findByIdempotencyKey('idem-retry-777');
  assert.strictEqual(updatedOutbox?.state, 'provider_accepted');

  // 7. Test inspectMetaToken with empty token
  const inspectEmpty = await controller.inspectMetaToken('');
  assert.strictEqual(inspectEmpty.valid, false);

  // 8. Test updateConnection on ChannelConnectionRepository
  connRepo.updateConnection(newConn.id, {
    displayName: 'Updated Display Name',
    externalAccountId: 'acc-updated',
  });
  const reloaded = connRepo.findById(newConn.id);
  assert.strictEqual(reloaded?.displayName, 'Updated Display Name');
  assert.strictEqual(reloaded?.externalAccountId, 'acc-updated');
});
