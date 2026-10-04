import test from 'node:test';
import assert from 'node:assert';
import { createCipheriv, randomBytes } from 'node:crypto';
import { getDatabase } from '../../src/persistence/db.ts';
import { ChannelConnectionRepository } from '../../src/persistence/repositories.ts';
import { CredentialVault } from '../../src/persistence/credential-vault.ts';
import type { ChannelConnection } from '../../src/core/types.ts';

test('credential vault encrypts, decrypts, and authenticates stored secrets', () => {
  const vault = new CredentialVault(Buffer.alloc(32, 7));
  const ciphertext = vault.encrypt('provider-secret-value')!;
  assert.match(ciphertext, /^enc:v2:default:/);
  assert.notStrictEqual(ciphertext, 'provider-secret-value');
  assert.strictEqual(vault.decrypt(ciphertext), 'provider-secret-value');
  assert.throws(() => new CredentialVault(Buffer.alloc(32, 8)).decrypt(ciphertext), /could not be decrypted/);

  const oldKey = Buffer.alloc(32, 7);
  const newKey = Buffer.alloc(32, 9);
  const rotatingVault = new CredentialVault({
    activeKeyId: 'key-2026-10',
    keys: { default: oldKey, 'key-2026-10': newKey },
  });
  const rotated = rotatingVault.encrypt(ciphertext)!;
  assert.match(rotated, /^enc:v2:key-2026-10:/);
  assert.strictEqual(rotatingVault.decrypt(rotated), 'provider-secret-value');

  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', oldKey, nonce);
  const legacyCiphertext = Buffer.concat([cipher.update('legacy-v1', 'utf8'), cipher.final()]);
  const legacyV1 = `enc:v1:${nonce.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${legacyCiphertext.toString('hex')}`;
  assert.strictEqual(rotatingVault.decrypt(legacyV1), 'legacy-v1');
  assert.match(rotatingVault.encrypt(legacyV1)!, /^enc:v2:key-2026-10:/);
});

test('channel credentials and callback secrets are encrypted in SQLite and decrypted for service use', () => {
  const db = getDatabase(':memory:');
  const repo = new ChannelConnectionRepository(db);
  const now = new Date().toISOString();
  const connection: ChannelConnection = {
    id: 'conn-secret-test', workspaceId: 'ws-secret', provider: 'meta', displayName: 'Page',
    externalAccountId: 'page-101', status: 'pending', credentialsEncrypted: 'page-token-secret',
    credentialVersion: 1, scopes: [], metadata: {}, chatwootCallbackSecretRef: 'callback-signing-secret',
    createdAt: now, updatedAt: now,
  };
  repo.create(connection);

  const stored = db.prepare(`SELECT credentials_encrypted, chatwoot_callback_secret_ref
    FROM channel_connections WHERE id = ?`).get(connection.id) as Record<string, string>;
  assert.match(stored.credentials_encrypted, /^enc:v2:default:/);
  assert.match(stored.chatwoot_callback_secret_ref, /^enc:v2:default:/);
  assert.doesNotMatch(JSON.stringify(stored), /page-token-secret|callback-signing-secret/);
  assert.strictEqual(repo.findById(connection.id)?.credentialsEncrypted, 'page-token-secret');
  assert.strictEqual(repo.findById(connection.id)?.chatwootCallbackSecretRef, 'callback-signing-secret');

  db.prepare(`UPDATE channel_connections SET credentials_encrypted = ?, chatwoot_callback_secret_ref = ? WHERE id = ?`)
    .run('legacy-token', 'legacy-callback-secret', connection.id);
  const migratedRepo = new ChannelConnectionRepository(db);
  const migrated = db.prepare(`SELECT credentials_encrypted, chatwoot_callback_secret_ref
    FROM channel_connections WHERE id = ?`).get(connection.id) as Record<string, string>;
  assert.match(migrated.credentials_encrypted, /^enc:v2:default:/);
  assert.match(migrated.chatwoot_callback_secret_ref, /^enc:v2:default:/);
  assert.strictEqual(migratedRepo.findById(connection.id)?.credentialsEncrypted, 'legacy-token');
});

test('connection repository rotates stored credential and callback ciphertext on startup', () => {
  const db = getDatabase(':memory:');
  const oldKey = Buffer.alloc(32, 3);
  const newKey = Buffer.alloc(32, 4);
  const oldRepo = new ChannelConnectionRepository(db, new CredentialVault(oldKey));
  const now = new Date().toISOString();
  oldRepo.create({
    id: 'rotate-conn', workspaceId: 'rotate-ws', provider: 'meta', displayName: 'Page',
    externalAccountId: 'page-rotate', status: 'connected', credentialsEncrypted: 'token-to-rotate',
    credentialVersion: 1, scopes: [], metadata: {}, chatwootCallbackSecretRef: 'callback-to-rotate',
    createdAt: now, updatedAt: now,
  });

  const rotationVault = new CredentialVault({
    activeKeyId: 'new-key', keys: { default: oldKey, 'new-key': newKey },
  });
  const rotatedRepo = new ChannelConnectionRepository(db, rotationVault);
  const stored = db.prepare(`SELECT credentials_encrypted, chatwoot_callback_secret_ref
    FROM channel_connections WHERE id = 'rotate-conn'`).get() as Record<string, string>;
  assert.match(stored.credentials_encrypted, /^enc:v2:new-key:/);
  assert.match(stored.chatwoot_callback_secret_ref, /^enc:v2:new-key:/);
  assert.strictEqual(rotatedRepo.findById('rotate-conn')?.credentialsEncrypted, 'token-to-rotate');
  assert.strictEqual(rotatedRepo.findById('rotate-conn')?.chatwootCallbackSecretRef, 'callback-to-rotate');
  db.close();
});
