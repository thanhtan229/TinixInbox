import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';

// Simple .env parser to load local environment if present
const envPath = join(process.cwd(), '.env');
if (existsSync(envPath)) {
  try {
    const content = readFileSync(envPath, 'utf8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx > 0) {
        const key = trimmed.slice(0, eqIdx).trim();
        const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  } catch {
    // ignore .env read errors
  }
}

export const ENV = {
  PORT: Number(process.env.PORT || 3182),
  HOST: process.env.HOST || '127.0.0.1',
  NODE_ENV: process.env.NODE_ENV || 'development',
  DATA_DIR: process.env.DATA_DIR || join(process.cwd(), 'data'),
  DB_PATH: process.env.DB_PATH || join(process.cwd(), 'data', 'tinix_inbox.db'),

  // Chatwoot V1 defaults. Credentials must be provided by the local environment.
  CHATWOOT_BASE_URL: process.env.CHATWOOT_BASE_URL || 'http://127.0.0.1:3180',
  CHATWOOT_API_TOKEN: process.env.CHATWOOT_API_TOKEN || '',
  CHATWOOT_ACCOUNT_ID: Number(process.env.CHATWOOT_ACCOUNT_ID || 1),
  CHATWOOT_CALLBACK_URL: process.env.CHATWOOT_CALLBACK_URL || '',
  META_APP_ID: process.env.META_APP_ID || '',
  META_APP_SECRET: process.env.META_APP_SECRET || '',
  META_SECRET_ROTATED: process.env.META_SECRET_ROTATED === 'true',
  META_WEBHOOK_VERIFY_TOKEN: process.env.META_WEBHOOK_VERIFY_TOKEN || '',
  META_GRAPH_API_VERSION: process.env.META_GRAPH_API_VERSION || 'v21.0',

  // Webhook / Callback settings
  CALLBACK_TIMESTAMP_TOLERANCE_SECONDS: Number(process.env.CALLBACK_TIMESTAMP_TOLERANCE_SECONDS || 300),

  // Gemini AI settings
  GEMINI_API_KEY: process.env.GEMINI_API_KEY || '',
  GEMINI_MODEL: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
  BUSINESS_TOOLS_DEMO_MODE: process.env.NODE_ENV !== 'production' && process.env.BUSINESS_TOOLS_DEMO_MODE === 'true',
  N8N_WEBHOOK_BASE_URL: process.env.N8N_WEBHOOK_BASE_URL || '',
  N8N_WEBHOOK_AUTH_TOKEN: process.env.N8N_WEBHOOK_AUTH_TOKEN || '',
  // Operator authentication
  TINIX_OPERATOR_TOKEN: process.env.TINIX_OPERATOR_TOKEN || '',
};

export function assertSafeRuntimeHost(nodeEnv: string, host: string, operatorToken = ENV.TINIX_OPERATOR_TOKEN): void {
  if (nodeEnv !== 'production') return;

  const normalized = host.trim().toLowerCase().replace(/^\[|\]$/g, '');
  const isIpv4Loopback = /^127(?:\.\d{1,3}){3}$/.test(normalized)
    && normalized.split('.').every((part) => Number(part) <= 255);
  if (!isIpv4Loopback && normalized !== '::1') {
    if (!operatorToken || operatorToken.trim().length < 16) {
      throw new Error('Tinix Inbox has no built-in authentication/RBAC; production HOST must remain loopback until operator authorization is implemented.');
    }
  }
}
