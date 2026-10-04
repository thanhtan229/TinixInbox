import test from 'node:test';
import assert from 'node:assert/strict';
import { ChatwootClient } from '../../src/providers/chatwoot/chatwoot-client.ts';

test('Chatwoot message history forwards the before cursor only when provided', async () => {
  const originalFetch = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    urls.push(String(input));
    return new Response(JSON.stringify({ payload: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  try {
    const client = new ChatwootClient({ baseUrl: 'http://chatwoot.test', apiToken: 'test-token' });
    await client.listMessages(7, 99);
    await client.listMessages(7, 99, 123);
    assert.strictEqual(urls[0], 'http://chatwoot.test/api/v1/accounts/7/conversations/99/messages');
    assert.strictEqual(urls[1], 'http://chatwoot.test/api/v1/accounts/7/conversations/99/messages?before=123');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
