import test from 'node:test';
import assert from 'node:assert';
import { DeliveryStateMachine } from '../../src/core/delivery-state.ts';

test('DeliveryStateMachine allows valid forward transitions', () => {
  assert.strictEqual(DeliveryStateMachine.canTransition('queued', 'sending'), true);
  assert.strictEqual(DeliveryStateMachine.canTransition('sending', 'provider_accepted'), true);
  assert.strictEqual(DeliveryStateMachine.canTransition('provider_accepted', 'delivered'), true);
  assert.strictEqual(DeliveryStateMachine.canTransition('delivered', 'read'), true);
});

test('DeliveryStateMachine handles failure and retry transitions', () => {
  assert.strictEqual(DeliveryStateMachine.canTransition('sending', 'retry_wait'), true);
  assert.strictEqual(DeliveryStateMachine.canTransition('retry_wait', 'sending'), true);
  assert.strictEqual(DeliveryStateMachine.canTransition('retry_wait', 'dead_letter'), true);
});

test('DeliveryStateMachine handles unknown state transitions', () => {
  assert.strictEqual(DeliveryStateMachine.canTransition('sending', 'unknown'), true);
  assert.strictEqual(DeliveryStateMachine.canTransition('unknown', 'provider_accepted'), true);
  assert.strictEqual(DeliveryStateMachine.canTransition('unknown', 'failed'), true);
});

test('DeliveryStateMachine rejects invalid transitions', () => {
  assert.strictEqual(DeliveryStateMachine.canTransition('read', 'sending'), false);
  assert.strictEqual(DeliveryStateMachine.canTransition('queued', 'delivered'), false);
  assert.throws(() => {
    DeliveryStateMachine.transition('read', 'queued');
  });
});
