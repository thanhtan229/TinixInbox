import test from 'node:test';
import assert from 'node:assert';
import { createHmac } from 'node:crypto';
import { getDatabase } from '../../src/persistence/db.ts';
import {
  AIStateRepository,
  CallbackEventRepository,
  ChannelConnectionRepository,
  ContactLinkRepository,
  ConversationLinkRepository,
  MessageLinkRepository,
  OutboxRepository,
} from '../../src/persistence/repositories.ts';
import { SyntheticChannelAdapter } from '../../src/channels/synthetic/synthetic-adapter.ts';
import { InboundService } from '../../src/services/inbound-service.ts';
import { OutboundService } from '../../src/services/outbound-service.ts';
import { OutboxService } from '../../src/services/outbox-service.ts';
import { ReconciliationService } from '../../src/services/reconciliation-service.ts';
import { HandoffPolicy } from '../../src/agent/handoff-policy.ts';
import type { ConversationProvider, MessageRef } from '../../src/core/conversation-provider.ts';
import { CallbackController } from '../../src/api/callback-controller.ts';
import { createAppServer } from '../../src/api/server.ts';
import type { WebhookController } from '../../src/api/webhook-controller.ts';
import type { InboxController } from '../../src/api/inbox-controller.ts';

// In-memory mock conversation provider for standalone testing
class MockConversationProvider implements ConversationProvider {
  readonly providerName = 'mock';
  public contactIdCounter = 1;
  public conversationIdCounter = 1;
  public messageIdCounter = 1;
  public messages: MessageRef[] = [];

  public async ensureIdentity(input: any) {
    return { contactId: this.contactIdCounter++, sourceId: input.externalUserId };
  }

  public async ensureConversation(input: any) {
    const id = this.conversationIdCounter++;
    return { conversationId: id, displayId: id };
  }

  public async createIncomingMessage(input: any) {
    const msg: MessageRef = {
      messageId: this.messageIdCounter++,
      conversationId: input.conversationId,
      content: input.text || '',
      direction: 'incoming',
      isPrivate: false,
      status: 'sent',
      createdAt: new Date().toISOString(),
    };
    this.messages.push(msg);
    return msg;
  }

  public async createOutgoingMessage(input: any) {
    const msg: MessageRef = {
      messageId: this.messageIdCounter++,
      conversationId: input.conversationId,
      content: input.text,
      direction: 'outgoing',
      isPrivate: input.isPrivate || false,
      status: 'sent',
      createdAt: new Date().toISOString(),
    };
    this.messages.push(msg);
    return msg;
  }

  public async listMessages(input: any) {
    return { messages: [...this.messages] };
  }

  public async updateSupportState() {}
  public async assignConversation() {}
  public async getAssignment() { return { agents: [], assignee: null }; }
  public async downloadMessageAttachment(): Promise<import('../../src/core/conversation-provider.ts').DownloadedMessageAttachment> { throw new Error('unused'); }

  public async addPrivateNote(input: any) {
    const msg: MessageRef = {
      messageId: this.messageIdCounter++,
      conversationId: input.conversationDisplayId,
      content: input.content,
      direction: 'outgoing',
      isPrivate: true,
      status: 'sent',
      createdAt: new Date().toISOString(),
    };
    this.messages.push(msg);
    return msg;
  }

  public async reconcileConversation(input: any) {
    return {
      unprocessedOutgoingMessages: this.messages.filter((m) => m.direction === 'outgoing' && !m.isPrivate),
    };
  }
}

