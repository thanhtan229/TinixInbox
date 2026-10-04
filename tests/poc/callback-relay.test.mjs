import assert from 'node:assert/strict';
import test from 'node:test';
import { createCallbackRelayServer } from '../../poc/chatwoot-v418/tinix-callback-relay.mjs';

test('callback relay refuses other paths without forwarding them', async () => {
  let forwarded = false;
  const server = createCallbackRelayServer({
    fetchFn: async () => {
      forwarded = true;
      return new Response('{}');
    },
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const response = await fetch(`http://127.0.0.1:${address.port}/api/conversations`);
    assert.equal(response.status, 404);
    assert.equal(forwarded, false);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test('callback relay preserves raw body and only forwards Chatwoot signature headers', async () => {
  let captured;
  const server = createCallbackRelayServer({
    upstreamUrl: 'http://127.0.0.1:3182/webhooks/chatwoot',
    fetchFn: async (url, init) => {
      captured = { url, init };
      return new Response('{"ok":true}', { status: 200 });
    },
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const body = '{ "event": "message_created", "id": 51 }';
    const response = await fetch(`http://127.0.0.1:${address.port}/webhooks/chatwoot`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-chatwoot-signature': 'sha256=test-signature',
        'x-chatwoot-timestamp': '1234567890',
        cookie: 'must-not-forward',
      },
      body,
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
    assert.equal(captured.url, 'http://127.0.0.1:3182/webhooks/chatwoot');
    assert.equal(Buffer.from(captured.init.body).toString('utf8'), body);
    assert.equal(captured.init.headers['x-chatwoot-signature'], 'sha256=test-signature');
    assert.equal(captured.init.headers['x-chatwoot-timestamp'], '1234567890');
    assert.equal('cookie' in captured.init.headers, false);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
