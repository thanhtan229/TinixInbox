import { randomBytes } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ENV } from '../src/config/env.ts';
import { CredentialVault } from '../src/persistence/credential-vault.ts';
import { ChannelConnectionRepository } from '../src/persistence/repositories.ts';
import {
  createDatabaseSnapshot,
  restoreDatabaseSnapshot,
  verifyDatabaseFile,
} from '../src/persistence/sqlite-backup.ts';

function configuredKeys() {
  const ringValue = process.env.TINIX_CREDENTIAL_ENCRYPTION_KEYS;
  const ring = ringValue ? JSON.parse(ringValue) : {};
  const activeKeyId = process.env.TINIX_CREDENTIAL_ENCRYPTION_KEY_ID || 'default';
  const singleKey = process.env.TINIX_CREDENTIAL_ENCRYPTION_KEY;
  let legacyKey;

  if (singleKey) {
    legacyKey = Buffer.from(singleKey, 'hex');
  } else if (typeof ring.default === 'string') {
    legacyKey = Buffer.from(ring.default, 'hex');
  } else if (typeof ring[activeKeyId] === 'string') {
    legacyKey = Buffer.from(ring[activeKeyId], 'hex');
  } else {
    legacyKey = readFileSync(join(ENV.DATA_DIR, '.credential-key'));
  }

  if (singleKey) {
    ring.default ||= singleKey;
    ring[activeKeyId] ||= singleKey;
  } else if (!ring.default) {
    ring.default = legacyKey.toString('hex');
  }

  return { activeKeyId, ring, legacyKey };
}

function countRows(path, table) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    return Number((db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()).count);
  } finally {
    db.close();
  }
}

function readConnectionValues(path, vault) {
  const db = new DatabaseSync(path);
  try {
    const repo = new ChannelConnectionRepository(db, vault);
    const ids = (db.prepare('SELECT id FROM channel_connections ORDER BY id').all())
      .map((row) => String(row.id));
    return ids.map((id) => {
      const connection = repo.findById(id);
      if (!connection) throw new Error('A channel connection disappeared during the drill');
      return {
        id,
        credentials: connection.credentialsEncrypted,
        callbackSecret: connection.chatwootCallbackSecretRef ?? null,
      };
    });
  } finally {
    db.close();
  }
}

function verifyRotatedSecrets(path, vault, expected) {
  const db = new DatabaseSync(path);
  try {
    const repo = new ChannelConnectionRepository(db, vault);
    for (const row of expected) {
      const connection = repo.findById(row.id);
      if (!connection
        || connection.credentialsEncrypted !== row.credentials
        || (connection.chatwootCallbackSecretRef ?? null) !== row.callbackSecret) {
        throw new Error('Credential verification failed after isolated key rotation');
      }
    }

    const stored = db.prepare(`SELECT credentials_encrypted, chatwoot_callback_secret_ref
      FROM channel_connections`).all();
    for (const row of stored) {
      if (!String(row.credentials_encrypted).startsWith('enc:v2:drill_next:')) {
        throw new Error('Credential rotation did not move every connection to the drill key');
      }
      if (row.chatwoot_callback_secret_ref !== null
        && !String(row.chatwoot_callback_secret_ref).startsWith('enc:v2:drill_next:')) {
        throw new Error('Credential rotation did not move every callback secret to the drill key');
      }
    }
  } finally {
    db.close();
  }
}

const source = resolve(ENV.DB_PATH);
if (!existsSync(source)) throw new Error('Tinix database does not exist; no restore drill was run');

const scratch = mkdtempSync(join(tmpdir(), 'tinix-restore-drill-'));

try {
  const scratchRelative = relative(resolve(tmpdir()), resolve(scratch));
  if (!basename(scratch).startsWith('tinix-restore-drill-')
    || scratchRelative === '..'
    || scratchRelative.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)
    || isAbsolute(scratchRelative)) {
    throw new Error('Refusing to use an unexpected temporary directory');
  }

  const backup = join(scratch, 'snapshot.db');
  const restoreTarget = join(scratch, 'restored.db');
  const keyConfig = configuredKeys();
  const sourceVault = new CredentialVault();
  createDatabaseSnapshot(source, backup);
  const expectedSecrets = readConnectionValues(backup, sourceVault);
  const sourceCounts = {
    channelConnections: countRows(backup, 'channel_connections'),
    conversations: countRows(backup, 'conversation_links'),
    messages: countRows(backup, 'message_links'),
    outbox: countRows(backup, 'outbox_messages'),
  };

  copyFileSync(backup, restoreTarget);
  restoreDatabaseSnapshot(backup, restoreTarget);
  verifyDatabaseFile(restoreTarget);

  const restoredCounts = {
    channelConnections: countRows(restoreTarget, 'channel_connections'),
    conversations: countRows(restoreTarget, 'conversation_links'),
    messages: countRows(restoreTarget, 'message_links'),
    outbox: countRows(restoreTarget, 'outbox_messages'),
  };
  if (JSON.stringify(sourceCounts) !== JSON.stringify(restoredCounts)) {
    throw new Error('Restored database row counts do not match the source snapshot');
  }

  const rotatingVault = new CredentialVault({
    activeKeyId: 'drill_next',
    keys: { ...keyConfig.ring, drill_next: randomBytes(32) },
    legacyKey: keyConfig.legacyKey,
  });
  verifyRotatedSecrets(restoreTarget, rotatingVault, expectedSecrets);
  verifyDatabaseFile(restoreTarget);

  console.log(JSON.stringify({
    status: 'PASS',
    sourceDatabase: source,
    restoredCounts,
    credentialConnectionsVerified: expectedSecrets.length,
    rotation: 'isolated copy only',
  }));
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
