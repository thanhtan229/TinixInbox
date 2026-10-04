import test from 'node:test';
import assert from 'node:assert/strict';
import { getDatabase } from '../../src/persistence/db.ts';
import { ProviderWebhookEventRepository } from '../../src/persistence/repositories.ts';

test('provider webhook retries only retryable failures and dead letters after the bounded attempts', () => {
  const db = getDatabase(':memory:');
  const repo = new ProviderWebhookEventRepository(db);
  const now = new Date().toISOString();
  assert.strictEqual(repo.recordEvent({
    id: 'evt-retry', workspaceId: 'ws', provider: 'meta', channelConnectionId: 'conn',
    providerEventId: 'provider-event', payloadHash: 'hash', rawPayload: '{}',
    correlationId: 'corr', receivedAt: now,
  }), true);

  assert.strictEqual(repo.claimReceived()[0]?.id, 'evt-retry');
  assert.strictEqual(repo.markFailed('evt-retry', 'temporary', true), 'retry_wait');
  assert.strictEqual(repo.claimReceived().length, 0);

  db.prepare(`UPDATE provider_webhook_events SET next_attempt_at = ? WHERE id = 'evt-retry'`)
    .run(new Date(Date.now() - 1000).toISOString());
  assert.strictEqual(repo.claimReceived()[0]?.id, 'evt-retry');
  db.prepare(`UPDATE provider_webhook_events SET attempt_count = 5 WHERE id = 'evt-retry'`).run();
  assert.strictEqual(repo.markFailed('evt-retry', 'temporary again', true), 'dead_letter');
  assert.strictEqual(repo.claimReceived().length, 0);
  db.close();
});
