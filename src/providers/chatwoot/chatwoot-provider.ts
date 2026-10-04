import type {
  AssignConversationInput,
  ConversationAssignment,
  ConversationAgent,
  ConversationListSummaryInput,
  ConversationListProjection,
  DownloadMessageAttachmentInput,
  DownloadedMessageAttachment,
  ChannelIdentityRef,
  ConversationProvider,
  ConversationRef,
  EnsureChannelIdentityInput,
  EnsureConversationInput,
  IncomingConversationMessage,
  ListMessagesInput,
  MessagePage,
  MessageRef,
  OutgoingConversationMessage,
  PrivateNoteInput,
  ReconcileConversationInput,
  ReconcileResult,
  UpdateSupportStateInput,
} from '../../core/conversation-provider.ts';
import { AttachmentPreparationError, ConversationProviderError, InboxError } from '../../core/errors.ts';
import { SecureAttachmentFetcher, type AttachmentFetcher, type ImportedAttachment } from '../../services/attachment-fetcher.ts';
import { ChannelConnectionRepository } from '../../persistence/repositories.ts';
import { ChatwootClient } from './chatwoot-client.ts';
import { mapChatwootMessageToRef } from './chatwoot-mapper.ts';

export class ChatwootConversationProvider implements ConversationProvider {
  readonly providerName = 'chatwoot';
  private client: ChatwootClient;
  private connectionRepo: ChannelConnectionRepository;
  private attachmentFetcher?: AttachmentFetcher;
  private conversationListSummaryCache = new Map<string, {
    fetchedAt: number;
    assignments: Map<number, ConversationListProjection>;
    scannedIds: Set<number>;
  }>();

  constructor(
    client: ChatwootClient,
    connectionRepo: ChannelConnectionRepository,
    attachmentFetcher?: AttachmentFetcher
  ) {
    this.client = client;
    this.connectionRepo = connectionRepo;
    this.attachmentFetcher = attachmentFetcher;
  }

  private getConnection(channelConnectionId: string, workspaceId: string) {
    const conn = this.connectionRepo.findById(channelConnectionId);
    if (!conn) {
      throw new ConversationProviderError(`Channel connection ${channelConnectionId} not found`);
    }
    if (conn.workspaceId !== workspaceId) throw new ConversationProviderError('Channel connection crossed a workspace boundary');
    if (!conn.chatwootAccountId || !conn.chatwootInboxId) {
      throw new ConversationProviderError(`Channel connection ${channelConnectionId} is missing Chatwoot binding`);
    }
    return conn;
  }

  private getConversationConnection(workspaceId: string, conversationDisplayId: number) {
    const conn = this.connectionRepo.findForConversation(workspaceId, conversationDisplayId);
    if (!conn) {
      throw new ConversationProviderError(`No Tinix conversation mapping found for Chatwoot conversation ${conversationDisplayId}`);
    }
    if (!conn.chatwootAccountId || !conn.chatwootInboxId) {
      throw new ConversationProviderError(`Channel connection ${conn.id} is missing Chatwoot binding`);
    }
    return conn;
  }

  public async ensureIdentity(input: EnsureChannelIdentityInput): Promise<ChannelIdentityRef> {
    const conn = this.getConnection(input.channelConnectionId, input.workspaceId);
    const accountId = conn.chatwootAccountId!;
    const inboxId = conn.chatwootInboxId!;

    const contactName = input.displayName || `Customer ${input.externalUserId}`;
    const identifier = `tinix:${conn.provider}:${conn.id}:${input.externalUserId}`;
    const sourceId = input.externalUserId;
    const existingIdentity = await this.client.findIdentity(accountId, inboxId, sourceId, identifier);
    if (existingIdentity) return { contactId: existingIdentity.contactId, sourceId: existingIdentity.sourceId };

    const contact = await this.client.createContact(accountId, {
      name: contactName,
      identifier,
      inbox_id: inboxId,
      source_id: sourceId,
      custom_attributes: input.metadata,
    });

    const contactInbox = await this.client.addContactInbox(accountId, contact.id, {
      inbox_id: inboxId,
      source_id: sourceId,
    });

    return {
      contactId: contact.id,
      contactInboxId: contactInbox.contact_inbox_id,
      sourceId: contactInbox.source_id,
    };
  }

