import { createHash, randomUUID } from 'node:crypto';
import type { ConversationProvider } from '../core/conversation-provider.ts';
import type { ChannelConnection, ConversationLink } from '../core/types.ts';
import { HandoffPolicy } from '../agent/handoff-policy.ts';
import {
  AIStateRepository,
  ChannelConnectionRepository,
  ConversationLinkRepository,
  MessageLinkRepository,
  OutboxRepository,
} from '../persistence/repositories.ts';
import { ReconciliationService } from '../services/reconciliation-service.ts';
import type { OutboxService } from '../services/outbox-service.ts';
import { ProviderPermanentError } from '../core/errors.ts';
import { ENV } from '../config/env.ts';
import { MetaConnectionClient } from '../channels/meta/meta-connection.ts';
import { channelEnabled, FeatureFlagManager } from '../config/feature-flags.ts';

export class InboxController {
  private connectionRepo: ChannelConnectionRepository;
  private conversationRepo: ConversationLinkRepository;
  private messageRepo: MessageLinkRepository;
  private conversationProvider: ConversationProvider;
  private handoffPolicy: HandoffPolicy;
  private aiStateRepo: AIStateRepository;
  private reconciliationService: ReconciliationService;
  private outboxRepo?: OutboxRepository;
  private outboxService?: OutboxService;
  private eventBus?: import('./event-bus.ts').InboxEventBus;
  private aiConfigured: boolean;

  constructor(
    connectionRepo: ChannelConnectionRepository,
    conversationRepo: ConversationLinkRepository,
    messageRepo: MessageLinkRepository,
    conversationProvider: ConversationProvider,
    handoffPolicy: HandoffPolicy,
    aiStateRepo: AIStateRepository,
    reconciliationService: ReconciliationService,
    outboxRepo?: OutboxRepository,
    outboxService?: OutboxService,
    eventBus?: import('./event-bus.ts').InboxEventBus,
    aiConfigured = false
  ) {
    this.connectionRepo = connectionRepo;
    this.conversationRepo = conversationRepo;
    this.messageRepo = messageRepo;
    this.conversationProvider = conversationProvider;
    this.handoffPolicy = handoffPolicy;
    this.aiStateRepo = aiStateRepo;
    this.reconciliationService = reconciliationService;
    this.outboxRepo = outboxRepo;
    this.outboxService = outboxService;
    this.eventBus = eventBus;
    this.aiConfigured = aiConfigured;
  }

  public setEventBus(eventBus: import('./event-bus.ts').InboxEventBus): void {
    this.eventBus = eventBus;
  }


  public getHealth(): Record<string, unknown> {
    return {
      status: 'ok',
      service: 'tinix-inbox',
      version: '1.0.0',
      aiConfigured: this.aiConfigured && FeatureFlagManager.getInstance().isEnabled('tinix_inbox_ai_enabled'),
      timestamp: new Date().toISOString(),
    };
  }

  public getPrometheusMetrics(): string {
    const counts = this.outboxRepo?.countRowsByState() || {};
    const states = ['pending', 'sending', 'provider_accepted', 'retry_wait', 'unknown', 'failed', 'dead_letter'];
    const lines = [
      '# HELP tinix_inbox_outbox_messages Number of durable outbox rows by delivery state.',
      '# TYPE tinix_inbox_outbox_messages gauge',
    ];
    for (const state of states) {
      lines.push(`tinix_inbox_outbox_messages{state="${state}"} ${counts[state] || 0}`);
    }
    return `${lines.join('\n')}\n`;
  }

  public getUnknownInboundMessages(workspaceId = 'default-workspace'): Array<Record<string, unknown>> {
    return this.messageRepo.listUnknownInboundMessages(workspaceId).map((row) => ({
      workspaceId: String(row.workspace_id),
      channelConnectionId: String(row.channel_connection_id),
      externalMessageId: String(row.external_message_id),
      status: String(row.status),
      claimedAt: String(row.claimed_at),
      completedAt: row.completed_at ? String(row.completed_at) : undefined,
    }));
  }

  public getUnknownOutboxMessages(workspaceId = 'default-workspace'): Array<Record<string, unknown>> {
    return (this.outboxRepo?.listByState('unknown', workspaceId) || []).map((row) => ({
      id: row.id,
      workspaceId: row.workspaceId,
      channelConnectionId: row.channelConnectionId,
      chatwootMessageId: row.chatwootMessageId,
      state: row.state,
      attemptCount: row.attemptCount,
      lastError: row.lastError,
      createdAt: row.createdAt,
    }));
  }

