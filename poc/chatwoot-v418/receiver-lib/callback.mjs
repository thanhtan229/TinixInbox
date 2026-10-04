import { createHmac, timingSafeEqual } from 'node:crypto';

export function verifySignature({ rawBody, timestamp, signature, secret, nowSeconds, toleranceSeconds }) {
  if (!secret || !timestamp || !signature) return { ok: false, reason: 'missing_signature_material' };

  const parsedTimestamp = Number(timestamp);
  if (!Number.isInteger(parsedTimestamp)) return { ok: false, reason: 'invalid_timestamp' };
  if (Math.abs(nowSeconds - parsedTimestamp) > toleranceSeconds) return { ok: false, reason: 'stale_timestamp' };

  const digest = createHmac('sha256', secret).update(`${timestamp}.`).update(rawBody).digest('hex');
  const expected = `sha256=${digest}`;
  const actualBytes = Buffer.from(signature);
  const expectedBytes = Buffer.from(expected);
  if (actualBytes.length !== expectedBytes.length || !timingSafeEqual(actualBytes, expectedBytes)) {
    return { ok: false, reason: 'invalid_signature' };
  }

  return { ok: true };
}

export function semanticMessageKey(payload) {
  const accountId = payload?.account?.id;
  const inboxId = payload?.inbox?.id;
  const messageId = payload?.id;
  if (accountId == null || inboxId == null || messageId == null) return null;
  return `${accountId}:${inboxId}:${payload.event ?? 'unknown'}:${messageId}`;
}

export function isOutboundCandidate(payload, { accountId, inboxId }) {
  return payload?.event === 'message_created'
    && String(payload?.account?.id ?? '') === String(accountId)
    && String(payload?.inbox?.id ?? '') === String(inboxId)
    && payload?.message_type === 'outgoing'
    && payload?.private === false
    && payload?.content_type === 'text'
    && (payload?.attachments == null || (Array.isArray(payload.attachments) && payload.attachments.length === 0))
    && payload?.id != null
    && payload?.conversation?.id != null;
}