test('Phase 1 Critical Path E2E: Inbound -> Outbound -> Dedupe -> Predicate -> Handoff -> Reconcile', async () => {
  const db = getDatabase(':memory:');

  const connectionRepo = new ChannelConnectionRepository(db);
  const contactRepo = new ContactLinkRepository(db);
  const conversationRepo = new ConversationLinkRepository(db);
  const messageRepo = new MessageLinkRepository(db);
  const outboxRepo = new OutboxRepository(db);
  const callbackEventRepo = new CallbackEventRepository(db);
  const aiStateRepo = new AIStateRepository(db);

  const mockProvider = new MockConversationProvider();
  const syntheticAdapter = new SyntheticChannelAdapter();

  const inboundService = new InboundService(mockProvider, contactRepo, conversationRepo, messageRepo);
  const outboundService = new OutboundService(connectionRepo, conversationRepo, messageRepo, outboxRepo, callbackEventRepo);
  const outboxService = new OutboxService(outboxRepo, messageRepo, connectionRepo);
  outboxService.registerAdapter('synthetic', syntheticAdapter);
  const handoffPolicy = new HandoffPolicy(aiStateRepo);
  const reconciliationService = new ReconciliationService(mockProvider, conversationRepo, messageRepo, outboxRepo);

  // Set up Channel Connection
  const secret = 'chatwoot-callback-secret-42';
  connectionRepo.create({
    id: 'conn-test-1',
    workspaceId: 'ws-main',
    provider: 'synthetic',
    displayName: 'Test Channel',
    externalAccountId: 'acc-1',
    status: 'connected',
    credentialsEncrypted: 'enc-creds',
    credentialVersion: 1,
    scopes: ['messages'],
    metadata: {},
    chatwootAccountId: 1,
    chatwootInboxId: 10,
    chatwootCallbackSecretRef: secret,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  const connection = connectionRepo.findById('conn-test-1')!;

  // 1. E2E Inbound Message
  const webhookBody = JSON.stringify({
    message_id: 'provider-msg-001',
    sender_id: 'customer-123',
    sender_name: 'Nguyen Van A',
    text: 'Hello from customer',
    timestamp: Date.now(),
  });

  const headers = { 'x-synthetic-signature': 'secret-enc-creds' };
  const inboundRes = await inboundService.processInboundWebhook(syntheticAdapter, connection, webhookBody, headers, 'enc-creds');
  assert.strictEqual(inboundRes.processed, 1);
  assert.strictEqual(inboundRes.duplicate, 0);

  // Check stored contact link & conversation link
  const contact = contactRepo.findByExternalUser('ws-main', 'conn-test-1', 'customer-123');
  assert.ok(contact);
  const conv = conversationRepo.findByThreadKey('ws-main', 'conn-test-1', 'customer-123');
  assert.ok(conv);

  // Test duplicate inbound webhook suppression
  const duplicateInboundRes = await inboundService.processInboundWebhook(syntheticAdapter, connection, webhookBody, headers, 'enc-creds');
  assert.strictEqual(duplicateInboundRes.processed, 0);
  assert.strictEqual(duplicateInboundRes.duplicate, 1);

  // 2. E2E Outgoing Chatwoot Callback -> Strict Predicate -> Outbox -> Dispatch
  const outgoingChatwootPayload = {
    event: 'message_created',
    id: 501,
    content: 'Hello customer from agent',
    message_type: 'outgoing',
    private: false,
    account: { id: 1 },
    inbox: { id: 10 },
    conversation: {
      id: conv!.chatwootConversationDisplayId,
      contact_inbox: { source_id: 'customer-123' },
    },
  };

  const rawOutgoingBody = JSON.stringify(outgoingChatwootPayload);
  const nowSec = Math.floor(Date.now() / 1000);
  const validSignature = `sha256=${createHmac('sha256', secret).update(`${nowSec}.${rawOutgoingBody}`).digest('hex')}`;

  const callbackRes = await outboundService.handleChatwootCallback(rawOutgoingBody, validSignature, String(nowSec));
  assert.strictEqual(callbackRes.status, 'accepted');
  assert.ok(callbackRes.outboxId);

  // Process outbox dispatch
  const outboxDispatch = await outboxService.processPendingOutbox();
  assert.strictEqual(outboxDispatch.sent, 1);
  assert.strictEqual(syntheticAdapter.sendCount, 1);
  assert.strictEqual(syntheticAdapter.lastPayload?.text, 'Hello customer from agent');

  // Verify message delivery state updated to provider_accepted
  const msgLink = messageRepo.findByChatwootMessageId(1, 501);
  assert.strictEqual(msgLink?.deliveryState, 'provider_accepted');

  // 3. E2E Duplicate Chatwoot Callback Suppression
  const dupCallbackRes = await outboundService.handleChatwootCallback(rawOutgoingBody, validSignature, String(nowSec));
  assert.strictEqual(dupCallbackRes.status, 'duplicate');
  await outboxService.processPendingOutbox();
  assert.strictEqual(syntheticAdapter.sendCount, 1); // Still 1! Exactly once!

  // 4. E2E Private Note Protection
  const privateNotePayload = {
    event: 'message_created',
    id: 502,
    content: 'Internal agent note: customer is VIP',
    message_type: 'outgoing',
    private: true,
    account: { id: 1 },
    inbox: { id: 10 },
    conversation: { id: conv!.chatwootConversationDisplayId },
  };
  const rawPrivateNoteBody = JSON.stringify(privateNotePayload);
  const privateSig = `sha256=${createHmac('sha256', secret).update(`${nowSec}.${rawPrivateNoteBody}`).digest('hex')}`;
  const privateRes = await outboundService.handleChatwootCallback(rawPrivateNoteBody, privateSig, String(nowSec));
  assert.strictEqual(privateRes.status, 'ignored');
  assert.match(privateRes.reason!, /Private note/);
  await outboxService.processPendingOutbox();
  assert.strictEqual(syntheticAdapter.sendCount, 1); // Private note never sent to provider!

  // 5. E2E Incoming Callback Echo Protection
  const incomingEchoPayload = {
    event: 'message_created',
    id: 503,
    content: 'Incoming message callback echo',
    message_type: 'incoming',
    private: false,
    account: { id: 1 },
    inbox: { id: 10 },
  };
  const rawEchoBody = JSON.stringify(incomingEchoPayload);
  const echoSig = `sha256=${createHmac('sha256', secret).update(`${nowSec}.${rawEchoBody}`).digest('hex')}`;
  const echoRes = await outboundService.handleChatwootCallback(rawEchoBody, echoSig, String(nowSec));
  assert.strictEqual(echoRes.status, 'ignored');
  assert.match(echoRes.reason!, /Not outgoing/);
  await outboxService.processPendingOutbox();
  assert.strictEqual(syntheticAdapter.sendCount, 1); // Incoming echo never sent to provider!

  // 6. E2E AI / Human Handoff Race Condition Protection
  const convKey = String(conv!.chatwootConversationDisplayId);
  handoffPolicy.resumeAI('ws-main', 'mock', convKey);
  const initialCheck = handoffPolicy.checkCanAIReply('ws-main', convKey);
  assert.strictEqual(initialCheck.canReply, true);
  assert.strictEqual(initialCheck.version, 1);

  // Human takes over while AI is thinking
  handoffPolicy.takeOverByHuman('ws-main', 'mock', convKey, 'agent-007');

  // AI attempts to commit reply with version 1
  const committed = handoffPolicy.commitAIReply('ws-main', 'mock', convKey, 1);
  assert.strictEqual(committed, false); // Aborted! Human takeover protected.

  const afterTakeoverCheck = handoffPolicy.checkCanAIReply('ws-main', convKey);
  assert.strictEqual(afterTakeoverCheck.canReply, false);
  assert.match(afterTakeoverCheck.reason!, /Human agent has taken over/);

  // 7. E2E REST Reconciliation (Missing Callback Recovery)
  // Simulate an outgoing message in provider that missed its callback
  mockProvider.messages.push({
    messageId: 999,
    conversationId: conv!.chatwootConversationDisplayId,
    content: 'Reconciled message that lost its callback',
    direction: 'outgoing',
    isPrivate: false,
    status: 'sent',
    createdAt: new Date().toISOString(),
  });

  const reconcileRes = await reconciliationService.reconcileWorkspace('ws-main');
  assert.strictEqual(reconcileRes.missingDetected, 1);
  assert.strictEqual(reconcileRes.outboxQueued, 1);

  // Dispatch reconciled message from outbox
  await outboxService.processPendingOutbox();
  assert.strictEqual(syntheticAdapter.sendCount, 2);
  assert.strictEqual(syntheticAdapter.lastPayload?.text, 'Reconciled message that lost its callback');
});

test('Phase 1 HTTP callback E2E: signature -> durable event -> outbox -> synthetic send exactly once', async () => {
  const db = getDatabase(':memory:');
  const connectionRepo = new ChannelConnectionRepository(db);
  const conversationRepo = new ConversationLinkRepository(db);
  const messageRepo = new MessageLinkRepository(db);
  const outboxRepo = new OutboxRepository(db);
  const callbackEventRepo = new CallbackEventRepository(db);
  const adapter = new SyntheticChannelAdapter();
  const secret = 'http-callback-test-secret';

  connectionRepo.create({
    id: 'conn-http-callback',
    workspaceId: 'ws-http-callback',
    provider: 'synthetic',
    displayName: 'Synthetic callback test',
    externalAccountId: 'synthetic-http',
    status: 'connected',
    credentialsEncrypted: 'http-callback-credentials',
    credentialVersion: 1,
    scopes: ['messages'],
    metadata: {},
    chatwootAccountId: 1,
    chatwootInboxId: 10,
    chatwootCallbackSecretRef: secret,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  conversationRepo.create({
    id: 'conv-http-callback',
    workspaceId: 'ws-http-callback',
    channelConnectionId: 'conn-http-callback',
    externalConversationId: 'external-conv-10',
    tinixThreadKey: 'thread-http-callback',
    chatwootAccountId: 1,
    chatwootInboxId: 10,
    chatwootContactInboxId: 20,
    chatwootConversationRef: 'conversation-ref-101',
    chatwootConversationDisplayId: 101,
    state: 'open',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  messageRepo.create({
    id: 'msg-ai-callback-link',
    workspaceId: 'ws-http-callback',
    channelConnectionId: 'conn-http-callback',
    conversationLinkId: 'conv-http-callback',
    direction: 'outgoing',
    origin: 'ai',
    chatwootAccountId: 1,
    chatwootMessageId: 1501,
    deliveryState: 'queued',
    correlationId: 'ai-correlation-1501',
    metadata: { aiVersion: 1, aiProvenance: { model: 'synthetic-test-model' } },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  const outboxService = new OutboxService(outboxRepo, messageRepo, connectionRepo, undefined, new HandoffPolicy(new AIStateRepository(db)));
  outboxService.registerAdapter('synthetic', adapter);
  const callbackController = new CallbackController(
    new OutboundService(connectionRepo, conversationRepo, messageRepo, outboxRepo, callbackEventRepo),
    outboxService
  );
  const app = createAppServer({
    port: 0,
    host: '127.0.0.1',
    callbackController,
    webhookController: {} as WebhookController,
    inboxController: {} as InboxController,
  });

  await app.start();
  try {
    const address = app.server.address();
    assert.ok(address && typeof address === 'object');
    const payload = {
      event: 'message_created',
      id: 1501,
      content: 'HTTP callback sends once',
      message_type: 'outgoing',
      private: false,
      account: { id: 1 },
      inbox: { id: 10 },
      conversation: {
        id: 101,
        contact_inbox: { source_id: 'synthetic-customer-101' },
      },
    };
    const rawBody = JSON.stringify(payload);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = `sha256=${createHmac('sha256', secret)
      .update(`${timestamp}.${rawBody}`)
      .digest('hex')}`;
    const postCallback = () => fetch(`http://127.0.0.1:${address.port}/webhooks/chatwoot`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-chatwoot-timestamp': timestamp,
        'x-chatwoot-signature': signature,
      },
      body: rawBody,
    });

    const firstResponse = await postCallback();
    assert.strictEqual(firstResponse.status, 200);
    const firstBody = await firstResponse.json() as { status: string; outboxId: string };
    assert.strictEqual(firstBody.status, 'accepted');
    assert.ok(firstBody.outboxId);

    for (let attempt = 0; attempt < 20 && adapter.sendCount < 1; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.strictEqual(adapter.sendCount, 1);
    const outbox = outboxRepo.findByIdempotencyKey('1:10:message_created:1501');
    assert.strictEqual(outbox?.state, 'provider_accepted');
    const linkedMessage = messageRepo.findByChatwootMessageId(1, 1501);
    assert.strictEqual(linkedMessage?.outboxId, outbox?.id);
    assert.strictEqual(linkedMessage?.origin, 'ai');
    assert.deepStrictEqual(linkedMessage?.metadata?.aiProvenance, { model: 'synthetic-test-model' });

    const duplicateResponse = await postCallback();
    assert.strictEqual(duplicateResponse.status, 200);
    const duplicateBody = await duplicateResponse.json() as { status: string };
    assert.strictEqual(duplicateBody.status, 'duplicate');
    assert.strictEqual(adapter.sendCount, 1);

    const callbackBeforeAiProjection = {
      ...payload,
      id: 1502,
      content: 'Callback arrives before AI projection',
    };
    const secondRawBody = JSON.stringify(callbackBeforeAiProjection);
    const secondTimestamp = String(Math.floor(Date.now() / 1000));
    const secondSignature = `sha256=${createHmac('sha256', secret)
      .update(`${secondTimestamp}.${secondRawBody}`)
      .digest('hex')}`;
    const secondResponse = await fetch(`http://127.0.0.1:${address.port}/webhooks/chatwoot`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-chatwoot-timestamp': secondTimestamp,
        'x-chatwoot-signature': secondSignature,
      },
      body: secondRawBody,
    });
    assert.strictEqual(secondResponse.status, 200);
    assert.strictEqual((await secondResponse.json() as { status: string }).status, 'accepted');
    for (let attempt = 0; attempt < 20 && adapter.sendCount < 2; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.strictEqual(adapter.sendCount, 2);
    const callbackOutbox = outboxRepo.findByIdempotencyKey('1:10:message_created:1502');
    messageRepo.recordAiOutgoing({
      id: 'msg-ai-projection-late',
      workspaceId: 'ws-http-callback',
      channelConnectionId: 'conn-http-callback',
      conversationLinkId: 'conv-http-callback',
      direction: 'outgoing',
      origin: 'ai',
      chatwootAccountId: 1,
      chatwootMessageId: 1502,
      deliveryState: 'queued',
      correlationId: 'ai-correlation-1502',
      metadata: { aiProvenance: { model: 'synthetic-test-model' } },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const lateAiMessage = messageRepo.findByChatwootMessageId(1, 1502);
    assert.strictEqual(lateAiMessage?.origin, 'ai');
    assert.strictEqual(lateAiMessage?.outboxId, callbackOutbox?.id);
    assert.strictEqual(lateAiMessage?.deliveryState, 'provider_accepted');
    assert.deepStrictEqual(lateAiMessage?.metadata?.aiProvenance, { model: 'synthetic-test-model' });
    assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM chatwoot_callback_events').get()?.count, 3);
  } finally {
    await app.stop();
    db.close();
  }
});
