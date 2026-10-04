import { test } from 'node:test';
import assert from 'node:assert';
import { InboxEventBus } from '../../src/api/event-bus.ts';
import type { ServerResponse } from 'node:http';

test('InboxEventBus: registers client, sends handshake, and broadcasts events', async () => {
  const bus = new InboxEventBus();
  const writes: string[] = [];

  const mockRes = {
    write: (chunk: string) => {
      writes.push(chunk);
      return true;
    },
  } as unknown as ServerResponse;

  bus.registerClient(mockRes);
  assert.strictEqual(bus.getClientsCount(), 1);
  assert.ok(writes.some((w) => w.includes('event: connected')));

  bus.broadcast('message_created', { messageId: 999, content: 'Hello SSE' });
  assert.ok(writes.some((w) => w.includes('event: message_created') && w.includes('Hello SSE')));

  bus.removeClient(mockRes);
  assert.strictEqual(bus.getClientsCount(), 0);
});
