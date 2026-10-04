import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENV } from '../config/env.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let instance: DatabaseSync | null = null;

export function getDatabase(customPath?: string): DatabaseSync {
  if (instance && !customPath) {
    return instance;
  }

  const dbPath = customPath || ENV.DB_PATH;
  if (dbPath !== ':memory:') {
    mkdirSync(dirname(dbPath), { recursive: true });
  }

  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');

  const schemaPath = join(__dirname, 'schema.sql');
  const schemaSql = readFileSync(schemaPath, 'utf8');
  db.exec(schemaSql);
  const webhookColumns = db.prepare('PRAGMA table_info(provider_webhook_events)').all() as Array<{ name: string }>;
  if (!webhookColumns.some((column) => column.name === 'next_attempt_at')) {
    db.exec('ALTER TABLE provider_webhook_events ADD COLUMN next_attempt_at TEXT');
  }
  const connectionColumns = db.prepare('PRAGMA table_info(channel_connections)').all() as Array<{ name: string }>;
  if (!connectionColumns.some((column) => column.name === 'disabled_previous_status')) {
    db.exec('ALTER TABLE channel_connections ADD COLUMN disabled_previous_status TEXT');
  }

  if (!customPath) {
    instance = db;
  }
  return db;
}

export function closeDatabase(): void {
  if (instance) {
    try {
      instance.close();
    } catch {
      // ignore
    }
    instance = null;
  }
}
