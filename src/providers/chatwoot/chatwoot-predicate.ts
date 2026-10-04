export interface ChatwootCallbackPayload {
  event?: string;
  id?: number | string;
  content?: string;
  message_type?: string | number;
  private?: boolean | number;
  content_type?: string;
  content_attributes?: Record<string, unknown>;
  attachments?: unknown[];
  account?: { id?: number | string; name?: string };
  inbox?: { id?: number | string; name?: string };
  conversation?: {
    id?: number | string;
    contact_inbox?: {
      id?: number | string;
      source_id?: string;
      contact_id?: number | string;
      inbox_id?: number | string;
    };
  };
  sender?: {
    id?: number | string;
    type?: string;
    name?: string;
  };
}

export interface PredicateEvaluation {
  isCandidate: boolean;
  reason?: string;
  semanticKey?: string;
}

export function evaluateOutboundPredicate(
  payload: ChatwootCallbackPayload,
  expected: { accountId: number; inboxId: number }
): PredicateEvaluation {
  // 1. Must be a message_created event
  if (payload.event !== 'message_created') {
    return { isCandidate: false, reason: `Ignored event: ${payload.event}` };
  }

  // 2. Must belong to the expected account
  const payloadAccountId = Number(payload.account?.id);
  if (payloadAccountId !== expected.accountId) {
    return { isCandidate: false, reason: `Account mismatch: expected ${expected.accountId}, got ${payloadAccountId}` };
  }

  // 3. Must belong to the expected inbox
  const payloadInboxId = Number(payload.inbox?.id);
  if (payloadInboxId !== expected.inboxId) {
    return { isCandidate: false, reason: `Inbox mismatch: expected ${expected.inboxId}, got ${payloadInboxId}` };
  }

  // 4. Must be an outgoing message
  const isOutgoing = payload.message_type === 'outgoing' || payload.message_type === 1;
  if (!isOutgoing) {
    return { isCandidate: false, reason: `Not outgoing message (message_type: ${payload.message_type})` };
  }

  // 5. Must NOT be private note
  if (payload.private === true || payload.private === 1) {
    return { isCandidate: false, reason: 'Private note is strictly internal' };
  }

  // 6. Must have valid message ID
  const messageId = payload.id;
  if (messageId === undefined || messageId === null) {
    return { isCandidate: false, reason: 'Missing message ID' };
  }

  // 7. Ignore activity / system message types
  if (payload.content_type === 'activity') {
    return { isCandidate: false, reason: 'Activity messages are not sent to providers' };
  }

  const semanticKey = `${payloadAccountId}:${payloadInboxId}:message_created:${messageId}`;
  return {
    isCandidate: true,
    semanticKey,
  };
}
