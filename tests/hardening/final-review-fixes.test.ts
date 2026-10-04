import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { getDatabase } from '../../src/persistence/db.ts';
import { AIStateRepository, CallbackEventRepository, ChannelConnectionRepository, ContactLinkRepository,
  ConversationLinkRepository, MessageLinkRepository, OutboxRepository } from '../../src/persistence/repositories.ts';
import { HandoffPolicy } from '../../src/agent/handoff-policy.ts';
import { InboxAgentRouter } from '../../src/agent/inbox-agent-router.ts';
import { InboxController } from '../../src/api/inbox-controller.ts';
import { InboundService } from '../../src/services/inbound-service.ts';
import { OutboundService } from '../../src/services/outbound-service.ts';
import { OutboxService } from '../../src/services/outbox-service.ts';
import { ReconciliationService } from '../../src/services/reconciliation-service.ts';
import { SyntheticChannelAdapter } from '../../src/channels/synthetic/synthetic-adapter.ts';
import { FeatureFlagManager } from '../../src/config/feature-flags.ts';
import { AttachmentPreparationError, ConversationProviderError } from '../../src/core/errors.ts';
import type { ConversationProvider, MessageRef } from '../../src/core/conversation-provider.ts';
import type { UnifiedMessage } from '../../src/core/unified-message.ts';
import { ChatwootClient } from '../../src/providers/chatwoot/chatwoot-client.ts';
import { ChatwootConversationProvider } from '../../src/providers/chatwoot/chatwoot-provider.ts';
import { ENV } from '../../src/config/env.ts';
import { MetaConnectionClient } from '../../src/channels/meta/meta-connection.ts';

test('Meta setup fails closed on missing rotation, wrong token type, failed subscription and missing callback secret', async () => {
  const saved = { ...ENV }, original = globalThis.fetch;
  const f = fixture();
  try {
    ENV.META_SECRET_ROTATED = false;
    assert.equal((await new MetaConnectionClient().inspect('test-token')).valid, false);
    Object.assign(ENV, { META_SECRET_ROTATED: true, META_APP_ID: 'test-app', META_APP_SECRET: 'test-only-secret',
      META_WEBHOOK_VERIFY_TOKEN: 'test-verify', CHATWOOT_CALLBACK_URL: 'http://callback.test/webhooks/chatwoot' });
    let tokenType = 'USER', subscribed = false, provisionCalls = 0;
    globalThis.fetch = (async url => new Response(JSON.stringify(String(url).includes('debug_token')
      ? { data: { is_valid: true, type: tokenType, app_id: 'test-app', profile_id: 'page', scopes: ['pages_messaging', 'pages_manage_metadata'] } }
      : String(url).includes('subscribed_apps') ? { success: subscribed } : { id: 'page', name: 'Test' }), { status: 200 })) as typeof fetch;
    assert.equal((await new MetaConnectionClient().inspect('test-token')).valid, false);
    tokenType = 'PAGE';
    f.provider.provisionChannel = async () => { provisionCalls++; throw new Error('missing secret'); };
    assert.equal((await f.controller.connectMetaPage({ token: 'test-token' })).success, false);
    assert.equal(provisionCalls, 0);
    subscribed = true;
    assert.equal((await f.controller.connectMetaPage({ token: 'test-token' })).success, false);
    assert.equal(provisionCalls, 1);
    assert.equal(f.connections.listByProvider('workspace', 'meta').length, 0);
  } finally { Object.assign(ENV, saved); globalThis.fetch = original; f.db.close(); }
});

