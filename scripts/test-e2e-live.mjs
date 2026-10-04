import { createHash } from 'node:crypto';

async function main() {
  const secret = 'secret';
  const timestamp = Date.now();
  const testMsgId = 'msg-live-' + timestamp;
  const payload = {
    event_id: 'evt-' + timestamp,
    connection_id: 'conn-chatwoot-1',
    user_id: 'cust-888',
    sender_id: 'cust-888',
    user_name: 'Nguyen Van Tuan',
    conversation_id: 'conv-888',
    message_id: testMsgId,
    text: 'Shop ơi shop có hỗ trợ ship COD toàn quốc không ạ?',
    timestamp: timestamp,
  };

  const rawBody = JSON.stringify(payload);
  const signature = 'secret-' + secret;

  console.log(`[1] Sending inbound webhook to Tinix (/webhooks/channels/synthetic/conn-chatwoot-1)...`);
  const res = await fetch('http://127.0.0.1:3182/webhooks/channels/synthetic/conn-chatwoot-1', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-synthetic-signature': signature,
    },
    body: rawBody,
  });

  console.log(`[1] Webhook Response Status: ${res.status}`);
  const result = await res.json();
  console.log(`[1] Webhook Result:`, result);

  console.log(`[2] Waiting 8 seconds for Gemini AI response, Chatwoot callback, and Outbox dispatch...`);
  await new Promise((r) => setTimeout(r, 8000));

  console.log(`[3] Checking database state...`);
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync('./data/tinix_inbox.db');

  console.log('\n--- MESSAGE LINKS ---');
  const msgLinks = db.prepare(`
    SELECT id, direction, origin, delivery_state, chatwoot_message_id, created_at
    FROM message_links
    ORDER BY created_at DESC
    LIMIT 4
  `).all();
  console.log(msgLinks);

  console.log('\n--- OUTBOX MESSAGES ---');
  const outbox = db.prepare(`
    SELECT id, state, attempt_count, provider_message_id, created_at, sent_at, last_error
    FROM outbox_messages
    ORDER BY created_at DESC
    LIMIT 4
  `).all();
  console.log(outbox);

  console.log('\n--- CHATWOOT CALLBACK EVENTS ---');
  const callbacks = db.prepare(`
    SELECT id, event_type, chatwoot_message_id, status, correlation_id, received_at
    FROM chatwoot_callback_events
    ORDER BY received_at DESC
    LIMIT 4
  `).all();
  console.log(callbacks);
}

main().catch(console.error);
