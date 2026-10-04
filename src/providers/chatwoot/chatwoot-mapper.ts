import type { ConversationRef, MessageRef } from '../../core/conversation-provider.ts';
import type { Direction } from '../../core/types.ts';

export function mapChatwootMessageToRef(raw: Record<string, unknown>): MessageRef {
  const messageType = raw.message_type;
  const isIncoming = messageType === 0 || messageType === 'incoming';
  const direction: Direction = isIncoming ? 'incoming' : 'outgoing';
  const isPrivate = Boolean(raw.private);

  let createdAtStr = new Date().toISOString();
  if (typeof raw.created_at === 'number') {
    createdAtStr = new Date(raw.created_at * 1000).toISOString();
  } else if (typeof raw.created_at === 'string') {
    createdAtStr = raw.created_at;
  }

  return {
    messageId: Number(raw.id),
    conversationId: Number(raw.conversation_id),
    content: String(raw.content || ''),
    direction,
    isPrivate,
    status: String(raw.status || 'sent'),
    createdAt: createdAtStr,
    externalMessageId: typeof raw.source_id === 'string' ? raw.source_id : undefined,
    operationId: typeof (raw.content_attributes as Record<string, unknown> | undefined)?.tinix_operation_id === 'string'
      ? String((raw.content_attributes as Record<string, unknown>).tinix_operation_id) : undefined,
    attachments: Array.isArray(raw.attachments) ? raw.attachments.flatMap((item, index) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
      const attachment = item as Record<string, unknown>;
      const rawType = String(attachment.file_type || attachment.type || 'file').toLowerCase();
      const type = ['image', 'video', 'audio'].includes(rawType) ? rawType : 'file';
      const fileName = typeof attachment.file_name === 'string' && attachment.file_name.trim()
        ? attachment.file_name.trim()
        : `attachment-${index + 1}`;
      const mimeType = typeof attachment.content_type === 'string' ? attachment.content_type : undefined;
      const sizeBytes = Number(attachment.file_size);
      return [{
        id: String(attachment.id ?? index),
        type,
        fileName,
        mimeType,
        sizeBytes: Number.isSafeInteger(sizeBytes) && sizeBytes >= 0 ? sizeBytes : undefined,
      }];
    }) : [],
  };
}

export function mapChatwootConversationToRef(raw: Record<string, unknown>): ConversationRef {
  const displayId = Number(raw.id || raw.display_id);
  return {
    conversationId: displayId,
    displayId,
    uuid: raw.uuid ? String(raw.uuid) : undefined,
  };
}
