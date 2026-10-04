import test from 'node:test';
import assert from 'node:assert/strict';
import { SecureAttachmentFetcher, isPublicMediaAddress, validateImportedMedia } from '../../src/services/attachment-fetcher.ts';
import { ChatwootClient } from '../../src/providers/chatwoot/chatwoot-client.ts';
import { ChatwootConversationProvider } from '../../src/providers/chatwoot/chatwoot-provider.ts';
import { getDatabase } from '../../src/persistence/db.ts';
import { ChannelConnectionRepository } from '../../src/persistence/repositories.ts';
import { AttachmentPreparationError, ProviderTemporaryError } from '../../src/core/errors.ts';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jCfkAAAAASUVORK5CYII=', 'base64');
test('media URL policy rejects credentials, private IPs, untrusted hosts and misleading domain suffixes', () => {
  const fetcher = new SecureAttachmentFetcher(['fbcdn.net']);
  assert.equal(fetcher.validateUrl('https://scontent.example.fbcdn.net/file').hostname, 'scontent.example.fbcdn.net');
  for (const url of ['http://fbcdn.net/file', 'https://fbcdn.net:444/file', 'https://user:secret@fbcdn.net/file',
    'https://fbcdn.net.evil.test/file', 'https://evilfbcdn.net/file', 'https://127.0.0.1/file', 'https://[::1]/file', 'file:///etc/passwd']) {
    assert.throws(() => fetcher.validateUrl(url));
  }
  for (const ip of ['127.0.0.1', '10.0.0.1', '169.254.169.254', '172.16.0.1', '192.168.1.1', '100.64.1.1',
    '0.0.0.0', '203.0.113.1', '224.0.0.1', '::1', '::ffff:127.0.0.1', 'fc00::1', 'fe80::1', '2001:0db8::1', '2002:7f00:1::']) {
    assert.equal(isPublicMediaAddress(ip), false, ip);
  }
  assert.equal(isPublicMediaAddress('8.8.8.8'), true); assert.equal(isPublicMediaAddress('2606:4700:4700::1111'), true);
});

test('media content validates declared type, magic bytes and size', () => {
  assert.doesNotThrow(() => validateImportedMedia(png, 'image/png', 'image'));
  assert.throws(() => validateImportedMedia(Buffer.from('<html>'), 'image/png', 'image'));
  assert.throws(() => validateImportedMedia(png, 'text/html', 'file'));
  assert.throws(() => validateImportedMedia(png, 'image/png', 'video'));
  assert.throws(() => validateImportedMedia(new Uint8Array(12 * 1024 * 1024 + 1), 'application/octet-stream', 'file'));
});

test('incoming media uses multipart with stable source ID and no manually set content type', async () => {
  const original = globalThis.fetch; let captured: FormData | undefined;
  globalThis.fetch = (async (_url, init) => {
    assert.equal((init?.headers as Record<string, string>)['Content-Type'], undefined);
    assert.ok(init?.body instanceof FormData); captured = init.body;
    return new Response(JSON.stringify({ id: 4 }), { status: 200 });
  }) as typeof fetch;
  try {
    await new ChatwootClient({ baseUrl: 'http://chatwoot.test', apiToken: 'test' }).createMessage(1, 2,
      { content: '', message_type: 'incoming', private: false, source_id: 'external', content_attributes: { tinix_media_import: 'imported' },
        attachments: [{ bytes: png, mimeType: 'image/png', fileName: 'attachment.png' }] });
    assert.equal(captured?.get('source_id'), 'external'); assert.equal(captured?.get('message_type'), 'incoming');
    const file = captured?.get('attachments[]') as File;
    assert.equal(file.type, 'image/png'); assert.deepEqual(Buffer.from(await file.arrayBuffer()), png);
  } finally { globalThis.fetch = original; }
});

test('temporary media fetch failure occurs before any remote message write', async () => {
  const db = getDatabase(':memory:'), repo = new ChannelConnectionRepository(db), now = new Date().toISOString();
  repo.create({ id: 'media', workspaceId: 'ws', provider: 'meta', displayName: 'media', externalAccountId: 'page', status: 'connected',
    credentialsEncrypted: '{}', credentialVersion: 1, scopes: [], metadata: {}, chatwootAccountId: 1, chatwootInboxId: 1, createdAt: now, updatedAt: now });
  let writes = 0;
  const client = new ChatwootClient({ baseUrl: 'http://chatwoot.test', apiToken: 'test' });
  client.createMessage = async () => { writes++; throw new Error('must not write'); };
  const provider = new ChatwootConversationProvider(client, repo, { async download() { throw new ProviderTemporaryError('503'); } });
  await assert.rejects(provider.createIncomingMessage({ workspaceId: 'other-workspace', channelConnectionId: 'media',
    conversationId: 1, externalMessageId: 'external' }), /workspace boundary/);
  await assert.rejects(provider.createIncomingMessage({ workspaceId: 'ws', channelConnectionId: 'media', conversationId: 1,
    externalMessageId: 'external', attachments: [{ type: 'image', url: 'https://fbcdn.net/media' }] }), AttachmentPreparationError);
  assert.equal(writes, 0); db.close();
});
