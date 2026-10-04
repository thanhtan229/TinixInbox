-- Tinix Inbox V2 Database Schema (SQLite)

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

CREATE TABLE IF NOT EXISTS external_contact_links (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  channel_connection_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  external_user_id TEXT NOT NULL,
  chatwoot_account_id INTEGER NOT NULL,
  chatwoot_contact_id INTEGER NOT NULL,
  chatwoot_contact_inbox_id INTEGER,
  chatwoot_source_id TEXT NOT NULL,
  customer_identity_id TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(workspace_id, channel_connection_id, external_user_id)
);

CREATE TABLE IF NOT EXISTS conversation_links (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  channel_connection_id TEXT NOT NULL,
  external_conversation_id TEXT,
  tinix_thread_key TEXT NOT NULL,
  chatwoot_account_id INTEGER NOT NULL,
  chatwoot_inbox_id INTEGER NOT NULL,
  chatwoot_contact_inbox_id INTEGER,
  chatwoot_conversation_ref TEXT NOT NULL,
  chatwoot_conversation_display_id INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'open',
  provider_last_message_at TEXT,
  last_reconciled_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(workspace_id, channel_connection_id, tinix_thread_key)
);

CREATE TABLE IF NOT EXISTS message_links (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  channel_connection_id TEXT NOT NULL,
  conversation_link_id TEXT NOT NULL,
  direction TEXT NOT NULL,
  origin TEXT NOT NULL,
  external_message_id TEXT,
  provider_message_id TEXT,
  chatwoot_account_id INTEGER NOT NULL,
  chatwoot_message_id INTEGER NOT NULL,
  outbox_id TEXT,
  delivery_state TEXT NOT NULL DEFAULT 'queued',
  provider_sent_at TEXT,
  provider_accepted_at TEXT,
  delivered_at TEXT,
  read_at TEXT,
  failed_at TEXT,
  correlation_id TEXT NOT NULL,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(chatwoot_account_id, chatwoot_message_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_inbound_unique ON message_links(workspace_id, channel_connection_id, external_message_id)
  WHERE external_message_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS inbound_message_claims (
  workspace_id TEXT NOT NULL,
  channel_connection_id TEXT NOT NULL,
  external_message_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('processing', 'processed', 'unknown')),
  claimed_at TEXT NOT NULL,
  completed_at TEXT,
  last_error TEXT,
  PRIMARY KEY(workspace_id, channel_connection_id, external_message_id)
);

CREATE TABLE IF NOT EXISTS chatwoot_callback_events (
  id TEXT PRIMARY KEY,
  chatwoot_account_id INTEGER NOT NULL,
  chatwoot_inbox_id INTEGER,
  delivery_id TEXT,
  event_type TEXT NOT NULL,
  chatwoot_message_id INTEGER,
  chatwoot_conversation_id INTEGER,
  signature_valid INTEGER NOT NULL DEFAULT 0,
  timestamp_valid INTEGER NOT NULL DEFAULT 0,
  payload_hash TEXT NOT NULL,
  raw_payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'received',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  correlation_id TEXT NOT NULL,
  received_at TEXT NOT NULL,
  processed_at TEXT,
  last_error TEXT
);

CREATE TABLE IF NOT EXISTS provider_webhook_events (
  id TEXT PRIMARY KEY,
  workspace_id TEXT,
  provider TEXT NOT NULL,
  channel_connection_id TEXT,
  provider_event_id TEXT,
  signature_valid INTEGER NOT NULL DEFAULT 0,
  payload_hash TEXT NOT NULL,
  raw_payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'received',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  correlation_id TEXT NOT NULL,
  received_at TEXT NOT NULL,
  processed_at TEXT,
  last_error TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_provider_webhook_dedupe
  ON provider_webhook_events(channel_connection_id, payload_hash)
  WHERE channel_connection_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS outbox_messages (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  channel_connection_id TEXT NOT NULL,
  conversation_link_id TEXT NOT NULL,
  chatwoot_account_id INTEGER NOT NULL,
  chatwoot_message_id INTEGER NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  payload_snapshot TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  provider_message_id TEXT,
  provider_response_ref TEXT,
  correlation_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  claimed_at TEXT,
  sent_at TEXT,
  last_error TEXT,
  UNIQUE(chatwoot_account_id, chatwoot_message_id)
);

CREATE TABLE IF NOT EXISTS conversation_ai_state (
  workspace_id TEXT NOT NULL,
  conversation_provider TEXT NOT NULL,
  provider_conversation_id TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'ai',
  version INTEGER NOT NULL DEFAULT 1,
  pause_reason TEXT,
  human_owner_id TEXT,
  last_ai_message_at TEXT,
  last_human_message_at TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(workspace_id, conversation_provider, provider_conversation_id)
);

CREATE TABLE IF NOT EXISTS reconciliation_cursors (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  source TEXT NOT NULL,
  scope_type TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  watermark TEXT,
  overlap_window INTEGER NOT NULL DEFAULT 300,
  last_started_at TEXT,
  last_success_at TEXT,
  last_error TEXT,
  UNIQUE(workspace_id, source, scope_type, scope_id)
);

CREATE TABLE IF NOT EXISTS send_operations (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, conversation_link_id TEXT NOT NULL,
  origin TEXT NOT NULL, ai_version INTEGER, fingerprint TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'processing', result TEXT, created_at TEXT NOT NULL
);