  public async provisionChannel(input: { accountId: number; name: string; callbackUrl: string; inboxId?: number }) {
    const inbox = await this.client.provisionInbox(input.accountId, input.name, input.callbackUrl, input.inboxId);
    if (!Number.isSafeInteger(Number(inbox.id)) || !inbox.secret || !inbox.inbox_identifier
      || inbox.channel_type !== 'Channel::Api' || inbox.webhook_url !== input.callbackUrl) {
      throw new ConversationProviderError('API inbox binding, signing secret or callback URL could not be verified');
    }
    return { inboxId: Number(inbox.id), identifier: String(inbox.inbox_identifier), callbackSecret: String(inbox.secret) };
  }

  public async ensureConversation(input: EnsureConversationInput): Promise<ConversationRef> {
    const conn = this.getConnection(input.channelConnectionId, input.workspaceId);
    const accountId = conn.chatwootAccountId!;
    const inboxId = conn.chatwootInboxId!;
    const existingConversation = await this.client.findContactConversation(accountId, input.contactId, inboxId);
    if (existingConversation) return { conversationId: existingConversation.id, displayId: existingConversation.id };
    const conv = await this.client.createConversation(accountId, {
      inbox_id: inboxId,
      source_id: input.sourceId,
      contact_id: input.contactId,
    });

    return {
      conversationId: conv.id,
      displayId: conv.display_id,
      uuid: conv.uuid,
    };
  }

  public async createIncomingMessage(input: IncomingConversationMessage): Promise<MessageRef> {
    const conn = this.getConnection(input.channelConnectionId, input.workspaceId);
    const accountId = conn.chatwootAccountId!;
    const media: ImportedAttachment[] = [];
    const unsupported: string[] = [];
    const fetcher = this.attachmentFetcher || (conn.provider === 'meta'
      ? new SecureAttachmentFetcher(['fbcdn.net', 'fbsbx.com']) : undefined);
    let aggregateBytes = 0;
    let downloadAttempts = 0;
    for (const attachment of input.attachments || []) {
      if (!fetcher || downloadAttempts >= 5 || aggregateBytes >= 24 * 1024 * 1024 || !['image', 'audio', 'video', 'file'].includes(attachment.type)) {
        unsupported.push(attachment.type); continue;
      }
      try {
        downloadAttempts++;
        const imported = await fetcher.download(attachment);
        aggregateBytes += imported.bytes.byteLength;
        if (aggregateBytes > 24 * 1024 * 1024) { unsupported.push(attachment.type); continue; }
        media.push(imported);
      } catch (error) {
        if (error instanceof InboxError && error.retryable) {
          throw new AttachmentPreparationError('Media fetch failed before the Chatwoot message write');
        }
        unsupported.push(attachment.type);
      }
    }

    const res = await this.client.createMessage(accountId, input.conversationId, {
      content: (input.text || '') + (unsupported.length
        ? `\n[Tệp đính kèm chưa được nhập: ${unsupported.join(', ')}. Tham chiếu gốc được lưu tại Tinix.]` : ''),
      message_type: 'incoming',
      private: false,
      source_id: input.externalMessageId,
      content_attributes: { tinix_media_import: unsupported.length ? 'partial' : media.length ? 'imported' : 'none' },
      attachments: media.length ? media : undefined,
    });

    return mapChatwootMessageToRef(res as unknown as Record<string, unknown>);
  }

  public async createOutgoingMessage(input: OutgoingConversationMessage): Promise<MessageRef> {
    const conn = this.getConnection(input.channelConnectionId, input.workspaceId);
    const accountId = conn.chatwootAccountId!;

    const res = await this.client.createMessage(accountId, input.conversationId, {
      content: input.text,
      message_type: 'outgoing',
      private: input.isPrivate ?? false,
      content_attributes: input.operationId ? { tinix_operation_id: input.operationId } : undefined,
    });

    return mapChatwootMessageToRef(res as unknown as Record<string, unknown>);
  }

  public async listMessages(input: ListMessagesInput): Promise<MessagePage> {
    const conn = this.getConversationConnection(input.workspaceId, input.conversationDisplayId);

    const res = await this.client.listMessages(conn.chatwootAccountId!, input.conversationDisplayId, input.before);
    const rawMessages = res.payload || [];
    return {
      messages: rawMessages.map((m) => mapChatwootMessageToRef(m)),
    };
  }

  public async updateSupportState(input: UpdateSupportStateInput): Promise<void> {
    const conn = this.getConversationConnection(input.workspaceId, input.conversationDisplayId);
    await this.client.toggleStatus(conn.chatwootAccountId!, input.conversationDisplayId, input.status);
  }

