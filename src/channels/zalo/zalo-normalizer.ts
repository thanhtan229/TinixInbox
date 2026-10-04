import { randomUUID } from 'node:crypto';
import type { ChannelConnection } from '../../core/types.ts';
import type { UnifiedMessage } from '../../core/unified-message.ts';
import type { ZaloWebhookEvent } from './zalo-types.ts';

export function normalizeZaloWebhookEvent(
  event: ZaloWebhookEvent,
  connection: ChannelConnection
): UnifiedMessage[] {
  // Ignore OA echoes to prevent outbound/incoming loop
  if (event.event_name && event.event_name.startsWith('oa_send_')) {
    return [];
  }

  // If event has no message payload (e.g., follow, unfollow), return empty
  if (!event.message) {
    return [];
  }

  const senderId = event.sender?.id || event.user_id_by_app || 'unknown-user';
  const recipientId = event.recipient?.id || event.oa_id || 'unknown-oa';
  const externalMessageId = event.message.msg_id || `zalo-${randomUUID()}`;
  const text = event.message.text || '';

  const attachments = (event.message.attachments || []).map((att, idx) => ({
    id: `att-${idx}-${randomUUID().slice(0, 6)}`,
    type: att.type || 'file',
    url: (att.payload?.url || att.payload?.thumbnail) as string | undefined,
  }));

  let messageType: UnifiedMessage['messageType'] = 'text';
  if (attachments.length > 0) {
    const firstType = attachments[0].type.toLowerCase();
    if (firstType === 'image') messageType = 'image';
    else if (firstType === 'audio') messageType = 'audio';
    else if (firstType === 'video') messageType = 'video';
    else messageType = 'file';
  }

  let sentAt = new Date().toISOString();
  if (event.timestamp) {
    const ts = typeof event.timestamp === 'string' ? parseInt(event.timestamp, 10) : event.timestamp;
    if (!Number.isNaN(ts) && ts > 0) {
      // If timestamp is in seconds instead of ms
      const dateMs = ts < 10000000000 ? ts * 1000 : ts;
      sentAt = new Date(dateMs).toISOString();
    }
  }

  return [
    {
      id: randomUUID(),
      workspaceId: connection.workspaceId,
      provider: connection.provider,
      channelConnectionId: connection.id,
      externalConversationId: senderId,
      externalMessageId,
      direction: 'incoming',
      messageType,
      sender: {
        externalId: senderId,
      },
      recipient: {
        externalId: recipientId,
      },
      text,
      attachments,
      sentAt,
      receivedAt: new Date().toISOString(),
      providerMetadata: event as unknown as Record<string, unknown>,
    },
  ];
}
