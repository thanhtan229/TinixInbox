import type { ChannelAdapter } from '../core/channel-adapter.ts';
import type { DeliveryState } from '../core/types.ts';
import {
  ChannelConnectionRepository,
  MessageLinkRepository,
  OutboxRepository,
} from '../persistence/repositories.ts';
import type { InboxEventBus } from '../api/event-bus.ts';
import type { HandoffPolicy } from '../agent/handoff-policy.ts';
import { FeatureFlagManager } from '../config/feature-flags.ts';

export class OutboxService {
  private adapters: Map<string, ChannelAdapter> = new Map();
  private maxAttempts = 5;
  private outboxRepo: OutboxRepository;
  private messageRepo: MessageLinkRepository;
  private connectionRepo: ChannelConnectionRepository;
  private eventBus?: InboxEventBus;
  private handoffPolicy?: HandoffPolicy;

  constructor(
    outboxRepo: OutboxRepository,
    messageRepo: MessageLinkRepository,
    connectionRepo: ChannelConnectionRepository,
    eventBus?: InboxEventBus,
    handoffPolicy?: HandoffPolicy
  ) {
    this.outboxRepo = outboxRepo;
    this.messageRepo = messageRepo;
    this.connectionRepo = connectionRepo;
    this.eventBus = eventBus;
    this.handoffPolicy = handoffPolicy;
  }

  public setEventBus(eventBus: InboxEventBus): void {
    this.eventBus = eventBus;
  }


  public registerAdapter(provider: string, adapter: ChannelAdapter): void {
    this.adapters.set(provider, adapter);
  }

  public async processPendingOutbox(limit = 20): Promise<{ processed: number; sent: number; failed: number }> {
    const pending = this.outboxRepo.listPending(limit);
    let sent = 0;
    let failed = 0;
    let paused = 0;

    for (const item of pending) {
      const connection = this.connectionRepo.findById(item.channelConnectionId);
      if (connection?.status === 'disabled') {
        paused++;
        continue;
      }
      const success = await this.dispatchItem(item.id);
      if (success) {
        sent++;
      } else {
        if (this.connectionRepo.findById(item.channelConnectionId)?.status === 'disabled') paused++;
        else failed++;
      }
    }

    return { processed: pending.length - paused, sent, failed };
  }