  public async assignConversation(input: AssignConversationInput): Promise<void> {
    if (!Number.isSafeInteger(input.agentId) || (input.agentId ?? 0) <= 0) {
      throw new ConversationProviderError('A valid Chatwoot agent ID is required');
    }
    const conn = this.getConversationConnection(input.workspaceId, input.conversationDisplayId);
    await this.client.assignAgent(conn.chatwootAccountId!, input.conversationDisplayId, input.agentId!);
    this.conversationListSummaryCache.delete(`${input.workspaceId}:${conn.chatwootAccountId}:${conn.chatwootInboxId}`);
  }

  public async getAssignment(input: Omit<AssignConversationInput, 'agentId'>): Promise<ConversationAssignment> {
    const conn = this.getConversationConnection(input.workspaceId, input.conversationDisplayId);
    const [rawAgents, conversation] = await Promise.all([
      this.client.listInboxAgents(conn.chatwootAccountId!, conn.chatwootInboxId!),
      this.client.getConversation(conn.chatwootAccountId!, input.conversationDisplayId),
    ]);
    const agents = rawAgents.flatMap((agent) => {
      const id = Number(agent.id);
      const name = typeof agent.available_name === 'string' && agent.available_name.trim()
        ? agent.available_name.trim()
        : typeof agent.name === 'string' ? agent.name.trim() : '';
      return Number.isSafeInteger(id) && id > 0 && name ? [{ id, name }] : [];
    });
    const meta = conversation.meta && typeof conversation.meta === 'object'
      ? conversation.meta as Record<string, unknown>
      : {};
    const rawAssignee = meta.assignee && typeof meta.assignee === 'object'
      ? meta.assignee as Record<string, unknown>
      : null;
    const assigneeId = Number(rawAssignee?.id);
    const assigneeName = typeof rawAssignee?.name === 'string' ? rawAssignee.name.trim() : '';
    const assignee = Number.isSafeInteger(assigneeId) && assigneeId > 0 && assigneeName
      ? { id: assigneeId, name: assigneeName }
      : null;
    return { agents, assignee };
  }

  public async listConversationSummaries(
    input: ConversationListSummaryInput
  ): Promise<Map<string, ConversationListProjection>> {
    const result = new Map<string, ConversationListProjection>();
    const groups = new Map<string, {
      accountId: number;
      inboxId: number;
      conversations: Array<{ conversationLinkId: string; conversationDisplayId: number }>;
    }>();

    for (const ref of input.conversations) {
      if (!Number.isSafeInteger(ref.conversationDisplayId) || ref.conversationDisplayId <= 0) continue;
      const connection = this.getConnection(ref.channelConnectionId, input.workspaceId);
      if (connection.workspaceId !== input.workspaceId) {
        throw new ConversationProviderError('Conversation assignment summary crossed workspace boundary');
      }
      const key = `${connection.chatwootAccountId}:${connection.chatwootInboxId}`;
      const group = groups.get(key) || {
        accountId: connection.chatwootAccountId!,
        inboxId: connection.chatwootInboxId!,
        conversations: [],
      };
      group.conversations.push({ conversationLinkId: ref.conversationLinkId, conversationDisplayId: ref.conversationDisplayId });
      groups.set(key, group);
    }

    for (const [key, group] of groups) {
      const now = Date.now();
      const cached = this.conversationListSummaryCache.get(`${input.workspaceId}:${key}`);
      const cacheIsFresh = cached && now - cached.fetchedAt < 10_000;
      const assignments = cacheIsFresh
        ? new Map(cached.assignments)
        : new Map<number, ConversationListProjection>();
      const scannedIds = cacheIsFresh ? new Set(cached.scannedIds) : new Set<number>();
      const unresolved = new Set(group.conversations
        .map((ref) => ref.conversationDisplayId)
        .filter((id) => !assignments.has(id) && !scannedIds.has(id)));

      if (unresolved.size > 0) {
        for (let page = 1; page <= 40 && unresolved.size > 0; page++) {
          const conversations = await this.client.listConversations(group.accountId, group.inboxId, page);
          for (const conversation of conversations) {
            const displayId = Number(conversation.id ?? conversation.display_id);
            if (!unresolved.has(displayId)) continue;
            const meta = conversation.meta && typeof conversation.meta === 'object'
              ? conversation.meta as Record<string, unknown>
              : {};
            const rawAssignee = meta.assignee && typeof meta.assignee === 'object'
              ? meta.assignee as Record<string, unknown>
              : null;
            let assignee: ConversationAgent | null | undefined;
            if (!Object.hasOwn(meta, 'assignee') || meta.assignee === null) {
              assignee = null;
            } else if (rawAssignee) {
              const id = Number(rawAssignee.id);
              const name = typeof rawAssignee.available_name === 'string' && rawAssignee.available_name.trim()
                ? rawAssignee.available_name.trim()
                : typeof rawAssignee.name === 'string' ? rawAssignee.name.trim() : '';
              if (Number.isSafeInteger(id) && id > 0 && name) assignee = { id, name };
            }
            const sender = meta.sender && typeof meta.sender === 'object'
              ? meta.sender as Record<string, unknown>
              : {};
            const contactName = typeof sender.name === 'string' ? sender.name.trim() : '';
            if (assignee !== undefined || contactName) {
              assignments.set(displayId, {
                ...(assignee !== undefined ? { assignee } : {}),
                ...(contactName ? { contactName } : {}),
              });
              unresolved.delete(displayId);
            }
          }
          if (conversations.length < 25) break;
        }
        for (const ref of group.conversations) scannedIds.add(ref.conversationDisplayId);
        this.conversationListSummaryCache.set(`${input.workspaceId}:${key}`, { fetchedAt: Date.now(), assignments, scannedIds });
      }

      for (const ref of group.conversations) {
        if (assignments.has(ref.conversationDisplayId)) {
          result.set(ref.conversationLinkId, assignments.get(ref.conversationDisplayId)!);
        }
      }
    }
    return result;
  }

