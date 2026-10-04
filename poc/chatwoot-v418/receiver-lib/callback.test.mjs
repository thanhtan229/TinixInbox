import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { isOutboundCandidate, semanticMessageKey, verifySignature } from './callback.mjs';

const secret = 'local-poc-only-secret';
const rawBody = '{"event":"message_created","id":41}';
const timestamp = '1790553600';
const signature = `sha256=${createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex')}`;
const nowSeconds = Number(timestamp);

test('accepts a valid raw-body HMAC inside the timestamp window', () => {
  assert.deepEqual(verifySignature({ rawBody: Buffer.from(rawBody, 'utf8'), timestamp, signature, secret, nowSeconds, toleranceSeconds: 300 }), { ok: true });
});

test('rejects a modified body and a stale timestamp', () => {
  assert.equal(verifySignature({ rawBody: `${rawBody} `, timestamp, signature, secret, nowSeconds, toleranceSeconds: 300 }).reason, 'invalid_signature');
  assert.equal(verifySignature({ rawBody, timestamp, signature, secret, nowSeconds: nowSeconds + 301, toleranceSeconds: 300 }).reason, 'stale_timestamp');
});

test('rejects missing signature material and malformed timestamps', () => {
  assert.equal(verifySignature({ rawBody, timestamp, signature, secret: '', nowSeconds, toleranceSeconds: 300 }).reason, 'missing_signature_material');
  assert.equal(verifySignature({ rawBody, timestamp: 'tomorrow', signature, secret, nowSeconds, toleranceSeconds: 300 }).reason, 'invalid_timestamp');
});

test('only allows mapped public outgoing text messages into the fake outbox', () => {
  const payload = {
    event: 'message_created', id: 41, account: { id: 7 }, inbox: { id: 12 },
    conversation: { id: 88 }, message_type: 'outgoing', private: false, content_type: 'text',
  };
  assert.equal(isOutboundCandidate(payload, { accountId: 7, inboxId: 12 }), true);
  assert.equal(isOutboundCandidate({ ...payload, private: true }, { accountId: 7, inboxId: 12 }), false);
  assert.equal(isOutboundCandidate({ ...payload, message_type: 'incoming' }, { accountId: 7, inboxId: 12 }), false);
  assert.equal(isOutboundCandidate({ ...payload, message_type: 'template' }, { accountId: 7, inboxId: 12 }), false);
  assert.equal(isOutboundCandidate({ ...payload, event: 'message_updated' }, { accountId: 7, inboxId: 12 }), false);
  assert.equal(isOutboundCandidate({ ...payload, content_type: 'template' }, { accountId: 7, inboxId: 12 }), false);
  assert.equal(isOutboundCandidate({ ...payload, attachments: [{ data_url: 'https://example.test/file.txt' }] }, { accountId: 7, inboxId: 12 }), false);
  assert.equal(isOutboundCandidate({ ...payload, attachments: 'malformed' }, { accountId: 7, inboxId: 12 }), false);
  assert.equal(isOutboundCandidate(payload, { accountId: 8, inboxId: 12 }), false);
  assert.equal(isOutboundCandidate(payload, { accountId: 7, inboxId: 13 }), false);
});

test('semantic key includes account, inbox, event and message identity', () => {
  assert.equal(semanticMessageKey({ event: 'message_created', id: 41, account: { id: 7 }, inbox: { id: 12 } }), '7:12:message_created:41');
  assert.equal(semanticMessageKey({ event: 'message_created', account: { id: 7 }, inbox: { id: 12 } }), null);
});
