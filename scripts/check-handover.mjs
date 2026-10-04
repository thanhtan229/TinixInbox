import { DatabaseSync } from 'node:sqlite';
import { CredentialVault } from '../src/persistence/credential-vault.ts';

const vault = new CredentialVault();
const db = new DatabaseSync('./data/tinix_inbox.db');
const row = db.prepare('SELECT credentials_encrypted, external_account_id FROM channel_connections WHERE id = ?').get('conn-8386382e');
const creds = JSON.parse(vault.decrypt(row.credentials_encrypted));
const token = creds.pageAccessToken;
const pageId = row.external_account_id;

console.log('Checking secondary_receivers for Page:');
const resSec = await fetch(`https://graph.facebook.com/v21.0/${pageId}/secondary_receivers?access_token=${token}`);
console.log('secondary_receivers:', JSON.stringify(await resSec.json(), null, 2));

console.log('Checking pass_thread_control / handover settings:');
const resSettings = await fetch(`https://graph.facebook.com/v21.0/${pageId}?fields=roles,leadgen_tos_accepted,is_webhooks_subscribed&access_token=${token}`);
console.log('Page settings:', JSON.stringify(await resSettings.json(), null, 2));
