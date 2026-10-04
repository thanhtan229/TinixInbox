import { randomUUID } from 'node:crypto';
import type { ChannelConnection } from '../../core/types.ts';
import type { UnifiedMessage } from '../../core/unified-message.ts';
import type { ShopeeWebhookEvent } from './shopee-types.ts';

export function normalizeShopeeWebhookEvent(
  event: ShopeeWebhookEvent,
  connection: ChannelConnection
): UnifiedMessage[] {
  if (!event.data) {
    return [];
  }

  // Echo protection: messages sent from the shop itself are ignored
  if (event.data.from_id && event.data.from_id === event.shop_id) {
    return [];
  }

  const senderId = String(event.data.from_id || 'unknown-buyer');
  const externalMessageId = event.data.message_id || `shopee-${randomUUID()}`;
  const conversationId = event.data.conversation_id || senderId;

  let text = '';
  const attachments: UnifiedMessage['attachments'] = [];
  let messageType: UnifiedMessage['messageType'] = 'text';

  if (event.data.content?.text) {
    text = event.data.content.text;
  }

  if (event.data.content?.image_url) {
    attachments.push({
      id: `att-${randomUUID().slice(0, 6)}`,
      type: 'image',
      url: event.data.content.image_url,
    });
    messageType = 'image';
  }

  const sentAt = event.data.created_timestamp
    ? new Date(event.data.created_timestamp * 1000).toISOString()
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
      },
      text,
      attachments,
      sentAt,
      receivedAt: new Date().toISOString(),
      providerMetadata: event as unknown as Record<string, unknown>,
    },
  ];
}