function fixture() {
  const db = getDatabase(':memory:');
  const connections = new ChannelConnectionRepository(db), conversations = new ConversationLinkRepository(db);
  const messages = new MessageLinkRepository(db), outbox = new OutboxRepository(db), states = new AIStateRepository(db);
  const policy = new HandoffPolicy(states), now = new Date().toISOString();
  const connection = { id: 'connection', workspaceId: 'workspace', provider: 'synthetic', displayName: 'Test',
    externalAccountId: 'page', status: 'connected' as const, credentialsEncrypted: 'test-secret', credentialVersion: 1,
    scopes: [], metadata: {}, chatwootAccountId: 1, chatwootInboxId: 1, chatwootCallbackSecretRef: 'test-secret', createdAt: now, updatedAt: now };
  connections.create(connection);
  conversations.create({ id: 'conversation', workspaceId: 'workspace', channelConnectionId: 'connection', tinixThreadKey: 'customer',
    chatwootAccountId: 1, chatwootInboxId: 1, chatwootConversationRef: '1', chatwootConversationDisplayId: 1,
    state: 'open', createdAt: now, updatedAt: now });
  const ref = (id: number, direction: 'incoming' | 'outgoing' = 'outgoing'): MessageRef => ({ messageId: id, conversationId: 1,
    content: 'hello', direction, isPrivate: false, status: 'sent', createdAt: now });
  let outgoingCalls = 0;
  const provider: ConversationProvider = { providerName: 'chatwoot',
    async ensureIdentity() { return { contactId: 1, sourceId: 'customer' }; }, async ensureConversation() { return { conversationId: 1, displayId: 1 }; },
    async createIncomingMessage() { return ref(10, 'incoming'); }, async createOutgoingMessage() { outgoingCalls++; return ref(20); },
    async listMessages() { return { messages: [] }; }, async updateSupportState() {}, async assignConversation() {},
    async getAssignment() { return { agents: [], assignee: null }; }, async downloadMessageAttachment() { throw new Error('unused'); },
    async addPrivateNote() { return { ...ref(30), isPrivate: true }; }, async reconcileConversation() { return { unprocessedOutgoingMessages: [] }; } };
  const reconcile = new ReconciliationService(provider, conversations, messages, outbox);
  const controller = new InboxController(connections, conversations, messages, provider, policy, states, reconcile);
  const incoming: UnifiedMessage = { id: 'incoming', workspaceId: 'workspace', provider: 'synthetic', channelConnectionId: 'connection',
    externalMessageId: 'external', externalConversationId: 'customer', direction: 'incoming', messageType: 'text', sender: { externalId: 'customer' },
    attachments: [], text: 'hello', sentAt: now, receivedAt: now };
  return { db, connections, conversations, messages, outbox, states, policy, provider, controller, reconcile, incoming, connection, ref,
    calls: () => outgoingCalls };
}

test('a definitive failure before incoming message creation remains retryable', async () => {
  const f = fixture(); let attempts = 0;
  f.provider.ensureIdentity = async () => { if (++attempts === 1) throw new ConversationProviderError('temporary 503'); return { contactId: 1, sourceId: 'customer' }; };
  const service = new InboundService(f.provider, new ContactLinkRepository(f.db), f.conversations, f.messages);
  await assert.rejects(service.handleUnifiedMessage(f.incoming, f.connection), /503/);
  assert.equal(await service.handleUnifiedMessage(f.incoming, f.connection), true);
  assert.equal(await service.handleUnifiedMessage(f.incoming, f.connection), false);
  f.db.close();
});

test('a media preparation failure releases the claim and the retry writes exactly once', async () => {
  const f = fixture(); let attempts = 0;
  f.provider.createIncomingMessage = async () => {
    if (++attempts === 1) throw new AttachmentPreparationError('provider media 503 before POST');
    return f.ref(10, 'incoming');
  };
  const service = new InboundService(f.provider, new ContactLinkRepository(f.db), f.conversations, f.messages);
  await assert.rejects(service.handleUnifiedMessage(f.incoming, f.connection), AttachmentPreparationError);
  assert.equal(await service.handleUnifiedMessage(f.incoming, f.connection), true);
  assert.equal(await service.handleUnifiedMessage(f.incoming, f.connection), false);
  assert.equal(attempts, 2); assert.equal(f.messages.listByConversation('conversation').length, 1); f.db.close();
});

