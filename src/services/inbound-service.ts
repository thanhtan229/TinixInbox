import { randomUUID } from 'node:crypto';
import type { ChannelAdapter } from '../core/channel-adapter.ts';
import type { ConversationProvider } from '../core/conversation-provider.ts';
import { AttachmentPreparationError, InboundOutcomeUnknownError, WebhookVerificationError } from '../core/errors.ts';
import type { ChannelConnection } from '../core/types.ts';
import { computeInboundIdempotencyKey, type UnifiedMessage } from '../core/unified-message.ts';
import {
  ChannelConnectionRepository,
  ContactLinkRepository,
  ConversationLinkRepository,
  MessageLinkRepository,
} from '../persistence/repositories.ts';
import type { InboxAgentRouter } from '../agent/inbox-agent-router.ts';
import type { InboxEventBus } from '../api/event-bus.ts';

export class InboundService {
  private conversationProvider: ConversationProvider;
  private contactRepo: ContactLinkRepository;
  private conversationRepo: ConversationLinkRepository;
  private messageRepo: MessageLinkRepository;
  private agentRouter?: InboxAgentRouter;
  private eventBus?: InboxEventBus;
  private connectionRepo?: ChannelConnectionRepository;

  constructor(
    conversationProvider: ConversationProvider,
    contactRepo: ContactLinkRepository,
    conversationRepo: ConversationLinkRepository,
    messageRepo: MessageLinkRepository,
    agentRouter?: InboxAgentRouter,
    eventBus?: InboxEventBus,
    connectionRepo?: ChannelConnectionRepository
  ) {
    this.conversationProvider = conversationProvider;
    this.contactRepo = contactRepo;
    this.conversationRepo = conversationRepo;
    this.messageRepo = messageRepo;
    this.agentRouter = agentRouter;
    this.eventBus = eventBus;
    this.connectionRepo = connectionRepo;
  }

  public setAgentRouter(router: InboxAgentRouter): void {
    this.agentRouter = router;
  }

  public setEventBus(eventBus: InboxEventBus): void {
    this.eventBus = eventBus;
  }


  public async processInboundWebhook(
    adapter: ChannelAdapter,
    connection: ChannelConnection,
    rawBody: string,
    headers: Record<string, string | string[] | undefined>,
    webhookSecret: string
  ): Promise<{ processed: number; duplicate: number }> {
    // 1. Verify authenticity
    const isValid = await adapter.verifyWebhook(rawBody, headers, webhookSecret);
    if (!isValid) {
      throw new WebhookVerificationError('Provider webhook verification failed');
    }

    return this.processVerifiedInboundWebhook(adapter, connection, rawBody, headers);
  }

  public async processVerifiedInboundWebhook(
    adapter: ChannelAdapter,
    connection: ChannelConnection,
    rawBody: string,
    headers: Record<string, string | string[] | undefined> = {}
  ): Promise<{ processed: number; duplicate: number }> {

    // 2. Parse & normalize
    const rawEvents = await adapter.parseWebhook(rawBody, headers);
    let processed = 0;
    let duplicate = 0;

    for (const rawEvent of rawEvents) {
      const messages = await adapter.normalizeEvent(rawEvent, connection);
      for (const msg of messages) {
        let targetConn = connection;
        if (
          this.connectionRepo &&
          msg.recipient?.externalId &&
          msg.recipient.externalId !== connection.externalAccountId
        ) {
          const matched = this.connectionRepo.findByProviderAndExternalAccountId(
            connection.workspaceId,
            connection.provider,
            msg.recipient.externalId
          );
          if (matched) {
            targetConn = matched;
            msg.channelConnectionId = matched.id;
          } else {
            continue;
          }
        }
        if (!['connected', 'degraded'].includes(targetConn.status)) {
          continue; // Paused connection drops inbound messages safely
        }
        const isNew = await this.handleUnifiedMessage(msg, targetConn);
        if (isNew) {
          processed++;
        } else {
          duplicate++;
        }
      }
    }

    return { processed, duplicate };
  }

