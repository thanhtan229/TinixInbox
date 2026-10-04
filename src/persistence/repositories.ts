import { DatabaseSync } from 'node:sqlite';
import type {
  AIMode,
  ChannelConnection,
  ConversationAIState,
  ConversationLink,
  DeliveryState,
  ExternalContactLink,
  MessageLink,
  OutboxMessage,
  OutboxState,
} from '../core/types.ts';
import { CredentialVault } from './credential-vault.ts';

export class ChannelConnectionRepository {
  private db: DatabaseSync;
  private vault: CredentialVault;

  constructor(db: DatabaseSync, vault = new CredentialVault()) {
    this.db = db;
    this.vault = vault;
    this.migrateLegacySecrets();
  }

  private migrateLegacySecrets(): void {
    const rows = this.db.prepare(`SELECT id, credentials_encrypted, chatwoot_callback_secret_ref
      FROM channel_connections`).all() as Array<Record<string, unknown>>;
    const update = this.db.prepare(`UPDATE channel_connections
      SET credentials_encrypted = ?, chatwoot_callback_secret_ref = ? WHERE id = ?`);
    for (const row of rows) {
      const credentials = String(row.credentials_encrypted ?? '');
      const callbackSecret = row.chatwoot_callback_secret_ref == null ? null : String(row.chatwoot_callback_secret_ref);
      const encryptedCredentials = this.vault.encrypt(credentials)!;
      const encryptedCallbackSecret = this.vault.encrypt(callbackSecret);
      if (encryptedCredentials !== credentials || encryptedCallbackSecret !== callbackSecret) {
        update.run(encryptedCredentials, encryptedCallbackSecret, String(row.id));
      }
    }
  }

  public create(conn: ChannelConnection): void {
    const stmt = this.db.prepare(`
      INSERT INTO channel_connections (
        id, workspace_id, provider, display_name, external_account_id,
        status, credentials_encrypted, credential_version, scopes, metadata,
        chatwoot_account_id, chatwoot_inbox_id, chatwoot_api_channel_identifier,
        chatwoot_callback_secret_ref, created_at, updated_at, last_verified_at,
        last_successful_event_at, last_error
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
    `);
    stmt.run(
      conn.id,
      conn.workspaceId,
      conn.provider,
      conn.displayName,
      conn.externalAccountId,
      conn.status,
      this.vault.encrypt(conn.credentialsEncrypted),
      conn.credentialVersion,
      JSON.stringify(conn.scopes || []),
      JSON.stringify(conn.metadata || {}),
      conn.chatwootAccountId ?? null,
      conn.chatwootInboxId ?? null,
      conn.chatwootApiChannelIdentifier ?? null,
      this.vault.encrypt(conn.chatwootCallbackSecretRef),
      conn.createdAt,
      conn.updatedAt,
      conn.lastVerifiedAt ?? null,
      conn.lastSuccessfulEventAt ?? null,
      conn.lastError ?? null
    );
  }

  public findById(id: string): ChannelConnection | null {
    const stmt = this.db.prepare('SELECT * FROM channel_connections WHERE id = ?');
    const row = stmt.get(id) as Record<string, unknown> | undefined;
    return row ? this.mapRow(row) : null;
  }

  public findByChatwootInbox(chatwootAccountId: number, chatwootInboxId: number): ChannelConnection | null {
    const stmt = this.db.prepare(`
      SELECT * FROM channel_connections
      WHERE chatwoot_account_id = ? AND chatwoot_inbox_id = ?
    `);
    const row = stmt.get(chatwootAccountId, chatwootInboxId) as Record<string, unknown> | undefined;
    return row ? this.mapRow(row) : null;
  }

  public findForConversation(workspaceId: string, conversationDisplayId: number): ChannelConnection | null {
    const row = this.db.prepare(`
      SELECT cc.* FROM channel_connections cc
      JOIN conversation_links cl
        ON cl.channel_connection_id = cc.id
       AND cl.workspace_id = cc.workspace_id
      WHERE cl.workspace_id = ? AND cl.chatwoot_conversation_display_id = ?
      LIMIT 1
    `).get(workspaceId, conversationDisplayId) as Record<string, unknown> | undefined;
    return row ? this.mapRow(row) : null;
  }

  public listByWorkspace(workspaceId: string): ChannelConnection[] {
    const stmt = this.db.prepare('SELECT * FROM channel_connections WHERE workspace_id = ?');
    const rows = stmt.all(workspaceId) as Array<Record<string, unknown>>;
    return rows.map((r) => this.mapRow(r));
  }

  public findByProviderAndExternalAccountId(
    workspaceId: string,
    provider: string,
    externalAccountId: string
  ): ChannelConnection | null {
    const stmt = this.db.prepare(`
      SELECT * FROM channel_connections
      WHERE workspace_id = ? AND provider = ? AND external_account_id = ?
      LIMIT 1
    `);
    const row = stmt.get(workspaceId, provider, externalAccountId) as Record<string, unknown> | undefined;
    return row ? this.mapRow(row) : null;
  }

  public listByProvider(workspaceId: string, provider: string): ChannelConnection[] {
    const stmt = this.db.prepare(`
      SELECT * FROM channel_connections
      WHERE workspace_id = ? AND provider = ?
    `);
    const rows = stmt.all(workspaceId, provider) as Array<Record<string, unknown>>;
    return rows.map((r) => this.mapRow(r));
  }