  public getDeadLetterOutboxMessages(workspaceId = 'default-workspace'): Array<Record<string, unknown>> {
    return (this.outboxRepo?.listByState('dead_letter', workspaceId) || []).map((row) => ({
      id: row.id,
      workspaceId: row.workspaceId,
      channelConnectionId: row.channelConnectionId,
      chatwootMessageId: row.chatwootMessageId,
      state: row.state,
      attemptCount: row.attemptCount,
      lastError: row.lastError,
      createdAt: row.createdAt,
    }));
  }

  public getConnections(workspaceId = 'default-workspace'): Array<Omit<ChannelConnection, 'credentialsEncrypted' | 'chatwootCallbackSecretRef'>> {
    return this.connectionRepo.listByWorkspace(workspaceId).map((connection) => this.publicConnection(connection));
  }

  public createConnection(data: Partial<ChannelConnection>): Omit<ChannelConnection, 'credentialsEncrypted' | 'chatwootCallbackSecretRef'> {
    if (!data.credentialsEncrypted?.trim()) {
      throw new Error('Connection credentials are required');
    }
    const id = data.id || `conn-${randomUUID().slice(0, 8)}`;
    const conn: ChannelConnection = {
      id,
      workspaceId: data.workspaceId || 'default-workspace',
      provider: data.provider || 'synthetic',
      displayName: data.displayName || 'New Channel',
      externalAccountId: data.externalAccountId || `acc-${randomUUID().slice(0, 8)}`,
      status: 'pending',
      credentialsEncrypted: data.credentialsEncrypted,
      credentialVersion: 1,
      scopes: data.scopes || ['messages', 'webhooks'],
      metadata: data.metadata || {},
      chatwootAccountId: data.chatwootAccountId,
      chatwootInboxId: data.chatwootInboxId,
      chatwootCallbackSecretRef: data.chatwootCallbackSecretRef,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.connectionRepo.create(conn);
    return this.publicConnection(conn);
  }

  public setConnectionEnabled(connectionId: string, enabled: boolean): Omit<ChannelConnection, 'credentialsEncrypted' | 'chatwootCallbackSecretRef'> {
    const connection = this.connectionRepo.setEnabled('default-workspace', connectionId, enabled);
    if (!connection) throw new Error('Channel connection not found');
    return this.publicConnection(connection);
  }

  private publicConnection(connection: ChannelConnection): Omit<ChannelConnection, 'credentialsEncrypted' | 'chatwootCallbackSecretRef'> {
    return {
      id: connection.id,
      workspaceId: connection.workspaceId,
      provider: connection.provider,
      displayName: connection.displayName,
      externalAccountId: connection.externalAccountId,
      status: connection.status,
      credentialVersion: connection.credentialVersion,
      scopes: connection.scopes,
      metadata: {},
      chatwootAccountId: connection.chatwootAccountId,
      chatwootInboxId: connection.chatwootInboxId,
      chatwootApiChannelIdentifier: connection.chatwootApiChannelIdentifier,
      createdAt: connection.createdAt,
      updatedAt: connection.updatedAt,
      lastVerifiedAt: connection.lastVerifiedAt,
      lastSuccessfulEventAt: connection.lastSuccessfulEventAt,
      lastError: connection.lastError,
    };
  }

  public async getConversations(workspaceId = 'default-workspace'): Promise<Array<Record<string, unknown>>> {
    const links = this.conversationRepo.listByWorkspace(workspaceId);
    const summaries = links.map((link) => {
      const messages = this.messageRepo.listByConversation(link.id);
      const lastMsg = messages[messages.length - 1];
      const aiDecision = this.handoffPolicy.checkCanAIReply(workspaceId, String(link.chatwootConversationDisplayId));
      const conn = this.connectionRepo.findById(link.channelConnectionId);

      return {
        id: link.id,
        displayId: link.chatwootConversationDisplayId,
        threadKey: link.tinixThreadKey,
        provider: conn?.provider || 'unknown',
        channelName: conn?.displayName || 'Channel',
        connectionStatus: conn?.status || 'unknown',
        state: link.state,
        aiMode: aiDecision.mode,
        lastMessage: lastMsg ? {
          direction: lastMsg.direction,
          deliveryState: lastMsg.deliveryState,
          createdAt: lastMsg.createdAt,
        } : null,
        updatedAt: link.updatedAt,
      };
    });

    let assignees = new Map<string, import('../core/conversation-provider.ts').ConversationListProjection>();
    if (links.length && this.conversationProvider.listConversationSummaries) {
      try {
        assignees = await this.conversationProvider.listConversationSummaries({
          workspaceId,
          conversations: links.map((link) => ({
            conversationLinkId: link.id,
            channelConnectionId: link.channelConnectionId,
            conversationDisplayId: link.chatwootConversationDisplayId,
          })),
        });
      } catch (error) {
        console.warn('[Inbox] Conversation assignee projection is unavailable', {
          workspaceId,
          errorName: error instanceof Error ? error.name : 'UnknownError',
        });
      }
    }

    return summaries.map((summary) => {
      const linkId = String(summary.id);
      const projection = assignees.get(linkId);
      return projection ? { ...summary, ...projection } : summary;
    });
  }

  public async getMessages(conversationLinkId: string, before?: number): Promise<Array<Record<string, unknown>>> {
    const conv = this.conversationRepo.findById(conversationLinkId);
    if (!conv) {
      return [];
    }

    const localMessages = this.messageRepo.listByConversation(conv.id);
    const providerPage = await this.conversationProvider.listMessages({
      workspaceId: conv.workspaceId,
      conversationDisplayId: conv.chatwootConversationDisplayId,
      before,
    });

    // Merge delivery state from local message_links into provider messages
    return providerPage.messages.map((pMsg) => {
      const match = localMessages.find((l) => l.chatwootMessageId === pMsg.messageId);
      return {
        id: pMsg.messageId,
        content: pMsg.content,
        direction: pMsg.direction,
        isPrivate: pMsg.isPrivate,
        createdAt: pMsg.createdAt,
        attachments: (pMsg.attachments || []).map((attachment, index) => ({
          type: attachment.type,
          mimeType: attachment.mimeType,
          fileName: attachment.fileName,
          sizeBytes: attachment.sizeBytes,
          url: `/api/conversations/${encodeURIComponent(conv.id)}/messages/${pMsg.messageId}/attachments/${index}`,
        })),
        deliveryState: match?.deliveryState || (pMsg.direction === 'incoming' ? 'delivered' : 'unknown'),
      };
    });
  }

  public async downloadMessageAttachment(
    conversationLinkId: string,
    messageId: number,
    attachmentIndex: number
  ) {
    const conv = this.conversationRepo.findById(conversationLinkId);
    if (!conv) throw new Error('Conversation not found');
    return this.conversationProvider.downloadMessageAttachment({
      workspaceId: conv.workspaceId,
      conversationDisplayId: conv.chatwootConversationDisplayId,
      messageId,
      attachmentIndex,
    });
  }

  public async sendMessage(
    conversationLinkId: string,
    content: string,
    isPrivate = false,
    operationId: string = randomUUID()
  ): Promise<Record<string, unknown>> {
    const conv = this.conversationRepo.findById(conversationLinkId);
    if (!conv) {
      throw new Error('Conversation not found');
    }

    const connection = this.connectionRepo.findById(conv.channelConnectionId);
    if (!isPrivate && (!connection || !channelEnabled(connection.provider) || !['connected', 'degraded'].includes(connection.status))) {
      throw new ProviderPermanentError('Channel connection is disabled', {
        safeMessage: 'Kênh đang tạm dừng. Hãy bật lại kênh trước khi gửi tin nhắn cho khách.',
      });
    }

    if (!content.trim() || content.length > 20000 || !/^[a-zA-Z0-9_-]{8,100}$/.test(operationId)) {
      throw new ProviderPermanentError('Invalid message content or operation ID');
    }
    const fingerprint = createHash('sha256').update(JSON.stringify({ content, isPrivate })).digest('hex');
    if (!this.messageRepo.beginSendOperation(operationId, conv.workspaceId, conv.id, 'human', fingerprint)) {
      const operation = this.messageRepo.getSendOperation(operationId);
      if (operation?.workspace_id !== conv.workspaceId || operation.conversation_link_id !== conv.id || operation.fingerprint !== fingerprint) {
        throw new ProviderPermanentError('Operation ID belongs to a different request');
      }
      if (operation.state === 'complete' && operation.result) return JSON.parse(operation.result);
      throw new ProviderPermanentError('Message outcome is unresolved; do not send it again', {
        safeMessage: 'Lượt gửi đang xử lý hoặc cần đối soát. Không gửi lại với mã mới để tránh trùng tin nhắn.',
      });
    }
    let msgRef;
    if (isPrivate) {
      msgRef = await this.conversationProvider.addPrivateNote({
        workspaceId: conv.workspaceId,
        conversationDisplayId: conv.chatwootConversationDisplayId,
        content,
        operationId,
      });
    } else {
      this.handoffPolicy.takeOverByHuman(conv.workspaceId, this.conversationProvider.providerName,
        String(conv.chatwootConversationDisplayId), 'tinix-operator');
      msgRef = await this.conversationProvider.createOutgoingMessage({
        workspaceId: conv.workspaceId,
        channelConnectionId: conv.channelConnectionId,
        conversationId: conv.chatwootConversationDisplayId,
        text: content,
        isPrivate: false,
        operationId,
      });
    }

    const result = { messageId: msgRef.messageId, content: msgRef.content, isPrivate: msgRef.isPrivate,
      direction: msgRef.direction, status: msgRef.status };
    this.messageRepo.finishSendOperation(operationId, result);
    if (this.eventBus) {
      this.eventBus.broadcast('message_created', {
        conversationLinkId: conv.id,
        conversationDisplayId: conv.chatwootConversationDisplayId,
        messageId: msgRef.messageId,
        content: msgRef.content,
        isPrivate: msgRef.isPrivate,
        direction: 'outgoing',
        deliveryState: msgRef.isPrivate ? 'internal_note' : 'queued',
        createdAt: new Date().toISOString(),
      });
    }

    return result;
  }

  public takeoverConversation(conversationLinkId: string, humanOwnerId = 'agent-1'): void {
    const conv = this.conversationRepo.findById(conversationLinkId);
    if (!conv) throw new Error('Conversation not found');

    this.handoffPolicy.takeOverByHuman(
      conv.workspaceId,
      'chatwoot',
      String(conv.chatwootConversationDisplayId),
      humanOwnerId
    );

    if (this.eventBus) {
      this.eventBus.broadcast('handoff_updated', {
        conversationLinkId: conv.id,
        conversationDisplayId: conv.chatwootConversationDisplayId,
        mode: 'human',
        ownerId: humanOwnerId,
      });
    }
  }

  public async updateConversationStatus(
    conversationLinkId: string,
    status: ConversationLink['state']
  ): Promise<void> {
    const conv = this.conversationRepo.findById(conversationLinkId);
    if (!conv) throw new Error('Conversation not found');

    await this.conversationProvider.updateSupportState({
      workspaceId: conv.workspaceId,
      conversationDisplayId: conv.chatwootConversationDisplayId,
      status,
    });
    this.conversationRepo.updateState(conv.id, status);
  }

  public async getConversationAssignment(conversationLinkId: string) {
    const conv = this.conversationRepo.findById(conversationLinkId);
    if (!conv) throw new Error('Conversation not found');
    return this.conversationProvider.getAssignment({
      workspaceId: conv.workspaceId,
      conversationDisplayId: conv.chatwootConversationDisplayId,
    });
  }

  public async assignConversation(conversationLinkId: string, agentId: number) {
    const conv = this.conversationRepo.findById(conversationLinkId);
    if (!conv) throw new Error('Conversation not found');
    const assignmentInput = {
      workspaceId: conv.workspaceId,
      conversationDisplayId: conv.chatwootConversationDisplayId,
    };
    const current = await this.conversationProvider.getAssignment(assignmentInput);
    if (!current.agents.some((agent) => agent.id === agentId)) {
      throw new ProviderPermanentError('Selected agent is not a member of this conversation inbox', {
        safeMessage: 'Nhân viên này không thuộc hộp thư của cuộc hội thoại.',
      });
    }
    await this.conversationProvider.assignConversation({ ...assignmentInput, agentId });
    return this.conversationProvider.getAssignment(assignmentInput);
  }

  public resumeAI(conversationLinkId: string): void {
    const conv = this.conversationRepo.findById(conversationLinkId);
    if (!conv) throw new Error('Conversation not found');
    if (!this.aiConfigured) {
      throw new ProviderPermanentError('Gemini runtime is not configured', {
        provider: 'gemini',
        safeMessage: 'AI remains paused until a Gemini API key is configured.',
      });
    }

    this.handoffPolicy.resumeAI(
      conv.workspaceId,
      'chatwoot',
      String(conv.chatwootConversationDisplayId)
    );

    if (this.eventBus) {
      this.eventBus.broadcast('handoff_updated', {
        conversationLinkId: conv.id,
        conversationDisplayId: conv.chatwootConversationDisplayId,
        mode: 'ai',
      });
    }
  }

  public async retryMessage(
    chatwootMessageId: number,
    chatwootAccountId = 1
  ): Promise<{ success: boolean; error?: string }> {
    if (!this.outboxRepo || !this.outboxService) {
      return { success: false, error: 'Outbox service not configured' };
    }
    const outbox = this.outboxRepo.findByChatwootMessageId(chatwootAccountId, chatwootMessageId);
    if (!outbox) {
      return { success: false, error: 'Outbox entry not found for message' };
    }
    const success = await this.outboxService.retryOutboxItem(outbox.id);
    return { success };
  }

  public async redriveDeadLetters(): Promise<{ resetCount: number; processed: number; sent: number; failed: number }> {
    if (!this.outboxService) {
      throw new Error('Outbox service not configured');
    }
    return this.outboxService.redriveAllDeadLetter();
  }

  public async triggerReconcile(workspaceId = 'default-workspace'): Promise<Record<string, unknown>> {
    return this.reconciliationService.reconcileWorkspace(workspaceId);
  }

  public async inspectMetaToken(token: string) {
    return new MetaConnectionClient().inspect(token);
  }

  public async connectMetaPage(input: { token: string; displayName?: string; pageId?: string }): Promise<{
    success: boolean; connection?: Omit<ChannelConnection, 'credentialsEncrypted' | 'chatwootCallbackSecretRef'>; error?: string;
  }> {
    const client = new MetaConnectionClient();
    const inspection = await client.inspect(input.token);
    if (!inspection.valid || !inspection.pageId) return { success: false, error: inspection.error };
    if (input.pageId && input.pageId !== inspection.pageId) return { success: false, error: 'Page ID không khớp token.' };
    if (!ENV.CHATWOOT_CALLBACK_URL || !this.conversationProvider.provisionChannel) {
      return { success: false, error: 'Chưa cấu hình callback URL hoặc conversation provider không hỗ trợ tạo kênh.' };
    }
    const pageId = inspection.pageId;
    const workspaceId = 'default-workspace';
    const existing = this.connectionRepo.findByProviderAndExternalAccountId(workspaceId, 'meta', pageId);
    const displayName = input.displayName?.trim() || inspection.pageName || pageId;
    try {
      await client.subscribe(pageId, input.token.trim());
      const binding = await this.conversationProvider.provisionChannel({ accountId: ENV.CHATWOOT_ACCOUNT_ID,
        name: `Tinix Meta ${pageId}`, callbackUrl: ENV.CHATWOOT_CALLBACK_URL, inboxId: existing?.chatwootInboxId });
      const now = new Date().toISOString();
      const updates: Partial<ChannelConnection> = {
        displayName, status: 'connected', credentialsEncrypted: JSON.stringify({ pageId,
          pageAccessToken: input.token.trim(), appSecret: ENV.META_APP_SECRET, webhookVerifyToken: ENV.META_WEBHOOK_VERIFY_TOKEN }),
        chatwootAccountId: ENV.CHATWOOT_ACCOUNT_ID, chatwootInboxId: binding.inboxId,
        chatwootApiChannelIdentifier: binding.identifier, chatwootCallbackSecretRef: binding.callbackSecret, lastVerifiedAt: now,
      };
      if (existing) this.connectionRepo.updateConnection(existing.id, updates);
      else this.connectionRepo.create({ id: `conn-meta-${randomUUID().slice(0, 8)}`, workspaceId, provider: 'meta',
        externalAccountId: pageId, credentialVersion: 1, scopes: inspection.scopes || [], metadata: {},
        createdAt: now, updatedAt: now, ...updates } as ChannelConnection);
      return { success: true, connection: this.publicConnection(this.connectionRepo.findByProviderAndExternalAccountId(workspaceId, 'meta', pageId)!) };
    } catch {
      return { success: false, error: 'Không hoàn tất đăng ký Meta hoặc xác minh API inbox/callback secret. Kết nối chưa được kích hoạt.' };
    }
  }
  public deleteConnection(connectionId: string, workspaceId = 'default-workspace'): { success: boolean; error?: string } {
    const conn = this.connectionRepo.findById(connectionId);
    if (!conn || conn.workspaceId !== workspaceId) {
      return { success: false, error: 'Kết nối không tồn tại' };
    }
    const deleted = this.connectionRepo.deleteConnection(workspaceId, connectionId);
    return { success: deleted };
  }
}
