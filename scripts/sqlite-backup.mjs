import { resolve } from 'node:path';
import { createDatabaseSnapshot, restoreDatabaseSnapshot } from '../src/persistence/sqlite-backup.ts';

const command = process.argv[2];
const dbPath = resolve(process.env.DB_PATH || 'data/tinix_inbox.db');

try {
  if (command === 'backup') {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const destination = resolve(process.argv[3] || `backups/tinix_inbox_${timestamp}.db`);
    createDatabaseSnapshot(dbPath, destination);
    console.log(JSON.stringify({ status: 'PASS', operation: 'backup', database: destination }));
  } else if (command === 'restore') {
    const backupPath = process.argv[3];
    const destination = resolve(process.argv[4] || dbPath);
    if (!backupPath) throw new Error('Usage: sqlite-backup.mjs restore <backup.db> [destination.db]');
    const previousSnapshot = restoreDatabaseSnapshot(resolve(backupPath), destination);
    console.log(JSON.stringify({ status: 'PASS', operation: 'restore', database: destination, previousSnapshot }));
  } else {
    throw new Error('Usage: sqlite-backup.mjs backup [destination.db] | restore <backup.db> [destination.db]');
  }
} catch (error) {
  console.error(JSON.stringify({ status: 'FAIL', operation: command || 'unknown', error: error instanceof Error ? error.message : 'Unknown error' }));
  process.exitCode = 1;
}
