import type { Attachment, ChannelConnection, ChannelProvider } from './types.ts';
import type { UnifiedMessage } from './unified-message.ts';

export interface ChannelSendRequest {
  workspaceId: string;
  channelConnectionId: string;
  recipientExternalId: string;
  text?: string;
  attachments?: Attachment[];
  replyToExternalMessageId?: string;
  correlationId: string;
  metadata?: Record<string, unknown>;
}

export interface ChannelSendResult {
  success: boolean;
  failureKind?: 'retryable' | 'permanent' | 'unknown';
  providerMessageId?: string;
  sentAt: string;
  rawResponse?: unknown;
  error?: string;
}

export interface ChannelAdapter {
  readonly provider: ChannelProvider;

  validateConnection(credentials: string): Promise<{ valid: boolean; error?: string }>;

  verifyWebhook(
    rawBody: string,
    headers: Record<string, string | string[] | undefined>,
    secret: string
  ): Promise<boolean>;

  parseWebhook(
    rawBody: string,
    headers: Record<string, string | string[] | undefined>
  ): Promise<unknown[]>;

  normalizeEvent(
    rawEvent: unknown,
    connection: ChannelConnection
  ): Promise<UnifiedMessage[]>;

  sendMessage(request: ChannelSendRequest): Promise<ChannelSendResult>;

  markRead?(
    channelConnectionId: string,
    recipientExternalId: string,
    externalMessageId: string
  ): Promise<void>;

  sendTyping?(
    channelConnectionId: string,
    recipientExternalId: string
  ): Promise<void>;
}
