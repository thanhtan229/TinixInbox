import { randomUUID } from 'node:crypto';
import type { ConversationProvider } from '../core/conversation-provider.ts';
import type { OutboxMessage } from '../core/types.ts';
import type { HandoffPolicy } from '../agent/handoff-policy.ts';
import {
  ConversationLinkRepository,
  MessageLinkRepository,
  OutboxRepository,
} from '../persistence/repositories.ts';

export class ReconciliationService {
  private recoveryEpoch = Date.now();
  private running = false;
  private conversationProvider: ConversationProvider;
  private conversationRepo: ConversationLinkRepository;
  private messageRepo: MessageLinkRepository;
  private outboxRepo: OutboxRepository;
  private handoffPolicy?: HandoffPolicy;

  constructor(
    conversationProvider: ConversationProvider,
    conversationRepo: ConversationLinkRepository,
    messageRepo: MessageLinkRepository,
    outboxRepo: OutboxRepository,
    handoffPolicy?: HandoffPolicy
  ) {
    this.conversationProvider = conversationProvider;
    this.conversationRepo = conversationRepo;
    this.messageRepo = messageRepo;
    this.outboxRepo = outboxRepo;
    this.handoffPolicy = handoffPolicy;
  }

  public async reconcileWorkspace(workspaceId: string, automatic = false): Promise<{ missingDetected: number; outboxQueued: number }> {
    if (this.running) return { missingDetected: 0, outboxQueued: 0 };
    this.running = true;
    try {
    const convLinks = this.conversationRepo.listByWorkspace(workspaceId);
    let missingDetected = 0;
    let outboxQueued = 0;

    for (const conv of convLinks) {
      const window = this.messageRepo.reconciliationWindow(workspaceId, conv.id,
        new Date(Math.floor(this.recoveryEpoch / 1000) * 1000).toISOString());
      const startedAt = new Date().toISOString();
      const res = await this.conversationProvider.reconcileConversation({
        workspaceId,
        conversationDisplayId: conv.chatwootConversationDisplayId,
        sinceTimestamp: automatic && !this.messageRepo.listUnknownInboundMessages(workspaceId).some(row => row.channel_connection_id === conv.channelConnectionId)
          ? Math.max(window.baseline, window.watermark - 300000) : undefined,
      });

      for (const msg of [...res.unprocessedOutgoingMessages, ...(res.privateMessages || [])]) {
        if (!msg.operationId) continue;
        const operation = this.messageRepo.getSendOperation(msg.operationId);
        if (operation?.workspace_id !== workspaceId || operation.conversation_link_id !== conv.id) continue;
        this.messageRepo.finishSendOperation(msg.operationId, { messageId: msg.messageId, content: msg.content,
          isPrivate: msg.isPrivate, direction: msg.direction, status: msg.status });
      }

      for (const msg of res.unprocessedOutgoingMessages) {
        if (automatic && Date.parse(msg.createdAt) < window.baseline) continue;
        const existingOutbox = this.outboxRepo.findByChatwootMessageId(conv.chatwootAccountId, msg.messageId);
        if (!existingOutbox) {
          missingDetected++;
          const idempotencyKey = `${conv.chatwootAccountId}:${conv.chatwootInboxId}:reconcile:${msg.messageId}`;
          const outboxId = randomUUID();
          const existingMsg = this.messageRepo.findByChatwootMessageId(conv.chatwootAccountId, msg.messageId);
          const operation = msg.operationId ? this.messageRepo.getSendOperation(msg.operationId) : undefined;
          const trustedOperation = operation?.workspace_id === workspaceId && operation.conversation_link_id === conv.id ? operation : undefined;
          const origin = trustedOperation?.origin || existingMsg?.origin || 'human';
          const aiVersion = trustedOperation?.ai_version ?? existingMsg?.metadata?.aiVersion;
          if (origin === 'human' && Date.parse(msg.createdAt) >= window.baseline) {
            this.handoffPolicy?.takeOverByHuman(workspaceId, this.conversationProvider.providerName,
              String(conv.chatwootConversationDisplayId), 'recovered-human-send');
          }

          const outboxRecord: OutboxMessage = {
            id: outboxId,
            workspaceId,
            channelConnectionId: conv.channelConnectionId,
            conversationLinkId: conv.id,
            chatwootAccountId: conv.chatwootAccountId,
            chatwootMessageId: msg.messageId,
            idempotencyKey,
            payloadSnapshot: JSON.stringify({
              content: msg.content,
              recipientExternalId: conv.tinixThreadKey,
              conversationId: conv.chatwootConversationDisplayId,
              origin, aiVersion,
              attachmentCount: msg.attachments?.length || 0,
            }),
            state: Date.parse(msg.createdAt) < window.baseline ? 'unknown' : 'pending',
            attemptCount: 0,
            correlationId: randomUUID(),
            createdAt: new Date().toISOString(),
          };

          this.messageRepo.transaction(() => {
          this.outboxRepo.create(outboxRecord);
          outboxQueued++;

          // Record in message_links if not present
          if (!existingMsg) {
            this.messageRepo.create({
              id: randomUUID(),
              workspaceId,
              channelConnectionId: conv.channelConnectionId,
              conversationLinkId: conv.id,
              direction: 'outgoing',
              origin: origin === 'ai' ? 'ai' : 'human',
              metadata: { aiVersion, operationId: msg.operationId },
              chatwootAccountId: conv.chatwootAccountId,
              chatwootMessageId: msg.messageId,
              outboxId,
              deliveryState: Date.parse(msg.createdAt) < window.baseline ? 'unknown' : 'queued',
              correlationId: randomUUID(),
              createdAt: msg.createdAt,
              updatedAt: new Date().toISOString(),
            });
          } else {
            this.messageRepo.attachOutbox(existingMsg.id, outboxId, workspaceId, conv.channelConnectionId);
            if (outboxRecord.state === 'unknown') this.messageRepo.updateDeliveryState(existingMsg.id, 'unknown');
          }
          });
        }
      }
      const unknown = this.messageRepo.listUnknownInboundMessages(workspaceId);
      for (const msg of res.incomingMessages || []) {
        if (!msg.externalMessageId || !unknown.some(row => row.channel_connection_id === conv.channelConnectionId && row.external_message_id === msg.externalMessageId)) continue;
        if (!this.messageRepo.findByExternalMessageId(workspaceId, conv.channelConnectionId, msg.externalMessageId)) {
          this.messageRepo.create({ id: randomUUID(), workspaceId, channelConnectionId: conv.channelConnectionId,
            conversationLinkId: conv.id, direction: 'incoming', origin: 'customer', externalMessageId: msg.externalMessageId,
            chatwootAccountId: conv.chatwootAccountId, chatwootMessageId: msg.messageId, deliveryState: 'delivered',
            correlationId: randomUUID(), createdAt: msg.createdAt, updatedAt: new Date().toISOString() });
        }
        this.messageRepo.completeInboundMessage(workspaceId, conv.channelConnectionId, msg.externalMessageId);
      }
      if (automatic) this.messageRepo.advanceReconciliationWindow(workspaceId, conv.id, startedAt);
    }

    return { missingDetected, outboxQueued };
    } finally { this.running = false; }
  }
}
