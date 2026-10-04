import test from 'node:test';
import assert from 'node:assert/strict';
import { getDatabase } from '../../src/persistence/db.ts';
import {
  ChannelConnectionRepository,
  ContactLinkRepository,
  ConversationLinkRepository,
  MessageLinkRepository,
  ProviderWebhookEventRepository,
} from '../../src/persistence/repositories.ts';
import { InboundService } from '../../src/services/inbound-service.ts';
import { WebhookController } from '../../src/api/webhook-controller.ts';
import { SyntheticChannelAdapter } from '../../src/channels/synthetic/synthetic-adapter.ts';
import type { ConversationProvider } from '../../src/core/conversation-provider.ts';

test('provider webhook is verified and persisted before ACK, then processed asynchronously', async () => {
  const db = getDatabase(':memory:');
  const connectionRepo = new ChannelConnectionRepository(db);
  const eventRepo = new ProviderWebhookEventRepository(db);
  const contactRepo = new ContactLinkRepository(db);
  const conversationRepo = new ConversationLinkRepository(db);
  const messageRepo = new MessageLinkRepository(db);

  let processingStarted!: () => void;
  let releaseProcessing!: () => void;
  const started = new Promise<void>((resolve) => { processingStarted = resolve; });
  const gate = new Promise<void>((resolve) => { releaseProcessing = resolve; });
  const conversationProvider: ConversationProvider = {
    providerName: 'test',
    async ensureIdentity(input) {
      processingStarted();
      await gate;
      return { contactId: 1, sourceId: input.externalUserId };
    },
    async ensureConversation() { return { conversationId: 1, displayId: 1 }; },
    async createIncomingMessage(input) {
      return { messageId: 1, conversationId: input.conversationId, content: input.text || '', direction: 'incoming', isPrivate: false, status: 'sent', createdAt: new Date().toISOString() };
    },
    async createOutgoingMessage() { throw new Error('unused'); },
    async listMessages() { return { messages: [], hasMore: false }; },
    async updateSupportState() {},
    async assignConversation() {},
    async getAssignment() { return { agents: [], assignee: null }; },
    async downloadMessageAttachment() { throw new Error('unused'); },
    async addPrivateNote() { throw new Error('unused'); },
    async reconcileConversation() { return { unprocessedOutgoingMessages: [] }; },
  };
  connectionRepo.create({
    id: 'conn-webhook', workspaceId: 'ws-webhook', provider: 'synthetic', displayName: 'Test',
    externalAccountId: 'account-1', status: 'connected', credentialsEncrypted: 'test-only',
    credentialVersion: 1, scopes: [], metadata: { webhookSecret: 'secret-1', webhookVerifyToken: 'verify-1' },
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  });

  const adapter = new SyntheticChannelAdapter();
  const controller = new WebhookController(
    new InboundService(conversationProvider, contactRepo, conversationRepo, messageRepo),
    connectionRepo,
    eventRepo
  );
  controller.registerAdapter('synthetic', adapter);

  const rawBody = JSON.stringify({ message_id: 'msg-1', sender_id: 'customer-1', text: 'Hello' });
  const result = await controller.handleWebhook('synthetic', 'conn-webhook', rawBody, {
    'x-synthetic-signature': 'secret-secret-1',
  });
  assert.strictEqual(result.status, 200);
  assert.strictEqual((result.body as { accepted?: boolean }).accepted, true);

  const persisted = db.prepare('SELECT status, raw_payload FROM provider_webhook_events').get() as { status: string; raw_payload: string };
  assert.ok(['received', 'processing'].includes(persisted.status));
  assert.strictEqual(persisted.raw_payload, rawBody);
  await started;

  const duplicate = await controller.handleWebhook('synthetic', 'conn-webhook', rawBody, {
    'x-synthetic-signature': 'secret-secret-1',
  });
  assert.strictEqual((duplicate.body as { duplicate?: boolean }).duplicate, true);

  releaseProcessing();
  await new Promise((resolve) => setTimeout(resolve, 10));
  const processed = db.prepare('SELECT status FROM provider_webhook_events').get() as { status: string };
  assert.strictEqual(processed.status, 'processed');
});

test('Meta webhook challenge requires the configured verify token', async () => {
  const db = getDatabase(':memory:');
  const connections = new ChannelConnectionRepository(db);
  connections.create({
    id: 'conn-meta-challenge', workspaceId: 'ws-meta', provider: 'meta', displayName: 'Meta',
    externalAccountId: 'page-1', status: 'connected', credentialsEncrypted: 'test-only', credentialVersion: 1,
    scopes: [], metadata: { webhookVerifyToken: 'verify-secret' }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  });
  const controller = new WebhookController(
    new InboundService({} as ConversationProvider, new ContactLinkRepository(db), new ConversationLinkRepository(db), new MessageLinkRepository(db)),
    connections,
    new ProviderWebhookEventRepository(db)
  );

  const valid = await controller.verifyChallenge('meta', 'conn-meta-challenge', new URLSearchParams({
    'hub.mode': 'subscribe', 'hub.verify_token': 'verify-secret', 'hub.challenge': 'proof',
  }));
  assert.deepStrictEqual(valid, { status: 200, body: 'proof' });

  const invalid = await controller.verifyChallenge('meta', 'conn-meta-challenge', new URLSearchParams({
    'hub.mode': 'subscribe', 'hub.verify_token': 'wrong', 'hub.challenge': 'proof',
  }));
  assert.strictEqual(invalid.status, 403);
});

test('Meta webhook challenge resolves verify token from credentialsEncrypted JSON when metadata is empty', async () => {
  const db = getDatabase(':memory:');
  const connections = new ChannelConnectionRepository(db);
  connections.create({
    id: 'conn-meta-json',
    workspaceId: 'ws-meta',
    provider: 'meta',
    displayName: 'Meta JSON',
    externalAccountId: 'page-2',
    status: 'connected',
    credentialsEncrypted: JSON.stringify({ pageAccessToken: 'tok-123', webhookVerifyToken: 'json-verify-token' }),
    credentialVersion: 1,
    scopes: [],
    metadata: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  const controller = new WebhookController(
    new InboundService({} as ConversationProvider, new ContactLinkRepository(db), new ConversationLinkRepository(db), new MessageLinkRepository(db)),
    connections,
    new ProviderWebhookEventRepository(db)
  );

  const valid = await controller.verifyChallenge('meta', 'conn-meta-json', new URLSearchParams({
    'hub.mode': 'subscribe',
    'hub.verify_token': 'json-verify-token',
    'hub.challenge': 'challenge-token-abc',
  }));
  assert.deepStrictEqual(valid, { status: 200, body: 'challenge-token-abc' });
});