test('human sends take over and durable operation IDs prevent duplicate remote writes and cross-conversation reuse', async () => {
  const f = fixture();
  const first = await f.controller.sendMessage('conversation', 'hello', false, 'operation-123');
  assert.deepEqual(await f.controller.sendMessage('conversation', 'hello', false, 'operation-123'), first);
  assert.equal(f.calls(), 1);
  assert.equal(f.policy.checkCanAIReply('workspace', '1').canReply, false);
  await assert.rejects(f.controller.sendMessage('conversation', 'different', false, 'operation-123'), /different request/);
  f.provider.createOutgoingMessage = async () => { throw new Error('uncertain timeout'); };
  await assert.rejects(f.controller.sendMessage('conversation', 'uncertain', false, 'operation-456'), /timeout/);
  await assert.rejects(f.controller.sendMessage('conversation', 'uncertain', false, 'operation-456'), /unresolved/);
  f.db.close();
});

test('disconnect retains history binding, blocks sends and requires reconnect rather than enable', async () => {
  const f = fixture();
  assert.equal(f.connections.deleteConnection('workspace', 'connection'), true);
  assert.equal(f.connections.findForConversation('workspace', 1)?.status, 'disconnected');
  f.connections.setEnabled('workspace', 'connection', false); f.connections.setEnabled('workspace', 'connection', true);
  assert.equal(f.connections.findById('connection')?.status, 'disconnected');
  await assert.rejects(f.controller.sendMessage('conversation', 'hello'), /disabled/);
  assert.equal((await f.controller.sendMessage('conversation', 'note', true)).isPrivate, true);
  f.db.close();
});

test('AI callback during pending Chatwoot POST is cancelled at provider dispatch after human takeover', async () => {
  const f = fixture(); const adapter = new SyntheticChannelAdapter();
  const outbound = new OutboundService(f.connections, f.conversations, f.messages, f.outbox, new CallbackEventRepository(f.db), f.policy);
  const service = new OutboxService(f.outbox, f.messages, f.connections, undefined, f.policy); service.registerAdapter('synthetic', adapter);
  f.provider.createOutgoingMessage = async input => {
    f.policy.takeOverByHuman('workspace', 'chatwoot', '1', 'human');
    const payload = JSON.stringify({ event: 'message_created', id: 20, content: input.text, message_type: 'outgoing', private: false,
      account: { id: 1 }, inbox: { id: 1 }, conversation: { id: 1, contact_inbox: { source_id: 'customer' } },
      content_attributes: { tinix_operation_id: input.operationId } });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = `sha256=${createHmac('sha256', 'test-secret').update(`${timestamp}.${payload}`).digest('hex')}`;
    const result = await outbound.handleChatwootCallback(payload, signature, timestamp);
    assert.ok(result.outboxId); assert.equal(await service.dispatchItem(result.outboxId), false);
    return f.ref(20);
  };
  await new InboxAgentRouter(f.policy, f.provider, f.conversations, f.messages, undefined, undefined, f.connections)
    .handleIncomingMessage(f.incoming, { generateReplyFn: async () => 'AI text' });
  assert.equal(adapter.sendCount, 0);
  assert.equal(f.outbox.findByChatwootMessageId(1, 20)?.state, 'failed');
  f.db.close();
});

test('AI flag and hybrid mode inhibit generation and final commit', async () => {
  const f = fixture(), flags = FeatureFlagManager.getInstance();
  flags.setFlag('tinix_inbox_ai_enabled', false);
  try { assert.equal(f.policy.checkCanAIReply('workspace', '1').canReply, false); assert.equal(f.policy.commitAIReply('workspace', 'chatwoot', '1', 1), false); }
  finally { flags.setFlag('tinix_inbox_ai_enabled', true); }
  f.states.setMode('workspace', 'chatwoot', '1', 'hybrid');
  assert.equal(f.policy.checkCanAIReply('workspace', '1').canReply, false);
  f.db.close();
});

