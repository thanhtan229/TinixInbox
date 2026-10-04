import { test } from 'node:test';
import assert from 'node:assert';
import { GeminiClient } from '../../src/agent/gemini-client.ts';
import { ProviderTemporaryError } from '../../src/core/errors.ts';
import { BusinessToolRegistry } from '../../src/agent/business-tools.ts';

test('GeminiClient: missing API key fails closed without fabricating a customer reply', async () => {
  const tools = new BusinessToolRegistry({ demoMode: true });
  const client = new GeminiClient();

  await assert.rejects(
    client.generateReply('Shop kiểm tra giúp mình đơn DH8888 với', [], tools),
    (error: unknown) => error instanceof Error && /API key is not configured/.test(error.message)
  );
});

test('GeminiClient: provider failure is surfaced without substituting a canned response', async () => {
  const failingFetch = (async () => ({ ok: false, status: 503 }) as Response) as unknown as typeof fetch;
  const client = new GeminiClient({ apiKey: 'test-key', fetchFn: failingFetch });
  await assert.rejects(
    client.generateReply('Chào shop ơi'),
    (error: unknown) => error instanceof ProviderTemporaryError
  );
});

test('GeminiClient: formats Gemini API request properly when API key is set', async () => {
  let capturedUrl = '';
  let capturedBody: any = null;

  const mockFetch = (async (url: string, init?: any) => {
    capturedUrl = url;
    capturedBody = JSON.parse(init.body);
    return {
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{ text: 'Dạ shop còn mẫu này nha bạn ơi!' }],
          },
        }],
      }),
    };
  }) as unknown as typeof fetch;

  const tools = new BusinessToolRegistry({ demoMode: true });
  const client = new GeminiClient({
    apiKey: 'test-gemini-key',
    model: 'gemini-2.5-flash',
    fetchFn: mockFetch,
  });

  const res = await client.generateReply('Mẫu áo này còn không shop?', [], tools);

  assert.strictEqual(res.replyText, 'Dạ shop còn mẫu này nha bạn ơi!');
  assert.strictEqual(res.model, 'gemini-2.5-flash');
  assert.ok(capturedUrl.includes('gemini-2.5-flash'));
  assert.ok(capturedUrl.includes('test-gemini-key'));
  assert.strictEqual(capturedBody.contents[0].parts[0].text, 'Mẫu áo này còn không shop?');
  assert.ok(capturedBody.tools[0].functionDeclarations.some((f: any) => f.name === 'lookup_order'));
});

test('GeminiClient carries the message correlation ID into n8n write action idempotency', async () => {
  let generation = 0;
  let idempotencyKey = '';
  const client = new GeminiClient({
    apiKey: 'test-gemini-key',
    fetchFn: (async () => {
      generation++;
      return new Response(JSON.stringify({ candidates: [{ content: { parts: generation === 1
        ? [{ functionCall: { name: 'create_crm_lead', args: { name: 'Synthetic lead' } } }]
        : [{ text: 'Đã ghi nhận thông tin.' }] } }] }), { status: 200 });
    }) as typeof fetch,
  });
  const tools = new BusinessToolRegistry({
    n8nWebhookBaseUrl: 'https://n8n.tinix.internal/webhook',
    n8nWebhookAuthToken: 'unit-test-token',
    fetchFn: (async (_url, init) => {
      idempotencyKey = new Headers(init?.headers).get('Idempotency-Key') || '';
      return new Response(JSON.stringify({ leadId: 'synthetic-lead-1' }), { status: 200 });
    }) as typeof fetch,
  });

  const result = await client.generateReply('Tôi muốn mua sỉ', [], tools, 'inbound-correlation');

  assert.equal(result.replyText, 'Đã ghi nhận thông tin.');
  assert.equal(generation, 2);
  assert.match(idempotencyKey, /^[a-f0-9]{64}$/);
});
