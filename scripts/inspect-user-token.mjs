const token = process.env.META_TEST_PAGE_TOKEN;
const appId = '1096726653342704';
const appSecret = process.env.META_APP_SECRET;
const appToken = `${appId}|${appSecret}`;

async function run() {
  const debugRes = await fetch(`https://graph.facebook.com/debug_token?input_token=${encodeURIComponent(token)}&access_token=${encodeURIComponent(appToken)}`);
  const debugData = await debugRes.json();
  console.log('DEBUG TOKEN DATA:');
  console.log(JSON.stringify(debugData, null, 2));

  const meRes = await fetch(`https://graph.facebook.com/v21.0/me?fields=id,name&access_token=${encodeURIComponent(token)}`);
  const meData = await meRes.json();
  console.log('GET /me RESULT:');
  console.log(JSON.stringify(meData, null, 2));

  // If this is a user token, let's check what pages this user manages!
  const accountsRes = await fetch(`https://graph.facebook.com/v21.0/me/accounts?fields=id,name&access_token=${encodeURIComponent(token)}`);
  const accountsData = await accountsRes.json();
  console.log('GET /me/accounts RESULT:');
  console.log(JSON.stringify(accountsData, null, 2));
}

run();
