import { DatabaseSync } from 'node:sqlite';
import { copyFileSync, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

const REQUIRED_TABLES = ['channel_connections', 'conversation_links', 'message_links', 'outbox_messages'];

export function verifyDatabaseFile(path: string): void {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const integrity = db.prepare('PRAGMA integrity_check').get() as Record<string, unknown> | undefined;
    if (integrity?.integrity_check !== 'ok') throw new Error('SQLite integrity check failed');
    const tables = new Set(
      (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map((row) => row.name)
    );
    const missing = REQUIRED_TABLES.filter((table) => !tables.has(table));
    if (missing.length) throw new Error(`Database is missing required Tinix tables: ${missing.join(', ')}`);
  } finally {
    db.close();
  }
}

export function createDatabaseSnapshot(sourcePath: string, destinationPath: string): void {
  const source = resolve(sourcePath);
  const destination = resolve(destinationPath);
  if (source === destination) throw new Error('Backup destination must differ from the source database');
  if (!existsSync(source)) throw new Error('Source database does not exist');
  if (existsSync(destination)) throw new Error('Backup destination already exists');

  mkdirSync(dirname(destination), { recursive: true });
  const db = new DatabaseSync(source);
  try {
    const integrity = db.prepare('PRAGMA integrity_check').get() as Record<string, unknown> | undefined;
    if (integrity?.integrity_check !== 'ok') throw new Error('Source database integrity check failed');
    db.prepare('VACUUM INTO ?').run(destination);
  } finally {
    db.close();
  }
  verifyDatabaseFile(destination);
}

export function restoreDatabaseSnapshot(backupPath: string, destinationPath: string): string | undefined {
  const backup = resolve(backupPath);
  const destination = resolve(destinationPath);
  if (!existsSync(backup)) throw new Error('Backup database does not exist');
  if (backup === destination) throw new Error('Restore source and destination must differ');
  verifyDatabaseFile(backup);

  mkdirSync(dirname(destination), { recursive: true });
  const stagedPath = `${destination}.restore-${randomUUID()}.tmp`;
  const suffix = new Date().toISOString().replace(/[:.]/g, '-');
  const previousSnapshotPath = existsSync(destination)
    ? resolve(dirname(destination), `${basename(destination, '.db')}.pre-restore-${suffix}.db`)
    : undefined;
  const previousRawPath = previousSnapshotPath ? `${previousSnapshotPath}.source` : undefined;
  const sidecars = ['-wal', '-shm'];
  const movedSidecars: Array<{ original: string; moved: string }> = [];
  let previousMoved = false;

  try {
    copyFileSync(backup, stagedPath);
    verifyDatabaseFile(stagedPath);
    if (destination !== resolve(stagedPath)) {
      const resolvedStage = resolve(stagedPath);
      if (resolvedStage === destination) throw new Error('Invalid staged restore path');
    }

    if (existsSync(destination) && previousSnapshotPath && previousRawPath) {
      createDatabaseSnapshot(destination, previousSnapshotPath);
      renameSync(destination, previousRawPath);
      previousMoved = true;
      for (const sidecar of sidecars) {
        const original = `${destination}${sidecar}`;
        if (!existsSync(original)) continue;
        const moved = `${previousRawPath}${sidecar}`;
        renameSync(original, moved);
        movedSidecars.push({ original, moved });
      }
    }

    renameSync(stagedPath, destination);
    verifyDatabaseFile(destination);
    return previousSnapshotPath;
  } catch (error) {
    rmSync(stagedPath, { force: true });
    if (previousMoved && previousRawPath) {
      rmSync(destination, { force: true });
      renameSync(previousRawPath, destination);
      for (const sidecar of movedSidecars) {
        if (existsSync(sidecar.moved)) renameSync(sidecar.moved, sidecar.original);
      }
    }
    throw error;
  }
}
