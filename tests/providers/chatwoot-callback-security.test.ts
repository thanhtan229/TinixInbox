import test from 'node:test';
import assert from 'node:assert/strict';
import { getDatabase } from '../../src/persistence/db.ts';
import {
  CallbackEventRepository,
  ChannelConnectionRepository,
  ConversationLinkRepository,
  MessageLinkRepository,
  OutboxRepository,
} from '../../src/persistence/repositories.ts';
import { OutboundService } from '../../src/services/outbound-service.ts';

function createService() {
  const db = getDatabase(':memory:');
  const connections = new ChannelConnectionRepository(db);
  const service = new OutboundService(
    connections,
    new ConversationLinkRepository(db),
    new MessageLinkRepository(db),
    new OutboxRepository(db),
    new CallbackEventRepository(db)
  );
  return { connections, service };
}

test('Chatwoot callback rejects an unmapped inbox instead of accepting an unsigned event', async () => {
  const { service } = createService();
  const body = JSON.stringify({ event: 'message_created', account: { id: 7 }, inbox: { id: 9 } });

  await assert.rejects(
    service.handleChatwootCallback(body, undefined, undefined),
    /not mapped or has no signing secret/i
  );
});

test('Chatwoot callback rejects malformed and non-object JSON payloads', async () => {
  const { service } = createService();

  await assert.rejects(
    service.handleChatwootCallback('{not-json', undefined, undefined),
    /body must be valid JSON/i
  );
  await assert.rejects(
    service.handleChatwootCallback('[]', undefined, undefined),
    /body must be a JSON object/i
  );
});

test('Chatwoot callback rejects a mapped inbox with no callback signing secret', async () => {
  const { connections, service } = createService();
  connections.create({
    id: 'conn-no-callback-secret',
    workspaceId: 'ws-test',
    provider: 'synthetic',
    displayName: 'Synthetic',
    externalAccountId: 'synthetic-1',
    status: 'pending',
    credentialsEncrypted: 'synthetic-test-credential',
    credentialVersion: 1,
    scopes: [],
    metadata: {},
    chatwootAccountId: 7,
    chatwootInboxId: 9,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  const body = JSON.stringify({ event: 'message_created', account: { id: 7 }, inbox: { id: 9 } });

  await assert.rejects(
    service.handleChatwootCallback(body, undefined, undefined),
    /not mapped or has no signing secret/i
  );
});
