const appId = '1096726653342704';
const appSecret = process.env.META_APP_SECRET;
const token = `${appId}|${appSecret}`;
const res = await fetch(`https://graph.facebook.com/v21.0/${appId}?fields=id,name,link,status,contact_email&access_token=${token}`);
console.log(await res.json());
