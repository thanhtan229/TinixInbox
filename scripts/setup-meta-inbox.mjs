import { DatabaseSync } from 'node:sqlite';
import { ENV } from '../src/config/env.ts';
import { CredentialVault } from '../src/persistence/credential-vault.ts';

const vault = new CredentialVault();
const db = new DatabaseSync('./data/tinix_inbox.db');

console.log('Checking existing inboxes in Chatwoot...');
const listRes = await fetch(`${ENV.CHATWOOT_BASE_URL}/api/v1/accounts/1/inboxes`, {
  headers: {
    api_access_token: ENV.CHATWOOT_API_TOKEN,
  }
});
const listData = await listRes.json();
const inboxes = listData.payload || [];

let targetInbox = inboxes.find(ib => ib.name === 'Meta Facebook - Tí Nị Studio');

if (!targetInbox) {
  console.log('Creating new Chatwoot API Inbox: Meta Facebook - Tí Nị Studio...');
  const createRes = await fetch(`${ENV.CHATWOOT_BASE_URL}/api/v1/accounts/1/inboxes`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      api_access_token: ENV.CHATWOOT_API_TOKEN,
    },
    body: JSON.stringify({
      name: 'Meta Facebook - Tí Nị Studio',
      channel: {
        type: 'api',
        webhook_url: 'http://callback-receiver:3181/webhooks/chatwoot'
      }
    })
  });
  targetInbox = await createRes.json();
  console.log('Created inbox:', targetInbox);
} else {
  console.log('Found existing target inbox:', targetInbox.id, targetInbox.name);
}

const inboxId = targetInbox.id;
const apiChannelIdentifier = targetInbox.inbox_identifier || targetInbox.identifier;
const callbackSecret = targetInbox.hmac_token || targetInbox.secret || null;

console.log('Updating conn-8386382e in SQLite with Chatwoot binding...');
const encryptedSecret = callbackSecret ? vault.encrypt(callbackSecret) : null;

db.prepare(`
  UPDATE channel_connections
  SET chatwoot_account_id = 1,
      chatwoot_inbox_id = ?,
      chatwoot_api_channel_identifier = ?,
      chatwoot_callback_secret_ref = ?,
      external_account_id = '139438959247389'
  WHERE id = 'conn-8386382e'
`).run(inboxId, apiChannelIdentifier, encryptedSecret);

const updatedRow = db.prepare('SELECT id, provider, status, external_account_id, chatwoot_account_id, chatwoot_inbox_id, chatwoot_api_channel_identifier FROM channel_connections WHERE id = ?').get('conn-8386382e');
console.log('Updated connection row:', JSON.stringify(updatedRow, null, 2));
