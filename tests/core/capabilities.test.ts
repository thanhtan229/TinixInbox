import test from 'node:test';
import assert from 'node:assert';
import { CapabilityRegistry } from '../../src/core/capabilities.ts';

test('CapabilityRegistry provides default capabilities', () => {
  const registry = CapabilityRegistry.getInstance();
  const metaCaps = registry.getCapabilities('meta');
  assert.strictEqual(metaCaps.inboundText, true);
  assert.strictEqual(metaCaps.outboundText, true);
  assert.strictEqual(metaCaps.attachments.includes('image'), true);

  const zaloCaps = registry.getCapabilities('zalo');
  assert.strictEqual(zaloCaps.inboundText, true);
  assert.strictEqual(zaloCaps.deliveryReceipts, false);

  const shopeeCaps = registry.getCapabilities('shopee');
  assert.strictEqual(shopeeCaps.inboundText, false);
});

test('CapabilityRegistry supports checking attachment types', () => {
  const registry = CapabilityRegistry.getInstance();
  assert.strictEqual(registry.supportsAttachment('meta', 'image/jpeg'), true);
  assert.strictEqual(registry.supportsAttachment('shopee', 'image/png'), false);
});