test('paused oldest outbox rows do not starve an active connection in a limited batch', async () => {
  const f = fixture();
  f.connections.create({ ...f.connection, id: 'paused', externalAccountId: 'paused', status: 'disabled' });
  for (let i = 0; i < 12; i++) f.outbox.create({ id: `outbox-${i}`, workspaceId: 'workspace', channelConnectionId: i < 11 ? 'paused' : 'connection',
    conversationLinkId: 'conversation', chatwootAccountId: 1, chatwootMessageId: 100 + i, idempotencyKey: `key-${i}`,
    payloadSnapshot: JSON.stringify({ content: 'hello', recipientExternalId: 'customer' }), state: 'pending', attemptCount: 0,
    correlationId: 'correlation', createdAt: new Date(1000 + i).toISOString() });
  const service = new OutboxService(f.outbox, f.messages, f.connections), adapter = new SyntheticChannelAdapter();
  service.registerAdapter('synthetic', adapter);
  assert.equal((await service.processPendingOutbox(10)).sent, 1); assert.equal(adapter.sendCount, 1);
  assert.equal(f.outbox.findById('outbox-0')?.state, 'pending'); f.db.close();
});

test('reconciliation retains its baseline across restart and deduplicates callback recovery', async () => {
  const f = fixture();
  f.provider.reconcileConversation = async () => ({ unprocessedOutgoingMessages: [{ ...f.ref(40), createdAt: new Date().toISOString() },
    { ...f.ref(41), createdAt: '2020-01-01T00:00:00Z' }] });
  assert.equal((await f.reconcile.reconcileWorkspace('workspace', true)).outboxQueued, 1);
  const first = f.messages.reconciliationWindow('workspace', 'conversation');
  assert.deepEqual(f.messages.reconciliationWindow('workspace', 'conversation', '2030-01-01T00:00:00Z'), first);
  assert.equal((await new ReconciliationService(f.provider, f.conversations, f.messages, f.outbox).reconcileWorkspace('workspace', true)).outboxQueued, 0);
  assert.equal(f.outbox.findByChatwootMessageId(1, 41), null); f.db.close();
});

test('unknown incoming outcome is resolved by a matching remote source ID without creating a second message', async () => {
  const f = fixture();
  f.messages.claimInboundMessage('workspace', 'connection', 'external');
  f.messages.markInboundOutcomeUnknown('workspace', 'connection', 'external', 'uncertain request');
  f.provider.reconcileConversation = async () => ({ unprocessedOutgoingMessages: [], incomingMessages: [{ ...f.ref(10, 'incoming'), externalMessageId: 'external' }] });
  await f.reconcile.reconcileWorkspace('workspace', true);
  assert.equal(f.messages.listUnknownInboundMessages('workspace').length, 0);
  assert.equal(f.messages.findByExternalMessageId('workspace', 'connection', 'external')?.chatwootMessageId, 10);
  await f.reconcile.reconcileWorkspace('workspace', true);
  assert.equal(f.messages.listByConversation('conversation').length, 1); f.db.close();
});

