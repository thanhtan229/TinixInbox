import { createHash, randomUUID } from 'node:crypto';
import type { HandoffPolicy } from '../agent/handoff-policy.ts';
import { InvalidRequestError, WebhookVerificationError } from '../core/errors.ts';
import type { OutboxMessage } from '../core/types.ts';
import {
  type ChatwootCallbackPayload,
  evaluateOutboundPredicate,
} from '../providers/chatwoot/chatwoot-predicate.ts';
import { verifyChatwootSignature } from '../providers/chatwoot/chatwoot-signature.ts';
import {
  CallbackEventRepository,
  ChannelConnectionRepository,
  ConversationLinkRepository,
  MessageLinkRepository,
  OutboxRepository,
} from '../persistence/repositories.ts';

export class OutboundService {
  private connectionRepo: ChannelConnectionRepository;
  private conversationRepo: ConversationLinkRepository;
  private messageRepo: MessageLinkRepository;
  private outboxRepo: OutboxRepository;
  private callbackEventRepo: CallbackEventRepository;
  private handoffPolicy?: HandoffPolicy;

  constructor(
    connectionRepo: ChannelConnectionRepository,
    conversationRepo: ConversationLinkRepository,
    messageRepo: MessageLinkRepository,
    outboxRepo: OutboxRepository,
    callbackEventRepo: CallbackEventRepository,
    handoffPolicy?: HandoffPolicy
  ) {
    this.connectionRepo = connectionRepo;
    this.conversationRepo = conversationRepo;
    this.messageRepo = messageRepo;
    this.outboxRepo = outboxRepo;
    this.callbackEventRepo = callbackEventRepo;
    this.handoffPolicy = handoffPolicy;
  }

