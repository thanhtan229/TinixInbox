import { DatabaseSync } from 'node:sqlite';
import { CredentialVault } from '../src/persistence/credential-vault.ts';

const vault = new CredentialVault();
const db = new DatabaseSync('./data/tinix_inbox.db');
const row = db.prepare('SELECT credentials_encrypted FROM channel_connections WHERE id = ?').get('conn-8386382e');
const creds = JSON.parse(vault.decrypt(row.credentials_encrypted));
const token = creds.pageAccessToken;

console.log('Inspecting user 1109683044786827:');
const res = await fetch(`https://graph.facebook.com/v21.0/1109683044786827?access_token=${token}`);
console.log(await res.json());

console.log('Inspecting PSID 9411868318877117:');
const resPsid = await fetch(`https://graph.facebook.com/v21.0/9411868318877117?fields=id,name,first_name,last_name&access_token=${token}`);
console.log(await resPsid.json());
