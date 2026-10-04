import test from 'node:test';
import assert from 'node:assert';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getDatabase } from '../../src/persistence/db.ts';
import {
  ChannelConnectionRepository,
  MessageLinkRepository,
  OutboxRepository,
} from '../../src/persistence/repositories.ts';

test('Database schema initializes all required tables and uniqueness constraints', () => {
  const db = getDatabase(':memory:');
  const connRepo = new ChannelConnectionRepository(db);
  const outboxRepo = new OutboxRepository(db);

  // 1. Connection creation and uniqueness test
  connRepo.create({
    id: 'conn-1',
    workspaceId: 'ws-1',
    provider: 'meta',
    displayName: 'Meta Page 1',
    externalAccountId: 'page-101',
    status: 'connected',
    credentialsEncrypted: 'enc-creds',
    credentialVersion: 1,
    scopes: ['messages'],
    metadata: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  const foundConn = connRepo.findById('conn-1');
  assert.strictEqual(foundConn?.displayName, 'Meta Page 1');

  const pausedConn = connRepo.setEnabled('ws-1', 'conn-1', false);
  assert.strictEqual(pausedConn?.status, 'disabled');
  const resumedConn = connRepo.setEnabled('ws-1', 'conn-1', true);
  assert.strictEqual(resumedConn?.status, 'connected');
  assert.strictEqual(connRepo.setEnabled('ws-other', 'conn-1', false), null);
  connRepo.create({
    id: 'conn-degraded', workspaceId: 'ws-1', provider: 'zalo', displayName: 'OA',
    externalAccountId: 'oa-1', status: 'degraded', credentialsEncrypted: 'enc-creds',
    credentialVersion: 1, scopes: [], metadata: {}, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  });
  connRepo.setEnabled('ws-1', 'conn-degraded', false);
  assert.strictEqual(connRepo.setEnabled('ws-1', 'conn-degraded', true)?.status, 'degraded');

  // Duplicate workspace + provider + externalAccountId should throw UNIQUE constraint error
  assert.throws(() => {
    connRepo.create({
      id: 'conn-2',
      workspaceId: 'ws-1',
      provider: 'meta',
      displayName: 'Duplicate Meta Page',
      externalAccountId: 'page-101',
      status: 'connected',
      credentialsEncrypted: 'enc-creds',
      credentialVersion: 1,
      scopes: ['messages'],
      metadata: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  });

  // 2. Outbox hard uniqueness test (chatwoot_account_id + chatwoot_message_id)
  outboxRepo.create({
    id: 'outbox-1',
    workspaceId: 'ws-1',
    channelConnectionId: 'conn-1',
    conversationLinkId: 'conv-1',
    chatwootAccountId: 1,
    chatwootMessageId: 501,
    idempotencyKey: 'key-1',
    payloadSnapshot: '{}',
    state: 'pending',
    attemptCount: 0,
    correlationId: 'corr-1',
    createdAt: new Date().toISOString(),
  });

  assert.throws(() => {
    outboxRepo.create({
      id: 'outbox-2',
      workspaceId: 'ws-1',
      channelConnectionId: 'conn-1',
      conversationLinkId: 'conv-1',
      chatwootAccountId: 1,
      chatwootMessageId: 501, // duplicate message ID
      idempotencyKey: 'key-2',
      payloadSnapshot: '{}',
      state: 'pending',
      attemptCount: 0,
      correlationId: 'corr-2',
      createdAt: new Date().toISOString(),
    });
  });
});

test('channel lifecycle migration adds prior-status storage to an existing database', () => {
  const directory = mkdtempSync(join(tmpdir(), 'tinix-inbox-migration-'));
  const dbPath = join(directory, 'legacy.db');
  const legacyDb = new DatabaseSync(dbPath);
  legacyDb.exec(`CREATE TABLE channel_connections (
    id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, provider TEXT NOT NULL,
    display_name TEXT NOT NULL, external_account_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', credentials_encrypted TEXT NOT NULL,
    credential_version INTEGER NOT NULL DEFAULT 1, scopes TEXT NOT NULL DEFAULT '[]',
    metadata TEXT NOT NULL DEFAULT '{}', chatwoot_account_id INTEGER,
    chatwoot_inbox_id INTEGER, chatwoot_api_channel_identifier TEXT,
    chatwoot_callback_secret_ref TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    last_verified_at TEXT, last_successful_event_at TEXT, last_error TEXT,
    UNIQUE(workspace_id, provider, external_account_id)
  )`);
  legacyDb.close();

  const migrated = getDatabase(dbPath);
  try {
    const columns = migrated.prepare('PRAGMA table_info(channel_connections)').all() as Array<{ name: string }>;
    assert.ok(columns.some((column) => column.name === 'disabled_previous_status'));
  } finally {
    migrated.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