  public async dispatchItem(outboxId: string): Promise<boolean> {
    const item = this.outboxRepo.findById(outboxId);
    if (!item) return false;
    const connectionBeforeClaim = this.connectionRepo.findById(item.channelConnectionId);
    if (!connectionBeforeClaim || !['connected', 'degraded'].includes(connectionBeforeClaim.status)) return false;
    if (!this.outboxRepo.claimForSend(item.id)) return false;

    const connection = this.connectionRepo.findById(item.channelConnectionId);
    if (!connection || !['connected', 'degraded'].includes(connection.status)) {
      this.outboxRepo.releaseSendClaim(item.id);
      return false;
    }
    const provider = connection?.provider || 'synthetic';
    const adapter = this.adapters.get(provider);

    if (!adapter) {
      this.outboxRepo.markFailed(item.id, `No adapter registered for provider: ${provider}`, undefined, false, true);
      return false;
    }

    let payload: { content?: string; recipientExternalId?: string; origin?: string; aiVersion?: number; conversationId?: number; attachmentCount?: number };
    try {
      payload = JSON.parse(item.payloadSnapshot);
    } catch {
      this.outboxRepo.markFailed(item.id, 'Invalid payload snapshot in outbox', undefined, false, true);
      return false;
    }

    const flags = FeatureFlagManager.getInstance();
    const channelFlag = `tinix_inbox_${provider}_enabled`;
    if (!flags.isEnabled('tinix_inbox_enabled') || (channelFlag in flags.getAll() && !flags.getAll()[channelFlag as keyof ReturnType<typeof flags.getAll>])) {
      this.outboxRepo.releaseSendClaim(item.id);
      return false;
    }
    const projection = this.messageRepo.findByChatwootMessageId(item.chatwootAccountId, item.chatwootMessageId);
    if (payload.attachmentCount) {
      this.outboxRepo.markFailed(item.id, 'Outbound attachment transport is not verified for this channel', undefined, false, true);
      if (projection) this.messageRepo.updateDeliveryState(projection.id, 'failed');
      return false;
    }
    if ((payload.origin || projection?.origin) === 'ai' && (!this.handoffPolicy || !this.handoffPolicy.commitAIReply(
      item.workspaceId, 'chatwoot', String(payload.conversationId), Number(payload.aiVersion ?? projection?.metadata?.aiVersion)))) {
      this.outboxRepo.markFailed(item.id, 'AI send cancelled because handoff state/version changed', undefined, false, true);
      if (projection) this.messageRepo.updateDeliveryState(projection.id, 'failed');
      return false;
    }

    let sendResult;
    try {
      sendResult = await adapter.sendMessage({
      workspaceId: item.workspaceId,
      channelConnectionId: item.channelConnectionId,
      recipientExternalId: payload.recipientExternalId || 'unknown-recipient',
      text: payload.content,
      correlationId: item.correlationId,
      metadata: this.adapterCredentials(provider, connection?.credentialsEncrypted, connection?.metadata, connection?.externalAccountId),
      });
    } catch (error) {
      sendResult = {
        success: false,
        failureKind: 'unknown' as const,
        sentAt: new Date().toISOString(),
        error: (error as Error).message,
      };
    }

    const msgLink = this.messageRepo.findByChatwootMessageId(item.chatwootAccountId, item.chatwootMessageId);

    if (sendResult.success) {
      const providerMsgId = sendResult.providerMessageId || 'unknown-provider-id';
      this.outboxRepo.markSent(item.id, providerMsgId);

      if (msgLink) {
        this.messageRepo.updateDeliveryState(msgLink.id, 'provider_accepted', {
          providerAcceptedAt: sendResult.sentAt,
        });
        if (this.eventBus) {
          this.eventBus.broadcast('delivery_updated', {
            messageId: msgLink.chatwootMessageId,
            deliveryState: 'provider_accepted',
            updatedAt: sendResult.sentAt,
          });
        }
      }
      return true;
    } else {
      const nextAttempt = item.attemptCount + 1;
      const isDeadLetter = nextAttempt >= this.maxAttempts;

      if (sendResult.failureKind === 'unknown') {
        this.outboxRepo.markUnknown(item.id, sendResult.error || 'Provider send outcome is unknown');
      } else if (sendResult.failureKind === 'permanent') {
        this.outboxRepo.markFailed(item.id, sendResult.error || 'Permanent provider rejection', undefined, false, true);
      } else {
        // Exponential backoff: 2^attempt seconds
        const backoffSeconds = Math.min(Math.pow(2, nextAttempt), 60);
        const nextAttemptAt = new Date(Date.now() + backoffSeconds * 1000).toISOString();
        this.outboxRepo.markFailed(item.id, sendResult.error || 'Retryable send failure', nextAttemptAt, isDeadLetter);
      }

      if (msgLink) {
        let deliveryState: DeliveryState = 'retry_wait';
        if (sendResult.failureKind === 'unknown') {
          deliveryState = 'unknown';
        } else if (sendResult.failureKind === 'permanent') {
          deliveryState = 'failed';
        } else if (isDeadLetter) {
          deliveryState = 'dead_letter';
        }
        this.messageRepo.updateDeliveryState(msgLink.id, deliveryState, {
          failedAt: new Date().toISOString(),
        });
        if (this.eventBus) {
          this.eventBus.broadcast('delivery_updated', {
            messageId: msgLink.chatwootMessageId,
            deliveryState,
            updatedAt: new Date().toISOString(),
          });
        }
      }
      return false;
    }
  }

  public recoverInterruptedSends(): number {
    const sending = this.outboxRepo.listSending();
    for (const item of sending) {
      this.outboxRepo.markUnknown(item.id, 'Tinix restarted while provider delivery outcome was unresolved');
      const message = this.messageRepo.findByChatwootMessageId(item.chatwootAccountId, item.chatwootMessageId);
      if (message) this.messageRepo.updateDeliveryState(message.id, 'unknown', { failedAt: new Date().toISOString() });
    }
    return sending.length;
  }

  private adapterCredentials(
    provider: string,
    storedCredentials?: string,
    connectionMetadata?: Record<string, unknown>,
    externalAccountId?: string
  ): Record<string, unknown> {
    const metadata = { ...(connectionMetadata || {}) };
    if (!storedCredentials) return metadata;

    let parsed: Record<string, unknown> | undefined;
    try {
      const value: unknown = JSON.parse(storedCredentials);
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        parsed = value as Record<string, unknown>;
      }
    } catch {
      // Some adapters accept a single opaque access token.
    }

    if (provider === 'meta') {
      const token = parsed?.pageAccessToken || parsed?.accessToken || storedCredentials;
      if (typeof token === 'string') metadata.accessToken = token;
      if (typeof parsed?.pageId === 'string') metadata.pageId = parsed.pageId;
      if (externalAccountId) metadata.pageId = externalAccountId;
    } else if (provider === 'zalo') {
      metadata.credentials = storedCredentials;
      if (typeof parsed?.accessToken === 'string') metadata.accessToken = parsed.accessToken;
    }
    return metadata;
  }

  public async retryOutboxItem(outboxId: string): Promise<boolean> {
    if (!this.outboxRepo.resetForRetry(outboxId)) return false;
    return this.dispatchItem(outboxId);
  }

  public async redriveAllDeadLetter(): Promise<{ resetCount: number; processed: number; sent: number; failed: number }> {
    const resetCount = this.outboxRepo.redriveAllDeadLetter();
    const batchResult = await this.processPendingOutbox(100);
    return {
      resetCount,
      ...batchResult,
    };
  }
}
