import test from 'node:test';
import assert from 'node:assert/strict';
import { createAppServer } from '../../src/api/server.ts';
import type { CallbackController } from '../../src/api/callback-controller.ts';
import type { WebhookController } from '../../src/api/webhook-controller.ts';
import type { InboxController } from '../../src/api/inbox-controller.ts';

test('attachment API returns bounded bytes with safe download headers', async () => {
  const requests: Array<{ id: string; messageId: number; index: number }> = [];
  const app = createAppServer({
    port: 0,
    host: '127.0.0.1',
    callbackController: {} as CallbackController,
    webhookController: {} as WebhookController,
    inboxController: {
      async downloadMessageAttachment(id: string, messageId: number, index: number) {
        requests.push({ id, messageId, index });
        return { bytes: new Uint8Array([10, 20, 30]), mimeType: 'image/png', fileName: 'photo.png', sizeBytes: 3 };
      },
    } as unknown as InboxController,
  });
  await app.start();
  try {
    const address = app.server.address();
    assert.ok(address && typeof address === 'object');
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const response = await fetch(`${baseUrl}/api/conversations/link-1/messages/45/attachments/0`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/png');
    assert.equal(response.headers.get('content-disposition'), "inline; filename*=UTF-8''photo.png");
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [10, 20, 30]);

    const invalid = await fetch(`${baseUrl}/api/conversations/link-1/messages/45/attachments/-1`);
    assert.equal(invalid.status, 404);
    assert.deepEqual(requests, [{ id: 'link-1', messageId: 45, index: 0 }]);
  } finally {
    await app.stop();
  }
});