  public async handleUnifiedMessage(
    message: UnifiedMessage,
    connection: ChannelConnection
  ): Promise<boolean> {
    const idempotencyKey = computeInboundIdempotencyKey(
      message.workspaceId,
      message.channelConnectionId,
      message.externalMessageId
    );

    // 1. Idempotency check and durable claim before any remote side effect.
    const existing = this.messageRepo.findByExternalMessageId(
      message.workspaceId,
      message.channelConnectionId,
      message.externalMessageId
    );
    if (existing) {
      this.messageRepo.completeInboundMessage(message.workspaceId, message.channelConnectionId, message.externalMessageId);
      return false; // already processed, duplicate suppressed
    }

    const claim = this.messageRepo.claimInboundMessage(
      message.workspaceId,
      message.channelConnectionId,
      message.externalMessageId
    );
    if (claim === 'processed' || claim === 'processing') return false;
    if (claim === 'unknown') throw new InboundOutcomeUnknownError(message.externalMessageId);

    let messageWriteStarted = false;
    try {
    // 2. Ensure Contact Link
    let contactLink = this.contactRepo.findByExternalUser(
      message.workspaceId,
      message.channelConnectionId,
      message.sender.externalId
    );

    if (!contactLink) {
      const identityRef = await this.conversationProvider.ensureIdentity({
        workspaceId: message.workspaceId,
        channelConnectionId: message.channelConnectionId,
        externalUserId: message.sender.externalId,
        displayName: message.sender.displayName,
      });

      contactLink = {
        id: randomUUID(),
        workspaceId: message.workspaceId,
        channelConnectionId: message.channelConnectionId,
        provider: connection.provider,
        externalUserId: message.sender.externalId,
        chatwootAccountId: connection.chatwootAccountId || 1,
        chatwootContactId: identityRef.contactId,
        chatwootContactInboxId: identityRef.contactInboxId,
        chatwootSourceId: identityRef.sourceId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      try {
        this.contactRepo.create(contactLink);
      } catch (err: unknown) {
        if ((err as Error).message?.includes('UNIQUE constraint failed')) {
          const reloaded = this.contactRepo.findByExternalUser(
            message.workspaceId,
            message.channelConnectionId,
            message.sender.externalId
          );
          if (reloaded) contactLink = reloaded;
        } else {
          throw err;
        }
      }
    }

    // 3. Ensure Conversation Link
    const threadKey = message.externalConversationId || message.sender.externalId;
    let convLink = this.conversationRepo.findByThreadKey(
      message.workspaceId,
      message.channelConnectionId,
      threadKey
    );

    if (!convLink) {
      const convRef = await this.conversationProvider.ensureConversation({
        workspaceId: message.workspaceId,
        channelConnectionId: message.channelConnectionId,
        contactId: contactLink.chatwootContactId,
        sourceId: contactLink.chatwootSourceId,
        tinixThreadKey: threadKey,
      });

      convLink = {
        id: randomUUID(),
        workspaceId: message.workspaceId,
        channelConnectionId: message.channelConnectionId,
        externalConversationId: message.externalConversationId,
        tinixThreadKey: threadKey,
        chatwootAccountId: connection.chatwootAccountId || 1,
        chatwootInboxId: connection.chatwootInboxId || 1,
        chatwootConversationRef: String(convRef.conversationId),
        chatwootConversationDisplayId: convRef.displayId ?? (convRef as { conversationDisplayId?: number }).conversationDisplayId ?? convRef.conversationId,
        state: 'open',
        providerLastMessageAt: message.sentAt,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      try {
        this.conversationRepo.create(convLink);
      } catch (err: unknown) {
        if ((err as Error).message?.includes('UNIQUE constraint failed')) {
          const reloaded = this.conversationRepo.findByThreadKey(
            message.workspaceId,
            message.channelConnectionId,
            threadKey
          );
          if (reloaded) convLink = reloaded;
        } else {
          throw err;
        }
      }
    }

    // 4. Create incoming message in ConversationProvider
    messageWriteStarted = true;
    const msgRef = await this.conversationProvider.createIncomingMessage({
      workspaceId: message.workspaceId,
      channelConnectionId: message.channelConnectionId,
      conversationId: convLink.chatwootConversationDisplayId,
      externalMessageId: message.externalMessageId,
      text: message.text,
      attachments: message.attachments,
      sentAt: message.sentAt,
    });

    // 5. Persist message_link
    try {
      this.messageRepo.create({
        id: randomUUID(),
        workspaceId: message.workspaceId,
        channelConnectionId: message.channelConnectionId,
        conversationLinkId: convLink.id,
        direction: 'incoming',
        origin: 'customer',
        externalMessageId: message.externalMessageId,
        chatwootAccountId: convLink.chatwootAccountId,
        chatwootMessageId: msgRef.messageId,
        deliveryState: 'delivered',
        deliveredAt: new Date().toISOString(),
        correlationId: randomUUID(),
        metadata: { attachments: message.attachments, mediaImportStatus: message.attachments?.length
          ? (msgRef.attachments?.length === message.attachments.length ? 'imported' : msgRef.attachments?.length ? 'partial' : 'unsupported') : 'none' },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    } catch (err: unknown) {
      if ((err as Error).message?.includes('UNIQUE constraint failed')) {
        this.messageRepo.completeInboundMessage(message.workspaceId, message.channelConnectionId, message.externalMessageId);
        return false;
      }
      throw err;
    }

    this.messageRepo.completeInboundMessage(message.workspaceId, message.channelConnectionId, message.externalMessageId);

    // Broadcast SSE event
    if (this.eventBus) {
      this.eventBus.broadcast('message_created', {
        conversationLinkId: convLink.id,
        conversationDisplayId: convLink.chatwootConversationDisplayId,
        messageId: msgRef.messageId,
        content: message.text || '',
        direction: 'incoming',
        isPrivate: false,
        deliveryState: 'delivered',
        createdAt: new Date().toISOString(),
      });
    }

    // Trigger AI Agent evaluation asynchronously (does not block inbound ACK)
    if (this.agentRouter && !message.attachments?.length) {
      void this.agentRouter.handleIncomingMessage(message).catch((err) => {
        console.error('[InboundService] AI Agent reply error:', err);
      });
    }

    return true;
    } catch (err) {
      if (!messageWriteStarted || err instanceof AttachmentPreparationError) {
        this.messageRepo.releaseInboundMessage(message.workspaceId, message.channelConnectionId, message.externalMessageId);
        throw err;
      }
      this.messageRepo.markInboundOutcomeUnknown(
        message.workspaceId,
        message.channelConnectionId,
        message.externalMessageId,
        (err as Error).message || 'ConversationProvider outcome is unknown'
      );
      throw err;
    }
  }
}
