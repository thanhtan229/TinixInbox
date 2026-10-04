const appId = '1096726653342704';
const appSecret = process.env.META_APP_SECRET;
const appToken = `${appId}|${appSecret}`;

// Get the token from database or we can check what's in the DB
import { DatabaseSync } from 'node:sqlite';
import { CredentialVault } from '../src/persistence/credential-vault.ts';
const vault = new CredentialVault();
const db = new DatabaseSync('./data/tinix_inbox.db');
const row = db.prepare('SELECT credentials_encrypted FROM channel_connections WHERE id = ?').get('conn-8386382e');
const creds = JSON.parse(vault.decrypt(row.credentials_encrypted));
const token = creds.pageAccessToken;

console.log('Test 1: GET /me?fields=id');
const r1 = await fetch(`https://graph.facebook.com/v21.0/me?fields=id&access_token=${token}`);
console.log('r1:', await r1.json());

console.log('Test 2: GET /debug_token with appToken');
const r2 = await fetch(`https://graph.facebook.com/debug_token?input_token=${token}&access_token=${appToken}`);
const d2 = await r2.json();
console.log('r2:', JSON.stringify(d2, null, 2));

const pageId = d2.data?.profile_id;
console.log('Page ID from debug_token:', pageId);

if (pageId) {
  console.log('Test 3: GET /' + pageId + ' with token');
  const r3 = await fetch(`https://graph.facebook.com/v21.0/${pageId}?access_token=${token}`);
  console.log('r3:', await r3.json());

  console.log('Test 4: GET /' + pageId + ' with appToken');
  const r4 = await fetch(`https://graph.facebook.com/v21.0/${pageId}?access_token=${appToken}`);
  console.log('r4:', await r4.json());

  console.log('Test 5: GET /' + pageId + '?fields=id,name with appToken');
  const r5 = await fetch(`https://graph.facebook.com/v21.0/${pageId}?fields=id,name&access_token=${appToken}`);
  console.log('r5:', await r5.json());
}
