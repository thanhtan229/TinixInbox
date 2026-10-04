import { DatabaseSync } from 'node:sqlite';
import { CredentialVault } from '../src/persistence/credential-vault.ts';

const vault = new CredentialVault();
const db = new DatabaseSync('./data/tinix_inbox.db');
const row = db.prepare('SELECT credentials_encrypted, external_account_id FROM channel_connections WHERE id = ?').get('conn-8386382e');
const creds = JSON.parse(vault.decrypt(row.credentials_encrypted));
const token = creds.pageAccessToken;

console.log('Inspecting /me with token:');
const resMe = await fetch(`https://graph.facebook.com/v21.0/me?access_token=${token}`);
const dataMe = await resMe.json();
console.log('Result /me:', JSON.stringify(dataMe, null, 2));

console.log('Inspecting /me/accounts (pages the token has access to):');
const resAccounts = await fetch(`https://graph.facebook.com/v21.0/me/accounts?access_token=${token}`);
const dataAccounts = await resAccounts.json();
console.log('Result /me/accounts:', JSON.stringify(dataAccounts, null, 2));
