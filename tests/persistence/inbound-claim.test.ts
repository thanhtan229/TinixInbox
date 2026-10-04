import test from 'node:test';
import assert from 'node:assert/strict';
import { getDatabase } from '../../src/persistence/db.ts';
import {
  ChannelConnectionRepository,
  ContactLinkRepository,
  ConversationLinkRepository,
  MessageLinkRepository,
} from '../../src/persistence/repositories.ts';
import { InboundService } from '../../src/services/inbound-service.ts';
import { InboundOutcomeUnknownError } from '../../src/core/errors.ts';
import type { ConversationProvider } from '../../src/core/conversation-provider.ts';
import type { UnifiedMessage } from '../../src/core/unified-message.ts';
import type { ChannelConnection } from '../../src/core/types.ts';

test('inbound message claim prevents a second Chatwoot create after an ambiguous result', async () => {
  const db = getDatabase(':memory:');
  const connectionRepo = new ChannelConnectionRepository(db);
  const contacts = new ContactLinkRepository(db);
  const conversations = new ConversationLinkRepository(db);
  const messages = new MessageLinkRepository(db);
  const now = new Date().toISOString();
  const connection: ChannelConnection = {
    id: 'conn-claim', workspaceId: 'ws-claim', provider: 'synthetic', displayName: 'Test',
    externalAccountId: 'account-claim', status: 'connected', credentialsEncrypted: 'test-only',
    credentialVersion: 1, scopes: [], metadata: {}, chatwootAccountId: 1, chatwootInboxId: 1,
    createdAt: now, updatedAt: now,
  };
  connectionRepo.create(connection);

  let createCalls = 0;
  const provider: ConversationProvider = {
    providerName: 'mock',
    async ensureIdentity(input) { return { contactId: 1, sourceId: input.externalUserId }; },
    async ensureConversation() { return { conversationId: 1, displayId: 1 }; },
    async createIncomingMessage() { createCalls++; throw new Error('socket closed after request body was sent'); },
    async createOutgoingMessage() { throw new Error('unused'); },
    async listMessages() { return { messages: [] }; },
    async updateSupportState() {},
    async assignConversation() {},
    async getAssignment() { return { agents: [], assignee: null }; },
    async downloadMessageAttachment() { throw new Error('unused'); },
    async addPrivateNote() { throw new Error('unused'); },
    async reconcileConversation() { return { unprocessedOutgoingMessages: [] }; },
  };
  const inbound = new InboundService(provider, contacts, conversations, messages);
  const message: UnifiedMessage = {
    id: 'msg-claim', workspaceId: connection.workspaceId, provider: 'synthetic',
    channelConnectionId: connection.id, externalConversationId: 'customer-1',
    externalMessageId: 'external-1', direction: 'incoming', messageType: 'text',
    sender: { externalId: 'customer-1' }, attachments: [], text: 'Hello',
    sentAt: now, receivedAt: now,
  };

  await assert.rejects(inbound.handleUnifiedMessage(message, connection), /socket closed/);
  await assert.rejects(inbound.handleUnifiedMessage(message, connection), InboundOutcomeUnknownError);
  assert.strictEqual(createCalls, 1);
  const claim = db.prepare(`SELECT status FROM inbound_message_claims WHERE external_message_id = ?`)
    .get('external-1') as { status: string };
  assert.strictEqual(claim.status, 'unknown');
  assert.strictEqual(messages.listUnknownInboundMessages(connection.workspaceId).length, 1);
});

test('restart recovery marks in-flight inbound claims unknown instead of replaying blindly', () => {
  const db = getDatabase(':memory:');
  const messages = new MessageLinkRepository(db);
  assert.strictEqual(messages.claimInboundMessage('ws', 'conn', 'external'), 'claimed');
  assert.strictEqual(messages.recoverInterruptedInboundMessages(), 1);
  assert.strictEqual(messages.claimInboundMessage('ws', 'conn', 'external'), 'unknown');
});
