import test from 'node:test';
import assert from 'node:assert';
import { BusinessToolRegistry } from '../../src/agent/business-tools.ts';

test('BusinessToolRegistry: demo data is available only when demo mode is explicit', async () => {
  const unconfigured = await new BusinessToolRegistry().executeTool({
    toolName: 'lookup_order', parameters: { orderId: 'ORD-9988' },
  });
  assert.strictEqual(unconfigured.success, false);
  assert.match(unconfigured.error!, /not configured/i);

  const registry = new BusinessToolRegistry({ demoMode: true });

  const res = await registry.executeTool({
    toolName: 'lookup_order',
    parameters: { orderId: 'ORD-9988' },
  });

  assert.strictEqual(res.success, true);
  assert.strictEqual(res.toolName, 'lookup_order');
  const data = res.data as any;
  assert.strictEqual(data.orderId, 'ORD-9988');
  assert.strictEqual(data.status, 'shipping');
  assert.ok(data.trackingCode);
});

test('BusinessToolRegistry: executes lookup_customer and create_crm_lead', async () => {
  const registry = new BusinessToolRegistry({ demoMode: true });

  const custRes = await registry.executeTool({
    toolName: 'lookup_customer',
    parameters: { phoneNumber: '0901234567' },
  });

  assert.strictEqual(custRes.success, true);
  const custData = custRes.data as any;
  assert.strictEqual(custData.name, 'Nguyễn Văn A');

  const leadRes = await registry.executeTool({
    toolName: 'create_crm_lead',
    parameters: { name: 'Khách hàng mới', phone: '0987654321', intent: 'Mua sỉ' },
  });

  assert.strictEqual(leadRes.success, true);
  assert.ok((leadRes.data as any).leadId);
});

test('BusinessToolRegistry: routes tool call to n8n webhook when baseUrl configured', async () => {
  let webhookCalled = false;
  let receivedPayload: any = null;
  let authorization = '';

  const mockFetch: typeof fetch = async (_url, init) => {
    webhookCalled = true;
    receivedPayload = JSON.parse(init?.body as string);
    authorization = new Headers(init?.headers).get('Authorization') || '';
    return new Response(
      JSON.stringify({ orderId: receivedPayload.orderId, status: 'delivered', n8nProcessed: true }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  };

  const registry = new BusinessToolRegistry({
    n8nWebhookBaseUrl: 'https://n8n.tinix.internal/webhook',
    n8nWebhookAuthToken: 'unit-test-token',
    fetchFn: mockFetch,
  });

  const res = await registry.executeTool({
    toolName: 'lookup_order',
    parameters: { orderId: 'ORD-N8N-123' },
  });

  assert.strictEqual(res.success, true);
  assert.strictEqual(webhookCalled, true);
  assert.strictEqual(receivedPayload.orderId, 'ORD-N8N-123');
  assert.strictEqual((res.data as any).n8nProcessed, true);
  assert.strictEqual((res.data as any).status, 'delivered');
  assert.strictEqual(authorization, 'Bearer unit-test-token');
});

test('BusinessToolRegistry gives each write action a stable per-message idempotency key', async () => {
  const idempotencyKeys: string[] = [];
  const registry = new BusinessToolRegistry({
    n8nWebhookBaseUrl: 'https://n8n.tinix.internal/webhook',
    n8nWebhookAuthToken: 'unit-test-token',
    fetchFn: async (_url, init) => {
      idempotencyKeys.push(new Headers(init?.headers).get('Idempotency-Key') || '');
      return new Response(JSON.stringify({ accepted: true }), { status: 200 });
    },
  });

  const first = await registry.executeTool({
    toolName: 'create_crm_lead',
    correlationId: 'stable-inbound-message-correlation',
    parameters: { name: 'Synthetic lead', phone: '0900000000' },
  });
  const retry = await registry.executeTool({
    toolName: 'create_crm_lead',
    correlationId: 'stable-inbound-message-correlation',
    parameters: { phone: '0900000000', name: 'Synthetic lead', note: 'retry may normalize fields' },
  });
  const differentAction = await registry.executeTool({
    toolName: 'send_internal_notification',
    correlationId: 'stable-inbound-message-correlation',
    parameters: { message: 'Synthetic notification' },
  });

  assert.equal(first.success, true);
  assert.equal(retry.success, true);
  assert.equal(differentAction.success, true);
  assert.equal(idempotencyKeys.length, 3);
  assert.match(idempotencyKeys[0]!, /^[a-f0-9]{64}$/);
  assert.equal(idempotencyKeys[1], idempotencyKeys[0]);
  assert.notEqual(idempotencyKeys[2], idempotencyKeys[0]);
});

test('BusinessToolRegistry reports n8n HTTP failures instead of success', async () => {
  const registry = new BusinessToolRegistry({
    n8nWebhookBaseUrl: 'https://n8n.tinix.internal/webhook',
    n8nWebhookAuthToken: 'unit-test-token',
    fetchFn: async () => new Response('unavailable', { status: 503 }),
  });
  const result = await registry.executeTool({
    toolName: 'lookup_order',
    parameters: { orderId: 'ORD-503' },
  });
  assert.strictEqual(result.success, false);
  assert.match(result.error!, /HTTP 503/);
});

test('BusinessToolRegistry refuses configured n8n endpoints without a bearer token', async () => {
  const result = await new BusinessToolRegistry({
    n8nWebhookBaseUrl: 'https://n8n.tinix.internal/webhook',
    fetchFn: async () => { throw new Error('must not call unauthenticated endpoint'); },
  }).executeTool({ toolName: 'create_crm_lead', parameters: { name: 'Synthetic' } });
  assert.equal(result.success, false);
  assert.match(result.error!, /authentication is not configured/i);
});

test('BusinessToolRegistry refuses n8n write actions without a stable message correlation', async () => {
  const result = await new BusinessToolRegistry({
    n8nWebhookBaseUrl: 'https://n8n.tinix.internal/webhook',
    n8nWebhookAuthToken: 'unit-test-token',
    fetchFn: async () => { throw new Error('must not perform an unkeyed write'); },
  }).executeTool({ toolName: 'create_crm_lead', parameters: { name: 'Synthetic' } });
  assert.equal(result.success, false);
  assert.match(result.error!, /Stable message correlation/i);
});