  public async downloadMessageAttachment(input: DownloadMessageAttachmentInput): Promise<DownloadedMessageAttachment> {
    const conn = this.getConversationConnection(input.workspaceId, input.conversationDisplayId);
    const messagePage = await this.client.listMessages(
      conn.chatwootAccountId!,
      input.conversationDisplayId,
      input.messageId + 1
    );
    const message = (messagePage.payload || []).find((item) => Number(item.id) === input.messageId);
    const attachments = Array.isArray(message?.attachments) ? message.attachments : [];
    const attachment = attachments[input.attachmentIndex];
    if (!attachment || typeof attachment !== 'object' || Array.isArray(attachment)) {
      throw new ConversationProviderError('Chatwoot attachment was not found');
    }
    const rawAttachment = attachment as Record<string, unknown>;
    const attachmentUrl = typeof rawAttachment.data_url === 'string'
      ? rawAttachment.data_url
      : typeof rawAttachment.file_url === 'string' ? rawAttachment.file_url : undefined;
    if (!attachmentUrl) throw new ConversationProviderError('Chatwoot attachment has no downloadable URL');
    return this.client.downloadAttachment(attachmentUrl);
  }

  public async addPrivateNote(input: PrivateNoteInput): Promise<MessageRef> {
    const conn = this.getConversationConnection(input.workspaceId, input.conversationDisplayId);

    const res = await this.client.createMessage(conn.chatwootAccountId!, input.conversationDisplayId, {
      content: input.content,
      message_type: 'outgoing',
      private: true,
      content_attributes: input.operationId ? { tinix_operation_id: input.operationId } : undefined,
    });

    return mapChatwootMessageToRef(res as unknown as Record<string, unknown>);
  }

  public async reconcileConversation(input: ReconcileConversationInput): Promise<ReconcileResult> {
    const conn = this.getConversationConnection(input.workspaceId, input.conversationDisplayId);

    const rawMessages: MessageRef[] = [];
    let before: number | undefined;
    for (let page = 0; ; page++) {
      if (page >= 500) throw new ConversationProviderError('Reconciliation page limit reached; cursor was not advanced');
      const res = await this.client.listMessages(conn.chatwootAccountId!, input.conversationDisplayId, before);
      const batch = (res.payload || []).filter(m => m.message_type === 0 || m.message_type === 1 || m.message_type === 'incoming' || m.message_type === 'outgoing')
        .map(m => mapChatwootMessageToRef(m));
      rawMessages.push(...batch);
      if (!(res.payload || []).length) break;
      const oldest = Math.min(...(res.payload || []).map(m => Number(m.id)));
      if (!Number.isSafeInteger(oldest) || oldest <= 0 || (before !== undefined && oldest >= before)) {
        throw new ConversationProviderError('Reconciliation pagination did not advance');
      }
      if (input.sinceTimestamp && batch.length && batch.every(m => Date.parse(m.createdAt) < input.sinceTimestamp!)) break;
      before = oldest;
    }

    const unprocessedOutgoingMessages = rawMessages.filter((msg) => {
      if (msg.direction !== 'outgoing' || msg.isPrivate) return false;
      if (input.sinceTimestamp) {
        const msgTime = new Date(msg.createdAt).getTime();
        return msgTime >= input.sinceTimestamp;
      }
      return true;
    });

    return { unprocessedOutgoingMessages, incomingMessages: rawMessages.filter(m => m.direction === 'incoming'),
      privateMessages: rawMessages.filter(m => m.isPrivate) };
  }
}
