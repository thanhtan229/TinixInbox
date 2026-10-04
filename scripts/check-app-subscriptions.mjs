import { DatabaseSync } from 'node:sqlite';
import { CredentialVault } from '../src/persistence/credential-vault.ts';

const vault = new CredentialVault();
const db = new DatabaseSync('./data/tinix_inbox.db');
const row = db.prepare('SELECT credentials_encrypted FROM channel_connections WHERE id = ?').get('conn-8386382e');
const creds = JSON.parse(vault.decrypt(row.credentials_encrypted));
const appId = '1096726653342704';
const appSecret = creds.appSecret;
const appAccessToken = `${appId}|${appSecret}`;

console.log('Inspecting App webhook subscriptions:');
const res = await fetch(`https://graph.facebook.com/v21.0/${appId}/subscriptions?access_token=${appAccessToken}`);
const data = await res.json();
console.log('App subscriptions:', JSON.stringify(data, null, 2));
