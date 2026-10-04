import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { ChannelConnectionRepository } from '../../src/persistence/repositories.ts';
import { CredentialVault } from '../../src/persistence/credential-vault.ts';
import type { ChannelConnection } from '../../src/core/types.ts';

function createTestDb(): DatabaseSync {
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
  `);
  return db;
}

test('Multi-Channel Connection: supports storing and querying multiple pages independently', () => {
  const db = createTestDb();
  const vault = new CredentialVault(Buffer.alloc(32, 7));
  const repo = new ChannelConnectionRepository(db, vault);

  const now = new Date().toISOString();

  // Create Page 1: Tinix
  const page1: ChannelConnection = {
    id: 'conn-meta-1',
    workspaceId: 'default-workspace',
    provider: 'meta',
    displayName: 'Tinix Official',
    externalAccountId: '1106784475845782',
    status: 'connected',
    credentialsEncrypted: 'token-page-1',
    credentialVersion: 1,
    scopes: ['messages', 'webhooks'],
    metadata: {},
    chatwootAccountId: 1,
    chatwootInboxId: 5,
    chatwootApiChannelIdentifier: 'ident-5',
    createdAt: now,
    updatedAt: now,
  };
  repo.create(page1);

  // Create Page 2: Studio
  const page2: ChannelConnection = {
    id: 'conn-meta-2',
    workspaceId: 'default-workspace',
    provider: 'meta',
    displayName: 'Tí Nị Studio',
    externalAccountId: '139438959247389',
    status: 'connected',
    credentialsEncrypted: 'token-page-2',
    credentialVersion: 1,
    scopes: ['messages', 'webhooks'],
    metadata: {},
    chatwootAccountId: 1,
    chatwootInboxId: 4,
    chatwootApiChannelIdentifier: 'ident-4',
    createdAt: now,
    updatedAt: now,
  };
  repo.create(page2);

  // 1. Both pages must exist simultaneously
  const allConns = repo.listByWorkspace('default-workspace');
  assert.equal(allConns.length, 2);

  const metaConns = repo.listByProvider('default-workspace', 'meta');
  assert.equal(metaConns.length, 2);

  // 2. Querying by provider and externalAccountId must resolve to the correct page
  const found1 = repo.findByProviderAndExternalAccountId('default-workspace', 'meta', '1106784475845782');
  assert.ok(found1);
  assert.equal(found1.displayName, 'Tinix Official');
  assert.equal(found1.chatwootInboxId, 5);

  const found2 = repo.findByProviderAndExternalAccountId('default-workspace', 'meta', '139438959247389');
  assert.ok(found2);
  assert.equal(found2.displayName, 'Tí Nị Studio');
  assert.equal(found2.chatwootInboxId, 4);

  // 3. Updating Page 1 does not affect Page 2
  repo.updateConnection('conn-meta-1', {
    displayName: 'Tinix Official Updated',
    lastVerifiedAt: new Date().toISOString(),
  });

  const updated1 = repo.findById('conn-meta-1');
  assert.equal(updated1?.displayName, 'Tinix Official Updated');

  const unchanged2 = repo.findById('conn-meta-2');
  assert.equal(unchanged2?.displayName, 'Tí Nị Studio');

  // 4. Deleting Page 1 leaves Page 2 intact
  const deleted = repo.deleteConnection('default-workspace', 'conn-meta-1');
  assert.equal(deleted, true);

  const remaining = repo.listByWorkspace('default-workspace');
  assert.equal(remaining.length, 2);
  assert.equal(repo.findById('conn-meta-1')?.status, 'disconnected');
  assert.equal(repo.findById('conn-meta-2')?.status, 'connected');
});
