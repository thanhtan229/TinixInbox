import { DatabaseSync } from 'node:sqlite';
import { CredentialVault } from '../src/persistence/credential-vault.ts';

const vault = new CredentialVault();
const db = new DatabaseSync('./data/tinix_inbox.db');
const row = db.prepare('SELECT credentials_encrypted FROM channel_connections WHERE id = ?').get('conn-8386382e');
const creds = JSON.parse(vault.decrypt(row.credentials_encrypted));
const token = creds.pageAccessToken;

console.log('Inspecting Page 139438959247389 with token:');
const resPage = await fetch(`https://graph.facebook.com/v21.0/139438959247389?access_token=${token}`);
const dataPage = await resPage.json();
console.log('Result Page:', JSON.stringify(dataPage, null, 2));

console.log('Checking subscribed_apps for Page 139438959247389:');
const resSub = await fetch(`https://graph.facebook.com/v21.0/139438959247389/subscribed_apps?access_token=${token}`);
const dataSub = await resSub.json();
console.log('Result subscribed_apps:', JSON.stringify(dataSub, null, 2));
