import { createHmac } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { CredentialVault } from '../src/persistence/credential-vault.ts';

const vault = new CredentialVault();
const db = new DatabaseSync('./data/tinix_inbox.db');
const row = db.prepare('SELECT credentials_encrypted FROM channel_connections WHERE id = ?').get('conn-8386382e');
const creds = JSON.parse(vault.decrypt(row.credentials_encrypted));
const appSecret = creds.appSecret;

const testPayload = JSON.stringify({
  object: 'page',
  entry: [
    {
      id: '139438959247389',
      time: Date.now(),
      messaging: [
        {
          sender: { id: 'test_user_fb_001' },
          recipient: { id: '139438959247389' },
          timestamp: Date.now(),
          message: {
            mid: `mid.test.${Date.now()}`,
            text: 'Xin chào, tôi muốn hỏi giá chụp ảnh cho bé!'
          }
        }
      ]
    }
  ]
});

const signature = `sha256=${createHmac('sha256', appSecret).update(testPayload).digest('hex')}`;

console.log('Sending signed Meta webhook to localhost:3182...');
const res = await fetch('http://127.0.0.1:3182/webhooks/inbox/meta/conn-8386382e', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-hub-signature-256': signature,
  },
  body: testPayload,
});

console.log('Response status:', res.status);
const resBody = await res.json();
console.log('Response body:', JSON.stringify(resBody, null, 2));
