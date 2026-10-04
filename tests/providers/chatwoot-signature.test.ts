import test from 'node:test';
import assert from 'node:assert';
import { createHmac } from 'node:crypto';
import { verifyChatwootSignature } from '../../src/providers/chatwoot/chatwoot-signature.ts';

test('verifyChatwootSignature validates valid signature and timestamp', () => {
  const secret = 'test-secret-key-123';
  const body = JSON.stringify({ event: 'message_created', id: 42 });
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = `sha256=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;

  const res = verifyChatwootSignature(body, signature, String(timestamp), secret);
  assert.strictEqual(res.valid, true);
});

test('verifyChatwootSignature rejects stale timestamp', () => {
  const secret = 'test-secret-key-123';
  const body = JSON.stringify({ event: 'message_created', id: 42 });
  const oldTimestamp = Math.floor(Date.now() / 1000) - 1000; // 1000s ago
  const signature = `sha256=${createHmac('sha256', secret).update(`${oldTimestamp}.${body}`).digest('hex')}`;

  const res = verifyChatwootSignature(body, signature, String(oldTimestamp), secret, { toleranceSeconds: 300 });
  assert.strictEqual(res.valid, false);
  assert.strictEqual(res.reason, 'stale_timestamp');
});

test('verifyChatwootSignature rejects tampered body', () => {
  const secret = 'test-secret-key-123';
  const body = JSON.stringify({ event: 'message_created', id: 42 });
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = `sha256=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;

  const tamperedBody = JSON.stringify({ event: 'message_created', id: 999 });
  const res = verifyChatwootSignature(tamperedBody, signature, String(timestamp), secret);
  assert.strictEqual(res.valid, false);
  assert.strictEqual(res.reason, 'signature_mismatch');
});

test('verifyChatwootSignature rejects wrong secret', () => {
  const secret = 'test-secret-key-123';
  const body = JSON.stringify({ event: 'message_created', id: 42 });
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = `sha256=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;

  const res = verifyChatwootSignature(body, signature, String(timestamp), 'wrong-secret');
  assert.strictEqual(res.valid, false);
  assert.strictEqual(res.reason, 'signature_mismatch');
});
