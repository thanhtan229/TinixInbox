import { DatabaseSync } from 'node:sqlite';
import { CredentialVault } from '../src/persistence/credential-vault.ts';

const vault = new CredentialVault();
const db = new DatabaseSync('./data/tinix_inbox.db');
const row = db.prepare('SELECT credentials_encrypted, external_account_id FROM channel_connections WHERE id = ?').get('conn-8386382e');
const creds = JSON.parse(vault.decrypt(row.credentials_encrypted));
const token = creds.pageAccessToken;
const appSecret = creds.appSecret;

console.log('Inspecting /me?fields=id,name with token:');
const resMe = await fetch(`https://graph.facebook.com/v21.0/me?fields=id,name&access_token=${token}`);
const dataMe = await resMe.json();
console.log('Result /me?fields=id,name:', JSON.stringify(dataMe, null, 2));

console.log('Inspecting token via debug_token:');
// We need an app access token or we can call with input_token
// appId can be extracted from token if it starts with EAAPld5KWkZCAB...
const resDebug = await fetch(`https://graph.facebook.com/debug_token?input_token=${token}&access_token=${token}`);
const dataDebug = await resDebug.json();
console.log('Result debug_token:', JSON.stringify(dataDebug, null, 2));
