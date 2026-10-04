import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { getDatabase } from '../../src/persistence/db.ts';
import {
  createDatabaseSnapshot,
  restoreDatabaseSnapshot,
  verifyDatabaseFile,
} from '../../src/persistence/sqlite-backup.ts';

test('SQLite backup snapshots committed WAL data and restore preserves a verified safety copy', () => {
  const directory = mkdtempSync(join(tmpdir(), 'tinix-inbox-backup-'));
  const source = join(directory, 'source.db');
  const snapshot = join(directory, 'snapshot.db');
  const destination = join(directory, 'destination.db');
  let operationError: unknown;

  try {
    const sourceDb = getDatabase(source);
    try {
      sourceDb.exec('CREATE TABLE backup_marker (value TEXT NOT NULL)');
      sourceDb.prepare('INSERT INTO backup_marker VALUES (?)').run('snapshot-value');
    } finally {
      sourceDb.close();
    }

    createDatabaseSnapshot(source, snapshot);
    verifyDatabaseFile(snapshot);
    const snapshotDb = new DatabaseSync(snapshot, { readOnly: true });
    assert.equal(snapshotDb.prepare('SELECT value FROM backup_marker').get()?.value, 'snapshot-value');
    snapshotDb.close();

    const destinationDb = getDatabase(destination);
    try {
      destinationDb.exec('CREATE TABLE backup_marker (value TEXT NOT NULL)');
      destinationDb.prepare('INSERT INTO backup_marker VALUES (?)').run('previous-value');
    } finally {
      destinationDb.close();
    }

    const safetySnapshot = restoreDatabaseSnapshot(snapshot, destination);
    assert.ok(safetySnapshot);
    verifyDatabaseFile(destination);
    const restored = new DatabaseSync(destination, { readOnly: true });
    assert.equal(restored.prepare('SELECT value FROM backup_marker').get()?.value, 'snapshot-value');
    restored.close();

    const previous = new DatabaseSync(safetySnapshot!, { readOnly: true });
    assert.equal(previous.prepare('SELECT value FROM backup_marker').get()?.value, 'previous-value');
    previous.close();
  } catch (error) {
    operationError = error;
    throw error;
  } finally {
    try {
      rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch (cleanupError) {
      if (!operationError) throw cleanupError;
      console.error('Temporary SQLite backup test cleanup failed after the operation error.', cleanupError);
    }
  }
});

test('SQLite backup verification rejects a non-Tinix or corrupt database', () => {
  const directory = mkdtempSync(join(tmpdir(), 'tinix-inbox-backup-invalid-'));
  const invalid = join(directory, 'invalid.db');
  try {
    writeFileSync(invalid, 'not a sqlite database');
    assert.throws(() => verifyDatabaseFile(invalid));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
