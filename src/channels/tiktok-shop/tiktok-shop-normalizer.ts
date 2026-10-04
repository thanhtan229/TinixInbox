import { randomUUID } from 'node:crypto';
import type { ChannelConnection } from '../../core/types.ts';
import type { UnifiedMessage } from '../../core/unified-message.ts';
import type { TikTokShopWebhookEvent } from './tiktok-shop-types.ts';

export function normalizeTikTokShopWebhookEvent(
  event: TikTokShopWebhookEvent,
  connection: ChannelConnection
): UnifiedMessage[] {
  // If no data or not message event, skip
  if (!event.data) {
    return [];
  }

  // Echo protection: skip seller messages sent by the shop itself
  if (event.data.sender?.role === 'SELLER') {
    return [];
  }

  const senderId = event.data.sender?.id || 'unknown-buyer';
  const externalMessageId = event.data.message_id || `tts-${randomUUID()}`;
  const conversationId = event.data.conversation_id || senderId;

  let text = '';
  const attachments: UnifiedMessage['attachments'] = [];
  let messageType: UnifiedMessage['messageType'] = 'text';

  if (event.data.content) {
    try {
      const parsedContent = JSON.parse(event.data.content);
      if (parsedContent.text) {
        text = parsedContent.text;
      }
      if (parsedContent.url) {
        attachments.push({
          id: `att-${randomUUID().slice(0, 6)}`,
          type: 'image',
          url: parsedContent.url,
        });
        messageType = 'image';
      }
    } catch {
      text = event.data.content;
    }
  }

  if (event.data.message_type === 'IMAGE' && attachments.length > 0) {
    messageType = 'image';
  }

  const sentAt = event.data.create_time
    ? new Date(event.data.create_time * 1000).toISOString()
    : new Date().toISOString();

  return [
    {
      id: randomUUID(),
      workspaceId: connection.workspaceId,
      provider: connection.provider,
      channelConnectionId: connection.id,
      externalConversationId: conversationId,
      externalMessageId,
      direction: 'incoming',
      messageType,
      sender: {
        externalId: senderId,
        displayName: event.data.sender?.name,
      },
      text,
      attachments,
      sentAt,
      receivedAt: new Date().toISOString(),
      providerMetadata: event as unknown as Record<string, unknown>,
    },
  ];
}
