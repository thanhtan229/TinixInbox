import { randomUUID } from 'node:crypto';
import type { ChannelConnection } from '../../core/types.ts';
import type { UnifiedMessage } from '../../core/unified-message.ts';
import type { MetaMessagingEvent } from './meta-types.ts';

export function normalizeMetaMessagingEvent(
  event: MetaMessagingEvent,
  connection: ChannelConnection
): UnifiedMessage[] {
  // If event has no message (e.g. delivery or read receipt only), return empty
  if (!event.message) {
    return [];
  }

  // Skip echoes (outgoing messages from the page itself)
  if (event.message.is_echo) {
    return [];
  }

  const senderId = event.sender.id;
  const externalMessageId = event.message.mid || `meta-${randomUUID()}`;
  const text = event.message.text || '';

  const attachments = (event.message.attachments || []).map((att, idx) => ({
    id: `att-${idx}-${randomUUID().slice(0, 6)}`,
    type: att.type,
    url: att.payload.url,
  }));

  let messageType: UnifiedMessage['messageType'] = 'text';
  if (attachments.length > 0) {
    const firstType = attachments[0].type;
    if (firstType === 'image') messageType = 'image';
    else if (firstType === 'video') messageType = 'video';
    else if (firstType === 'audio') messageType = 'audio';
    else if (firstType === 'file') messageType = 'file';
  }

  const sentAt = event.timestamp ? new Date(event.timestamp).toISOString() : new Date().toISOString();

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
        externalId: event.recipient.id,
      },
      text,
      attachments,
      replyToExternalMessageId: event.message.reply_to?.mid,
      sentAt,
      receivedAt: new Date().toISOString(),
      providerMetadata: event as unknown as Record<string, unknown>,
    },
  ];
}
