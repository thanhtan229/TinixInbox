import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, openSync, readFileSync, closeSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ENV } from '../config/env.ts';

const LEGACY_PREFIX = 'enc:v1:';
const PREFIX = 'enc:v2:';

interface VaultConfig {
  activeKeyId: string;
  keys: Map<string, Buffer>;
  legacyKey: Buffer;
}

export interface CredentialVaultOptions {
  activeKeyId: string;
  keys: Record<string, Buffer | string>;
  legacyKey?: Buffer | string;
}

function readKey(value: string, name: string): Buffer {
  if (!/^[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(`${name} must be a 32-byte key encoded as 64 hexadecimal characters`);
  }
  return Buffer.from(value, 'hex');
}

function loadLocalKey(): Buffer {
  const configured = process.env.TINIX_CREDENTIAL_ENCRYPTION_KEY;
  if (configured) return readKey(configured, 'TINIX_CREDENTIAL_ENCRYPTION_KEY');
  if (ENV.NODE_ENV === 'production') {
    throw new Error('TINIX_CREDENTIAL_ENCRYPTION_KEY or TINIX_CREDENTIAL_ENCRYPTION_KEYS is required in production');
  }

  mkdirSync(ENV.DATA_DIR, { recursive: true });
  const keyPath = join(ENV.DATA_DIR, '.credential-key');
  if (!existsSync(keyPath)) {
    const key = randomBytes(32);
    try {
      const fd = openSync(keyPath, 'wx', 0o600);
      try { writeFileSync(fd, key); } finally { closeSync(fd); }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }
  const key = readFileSync(keyPath);
  if (key.length !== 32) throw new Error('Local credential key has an invalid length');
  return key;
}

function loadConfig(): VaultConfig {
  const keys = new Map<string, Buffer>();
  const encodedRing = process.env.TINIX_CREDENTIAL_ENCRYPTION_KEYS;
  if (encodedRing) {
    let parsed: unknown;
    try { parsed = JSON.parse(encodedRing); } catch { throw new Error('TINIX_CREDENTIAL_ENCRYPTION_KEYS must be a JSON object of key IDs to 64-character hexadecimal keys'); }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('TINIX_CREDENTIAL_ENCRYPTION_KEYS must be a JSON object of key IDs to 64-character hexadecimal keys');
    }
    for (const [id, value] of Object.entries(parsed)) {
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(id) || typeof value !== 'string') {
        throw new Error('Credential key ring contains an invalid key ID or value');
      }
      keys.set(id, readKey(value, `TINIX_CREDENTIAL_ENCRYPTION_KEYS[${id}]`));
    }
  }
  const activeKeyId = process.env.TINIX_CREDENTIAL_ENCRYPTION_KEY_ID || 'default';
  const singleKey = process.env.TINIX_CREDENTIAL_ENCRYPTION_KEY;
  let legacyKey: Buffer;
  if (singleKey) {
    legacyKey = readKey(singleKey, 'TINIX_CREDENTIAL_ENCRYPTION_KEY');
  } else if (keys.has('default')) {
    legacyKey = keys.get('default')!;
  } else if (keys.has(activeKeyId)) {
    legacyKey = keys.get(activeKeyId)!;
  } else {
    legacyKey = loadLocalKey();
  }
  if (!keys.has(activeKeyId)) {
    if (encodedRing) throw new Error(`Active credential key '${activeKeyId}' is missing from TINIX_CREDENTIAL_ENCRYPTION_KEYS`);
    keys.set(activeKeyId, legacyKey);
  }
  if (!keys.has('default')) keys.set('default', legacyKey);
  return { activeKeyId, keys, legacyKey };
}

export class CredentialVault {
  private readonly config: VaultConfig;

  constructor(key?: Buffer | CredentialVaultOptions) {
    if (Buffer.isBuffer(key)) {
      if (key.length !== 32) throw new Error('Credential encryption key must be 32 bytes');
      const injected = Buffer.from(key);
      this.config = { activeKeyId: 'default', keys: new Map([['default', injected]]), legacyKey: injected };
    } else if (key) {
      const keys = new Map<string, Buffer>();
      for (const [id, raw] of Object.entries(key.keys)) {
        const value = Buffer.isBuffer(raw) ? Buffer.from(raw) : readKey(raw, `keys.${id}`);
        if (!/^[A-Za-z0-9_-]{1,64}$/.test(id) || value.length !== 32) throw new Error(`Invalid credential key '${id}'`);
        keys.set(id, value);
      }
      const activeKey = keys.get(key.activeKeyId);
      if (!activeKey) throw new Error(`Active credential key '${key.activeKeyId}' is missing`);
      const legacyKey = key.legacyKey
        ? (Buffer.isBuffer(key.legacyKey) ? Buffer.from(key.legacyKey) : readKey(key.legacyKey, 'legacyKey'))
        : keys.get('default') || activeKey;
      if (!keys.has('default')) keys.set('default', legacyKey);
      this.config = { activeKeyId: key.activeKeyId, keys, legacyKey };
    } else {
      this.config = loadConfig();
    }
  }

  encrypt(value: string | null | undefined): string | null {
    if (value == null) return null;
    if (value.startsWith(PREFIX) && value.split(':')[2] === this.config.activeKeyId) {
      this.decrypt(value);
      return value;
    }
    if (value.startsWith(PREFIX) || value.startsWith(LEGACY_PREFIX)) value = this.decrypt(value)!;
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.config.keys.get(this.config.activeKeyId)!, nonce);
    const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return `${PREFIX}${this.config.activeKeyId}:${nonce.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${ciphertext.toString('hex')}`;
  }

  decrypt(value: string | null | undefined): string | null {
    if (value == null) return null;
    if (value.startsWith(LEGACY_PREFIX)) {
      const [nonceHex, tagHex, ciphertextHex] = value.slice(LEGACY_PREFIX.length).split(':');
      return this.decryptParts(this.config.keys.get('default') || this.config.legacyKey, nonceHex, tagHex, ciphertextHex);
    }
    if (!value.startsWith(PREFIX)) return value;
    const [keyId, nonceHex, tagHex, ciphertextHex] = value.slice(PREFIX.length).split(':');
    const key = keyId ? this.config.keys.get(keyId) : undefined;
    if (!key) throw new Error(`Credential encryption key '${keyId || ''}' is not configured`);
    return this.decryptParts(key, nonceHex, tagHex, ciphertextHex);
  }

  private decryptParts(key: Buffer, nonceHex?: string, tagHex?: string, ciphertextHex?: string): string {
    if (!nonceHex || !tagHex || ciphertextHex === undefined) throw new Error('Stored credential ciphertext is malformed');
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(nonceHex, 'hex'));
      decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
      return Buffer.concat([decipher.update(Buffer.from(ciphertextHex, 'hex')), decipher.final()]).toString('utf8');
    } catch {
      throw new Error('Stored credential could not be decrypted with the configured key');
    }
  }
}
