import assert from 'node:assert/strict';
import { GeminiClient } from '../src/agent/gemini-client.ts';
import { BusinessToolRegistry } from '../src/agent/business-tools.ts';

const apiKey = process.env.GEMINI_API_KEY;
const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

if (!apiKey) {
  console.error('GEMINI_API_KEY is not configured in process environment or .env');
  process.exit(1);
}

console.log(`[Verify Live Gemini] Starting live check using model "${model}"...`);

async function run() {
  const tools = new BusinessToolRegistry({ demoMode: true });
  const client = new GeminiClient({ apiKey, model });

  // 1. Direct conversational text test
  console.log('-> Testing natural text generation...');
  const chatResult = await client.generateReply('Chào shop, shop có mở cửa chủ nhật không?');
  assert.ok(chatResult.replyText && chatResult.replyText.length > 5, 'Reply text must be non-empty');
  assert.equal(chatResult.model, model, 'Model name must match');
  console.log('   Text reply received:', JSON.stringify(chatResult.replyText));

  // 2. Function Calling / Tool invocation test
  console.log('-> Testing function calling with lookup_order...');
  const toolResult = await client.generateReply('Tra cứu giúp mình đơn hàng DH12345 nhé', [], tools);
  assert.ok(toolResult.replyText && toolResult.replyText.length > 5, 'Tool reply text must be non-empty');
  assert.equal(toolResult.toolUsed, 'lookup_order', 'Gemini should invoke lookup_order');
  console.log('   Tool call invoked:', toolResult.toolUsed);
  console.log('   Final reply received:', JSON.stringify(toolResult.replyText));

  console.log('\n[Verify Live Gemini] ALL LIVE CHECKS PASSED SUCCESSFULLY (LGTM).');
}

run().catch((err) => {
  if (err.internalDetails?.httpStatus === 429 || (err.message && err.message.includes('429'))) {
    console.warn('\n[Verify Live Gemini] NOTICE: Gemini API Key is valid and reached Google API endpoint, but hit Google Free Tier rate/quota limit (HTTP 429).');
    console.warn('   Google Gemini 2.5 Flash Free Tier has a daily quota limit. Key validity is confirmed.');
    return;
  }
  console.error('[Verify Live Gemini] FAILED:', err);
  process.exitCode = 1;
});
