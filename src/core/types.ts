export type Direction = 'incoming' | 'outgoing';

export type Origin = 'customer' | 'human' | 'ai' | 'system';

export type MessageType =
  | 'text'
  | 'image'
  | 'video'
  | 'audio'
  | 'file'
  | 'sticker'
  | 'location'
  | 'product'
  | 'order'
  | 'unsupported';

export type DeliveryState =
  | 'queued'
  | 'sending'
  | 'provider_accepted'
  | 'delivered'
  | 'read'
  | 'retry_wait'
  | 'unknown'
  | 'failed'
  | 'dead_letter';

export type OutboxState =
  | 'pending'
  | 'sending'
  | 'provider_accepted'
  | 'retry_wait'
  | 'unknown'
  | 'failed'
  | 'dead_letter';

export type AIMode = 'ai' | 'hybrid' | 'human' | 'paused';

export type ChannelProvider = 'meta' | 'zalo' | 'tiktok_shop' | 'shopee' | 'synthetic' | string;

export interface Attachment {
  id?: string;
  type: string;
  url?: string;
  mimeType?: string;
  fileName?: string;
  sizeBytes?: number;
  providerResourceId?: string;
}

export interface MessageSender {
  externalId: string;
  displayName?: string;
  avatarUrl?: string;
}

export interface MessageRecipient {
  externalId: string;
}

export interface ChannelCapabilities {
  inboundText: boolean;
  outboundText: boolean;
  attachments: string[];
  deliveryReceipts: boolean;
  readReceipts: boolean;
  markRead: boolean;
  typing: boolean;
  reactions: boolean;
  replyToMessage: boolean;
}

export interface ChannelConnection {
  id: string;
  workspaceId: string;
  provider: ChannelProvider;
  displayName: string;
  externalAccountId: string;
  status: 'pending' | 'connected' | 'degraded' | 'expired' | 'revoked' | 'disabled' | 'disconnected';
  credentialsEncrypted: string;
  credentialVersion: number;
  scopes: string[];
  metadata: Record<string, unknown>;
  chatwootAccountId?: number;
  chatwootInboxId?: number;
  chatwootApiChannelIdentifier?: string;
  chatwootCallbackSecretRef?: string;
  createdAt: string;
  updatedAt: string;
  lastVerifiedAt?: string;
  lastSuccessfulEventAt?: string;
  lastError?: string;
}

export interface ExternalContactLink {
  id: string;
  workspaceId: string;
  channelConnectionId: string;
  provider: ChannelProvider;
  externalUserId: string;
  chatwootAccountId: number;
  chatwootContactId: number;
  chatwootContactInboxId?: number;
  chatwootSourceId: string;
  customerIdentityId?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationLink {
  id: string;
  workspaceId: string;
  channelConnectionId: string;
  externalConversationId?: string;
  tinixThreadKey: string;
  chatwootAccountId: number;
  chatwootInboxId: number;
  chatwootContactInboxId?: number;
  chatwootConversationRef: string;
  chatwootConversationDisplayId: number;
  state: 'open' | 'resolved' | 'pending' | 'snoozed';
  providerLastMessageAt?: string;
  lastReconciledAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface MessageLink {
  id: string;
  workspaceId: string;
  channelConnectionId: string;
  conversationLinkId: string;
  direction: Direction;
  origin: Origin;
  externalMessageId?: string;
  providerMessageId?: string;
  chatwootAccountId: number;
  chatwootMessageId: number;
  outboxId?: string;
  deliveryState: DeliveryState;
  providerSentAt?: string;
  providerAcceptedAt?: string;
  deliveredAt?: string;
  readAt?: string;
  failedAt?: string;
  correlationId: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface OutboxMessage {
  id: string;
  workspaceId: string;
  channelConnectionId: string;
  conversationLinkId: string;
  chatwootAccountId: number;
  chatwootMessageId: number;
  idempotencyKey: string;
  payloadSnapshot: string;
  state: OutboxState;
  attemptCount: number;
  nextAttemptAt?: string;
  providerMessageId?: string;
  providerResponseRef?: string;
  correlationId: string;
  createdAt: string;
  claimedAt?: string;
  sentAt?: string;
  lastError?: string;
}

export interface ConversationAIState {
  workspaceId: string;
  conversationProvider: string;
  providerConversationId: string;
  mode: AIMode;
  version: number;
  pauseReason?: string;
  humanOwnerId?: string;
  lastAiMessageAt?: string;
  lastHumanMessageAt?: string;
  updatedAt: string;
}
