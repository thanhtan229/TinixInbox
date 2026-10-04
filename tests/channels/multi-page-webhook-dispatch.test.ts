import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import {
  ChannelConnectionRepository,
  ContactLinkRepository,
  ConversationLinkRepository,
  MessageLinkRepository,
  ProviderWebhookEventRepository,
} from '../../src/persistence/repositories.ts';
import { CredentialVault } from '../../src/persistence/credential-vault.ts';
import { InboundService } from '../../src/services/inbound-service.ts';
import { WebhookController } from '../../src/api/webhook-controller.ts';
import { MetaChannelAdapter } from '../../src/channels/meta/meta-adapter.ts';
import type { ConversationProvider } from '../../src/core/conversation-provider.ts';
import type { ChannelConnection } from '../../src/core/types.ts';

function createFullTestDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE IF NOT EXISTS channel_connections (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      display_name TEXT NOT NULL,
      external_account_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      credentials_encrypted TEXT NOT NULL,
      credential_version INTEGER NOT NULL DEFAULT 1,
      scopes TEXT NOT NULL DEFAULT '[]',
      metadata TEXT NOT NULL DEFAULT '{}',
      chatwoot_account_id INTEGER,
      chatwoot_inbox_id INTEGER,
      chatwoot_api_channel_identifier TEXT,
      chatwoot_callback_secret_ref TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_verified_at TEXT,
      last_successful_event_at TEXT,
      last_error TEXT,
      disabled_previous_status TEXT,
      UNIQUE(workspace_id, provider, external_account_id)
    );

    CREATE TABLE IF NOT EXISTS external_contact_links (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      channel_connection_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      external_user_id TEXT NOT NULL,
      chatwoot_account_id INTEGER NOT NULL,
      chatwoot_contact_id INTEGER NOT NULL,
      chatwoot_contact_inbox_id INTEGER,
      chatwoot_source_id TEXT NOT NULL,
      customer_identity_id TEXT,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(workspace_id, channel_connection_id, external_user_id)
    );

    CREATE TABLE IF NOT EXISTS conversation_links (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      channel_connection_id TEXT NOT NULL,
      external_conversation_id TEXT,
      tinix_thread_key TEXT NOT NULL,
      chatwoot_account_id INTEGER NOT NULL,
      chatwoot_inbox_id INTEGER NOT NULL,
      chatwoot_contact_inbox_id INTEGER,
      chatwoot_conversation_ref TEXT NOT NULL,
      chatwoot_conversation_display_id INTEGER NOT NULL,
      state TEXT NOT NULL DEFAULT 'open',
      provider_last_message_at TEXT,
      last_reconciled_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(workspace_id, channel_connection_id, tinix_thread_key)
    );

    CREATE TABLE IF NOT EXISTS message_links (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      channel_connection_id TEXT NOT NULL,
      conversation_link_id TEXT NOT NULL,
      direction TEXT NOT NULL,
      origin TEXT NOT NULL,
      external_message_id TEXT,
      provider_message_id TEXT,
      chatwoot_account_id INTEGER NOT NULL,
      chatwoot_message_id INTEGER NOT NULL,
      outbox_id TEXT,
      delivery_state TEXT NOT NULL DEFAULT 'queued',
      provider_sent_at TEXT,
      provider_accepted_at TEXT,
      delivered_at TEXT,
      read_at TEXT,
      failed_at TEXT,
      correlation_id TEXT NOT NULL,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(chatwoot_account_id, chatwoot_message_id)
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_inbound_unique ON message_links(workspace_id, channel_connection_id, external_message_id)
      WHERE external_message_id IS NOT NULL;

    CREATE TABLE IF NOT EXISTS inbound_message_claims (
      workspace_id TEXT NOT NULL,
      channel_connection_id TEXT NOT NULL,
      external_message_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('processing', 'processed', 'unknown')),
      claimed_at TEXT NOT NULL,
      completed_at TEXT,
      last_error TEXT,
      PRIMARY KEY(workspace_id, channel_connection_id, external_message_id)
    );

    CREATE TABLE IF NOT EXISTS provider_webhook_events (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      channel_connection_id TEXT NOT NULL,
      provider_event_id TEXT,
      payload_hash TEXT NOT NULL,
      raw_payload TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'received',
      retry_count INTEGER NOT NULL DEFAULT 0,
      next_retry_at TEXT,
      correlation_id TEXT NOT NULL,
      received_at TEXT NOT NULL,
      last_error TEXT,
      UNIQUE(channel_connection_id, payload_hash)
    );
  `);
  return db;
}

test('Multi-Page Inbound Dispatch: dynamically routes messages to correct connection and respects pause status', async () => {
  const db = createFullTestDb();
  const vault = new CredentialVault(Buffer.alloc(32, 7));
  const connectionRepo = new ChannelConnectionRepository(db, vault);
  const contactRepo = new ContactLinkRepository(db);
  const conversationRepo = new ConversationLinkRepository(db);
  const messageRepo = new MessageLinkRepository(db);
  const eventRepo = new ProviderWebhookEventRepository(db);

  const now = new Date().toISOString();

  // Connection A (Tinix)
  connectionRepo.create({
    id: 'conn-meta-a',
    workspaceId: 'default-workspace',
    provider: 'meta',
    displayName: 'Tinix',
    externalAccountId: 'page-tinix-111',
    status: 'connected',
    credentialsEncrypted: JSON.stringify({ webhookVerifyToken: 'tinix_meta_verify_2026', appSecret: 'secret1' }),
    credentialVersion: 1,
    scopes: ['messages'],
    metadata: { webhookVerifyToken: 'tinix_meta_verify_2026' },
    chatwootAccountId: 1,
    chatwootInboxId: 10,
    chatwootApiChannelIdentifier: 'ident-10',
    createdAt: now,
    updatedAt: now,
  });

  // Connection B (Studio)
  connectionRepo.create({
    id: 'conn-meta-b',
    workspaceId: 'default-workspace',
    provider: 'meta',
    displayName: 'Studio',
    externalAccountId: 'page-studio-222',
    status: 'connected',
    credentialsEncrypted: JSON.stringify({ webhookVerifyToken: 'tinix_meta_verify_2026', appSecret: 'secret1' }),
    credentialVersion: 1,
    scopes: ['messages'],
    metadata: { webhookVerifyToken: 'tinix_meta_verify_2026' },
    chatwootAccountId: 1,
    chatwootInboxId: 20,
    chatwootApiChannelIdentifier: 'ident-20',
    createdAt: now,
    updatedAt: now,
  });

  // Mock ConversationProvider
  let lastChatwootInboxId: number | undefined;
  let chatwootMsgSeq = 100;
  const mockProvider: ConversationProvider = {
    providerName: 'chatwoot',
    ensureIdentity: async (params) => ({
      contactId: 99,
      contactInboxId: 88,
      sourceId: params.externalUserId,
    }),
    ensureConversation: async (params) => {
      const conn = connectionRepo.findById(params.channelConnectionId);
      lastChatwootInboxId = conn?.chatwootInboxId;
      return {
        conversationId: 777,
        displayId: 777,
      };
    },
    createIncomingMessage: async (input) => ({
      messageId: ++chatwootMsgSeq,
      conversationId: input.conversationId,
      content: input.text || '',
      direction: 'incoming',
      isPrivate: false,
      status: 'delivered',
      createdAt: now,
    }),
    createOutgoingMessage: async (input) => ({
      messageId: ++chatwootMsgSeq,
      conversationId: input.conversationId,
      content: input.text,
      direction: 'outgoing',
      isPrivate: input.isPrivate || false,
      status: 'delivered',
      createdAt: now,
    }),
    updateSupportState: async () => undefined,
    assignConversation: async () => undefined,
    getAssignment: async () => ({ agents: [], assignee: null }),
    downloadMessageAttachment: async () => { throw new Error('unused'); },
    addPrivateNote: async () => { throw new Error('unused'); },
    reconcileConversation: async () => ({ unprocessedOutgoingMessages: [] }),
    listMessages: async () => ({ messages: [] }),
  };

  const inboundService = new InboundService(
    mockProvider,
    contactRepo,
    conversationRepo,
    messageRepo,
    undefined,
    undefined,
    connectionRepo
  );

  const adapter = new MetaChannelAdapter();

  // Test 1: Message addressed to Page B sent through Connection A
  const payloadForPageB = JSON.stringify({
    object: 'page',
    entry: [
      {
        id: 'page-studio-222',
        time: Date.now(),
        messaging: [
          {
            sender: { id: 'customer_1' },
            recipient: { id: 'page-studio-222' },
            timestamp: Date.now(),
            message: { mid: 'mid_b_1', text: 'Hello Studio' },
          },
        ],
      },
    ],
  });

  const connA = connectionRepo.findById('conn-meta-a')!;
  const result1 = await inboundService.processVerifiedInboundWebhook(adapter, connA, payloadForPageB);
  assert.equal(result1.processed, 1);

  // Must have resolved to Connection B, with Chatwoot Inbox 20
  assert.equal(lastChatwootInboxId, 20);
  const msgB = messageRepo.findByExternalMessageId('default-workspace', 'conn-meta-b', 'mid_b_1');
  assert.ok(msgB, 'Message must be stored under conn-meta-b');
  assert.equal(msgB.channelConnectionId, 'conn-meta-b');

  // Test 2: When Connection B is disabled, messages for Page B are skipped
  connectionRepo.updateStatus('conn-meta-b', 'disabled');

  const payloadForPageB2 = JSON.stringify({
    object: 'page',
    entry: [
      {
        id: 'page-studio-222',
        time: Date.now(),
        messaging: [
          {
            sender: { id: 'customer_1' },
            recipient: { id: 'page-studio-222' },
            timestamp: Date.now(),
            message: { mid: 'mid_b_2', text: 'Another message for Studio' },
          },
        ],
      },
    ],
  });

  const result2 = await inboundService.processVerifiedInboundWebhook(adapter, connA, payloadForPageB2);
  assert.equal(result2.processed, 0, 'Disabled page must drop messages');

  // Test 3: Universal webhook verification challenge without connectionId
  const webhookCtrl = new WebhookController(inboundService, connectionRepo, eventRepo);
  const challengeParams = new URLSearchParams({
    'hub.mode': 'subscribe',
    'hub.verify_token': 'tinix_meta_verify_2026',
    'hub.challenge': 'universal_challenge_token_999',
  });

  const challengeResult = await webhookCtrl.verifyChallenge('meta', undefined, challengeParams);
  assert.equal(challengeResult.status, 200);
  assert.equal(challengeResult.body, 'universal_challenge_token_999');
});
