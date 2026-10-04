import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { getDatabase } from '../../src/persistence/db.ts';
import {
  ChannelConnectionRepository,
  ContactLinkRepository,
  ConversationLinkRepository,
  MessageLinkRepository,
} from '../../src/persistence/repositories.ts';
import { CredentialVault } from '../../src/persistence/credential-vault.ts';
import { SyntheticChannelAdapter } from '../../src/channels/synthetic/synthetic-adapter.ts';
import { InboundService } from '../../src/services/inbound-service.ts';
import { ChatwootClient } from '../../src/providers/chatwoot/chatwoot-client.ts';
import { ChatwootConversationProvider } from '../../src/providers/chatwoot/chatwoot-provider.ts';

const token = process.env.CHATWOOT_API_TOKEN;
if (!token) throw new Error('CHATWOOT_API_TOKEN must be passed through the local process environment');

const accountId = Number(process.env.CHATWOOT_ACCOUNT_ID || 1);
const inboxId = Number(process.env.CHATWOOT_INBOX_ID || 1);
const agentId = Number(process.env.CHATWOOT_AGENT_ID || 2);
const baseUrl = process.env.CHATWOOT_BASE_URL || 'http://127.0.0.1:3180';
const runId = randomUUID();
const workspaceId = `poc-${runId}`;
const connectionId = `poc-conn-${runId}`;
const senderId = `poc-user-${runId}`;
const externalMessageId = `poc-message-${runId}`;
const text = `Tinix Chatwoot v4.18 live check ${runId}`;
const db = getDatabase(':memory:');

try {
  const connectionRepo = new ChannelConnectionRepository(db, new CredentialVault(Buffer.alloc(32, 0x5a)));
  const contactRepo = new ContactLinkRepository(db);
  const conversationRepo = new ConversationLinkRepository(db);
  const messageRepo = new MessageLinkRepository(db);
  const now = new Date().toISOString();
  connectionRepo.create({
    id: connectionId,
    workspaceId,
    provider: 'synthetic',
    displayName: 'Tinix Chatwoot live POC',
    externalAccountId: `poc-account-${runId}`,
    status: 'connected',
    credentialsEncrypted: '{}',
    credentialVersion: 1,
    scopes: ['messages'],
    metadata: {},
    chatwootAccountId: accountId,
    chatwootInboxId: inboxId,
    createdAt: now,
    updatedAt: now,
  });

  const connection = connectionRepo.findById(connectionId);
  assert.ok(connection);
  const conversationProvider = new ChatwootConversationProvider(
    new ChatwootClient({ baseUrl, apiToken: token }),
    connectionRepo
  );
  const inboundService = new InboundService(conversationProvider, contactRepo, conversationRepo, messageRepo);
  const adapter = new SyntheticChannelAdapter();
  const payload = JSON.stringify({
    id: externalMessageId,
    message_id: externalMessageId,
    sender_id: senderId,
    sender_name: 'Synthetic POC Customer',
    conversation_id: `poc-thread-${runId}`,
    text,
  });

  const first = await inboundService.processVerifiedInboundWebhook(adapter, connection, payload);
  const duplicate = await inboundService.processVerifiedInboundWebhook(adapter, connection, payload);
  assert.deepEqual(first, { processed: 1, duplicate: 0 });
  assert.deepEqual(duplicate, { processed: 0, duplicate: 1 });

  const link = conversationRepo.listByWorkspace(workspaceId)[0];
  assert.ok(link, 'Tinix conversation mapping was persisted');
  const page = await conversationProvider.listMessages({
    workspaceId,
    conversationDisplayId: link.chatwootConversationDisplayId,
  });
  const matchingMessages = page.messages.filter((message) => message.content === text);
  assert.equal(matchingMessages.length, 1, 'one Chatwoot incoming message exists after duplicate delivery');
  assert.equal(matchingMessages[0].direction, 'incoming');

  const outgoingText = `Tinix synthetic operator reply ${runId}`;
  const recoveredIdentity = await conversationProvider.ensureIdentity({ workspaceId, channelConnectionId: connectionId,
    externalUserId: senderId });
  assert.equal(recoveredIdentity.contactId, contactRepo.findByExternalUser(workspaceId, connectionId, senderId).chatwootContactId,
    'remote identity lookup reuses the original contact');
  const outgoing = await conversationProvider.createOutgoingMessage({
    workspaceId,
    channelConnectionId: connectionId,
    conversationId: link.chatwootConversationDisplayId,
    text: outgoingText,
    isPrivate: false,
  });
  assert.equal(outgoing.direction, 'outgoing');
  assert.equal(outgoing.isPrivate, false);

  await conversationProvider.assignConversation({
    workspaceId,
    conversationDisplayId: link.chatwootConversationDisplayId,
    agentId,
  });
  await conversationProvider.updateSupportState({
    workspaceId,
    conversationDisplayId: link.chatwootConversationDisplayId,
    status: 'resolved',
  });
  await conversationProvider.updateSupportState({
    workspaceId,
    conversationDisplayId: link.chatwootConversationDisplayId,
    status: 'open',
  });

  const verifiedPage = await conversationProvider.listMessages({
    workspaceId,
    conversationDisplayId: link.chatwootConversationDisplayId,
  });
  const matchingOutgoing = verifiedPage.messages.filter((message) => message.content === outgoingText);
  assert.equal(matchingOutgoing.length, 1, 'one public outgoing message exists in Chatwoot');
  assert.equal(matchingOutgoing[0].direction, 'outgoing');
  assert.equal(matchingOutgoing[0].isPrivate, false);

  const mediaBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jCfkAAAAASUVORK5CYII=', 'base64');
  const mediaProvider = new ChatwootConversationProvider(new ChatwootClient({ baseUrl, apiToken: token }), connectionRepo,
    { async download() { return { bytes: mediaBytes, mimeType: 'image/png', fileName: 'test.png' }; } });
  const mediaMessage = await mediaProvider.createIncomingMessage({ workspaceId, channelConnectionId: connectionId,
    conversationId: link.chatwootConversationDisplayId, externalMessageId: `media-${runId}`,
    attachments: [{ type: 'image', url: 'https://media.test/test.png' }] });
  assert.equal(mediaMessage.attachments?.length, 1, 'binary image is stored by real Chatwoot Active Storage');
  const downloaded = await mediaProvider.downloadMessageAttachment({ workspaceId, conversationDisplayId: link.chatwootConversationDisplayId,
    messageId: mediaMessage.messageId, attachmentIndex: 0 });
  assert.deepEqual(Buffer.from(downloaded.bytes), mediaBytes, 'uploaded and downloaded media bytes match');

  console.log(JSON.stringify({
    status: 'PASS',
    provider: 'Chatwoot CE v4.18.0',
    accountId,
    inboxId,
    contactMapped: true,
    conversationDisplayId: link.chatwootConversationDisplayId,
    firstDelivery: first,
    duplicateDelivery: duplicate,
    chatwootIncomingMessages: matchingMessages.length,
    chatwootOutgoingMessages: matchingOutgoing.length,
    assignmentAndStatusApi: 'PASS',
    binaryMediaRoundTrip: 'PASS',
  }));
} finally {
  db.close();
}
