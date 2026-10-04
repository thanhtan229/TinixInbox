import test from 'node:test';
import assert from 'node:assert';
import { evaluateOutboundPredicate } from '../../src/providers/chatwoot/chatwoot-predicate.ts';

test('evaluateOutboundPredicate accepts valid public outgoing message', () => {
  const payload = {
    event: 'message_created',
    id: 101,
    content: 'Hello customer',
    message_type: 'outgoing',
    private: false,
    account: { id: 1 },
    inbox: { id: 2 },
  };

  const res = evaluateOutboundPredicate(payload, { accountId: 1, inboxId: 2 });
  assert.strictEqual(res.isCandidate, true);
  assert.strictEqual(res.semanticKey, '1:2:message_created:101');
});

test('evaluateOutboundPredicate rejects incoming messages (incoming echo protection)', () => {
  const payload = {
    event: 'message_created',
    id: 102,
    content: 'Hello agent',
    message_type: 'incoming',
    private: false,
    account: { id: 1 },
    inbox: { id: 2 },
  };

  const res = evaluateOutboundPredicate(payload, { accountId: 1, inboxId: 2 });
  assert.strictEqual(res.isCandidate, false);
  assert.match(res.reason!, /Not outgoing/);
});

test('evaluateOutboundPredicate rejects private notes (no internal note leak)', () => {
  const payload = {
    event: 'message_created',
    id: 103,
    content: 'Internal note: customer wants a refund',
    message_type: 'outgoing',
    private: true,
    account: { id: 1 },
    inbox: { id: 2 },
  };

  const res = evaluateOutboundPredicate(payload, { accountId: 1, inboxId: 2 });
  assert.strictEqual(res.isCandidate, false);
  assert.match(res.reason!, /Private note/);
});

test('evaluateOutboundPredicate rejects account/inbox mismatch', () => {
  const payload = {
    event: 'message_created',
    id: 104,
    content: 'Hello',
    message_type: 'outgoing',
    private: false,
    account: { id: 1 },
    inbox: { id: 99 }, // unexpected inbox
  };

  const res = evaluateOutboundPredicate(payload, { accountId: 1, inboxId: 2 });
  assert.strictEqual(res.isCandidate, false);
  assert.match(res.reason!, /Inbox mismatch/);
});

test('evaluateOutboundPredicate rejects non-message_created events', () => {
  const payload = {
    event: 'message_updated',
    id: 105,
    message_type: 'outgoing',
    private: false,
    account: { id: 1 },
    inbox: { id: 2 },
  };

  const res = evaluateOutboundPredicate(payload, { accountId: 1, inboxId: 2 });
  assert.strictEqual(res.isCandidate, false);
  assert.match(res.reason!, /Ignored event/);
});