  public deleteConnection(workspaceId: string, id: string): boolean {
    const result = this.db.prepare(`
      UPDATE channel_connections SET status = 'disconnected', disabled_previous_status = NULL
      WHERE workspace_id = ? AND id = ?
    `).run(workspaceId, id);
    return (result.changes ?? 0) > 0;
  }

  public setEnabled(workspaceId: string, id: string, enabled: boolean): ChannelConnection | null {
    const now = new Date().toISOString();
    if (enabled) {
      this.db.prepare(`
        UPDATE channel_connections
        SET status = COALESCE(disabled_previous_status, 'pending'),
            disabled_previous_status = NULL,
            updated_at = ?
        WHERE id = ? AND workspace_id = ? AND status = 'disabled'
      `).run(now, id, workspaceId);
    } else {
      this.db.prepare(`
        UPDATE channel_connections
        SET disabled_previous_status = CASE
              WHEN status = 'disabled' THEN COALESCE(disabled_previous_status, 'pending')
              ELSE status
            END,
            status = 'disabled',
            updated_at = ?
        WHERE id = ? AND workspace_id = ? AND status != 'disconnected'
      `).run(now, id, workspaceId);
    }
    const row = this.db.prepare('SELECT * FROM channel_connections WHERE id = ? AND workspace_id = ?')
      .get(id, workspaceId) as Record<string, unknown> | undefined;
    return row ? this.mapRow(row) : null;
  }

  public updateStatus(id: string, status: ChannelConnection['status'], lastVerifiedAt?: string): void {
    this.db.prepare(`
      UPDATE channel_connections
      SET status = ?, last_verified_at = COALESCE(?, last_verified_at), updated_at = ?
      WHERE id = ?
    `).run(status, lastVerifiedAt ?? null, new Date().toISOString(), id);
  }

  public updateConnection(id: string, updates: Partial<ChannelConnection>): void {
    const fields: string[] = [];
    const values: unknown[] = [];

    if (updates.displayName !== undefined) {
      fields.push('display_name = ?');
      values.push(updates.displayName);
    }
    if (updates.externalAccountId !== undefined) {
      fields.push('external_account_id = ?');
      values.push(updates.externalAccountId);
    }
    if (updates.status !== undefined) {
      fields.push('status = ?');
      values.push(updates.status);
    }
    if (updates.credentialsEncrypted !== undefined) {
      fields.push('credentials_encrypted = ?');
      values.push(this.vault.encrypt(updates.credentialsEncrypted));
    }
    if (updates.chatwootAccountId !== undefined) {
      fields.push('chatwoot_account_id = ?');
      values.push(updates.chatwootAccountId);
    }
    if (updates.chatwootInboxId !== undefined) {
      fields.push('chatwoot_inbox_id = ?');
      values.push(updates.chatwootInboxId);
    }
    if (updates.chatwootApiChannelIdentifier !== undefined) {
      fields.push('chatwoot_api_channel_identifier = ?');
      values.push(updates.chatwootApiChannelIdentifier);
    }
    if (updates.chatwootCallbackSecretRef !== undefined) {
      fields.push('chatwoot_callback_secret_ref = ?');
      values.push(this.vault.encrypt(updates.chatwootCallbackSecretRef));
    }
    if (updates.lastVerifiedAt !== undefined) {
      fields.push('last_verified_at = ?');
      values.push(updates.lastVerifiedAt);
    }

    if (fields.length === 0) return;

    fields.push('updated_at = ?');
    values.push(new Date().toISOString());

    values.push(id);
    const sqlValues = values.map((v) => (v === undefined ? null : (v as string | number | bigint | Uint8Array | null)));
    this.db.prepare(`UPDATE channel_connections SET ${fields.join(', ')} WHERE id = ?`).run(...sqlValues);
  }

  private mapRow(row: Record<string, unknown>): ChannelConnection {
    return {
      id: String(row.id),
      workspaceId: String(row.workspace_id),
      provider: String(row.provider),
      displayName: String(row.display_name),
      externalAccountId: String(row.external_account_id),
      status: row.status as ChannelConnection['status'],
      credentialsEncrypted: this.vault.decrypt(String(row.credentials_encrypted))!,
      credentialVersion: Number(row.credential_version),
      scopes: JSON.parse(String(row.scopes || '[]')),
      metadata: JSON.parse(String(row.metadata || '{}')),
      chatwootAccountId: row.chatwoot_account_id ? Number(row.chatwoot_account_id) : undefined,
      chatwootInboxId: row.chatwoot_inbox_id ? Number(row.chatwoot_inbox_id) : undefined,
      chatwootApiChannelIdentifier: row.chatwoot_api_channel_identifier ? String(row.chatwoot_api_channel_identifier) : undefined,
      chatwootCallbackSecretRef: this.vault.decrypt(row.chatwoot_callback_secret_ref ? String(row.chatwoot_callback_secret_ref) : null) ?? undefined,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      lastVerifiedAt: row.last_verified_at ? String(row.last_verified_at) : undefined,
      lastSuccessfulEventAt: row.last_successful_event_at ? String(row.last_successful_event_at) : undefined,
      lastError: row.last_error ? String(row.last_error) : undefined,
    };
  }
}

export class ContactLinkRepository {
  private db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  public create(link: ExternalContactLink): void {
    const stmt = this.db.prepare(`
      INSERT INTO external_contact_links (
        id, workspace_id, channel_connection_id, provider, external_user_id,
        chatwoot_account_id, chatwoot_contact_id, chatwoot_contact_inbox_id,
        chatwoot_source_id, customer_identity_id, metadata, created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
    `);
    stmt.run(
      link.id,
      link.workspaceId,
      link.channelConnectionId,
      link.provider,
      link.externalUserId,
      link.chatwootAccountId,
      link.chatwootContactId,
      link.chatwootContactInboxId ?? null,
      link.chatwootSourceId,
      link.customerIdentityId ?? null,
      JSON.stringify(link.metadata || {}),
      link.createdAt,
      link.updatedAt
    );
  }

