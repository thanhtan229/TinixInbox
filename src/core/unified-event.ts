import { randomUUID } from 'node:crypto';

export type UnifiedEventType =
  | 'channel.connection.created'
  | 'channel.connection.updated'
  | 'channel.connection.disabled'
  | 'channel.credentials.expiring'
  | 'channel.webhook.received'
  | 'channel.message.received'
  | 'channel.message.sent'
  | 'channel.message.delivered'
  | 'channel.message.read'
  | 'channel.message.failed'
  | 'conversation.created'
  | 'conversation.updated'
  | 'agent.reply.requested'
  | 'agent.reply.created'
  | 'agent.reply.skipped'
  | 'handoff.ai_enabled'
  | 'handoff.ai_paused'
  | 'handoff.human_active'
  | 'dead_letter.created';

export interface UnifiedEvent<T = Record<string, unknown>> {
  eventId: string;
  eventType: UnifiedEventType;
  workspaceId: string;
  correlationId: string;
  causationId?: string;
  occurredAt: string;
  payload: T;
}

export function createUnifiedEvent<T = Record<string, unknown>>(
  eventType: UnifiedEventType,
  workspaceId: string,
  payload: T,
  correlationId?: string,
  causationId?: string
): UnifiedEvent<T> {
  return {
    eventId: randomUUID(),
    eventType,
    workspaceId,
    correlationId: correlationId || randomUUID(),
    causationId,
    occurredAt: new Date().toISOString(),
    payload,
  };
}
