import type { Attachment, Direction, MessageRecipient, MessageSender, MessageType } from './types.ts';

export interface UnifiedMessage {
  id: string;
  workspaceId: string;
  provider: string;
  channelConnectionId: string;
  externalConversationId: string;
  externalMessageId: string;
  direction: Direction;
  messageType: MessageType;
  sender: MessageSender;
  recipient?: MessageRecipient;
  text?: string;
  attachments: Attachment[];
  replyToExternalMessageId?: string;
  sentAt: string;
  receivedAt: string;
  providerMetadata?: Record<string, unknown>;
}

export function computeInboundIdempotencyKey(
  workspaceId: string,
  channelConnectionId: string,
  externalMessageId: string
): string {
  return `${workspaceId}:${channelConnectionId}:${externalMessageId}`;
}

export function validateUnifiedMessage(message: Partial<UnifiedMessage>): message is UnifiedMessage {
  if (!message.workspaceId || typeof message.workspaceId !== 'string') return false;
  if (!message.channelConnectionId || typeof message.channelConnectionId !== 'string') return false;
  if (!message.externalMessageId || typeof message.externalMessageId !== 'string') return false;
  if (!message.direction || !['incoming', 'outgoing'].includes(message.direction)) return false;
  if (!message.sender || typeof message.sender.externalId !== 'string') return false;
  if (!Array.isArray(message.attachments)) return false;
  if (!message.sentAt || isNaN(Date.parse(message.sentAt))) return false;
  if (!message.receivedAt || isNaN(Date.parse(message.receivedAt))) return false;
  return true;
}