  public findByExternalUser(
    workspaceId: string,
    channelConnectionId: string,
    externalUserId: string
  ): ExternalContactLink | null {
    const stmt = this.db.prepare(`
      SELECT * FROM external_contact_links
      WHERE workspace_id = ? AND channel_connection_id = ? AND external_user_id = ?
    `);
    const row = stmt.get(workspaceId, channelConnectionId, externalUserId) as Record<string, unknown> | undefined;
    return row ? this.mapRow(row) : null;
  }

  private mapRow(row: Record<string, unknown>): ExternalContactLink {
    return {
      id: String(row.id),
      workspaceId: String(row.workspace_id),
      channelConnectionId: String(row.channel_connection_id),
      provider: String(row.provider),
      externalUserId: String(row.external_user_id),
      chatwootAccountId: Number(row.chatwoot_account_id),
      chatwootContactId: Number(row.chatwoot_contact_id),
      chatwootContactInboxId: row.chatwoot_contact_inbox_id ? Number(row.chatwoot_contact_inbox_id) : undefined,
      chatwootSourceId: String(row.chatwoot_source_id),
      customerIdentityId: row.customer_identity_id ? String(row.customer_identity_id) : undefined,
      metadata: JSON.parse(String(row.metadata || '{}')),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }
}

export class ConversationLinkRepository {
  private db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  public create(conv: ConversationLink): void {
    const stmt = this.db.prepare(`
      INSERT INTO conversation_links (
        id, workspace_id, channel_connection_id, external_conversation_id,
        tinix_thread_key, chatwoot_account_id, chatwoot_inbox_id,
        chatwoot_contact_inbox_id, chatwoot_conversation_ref,
        chatwoot_conversation_display_id, state, provider_last_message_at,
        last_reconciled_at, created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
    `);
    stmt.run(
      conv.id,
      conv.workspaceId,
      conv.channelConnectionId,
      conv.externalConversationId ?? null,
      conv.tinixThreadKey,
      conv.chatwootAccountId,
      conv.chatwootInboxId,
      conv.chatwootContactInboxId ?? null,
      conv.chatwootConversationRef,
      conv.chatwootConversationDisplayId,
      conv.state,
      conv.providerLastMessageAt ?? null,
      conv.lastReconciledAt ?? null,
      conv.createdAt,
      conv.updatedAt
    );
  }

  public findByThreadKey(
    workspaceId: string,
    channelConnectionId: string,
    tinixThreadKey: string
  ): ConversationLink | null {
    const stmt = this.db.prepare(`
      SELECT * FROM conversation_links
      WHERE workspace_id = ? AND channel_connection_id = ? AND tinix_thread_key = ?
    `);
    const row = stmt.get(workspaceId, channelConnectionId, tinixThreadKey) as Record<string, unknown> | undefined;
    return row ? this.mapRow(row) : null;
  }

  public findByChatwootDisplayId(
    chatwootAccountId: number,
    displayId: number
  ): ConversationLink | null {
    const stmt = this.db.prepare(`
      SELECT * FROM conversation_links
      WHERE chatwoot_account_id = ? AND chatwoot_conversation_display_id = ?
    `);
    const row = stmt.get(chatwootAccountId, displayId) as Record<string, unknown> | undefined;
    return row ? this.mapRow(row) : null;
  }

  public listByWorkspace(workspaceId: string): ConversationLink[] {
    const stmt = this.db.prepare('SELECT * FROM conversation_links WHERE workspace_id = ? ORDER BY updated_at DESC');
    const rows = stmt.all(workspaceId) as Array<Record<string, unknown>>;
    return rows.map((r) => this.mapRow(r));
  }

  public findById(id: string): ConversationLink | null {
    const stmt = this.db.prepare('SELECT * FROM conversation_links WHERE id = ?');
    const row = stmt.get(id) as Record<string, unknown> | undefined;
    return row ? this.mapRow(row) : null;
  }

  public updateState(id: string, state: ConversationLink['state']): void {
    this.db.prepare('UPDATE conversation_links SET state = ?, updated_at = ? WHERE id = ?')
      .run(state, new Date().toISOString(), id);
  }

  private mapRow(row: Record<string, unknown>): ConversationLink {
    return {
      id: String(row.id),
      workspaceId: String(row.workspace_id),
      channelConnectionId: String(row.channel_connection_id),
      externalConversationId: row.external_conversation_id ? String(row.external_conversation_id) : undefined,
      tinixThreadKey: String(row.tinix_thread_key),
      chatwootAccountId: Number(row.chatwoot_account_id),
      chatwootInboxId: Number(row.chatwoot_inbox_id),
      chatwootContactInboxId: row.chatwoot_contact_inbox_id ? Number(row.chatwoot_contact_inbox_id) : undefined,
      chatwootConversationRef: String(row.chatwoot_conversation_ref),
      chatwootConversationDisplayId: Number(row.chatwoot_conversation_display_id),
      state: row.state as ConversationLink['state'],
      providerLastMessageAt: row.provider_last_message_at ? String(row.provider_last_message_at) : undefined,
      lastReconciledAt: row.last_reconciled_at ? String(row.last_reconciled_at) : undefined,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }
}

export class MessageLinkRepository {
  private db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  public transaction<T>(operation: () => T): T {
    this.db.exec('SAVEPOINT message_projection');
    try {
      const result = operation();
      this.db.exec('RELEASE message_projection');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK TO message_projection');
      this.db.exec('RELEASE message_projection');
      throw error;
    }
  }

