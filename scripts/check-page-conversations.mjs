import { DatabaseSync } from 'node:sqlite';
import { CredentialVault } from '../src/persistence/credential-vault.ts';

const vault = new CredentialVault();
const db = new DatabaseSync('./data/tinix_inbox.db');
const row = db.prepare('SELECT credentials_encrypted, external_account_id FROM channel_connections WHERE id = ?').get('conn-8386382e');
const creds = JSON.parse(vault.decrypt(row.credentials_encrypted));
const token = creds.pageAccessToken;
const pageId = row.external_account_id;

const res = await fetch(`https://graph.facebook.com/v21.0/${pageId}/conversations?fields=id,snippet,updated_time&limit=5&access_token=${token}`);
const data = await res.json();
console.log('Top 5 conversations:', JSON.stringify(data.data, null, 2));
