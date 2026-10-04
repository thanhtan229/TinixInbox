import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

export function createMetaRelayServer(options = {}) {
  const upstream = options.upstream || 'http://127.0.0.1:3182';
  const fetchFn = options.fetchFn || fetch;
  return createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://relay');
    const reply = (status, text) => { res.writeHead(status, { 'content-type': 'text/plain' }); res.end(text); };
    if (!/^\/webhooks\/(inbox|channels)\/meta\/[-a-zA-Z0-9_]+$/.test(url.pathname)) return reply(404, 'Not found');
    if (!['GET', 'POST'].includes(req.method)) return reply(405, 'Method not allowed');
    let bytes = 0;
    const chunks = [];
    for await (const chunk of req) {
      bytes += chunk.length;
      if (bytes > 1024 * 1024) return reply(413, 'Payload too large');
      chunks.push(chunk);
    }
    try {
      const response = await fetchFn(`${upstream}${url.pathname}${url.search}`, {
        method: req.method, headers: { 'content-type': req.headers['content-type'] || 'application/json',
          'x-hub-signature-256': String(req.headers['x-hub-signature-256'] || '') },
        body: req.method === 'POST' ? Buffer.concat(chunks) : undefined, signal: AbortSignal.timeout(10000), redirect: 'error',
      });
      res.writeHead(response.status, { 'content-type': response.headers.get('content-type') || 'application/json' });
      res.end(await response.text());
    } catch { reply(502, 'Tinix webhook receiver unavailable'); }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  createMetaRelayServer().listen(3184, '127.0.0.1', () => console.log('[Meta Relay] Webhook-only listener on 127.0.0.1:3184'));
}