  public claimInboundMessage(workspaceId: string, channelConnectionId: string, externalMessageId: string): 'claimed' | 'processing' | 'processed' | 'unknown' {
    const result = this.db.prepare(`
      INSERT OR IGNORE INTO inbound_message_claims (
        workspace_id, channel_connection_id, external_message_id, status, claimed_at
      ) VALUES (?, ?, ?, 'processing', ?)
    `).run(workspaceId, channelConnectionId, externalMessageId, new Date().toISOString());
    if (Number(result.changes) === 1) return 'claimed';
    const row = this.db.prepare(`SELECT status FROM inbound_message_claims
      WHERE workspace_id = ? AND channel_connection_id = ? AND external_message_id = ?`)
      .get(workspaceId, channelConnectionId, externalMessageId) as { status: string } | undefined;
    if (row?.status === 'processing' || row?.status === 'processed' || row?.status === 'unknown') return row.status;
    throw new Error('Inbound message claim could not be read after insert conflict');
  }

  public completeInboundMessage(workspaceId: string, channelConnectionId: string, externalMessageId: string): void {
    this.db.prepare(`UPDATE inbound_message_claims SET status = 'processed', completed_at = ?, last_error = NULL
      WHERE workspace_id = ? AND channel_connection_id = ? AND external_message_id = ? AND status IN ('processing', 'unknown')`)
      .run(new Date().toISOString(), workspaceId, channelConnectionId, externalMessageId);
  }

