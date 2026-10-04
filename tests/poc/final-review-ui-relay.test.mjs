import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { randomUUID } from 'node:crypto';
import { createMetaRelayServer } from '../../scripts/meta-webhook-relay.mjs';

const html = readFileSync(new URL('../../public/index.html', import.meta.url), 'utf8');
function extract(start, end) { const i = html.indexOf(start); assert.ok(i >= 0); return html.slice(i, html.indexOf(end, i)); }

test('stale conversation history cannot overwrite the selected conversation', async () => {
  const area = { scrollHeight: 0, scrollTop: 0, clientHeight: 0, innerHTML: '' };
  let resolveA; const delay = new Promise(resolve => { resolveA = resolve; });
  const context = createContext({ document: { getElementById: () => area }, messageCache: new Map(), olderMessagesAvailable: new Map(),
    activeConversation: { id: 'A' }, escapeHtml: String, formatDeliveryState: String,
    fetch: async url => { if (url.includes('/A/')) await delay; return { ok: true, json: async () => [{ id: url.includes('/A/') ? 1 : 2,
      content: url.includes('/A/') ? 'history A' : 'history B', direction: 'incoming', createdAt: '2026-01-01', attachments: [] }] }; } });
  runInContext(extract('const messageRequestVersions', 'function formatDeliveryState('), context);
  const pending = runInContext("loadMessages('A')", context);
  context.activeConversation = { id: 'B' }; await runInContext("loadMessages('B')", context);
  resolveA(); await pending; assert.ok(area.innerHTML.includes('history B')); assert.ok(!area.innerHTML.includes('history A'));
});

test('double-submit sends once to the captured conversation and preserves a newer draft', async () => {
  const input = { value: 'first draft' }, button = { disabled: false }, checkbox = { checked: false }, stored = new Map(), requests = [];
  let resolvePost; const delay = new Promise(resolve => { resolvePost = resolve; });
  const context = createContext({ activeConversation: { id: 'A', connectionStatus: 'connected' }, crypto: { randomUUID },
    sessionStorage: { getItem: key => stored.get(key), setItem: (key, value) => stored.set(key, value), removeItem: key => stored.delete(key) },
    document: { getElementById: id => id === 'messageInput' ? input : id === 'privateCheckbox' ? checkbox : button },
    alert: assert.fail, loadMessages: async () => {}, fetch: async (url, init) => { requests.push({ url, body: JSON.parse(init.body) }); await delay; return { ok: true }; } });
  runInContext(extract('let sendInProgress', 'async function toggleTakeover('), context);
  const first = runInContext('handleSendMessage()', context), second = runInContext('handleSendMessage()', context);
  input.value = 'new draft'; context.activeConversation = { id: 'B', connectionStatus: 'connected' };
  resolvePost(); await Promise.all([first, second]);
  assert.equal(requests.length, 1); assert.match(requests[0].url, /\/A\/messages$/);
  assert.ok(requests[0].body.operationId); assert.equal(input.value, 'new draft');
});

test('Meta relay forwards only explicit webhook routes and preserves raw signatures', async () => {
  const calls = [];
  const server = createMetaRelayServer({ fetchFn: async (url, init) => { calls.push({ url, init }); return new Response('ok'); } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const path of ['/api/connections', '/', '/metrics', '/webhooks/chatwoot', '/webhooks/inbox/meta']) {
      assert.equal((await fetch(base + path)).status, 404);
    }
    assert.equal((await fetch(base + '/webhooks/inbox/meta/connection?hub.challenge=abc')).status, 200);
    const raw = '{ "entry": [] }';
    assert.equal((await fetch(base + '/webhooks/inbox/meta/connection', { method: 'POST', body: raw,
      headers: { 'x-hub-signature-256': 'sha256=test', cookie: 'private' } })).status, 200);
    assert.equal(calls.length, 2); assert.equal(String(calls[1].init.body), raw);
    assert.equal(calls[1].init.headers['x-hub-signature-256'], 'sha256=test'); assert.equal(calls[1].init.headers.cookie, undefined);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
