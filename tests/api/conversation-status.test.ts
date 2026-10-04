import test from 'node:test';
import assert from 'node:assert/strict';
import { createAppServer } from '../../src/api/server.ts';
import type { CallbackController } from '../../src/api/callback-controller.ts';
import type { WebhookController } from '../../src/api/webhook-controller.ts';
import type { InboxController } from '../../src/api/inbox-controller.ts';

test('conversation status API validates input and delegates supported state changes', async () => {
  const updates: Array<{ id: string; status: string }> = [];
  const app = createAppServer({
    port: 0,
    host: '127.0.0.1',
    callbackController: {} as CallbackController,
    webhookController: {} as WebhookController,
    inboxController: {
      async updateConversationStatus(id: string, status: string) {
        updates.push({ id, status });
      },
    } as unknown as InboxController,
  });
  await app.start();

  try {
    const address = app.server.address();
    assert.ok(address && typeof address === 'object');
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const invalid = await fetch(`${baseUrl}/api/conversations/link-1/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'deleted' }),
    });
    assert.equal(invalid.status, 400);

    const valid = await fetch(`${baseUrl}/api/conversations/link-1/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'resolved' }),
    });
    assert.equal(valid.status, 200);
    assert.deepEqual(await valid.json(), { ok: true, status: 'resolved' });
    assert.deepEqual(updates, [{ id: 'link-1', status: 'resolved' }]);
  } finally {
    await app.stop();
  }
});

test('conversation assignment API validates agent IDs and returns a sanitized assignment', async () => {
  const assigned: number[] = [];
  const assignment = { agents: [{ id: 7, name: 'Inbox Agent' }], assignee: { id: 7, name: 'Inbox Agent' } };
  const app = createAppServer({
    port: 0,
    host: '127.0.0.1',
    callbackController: {} as CallbackController,
    webhookController: {} as WebhookController,
    inboxController: {
      async getConversationAssignment() { return assignment; },
      async assignConversation(_id: string, agentId: number) { assigned.push(agentId); return assignment; },
    } as unknown as InboxController,
  });
  await app.start();
  try {
    const address = app.server.address();
    assert.ok(address && typeof address === 'object');
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const invalid = await fetch(`${baseUrl}/api/conversations/link-1/assignment`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ agentId: '7' }),
    });
    assert.equal(invalid.status, 400);
    const valid = await fetch(`${baseUrl}/api/conversations/link-1/assignment`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ agentId: 7 }),
    });
    assert.equal(valid.status, 200);
    assert.deepEqual(await valid.json(), { ok: true, ...assignment });
    assert.deepEqual(assigned, [7]);
  } finally {
    await app.stop();
  }
});

test('connection lifecycle API requires an explicit enabled boolean', async () => {
  const states: boolean[] = [];
  const app = createAppServer({
    port: 0,
    host: '127.0.0.1',
    callbackController: {} as CallbackController,
    webhookController: {} as WebhookController,
    inboxController: {
      setConnectionEnabled(id: string, enabled: boolean) {
        assert.equal(id, 'connection-1');
        states.push(enabled);
        return { id, status: enabled ? 'connected' : 'disabled' };
      },
    } as unknown as InboxController,
  });
  await app.start();
  try {
    const address = app.server.address();
    assert.ok(address && typeof address === 'object');
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const invalid = await fetch(`${baseUrl}/api/connections/connection-1/lifecycle`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: 'false' }),
    });
    assert.equal(invalid.status, 400);
    const valid = await fetch(`${baseUrl}/api/connections/connection-1/lifecycle`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: false }),
    });
    assert.equal(valid.status, 200);
    assert.deepEqual(await valid.json(), { id: 'connection-1', status: 'disabled' });
    assert.deepEqual(states, [false]);
  } finally {
    await app.stop();
  }
});