  public beginSendOperation(id: string, workspaceId: string, conversationLinkId: string, origin: string,
    fingerprint: string, aiVersion?: number): boolean {
    return Number(this.db.prepare(`INSERT OR IGNORE INTO send_operations
      (id, workspace_id, conversation_link_id, origin, ai_version, fingerprint, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(id, workspaceId, conversationLinkId, origin, aiVersion ?? null,
        fingerprint, new Date().toISOString()).changes) === 1;
  }

  public getSendOperation(id: string): { workspace_id: string; conversation_link_id: string; origin: string;
    ai_version: number | null; fingerprint: string; state: string; result: string | null } | undefined {
    return this.db.prepare('SELECT * FROM send_operations WHERE id = ?').get(id) as ReturnType<MessageLinkRepository['getSendOperation']>;
  }

  public finishSendOperation(id: string, result: unknown): void {
    this.db.prepare("UPDATE send_operations SET state = 'complete', result = ? WHERE id = ?")
      .run(JSON.stringify(result), id);
  }

  public reconciliationWindow(workspaceId: string, scopeId: string, initialBaseline = new Date().toISOString()): { watermark: number; baseline: number } {
    const now = initialBaseline;
    this.db.prepare(`INSERT OR IGNORE INTO reconciliation_cursors
      (id, workspace_id, source, scope_type, scope_id, watermark, last_started_at)
      VALUES (?, ?, 'chatwoot', 'conversation', ?, ?, ?)`).run(`${workspaceId}:${scopeId}`, workspaceId, scopeId, now, now);
    const row = this.db.prepare(`SELECT watermark, last_started_at FROM reconciliation_cursors
      WHERE workspace_id = ? AND source = 'chatwoot' AND scope_type = 'conversation' AND scope_id = ?`)
      .get(workspaceId, scopeId) as { watermark: string; last_started_at: string };
    return { watermark: Date.parse(row.watermark), baseline: Date.parse(row.last_started_at) };
  }

  public advanceReconciliationWindow(workspaceId: string, scopeId: string, watermark: string): void {
    this.db.prepare(`UPDATE reconciliation_cursors SET watermark = ?, last_success_at = ?, last_error = NULL
      WHERE workspace_id = ? AND source = 'chatwoot' AND scope_type = 'conversation' AND scope_id = ?`)
      .run(watermark, new Date().toISOString(), workspaceId, scopeId);
  }

  public releaseInboundMessage(workspaceId: string, channelConnectionId: string, externalMessageId: string): void {
    this.db.prepare(`DELETE FROM inbound_message_claims WHERE workspace_id = ? AND channel_connection_id = ?
      AND external_message_id = ? AND status = 'processing'`).run(workspaceId, channelConnectionId, externalMessageId);
  }

  public markInboundOutcomeUnknown(workspaceId: string, channelConnectionId: string, externalMessageId: string, error: string): void {
    this.db.prepare(`UPDATE inbound_message_claims SET status = 'unknown', completed_at = ?, last_error = ?
      WHERE workspace_id = ? AND channel_connection_id = ? AND external_message_id = ? AND status = 'processing'`)
      .run(new Date().toISOString(), error.slice(0, 1000), workspaceId, channelConnectionId, externalMessageId);
  }

  public recoverInterruptedInboundMessages(): number {
    const result = this.db.prepare(`UPDATE inbound_message_claims SET status = 'unknown', completed_at = ?,
      last_error = 'Tinix restarted while ConversationProvider outcome was unresolved'
      WHERE status = 'processing'`).run(new Date().toISOString());
    return Number(result.changes);
  }

  public listUnknownInboundMessages(workspaceId: string, limit = 100): Array<Record<string, unknown>> {
    return this.db.prepare(`SELECT workspace_id, channel_connection_id, external_message_id,
      status, claimed_at, completed_at FROM inbound_message_claims
      WHERE workspace_id = ? AND status = 'unknown'
      ORDER BY completed_at ASC LIMIT ?`).all(workspaceId, Math.max(1, Math.min(limit, 500))) as Array<Record<string, unknown>>;
  }

  public create(msg: MessageLink): void {
    const stmt = this.db.prepare(`
      INSERT INTO message_links (
        id, workspace_id, channel_connection_id, conversation_link_id,
        direction, origin, external_message_id, provider_message_id,
        chatwoot_account_id, chatwoot_message_id, outbox_id, delivery_state,
        provider_sent_at, provider_accepted_at, delivered_at, read_at,
        failed_at, correlation_id, metadata, created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
    `);
    stmt.run(
      msg.id,
      msg.workspaceId,
      msg.channelConnectionId,
      msg.conversationLinkId,
      msg.direction,
      msg.origin,
      msg.externalMessageId ?? null,
      msg.providerMessageId ?? null,
      msg.chatwootAccountId,
      msg.chatwootMessageId,
      msg.outboxId ?? null,
      msg.deliveryState,
      msg.providerSentAt ?? null,
      msg.providerAcceptedAt ?? null,
      msg.deliveredAt ?? null,
      msg.readAt ?? null,
      msg.failedAt ?? null,
      msg.correlationId,
      JSON.stringify(msg.metadata || {}),
      msg.createdAt,
      msg.updatedAt
    );
  }

  public recordAiOutgoing(msg: MessageLink): void {
    if (msg.direction !== 'outgoing') throw new Error('AI message projection must be outgoing');

    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO message_links (
        id, workspace_id, channel_connection_id, conversation_link_id,
        direction, origin, external_message_id, provider_message_id,
        chatwoot_account_id, chatwoot_message_id, outbox_id, delivery_state,
        provider_sent_at, provider_accepted_at, delivered_at, read_at,
        failed_at, correlation_id, metadata, created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
    `);
    stmt.run(
      msg.id,
      msg.workspaceId,
      msg.channelConnectionId,
      msg.conversationLinkId,
      msg.direction,
      'ai',
      msg.externalMessageId ?? null,
      msg.providerMessageId ?? null,
      msg.chatwootAccountId,
      msg.chatwootMessageId,
      null,
      msg.deliveryState,
      msg.providerSentAt ?? null,
      msg.providerAcceptedAt ?? null,
      msg.deliveredAt ?? null,
      msg.readAt ?? null,
      msg.failedAt ?? null,
      msg.correlationId,
      JSON.stringify(msg.metadata || {}),
      msg.createdAt,
      msg.updatedAt
    );

    // Chatwoot can callback before this projection is written. Merge AI provenance
    // into that row while preserving its real outbox link and delivery state.
    const existing = this.findByChatwootMessageId(msg.chatwootAccountId, msg.chatwootMessageId);
    if (!existing
      || existing.workspaceId !== msg.workspaceId
      || existing.channelConnectionId !== msg.channelConnectionId
      || existing.conversationLinkId !== msg.conversationLinkId
      || existing.direction !== 'outgoing') {
      throw new Error('AI message conflicts with an existing Tinix message mapping');
    }
    const metadata = JSON.stringify({ ...existing.metadata, ...msg.metadata });
    this.db.prepare(`
      UPDATE message_links
      SET origin = 'ai', metadata = ?, updated_at = ?
      WHERE id = ?
    `).run(metadata, new Date().toISOString(), existing.id);
  }

  public findByExternalMessageId(
    workspaceId: string,
    channelConnectionId: string,
    externalMessageId: string
  ): MessageLink | null {
    const stmt = this.db.prepare(`
      SELECT * FROM message_links
      WHERE workspace_id = ? AND channel_connection_id = ? AND external_message_id = ?
    `);
    const row = stmt.get(workspaceId, channelConnectionId, externalMessageId) as Record<string, unknown> | undefined;
    return row ? this.mapRow(row) : null;
  }

  public findByChatwootMessageId(
    chatwootAccountId: number,
    chatwootMessageId: number
  ): MessageLink | null {
    const stmt = this.db.prepare(`
      SELECT * FROM message_links
      WHERE chatwoot_account_id = ? AND chatwoot_message_id = ?
    `);
    const row = stmt.get(chatwootAccountId, chatwootMessageId) as Record<string, unknown> | undefined;
    return row ? this.mapRow(row) : null;
  }

  public listByConversation(conversationLinkId: string): MessageLink[] {
    const stmt = this.db.prepare(`
      SELECT * FROM message_links
      WHERE conversation_link_id = ?
      ORDER BY created_at ASC
    `);
    const rows = stmt.all(conversationLinkId) as Array<Record<string, unknown>>;
    return rows.map((r) => this.mapRow(r));
  }

  public updateDeliveryState(id: string, deliveryState: DeliveryState, timestamps: Record<string, string> = {}): void {
    const sets = ['delivery_state = ?', 'updated_at = ?'];
    const values: Array<string | number | null> = [deliveryState, new Date().toISOString()];

    if (timestamps.providerAcceptedAt) {
      sets.push('provider_accepted_at = ?');
      values.push(timestamps.providerAcceptedAt);
    }
    if (timestamps.deliveredAt) {
      sets.push('delivered_at = ?');
      values.push(timestamps.deliveredAt);
    }
    if (timestamps.readAt) {
      sets.push('read_at = ?');
      values.push(timestamps.readAt);
    }
    if (timestamps.failedAt) {
      sets.push('failed_at = ?');
      values.push(timestamps.failedAt);
    }

    values.push(id);
    const stmt = this.db.prepare(`UPDATE message_links SET ${sets.join(', ')} WHERE id = ?`);
    stmt.run(...values);
  }

  public attachOutbox(
    messageLinkId: string,
    outboxId: string,
    workspaceId: string,
    channelConnectionId: string
  ): boolean {
    const result = this.db.prepare(`
      UPDATE message_links
      SET outbox_id = ?, updated_at = ?
      WHERE id = ? AND workspace_id = ? AND channel_connection_id = ? AND direction = 'outgoing'
    `).run(outboxId, new Date().toISOString(), messageLinkId, workspaceId, channelConnectionId);
    return Number(result.changes) === 1;
  }

  private mapRow(row: Record<string, unknown>): MessageLink {
    return {
      id: String(row.id),
      workspaceId: String(row.workspace_id),
      channelConnectionId: String(row.channel_connection_id),
      conversationLinkId: String(row.conversation_link_id),
      direction: row.direction as MessageLink['direction'],
      origin: row.origin as MessageLink['origin'],
      externalMessageId: row.external_message_id ? String(row.external_message_id) : undefined,
      providerMessageId: row.provider_message_id ? String(row.provider_message_id) : undefined,
      chatwootAccountId: Number(row.chatwoot_account_id),
      chatwootMessageId: Number(row.chatwoot_message_id),
      outboxId: row.outbox_id ? String(row.outbox_id) : undefined,
      deliveryState: row.delivery_state as DeliveryState,
      providerSentAt: row.provider_sent_at ? String(row.provider_sent_at) : undefined,
      providerAcceptedAt: row.provider_accepted_at ? String(row.provider_accepted_at) : undefined,
      deliveredAt: row.delivered_at ? String(row.delivered_at) : undefined,
      readAt: row.read_at ? String(row.read_at) : undefined,
      failedAt: row.failed_at ? String(row.failed_at) : undefined,
      correlationId: String(row.correlation_id),
      metadata: JSON.parse(String(row.metadata || '{}')),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }
}

export class OutboxRepository {
  private db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  public create(outbox: OutboxMessage): void {
    const stmt = this.db.prepare(`
      INSERT INTO outbox_messages (
        id, workspace_id, channel_connection_id, conversation_link_id,
        chatwoot_account_id, chatwoot_message_id, idempotency_key,
        payload_snapshot, state, attempt_count, next_attempt_at,
        provider_message_id, provider_response_ref, correlation_id,
        created_at, claimed_at, sent_at, last_error
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
    `);
    stmt.run(
      outbox.id,
      outbox.workspaceId,
      outbox.channelConnectionId,
      outbox.conversationLinkId,
      outbox.chatwootAccountId,
      outbox.chatwootMessageId,
      outbox.idempotencyKey,
      outbox.payloadSnapshot,
      outbox.state,
      outbox.attemptCount,
      outbox.nextAttemptAt ?? null,
      outbox.providerMessageId ?? null,
      outbox.providerResponseRef ?? null,
      outbox.correlationId,
      outbox.createdAt,
      outbox.claimedAt ?? null,
      outbox.sentAt ?? null,
      outbox.lastError ?? null
    );
  }

  public findByIdempotencyKey(key: string): OutboxMessage | null {
    const stmt = this.db.prepare('SELECT * FROM outbox_messages WHERE idempotency_key = ?');
    const row = stmt.get(key) as Record<string, unknown> | undefined;
    return row ? this.mapRow(row) : null;
  }

  public findByChatwootMessageId(chatwootAccountId: number, chatwootMessageId: number): OutboxMessage | null {
    const stmt = this.db.prepare(`
      SELECT * FROM outbox_messages
      WHERE chatwoot_account_id = ? AND chatwoot_message_id = ?
    `);
    const row = stmt.get(chatwootAccountId, chatwootMessageId) as Record<string, unknown> | undefined;
    return row ? this.mapRow(row) : null;
  }

  public listPending(limit = 50): OutboxMessage[] {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      SELECT * FROM outbox_messages
      WHERE state IN ('pending', 'retry_wait')
        AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
        AND EXISTS (SELECT 1 FROM channel_connections c WHERE c.id = outbox_messages.channel_connection_id
          AND c.workspace_id = outbox_messages.workspace_id AND c.status IN ('connected', 'degraded'))
      ORDER BY created_at ASC
      LIMIT ?
    `);
    const rows = stmt.all(now, limit) as Array<Record<string, unknown>>;
    return rows.map((r) => this.mapRow(r));
  }

  public findById(id: string): OutboxMessage | null {
    const row = this.db.prepare('SELECT * FROM outbox_messages WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.mapRow(row) : null;
  }

  public countRowsByState(): Record<string, number> {
    const rows = this.db.prepare(`SELECT state, COUNT(*) AS count
      FROM outbox_messages GROUP BY state`).all() as Array<{ state: string; count: number }>;
    return Object.fromEntries(rows.map((row) => [row.state, Number(row.count)]));
  }

  public claimForSend(id: string): boolean {
    const now = new Date().toISOString();
    const result = this.db.prepare(`
      UPDATE outbox_messages
      SET state = 'sending', claimed_at = ?
      WHERE id = ? AND state IN ('pending', 'retry_wait')
        AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
    `).run(now, id, now);
    return Number(result.changes) === 1;
  }

  public releaseSendClaim(id: string): boolean {
    const result = this.db.prepare(`
      UPDATE outbox_messages
      SET state = 'pending', claimed_at = NULL
      WHERE id = ? AND state = 'sending'
    `).run(id);
    return Number(result.changes) === 1;
  }

  public listSending(): OutboxMessage[] {
    const rows = this.db.prepare("SELECT * FROM outbox_messages WHERE state = 'sending'").all() as Array<Record<string, unknown>>;
    return rows.map((row) => this.mapRow(row));
  }

  public markUnknown(id: string, error: string): void {
    this.db.prepare(`
      UPDATE outbox_messages
      SET state = 'unknown', attempt_count = attempt_count + 1, last_error = ?
      WHERE id = ? AND state = 'sending'
    `).run(error, id);
  }

  public markSent(id: string, providerMessageId: string): void {
    const stmt = this.db.prepare(`
      UPDATE outbox_messages
      SET state = 'provider_accepted', provider_message_id = ?, sent_at = ?
      WHERE id = ?
    `);
    stmt.run(providerMessageId, new Date().toISOString(), id);
  }

  public markFailed(id: string, error: string, nextAttemptAt?: string, isDeadLetter = false, permanent = false): void {
    const stmt = this.db.prepare(`
      UPDATE outbox_messages
      SET state = ?, attempt_count = attempt_count + 1, last_error = ?, next_attempt_at = ?
      WHERE id = ? AND state = 'sending'
    `);
    stmt.run(permanent ? 'failed' : (isDeadLetter ? 'dead_letter' : 'retry_wait'), error, nextAttemptAt ?? null, id);
  }

  public resetForRetry(id: string): boolean {
    const stmt = this.db.prepare(`
      UPDATE outbox_messages
      SET state = 'pending', attempt_count = 0, next_attempt_at = NULL, last_error = NULL
      WHERE id = ? AND state = 'dead_letter'
    `);
    return Number(stmt.run(id).changes) === 1;
  }

  public redriveAllDeadLetter(): number {
    const stmt = this.db.prepare(`
      UPDATE outbox_messages
      SET state = 'pending', attempt_count = 0, next_attempt_at = NULL, last_error = NULL
      WHERE state = 'dead_letter'
    `);
    const info = stmt.run();
    return Number(info.changes);
  }

  public listByState(state: OutboxState, workspaceId = 'default-workspace', limit = 50): OutboxMessage[] {
    const stmt = this.db.prepare(`
      SELECT * FROM outbox_messages
      WHERE state = ? AND workspace_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `);
    const rows = stmt.all(state, workspaceId, limit) as Array<Record<string, unknown>>;
    return rows.map((r) => this.mapRow(r));
  }

  private mapRow(row: Record<string, unknown>): OutboxMessage {
    return {
      id: String(row.id),
      workspaceId: String(row.workspace_id),
      channelConnectionId: String(row.channel_connection_id),
      conversationLinkId: String(row.conversation_link_id),
      chatwootAccountId: Number(row.chatwoot_account_id),
      chatwootMessageId: Number(row.chatwoot_message_id),
      idempotencyKey: String(row.idempotency_key),
      payloadSnapshot: String(row.payload_snapshot),
      state: row.state as OutboxState,
      attemptCount: Number(row.attempt_count),
      nextAttemptAt: row.next_attempt_at ? String(row.next_attempt_at) : undefined,
      providerMessageId: row.provider_message_id ? String(row.provider_message_id) : undefined,
      providerResponseRef: row.provider_response_ref ? String(row.provider_response_ref) : undefined,
      correlationId: String(row.correlation_id),
      createdAt: String(row.created_at),
      claimedAt: row.claimed_at ? String(row.claimed_at) : undefined,
      sentAt: row.sent_at ? String(row.sent_at) : undefined,
      lastError: row.last_error ? String(row.last_error) : undefined,
    };
  }
}

export class CallbackEventRepository {
  private db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  public recordEvent(record: {
    id: string;
    chatwootAccountId: number;
    chatwootInboxId?: number;
    deliveryId?: string;
    eventType: string;
    chatwootMessageId?: number;
    chatwootConversationId?: number;
    signatureValid: boolean;
    timestampValid: boolean;
    payloadHash: string;
    rawPayload: string;
    status: string;
    correlationId: string;
    receivedAt: string;
  }): void {
    const stmt = this.db.prepare(`
      INSERT INTO chatwoot_callback_events (
        id, chatwoot_account_id, chatwoot_inbox_id, delivery_id, event_type,
        chatwoot_message_id, chatwoot_conversation_id, signature_valid,
        timestamp_valid, payload_hash, raw_payload, status, correlation_id,
        received_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
    `);
    stmt.run(
      record.id,
      record.chatwootAccountId,
      record.chatwootInboxId ?? null,
      record.deliveryId ?? null,
      record.eventType,
      record.chatwootMessageId ?? null,
      record.chatwootConversationId ?? null,
      record.signatureValid ? 1 : 0,
      record.timestampValid ? 1 : 0,
      record.payloadHash,
      record.rawPayload,
      record.status,
      record.correlationId,
      record.receivedAt
    );
  }
}

export class ProviderWebhookEventRepository {
  private db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  public recordEvent(event: {
    id: string;
    workspaceId: string;
    provider: string;
    channelConnectionId: string;
    providerEventId: string;
    payloadHash: string;
    rawPayload: string;
    correlationId: string;
    receivedAt: string;
  }): boolean {
    const result = this.db.prepare(`
      INSERT OR IGNORE INTO provider_webhook_events (
        id, workspace_id, provider, channel_connection_id, provider_event_id,
        signature_valid, payload_hash, raw_payload, status, attempt_count,
        correlation_id, received_at
      ) VALUES (?, ?, ?, ?, ?, 1, ?, ?, 'received', 0, ?, ?)
    `).run(
      event.id, event.workspaceId, event.provider, event.channelConnectionId,
      event.providerEventId, event.payloadHash, event.rawPayload, event.correlationId, event.receivedAt
    );
    return Number(result.changes) === 1;
  }

  public claimReceived(limit = 20): Array<Record<string, unknown>> {
    const rows = this.db.prepare(`
      SELECT * FROM provider_webhook_events
      WHERE status = 'received' OR (status = 'retry_wait' AND (next_attempt_at IS NULL OR next_attempt_at <= ?))
      ORDER BY received_at ASC LIMIT ?
    `).all(new Date().toISOString(), limit) as Array<Record<string, unknown>>;
    return rows.filter((row) => {
      const result = this.db.prepare(`
        UPDATE provider_webhook_events SET status = 'processing', attempt_count = attempt_count + 1
        WHERE id = ? AND (status = 'received' OR (status = 'retry_wait' AND (next_attempt_at IS NULL OR next_attempt_at <= ?)))
      `).run(String(row.id), new Date().toISOString());
      return Number(result.changes) === 1;
    });
  }

  public markProcessed(id: string): void {
    this.db.prepare(`
      UPDATE provider_webhook_events SET status = 'processed', processed_at = ?, last_error = NULL
      WHERE id = ? AND status = 'processing'
    `).run(new Date().toISOString(), id);
  }

  public markFailed(id: string, error: string, retryable: boolean): 'retry_wait' | 'dead_letter' | 'failed' {
    const row = this.db.prepare('SELECT attempt_count FROM provider_webhook_events WHERE id = ? AND status = \'processing\'')
      .get(id) as { attempt_count?: number } | undefined;
    if (!row) return 'failed';
    const attempts = Number(row.attempt_count || 0);
    const status = retryable ? (attempts >= 5 ? 'dead_letter' : 'retry_wait') : 'failed';
    let nextAttemptAt: string | null = null;
    if (status === 'retry_wait') {
      const baseMs = Math.min(60_000, 1_000 * 2 ** Math.max(0, attempts - 1));
      const jitterMs = Math.floor(Math.random() * Math.max(1, Math.floor(baseMs / 5)));
      nextAttemptAt = new Date(Date.now() + baseMs + jitterMs).toISOString();
    }
    this.db.prepare(`
      UPDATE provider_webhook_events SET status = ?, last_error = ?, next_attempt_at = ?
      WHERE id = ? AND status = 'processing'
    `).run(status, error.slice(0, 1000), nextAttemptAt, id);
    return status;
  }

  public recoverInterrupted(): number {
    const result = this.db.prepare(`
      UPDATE provider_webhook_events SET status = 'received'
      WHERE status = 'processing'
    `).run();
    return Number(result.changes);
  }
}

export class AIStateRepository {
  private db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  public getState(workspaceId: string, providerConversationId: string): ConversationAIState | null {
    const stmt = this.db.prepare(`
      SELECT * FROM conversation_ai_state
      WHERE workspace_id = ? AND provider_conversation_id = ?
    `);
    const row = stmt.get(workspaceId, providerConversationId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      workspaceId: String(row.workspace_id),
      conversationProvider: String(row.conversation_provider),
      providerConversationId: String(row.provider_conversation_id),
      mode: row.mode as AIMode,
      version: Number(row.version),
      pauseReason: row.pause_reason ? String(row.pause_reason) : undefined,
      humanOwnerId: row.human_owner_id ? String(row.human_owner_id) : undefined,
      lastAiMessageAt: row.last_ai_message_at ? String(row.last_ai_message_at) : undefined,
      lastHumanMessageAt: row.last_human_message_at ? String(row.last_human_message_at) : undefined,
      updatedAt: String(row.updated_at),
    };
  }

  public setMode(
    workspaceId: string,
    conversationProvider: string,
    providerConversationId: string,
    mode: AIMode,
    expectedVersion?: number,
    options: { pauseReason?: string; humanOwnerId?: string } = {}
  ): boolean {
    const now = new Date().toISOString();
    if (expectedVersion !== undefined) {
      const stmt = this.db.prepare(`
        UPDATE conversation_ai_state
        SET mode = ?, version = version + 1, pause_reason = ?, human_owner_id = ?, updated_at = ?
        WHERE workspace_id = ? AND provider_conversation_id = ? AND version = ?
      `);
      const res = stmt.run(mode, options.pauseReason ?? null, options.humanOwnerId ?? null, now, workspaceId, providerConversationId, expectedVersion);
      return res.changes > 0;
    }

    const stmt = this.db.prepare(`
      INSERT INTO conversation_ai_state (
        workspace_id, conversation_provider, provider_conversation_id,
        mode, version, pause_reason, human_owner_id, updated_at
      ) VALUES (?, ?, ?, ?, 1, ?, ?, ?)
      ON CONFLICT(workspace_id, conversation_provider, provider_conversation_id) DO UPDATE SET
        mode = excluded.mode,
        version = version + 1,
        pause_reason = excluded.pause_reason,
        human_owner_id = excluded.human_owner_id,
        updated_at = excluded.updated_at
    `);
    stmt.run(workspaceId, conversationProvider, providerConversationId, mode, options.pauseReason ?? null, options.humanOwnerId ?? null, now);
    return true;
  }
}
