import test from 'node:test';
import assert from 'node:assert/strict';
import { getDatabase } from '../../src/persistence/db.ts';
import { ChannelConnectionRepository, ConversationLinkRepository } from '../../src/persistence/repositories.ts';
import { ChatwootClient } from '../../src/providers/chatwoot/chatwoot-client.ts';
import { ChatwootConversationProvider } from '../../src/providers/chatwoot/chatwoot-provider.ts';
import { mapChatwootMessageToRef } from '../../src/providers/chatwoot/chatwoot-mapper.ts';

test('Chatwoot attachment mapping returns metadata without provider URLs', () => {
  const message = mapChatwootMessageToRef({
    id: 45,
    conversation_id: 12,
    message_type: 0,
    attachments: [
      { id: 9, file_type: 'image', file_name: 'customer.png', content_type: 'image/png', file_size: 512, data_url: 'https://chatwoot.local/secret-signed-url' },
      { file_type: 'sticker', file_name: 'sticker.webp' },
    ],
  });
  assert.deepEqual(message.attachments, [
    { id: '9', type: 'image', fileName: 'customer.png', mimeType: 'image/png', sizeBytes: 512 },
    { id: '1', type: 'file', fileName: 'sticker.webp', mimeType: undefined, sizeBytes: undefined },
  ]);
  assert.equal(JSON.stringify(message).includes('secret-signed-url'), false);
});

test('Chatwoot attachment proxy fetches mapped message media with a bounded same-origin request', async () => {
  const db = getDatabase(':memory:');
  const connections = new ChannelConnectionRepository(db);
  const conversations = new ConversationLinkRepository(db);
  const now = new Date().toISOString();
  connections.create({
    id: 'conn-meta', workspaceId: 'ws-1', provider: 'meta', displayName: 'Page', externalAccountId: 'page-1',
    status: 'connected', credentialsEncrypted: '{}', credentialVersion: 1, scopes: [], metadata: {},
    chatwootAccountId: 8, chatwootInboxId: 80, createdAt: now, updatedAt: now,
  });
  conversations.create({
    id: 'link-1', workspaceId: 'ws-1', channelConnectionId: 'conn-meta', tinixThreadKey: 'thread-1',
    chatwootAccountId: 8, chatwootInboxId: 80, chatwootConversationRef: '220',
    chatwootConversationDisplayId: 220, state: 'open', createdAt: now, updatedAt: now,
  });
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; token?: string }> = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, token: new Headers(init?.headers).get('api_access_token') || undefined });
    if (url.includes('/messages?before=221')) {
      return new Response(JSON.stringify({ payload: [{
        id: 220,
        attachments: [{ file_type: 'image', file_name: 'safe.png', data_url: '/rails/active_storage/blobs/safe.png' }],
      }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: { 'Content-Type': 'image/png', 'Content-Disposition': 'inline; filename="safe.png"', 'Content-Length': '3' },
    });
  }) as typeof fetch;
  try {
    const provider = new ChatwootConversationProvider(
      new ChatwootClient({ baseUrl: 'http://chatwoot.local', apiToken: 'test-only-token' }),
      connections
    );
    const file = await provider.downloadMessageAttachment({
      workspaceId: 'ws-1', conversationDisplayId: 220, messageId: 220, attachmentIndex: 0,
    });
    assert.deepEqual([...file.bytes], [1, 2, 3]);
    assert.equal(file.mimeType, 'image/png');
    assert.equal(file.fileName, 'safe.png');
    assert.equal(file.sizeBytes, 3);
    assert.match(calls[0]!.url, /accounts\/8\/conversations\/220\/messages\?before=221$/);
    assert.match(calls[1]!.url, /^http:\/\/chatwoot\.local\/rails\//);
    assert.deepEqual(calls.map((call) => call.token), ['test-only-token', 'test-only-token']);
  } finally {
    globalThis.fetch = originalFetch;
    db.close();
  }
});

test('Chatwoot attachment downloader refuses off-origin URLs and redirects without fetching them', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    return new Response(null, { status: 302, headers: { Location: 'https://evil.example/steal' } });
  }) as typeof fetch;
  try {
    const client = new ChatwootClient({ baseUrl: 'http://chatwoot.local', apiToken: 'test-only-token' });
    await assert.rejects(client.downloadAttachment('https://evil.example/a'), /left the configured origin/);
    await assert.rejects(client.downloadAttachment('/rails/redirect'), /left the configured origin/);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Chatwoot attachment downloader rejects declared files over the size limit before reading', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(new Uint8Array(), {
    status: 200,
    headers: { 'Content-Type': 'image/png', 'Content-Length': String(12 * 1024 * 1024 + 1) },
  })) as typeof fetch;
  try {
    const client = new ChatwootClient({ baseUrl: 'http://chatwoot.local', apiToken: 'test-only-token' });
    await assert.rejects(client.downloadAttachment('/rails/too-large'), /12 MB limit/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('local Active Storage aliases are fetched through the configured origin only', async () => {
  const original = globalThis.fetch; const urls: string[] = [];
  globalThis.fetch = (async url => { urls.push(String(url)); return new Response(new Uint8Array([1]),
    { status: 200, headers: { 'content-type': 'image/png' } }); }) as typeof fetch;
  try {
    const client = new ChatwootClient({ baseUrl: 'http://127.0.0.1:3180', apiToken: 'test' });
    await client.downloadAttachment('http://localhost:3180/rails/active_storage/blobs/redirect/signed/image.png');
    assert.match(urls[0]!, /^http:\/\/127\.0\.0\.1:3180\/rails\/active_storage\//);
    await assert.rejects(client.downloadAttachment('http://localhost:3181/rails/active_storage/image.png'), /configured origin/);
    await assert.rejects(client.downloadAttachment('http://localhost:3180/api/conversations'), /configured origin/);
    assert.equal(urls.length, 1);
  } finally { globalThis.fetch = original; }
});
