import { ENV } from '../src/config/env.ts';

async function main() {
  const res = await fetch(`${ENV.CHATWOOT_BASE_URL}/api/v1/accounts/1/webhooks`, {
    headers: { api_access_token: ENV.CHATWOOT_API_TOKEN, Accept: 'application/json' }
  });
  console.log('Status:', res.status);
  const data = await res.json();
  console.log('Webhooks:', JSON.stringify(data, null, 2));
}

main().catch(console.error);