  public async handleChatwootCallback(
    rawBody: string,
    signature: string | undefined,
    timestamp: string | undefined,
    secretOverride?: string
  ): Promise<{ status: 'accepted' | 'ignored' | 'duplicate'; reason?: string; outboxId?: string }> {
    let payload: ChatwootCallbackPayload;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      throw new InvalidRequestError('Chatwoot callback body must be valid JSON');
    }

    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new InvalidRequestError('Chatwoot callback body must be a JSON object');
    }

    const accountId = Number(payload.account?.id);
    const inboxId = Number(payload.inbox?.id);
    if (!Number.isSafeInteger(accountId) || accountId <= 0 || !Number.isSafeInteger(inboxId) || inboxId <= 0) {
      throw new WebhookVerificationError('Chatwoot callback is missing a valid account or inbox ID');
    }

    // 1. Resolve channel connection to get callback secret
    const connection = this.connectionRepo.findByChatwootInbox(accountId, inboxId);
    const secret = secretOverride || connection?.chatwootCallbackSecretRef;

    // Unmapped callbacks and unsigned inboxes must never be accepted as trusted events.
    if (!connection || !secret) {
      throw new WebhookVerificationError('Chatwoot callback inbox is not mapped or has no signing secret');
    }

    // 2. Verify HMAC and timestamp
    const sigResult = verifyChatwootSignature(rawBody, signature, timestamp, secret);
    if (!sigResult.valid) {
      throw new WebhookVerificationError(`Invalid Chatwoot callback signature: ${sigResult.reason}`);
    }

    // 3. Record durable event
    const payloadHash = createHash('sha256').update(rawBody).digest('hex');
    const correlationId = randomUUID();
    const eventId = randomUUID();

    this.callbackEventRepo.recordEvent({
      id: eventId,
      chatwootAccountId: accountId,
      chatwootInboxId: inboxId,
      deliveryId: undefined,
      eventType: payload.event || 'unknown',
      chatwootMessageId: payload.id ? Number(payload.id) : undefined,
      chatwootConversationId: payload.conversation?.id ? Number(payload.conversation.id) : undefined,
      signatureValid: true,
      timestampValid: true,
      payloadHash,
      rawPayload: rawBody,
      status: 'received',
      correlationId,
      receivedAt: new Date().toISOString(),
    });

    // 4. Strict outbound predicate check
    const predicate = evaluateOutboundPredicate(payload, { accountId, inboxId });
    if (!predicate.isCandidate) {
      return { status: 'ignored', reason: predicate.reason };
    }
    if (!['connected', 'degraded'].includes(connection.status)) {
      return { status: 'ignored', reason: 'Channel connection is disabled' };
    }

    const messageId = Number(payload.id);
    const idempotencyKey = predicate.semanticKey || `${accountId}:${inboxId}:message_created:${messageId}`;

    // 5. Idempotency check against outbox
    const existingOutbox = this.outboxRepo.findByChatwootMessageId(accountId, messageId);
    if (existingOutbox) {
      return { status: 'duplicate', reason: 'Already queued in outbox', outboxId: existingOutbox.id };
    }

    // 6. Resolve conversation link
    const displayId = Number(payload.conversation?.id);
    const convLink = this.conversationRepo.findByChatwootDisplayId(accountId, displayId);
    const sourceId = payload.conversation?.contact_inbox?.source_id;
    if (!convLink || convLink.channelConnectionId !== connection.id || !sourceId) {
      return { status: 'ignored', reason: 'Conversation or channel identity is not mapped' };
    }

    const existingMsg = this.messageRepo.findByChatwootMessageId(accountId, messageId);
    const operationId = payload.content_attributes?.tinix_operation_id;
    const operation = typeof operationId === 'string' ? this.messageRepo.getSendOperation(operationId) : undefined;
    const trustedOperation = operation?.workspace_id === connection.workspaceId && operation.conversation_link_id === convLink.id ? operation : undefined;
    const origin = trustedOperation?.origin || existingMsg?.origin || 'human';
    if (trustedOperation && typeof operationId === 'string') {
      this.messageRepo.finishSendOperation(operationId, { messageId, content: payload.content || '', isPrivate: false,
        direction: 'outgoing', status: 'sent' });
    }
    const aiVersion = trustedOperation?.ai_version ?? existingMsg?.metadata?.aiVersion;
    if (origin === 'human') this.handoffPolicy?.takeOverByHuman(connection.workspaceId, 'chatwoot', String(displayId), 'chatwoot-operator');
    if (existingMsg && (
      existingMsg.workspaceId !== connection.workspaceId
      || existingMsg.channelConnectionId !== connection.id
      || existingMsg.conversationLinkId !== convLink.id
      || existingMsg.direction !== 'outgoing'
    )) {
      return { status: 'ignored', reason: 'Chatwoot message ID conflicts with an existing Tinix message mapping' };
    }

    const outboxId = randomUUID();
    const outboxRecord: OutboxMessage = {
      id: outboxId,
      workspaceId: connection.workspaceId,
      channelConnectionId: connection.id,
      conversationLinkId: convLink.id,
      chatwootAccountId: accountId,
      chatwootMessageId: messageId,
      idempotencyKey,
      payloadSnapshot: JSON.stringify({
        content: payload.content,
        recipientExternalId: sourceId,
        conversationId: displayId,
        origin,
        aiVersion,
        attachmentCount: Array.isArray(payload.attachments) ? payload.attachments.length : 0,
      }),
      state: 'pending',
      attemptCount: 0,
      correlationId,
      createdAt: new Date().toISOString(),
    };

    this.messageRepo.transaction(() => {
    this.outboxRepo.create(outboxRecord);

    // AI messages are first recorded before Chatwoot emits their callback; link that
    // existing projection to the real durable outbox ID instead of retaining a placeholder.
    if (existingMsg) {
      const linked = this.messageRepo.attachOutbox(
        existingMsg.id,
        outboxId,
        connection.workspaceId,
        connection.id
      );
      if (!linked) throw new Error('Unable to attach the Chatwoot callback outbox to its Tinix message');
    } else {
      this.messageRepo.create({
        id: randomUUID(),
        workspaceId: convLink.workspaceId,
        channelConnectionId: convLink.channelConnectionId,
        conversationLinkId: convLink.id,
        direction: 'outgoing',
        origin: origin === 'ai' ? 'ai' : 'human',
        metadata: { aiVersion, operationId },
        chatwootAccountId: accountId,
        chatwootMessageId: messageId,
        outboxId,
        deliveryState: 'queued',
        correlationId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }

    });
    return { status: 'accepted', outboxId };
  }
}