test('reconciliation resolves a private send operation and a callback already linked to an outbox', async () => {
  const f = fixture();
  f.messages.beginSendOperation('private-operation', 'workspace', 'conversation', 'human', 'private-fingerprint');
  f.messages.beginSendOperation('public-operation', 'workspace', 'conversation', 'human', 'public-fingerprint');
  f.outbox.create({ id: 'existing-outbox', workspaceId: 'workspace', channelConnectionId: 'connection', conversationLinkId: 'conversation',
    chatwootAccountId: 1, chatwootMessageId: 40, idempotencyKey: 'existing-key', payloadSnapshot: '{}', state: 'provider_accepted',
    attemptCount: 1, correlationId: 'correlation', createdAt: new Date().toISOString() });
  f.provider.reconcileConversation = async () => ({ unprocessedOutgoingMessages: [{ ...f.ref(40), operationId: 'public-operation' }],
    privateMessages: [{ ...f.ref(41), isPrivate: true, operationId: 'private-operation' }] });
  assert.equal((await f.reconcile.reconcileWorkspace('workspace', true)).outboxQueued, 0);
  assert.equal(f.messages.getSendOperation('public-operation')?.state, 'complete');
  assert.equal(f.messages.getSendOperation('private-operation')?.state, 'complete');
  assert.equal(f.outbox.findByChatwootMessageId(1, 41), null); f.db.close();
});

test('manual full sweep holds historical gaps unknown instead of sending them', async () => {
  const f = fixture();
  f.provider.reconcileConversation = async input => {
    assert.equal(input.sinceTimestamp, undefined);
    return { unprocessedOutgoingMessages: [{ ...f.ref(40), createdAt: '2020-01-01T00:00:00Z' }] };
  };
  await f.reconcile.reconcileWorkspace('workspace', false);
  assert.equal(f.outbox.findByChatwootMessageId(1, 40)?.state, 'unknown'); f.db.close();
});

test('outbound media cannot silently degrade into an empty text send', async () => {
  const f = fixture(), adapter = new SyntheticChannelAdapter();
  f.outbox.create({ id: 'media-outbox', workspaceId: 'workspace', channelConnectionId: 'connection', conversationLinkId: 'conversation',
    chatwootAccountId: 1, chatwootMessageId: 40, idempotencyKey: 'media-key', payloadSnapshot: JSON.stringify({ attachmentCount: 1 }),
    state: 'pending', attemptCount: 0, correlationId: 'correlation', createdAt: new Date().toISOString() });
  const service = new OutboxService(f.outbox, f.messages, f.connections); service.registerAdapter('synthetic', adapter);
  assert.equal(await service.dispatchItem('media-outbox'), false); assert.equal(adapter.sendCount, 0);
  assert.equal(f.outbox.findById('media-outbox')?.state, 'failed'); f.db.close();
});

test('Chatwoot recovery paginates beyond the latest page and preserves inbound source and unsupported media references', async () => {
  const f = fixture(), original = globalThis.fetch; const requests: Array<{ url: string; body?: string }> = [];
  globalThis.fetch = (async (url, init) => {
    requests.push({ url: String(url), body: typeof init?.body === 'string' ? init.body : undefined });
    const payload = String(url).includes('?before=21') ? [{ id: 20, message_type: 1, created_at: 1700000000 }]
      : String(url).includes('?before=20') ? [] : Array.from({ length: 20 }, (_, i) => ({ id: 21 + i, message_type: 1, created_at: 1700000000 }));
    return new Response(JSON.stringify(init?.method === 'POST' ? { id: 10, message_type: 0, created_at: 1700000000 } : { payload }), { status: 200 });
  }) as typeof fetch;
  try {
    const provider = new ChatwootConversationProvider(new ChatwootClient({ baseUrl: 'http://test', apiToken: 'test' }), f.connections);
    assert.equal((await provider.reconcileConversation({ workspaceId: 'workspace', conversationDisplayId: 1 })).unprocessedOutgoingMessages.length, 21);
    await provider.createIncomingMessage({ workspaceId: 'workspace', channelConnectionId: 'connection', conversationId: 1,
      externalMessageId: 'media-1', attachments: [{ type: 'image', url: 'https://example.test/original' }] });
    const body = JSON.parse(requests.at(-1)!.body!);
    assert.equal(body.source_id, 'media-1'); assert.match(body.content, /chưa được nhập/);
    assert.equal(body.content_attributes.tinix_media_import, 'partial');
  } finally { globalThis.fetch = original; f.db.close(); }
});
