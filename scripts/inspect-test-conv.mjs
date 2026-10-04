import { DatabaseSync } from 'node:sqlite';
import { CredentialVault } from '../src/persistence/credential-vault.ts';

const vault = new CredentialVault();
const db = new DatabaseSync('./data/tinix_inbox.db');
const row = db.prepare('SELECT credentials_encrypted FROM channel_connections WHERE id = ?').get('conn-8386382e');
const creds = JSON.parse(vault.decrypt(row.credentials_encrypted));
const token = creds.pageAccessToken;

const res = await fetch(`https://graph.facebook.com/v21.0/t_438920608529744?fields=messages{message,created_time,from}&access_token=${token}`);
const data = await res.json();
console.log('Conversation details:', JSON.stringify(data, null, 2));
