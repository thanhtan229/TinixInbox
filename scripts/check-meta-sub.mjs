import { DatabaseSync } from 'node:sqlite';
import { CredentialVault } from '../src/persistence/credential-vault.ts';

const vault = new CredentialVault();
const db = new DatabaseSync('./data/tinix_inbox.db');
const row = db.prepare('SELECT credentials_encrypted, external_account_id FROM channel_connections WHERE id = ?').get('conn-8386382e');
const creds = JSON.parse(vault.decrypt(row.credentials_encrypted));
const pageId = row.external_account_id;
const token = creds.pageAccessToken;

console.log('Checking subscribed_apps for page:', pageId);
const res = await fetch(`https://graph.facebook.com/v21.0/${pageId}/subscribed_apps?access_token=${token}`);
const data = await res.json();
console.log('Subscribed apps response:', JSON.stringify(data, null, 2));
