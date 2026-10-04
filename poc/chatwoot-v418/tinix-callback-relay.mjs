import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

export function createCallbackRelayServer(options = {}) {
  const maxBodyBytes = options.maxBodyBytes || 1024 * 1024;
  const tinixCallbackUrl = options.upstreamUrl || 'http://127.0.0.1:3182/webhooks/chatwoot';
  const fetchFn = options.fetchFn || fetch;

  return createServer(async (req, res) => {
    if (req.url !== '/webhooks/chatwoot') return send(res, 404, { error: 'Not found' });
    if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });

    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > maxBodyBytes) {
        req.destroy();
        return;
      }
      chunks.push(chunk);
    }

    try {
      const upstream = await fetchFn(tinixCallbackUrl, {
        method: 'POST',
        headers: {
          'content-type': req.headers['content-type'] || 'application/json',
          'x-chatwoot-signature': String(req.headers['x-chatwoot-signature'] || ''),
          'x-chatwoot-timestamp': String(req.headers['x-chatwoot-timestamp'] || ''),
        },
        body: Buffer.concat(chunks),
        signal: AbortSignal.timeout(10_000),
      });
      const responseText = await upstream.text();
      res.writeHead(upstream.status, {
        'content-type': upstream.headers.get('content-type') || 'application/json; charset=utf-8',
      });
      res.end(responseText);
    } catch {
      send(res, 502, { error: 'Tinix callback receiver is unavailable' });
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const host = process.env.TINIX_CALLBACK_RELAY_HOST || '127.0.0.1';
  const port = Number(process.env.TINIX_CALLBACK_RELAY_PORT || 3183);
  createCallbackRelayServer().listen(port, host, () => {
    console.log(`[Tinix Callback Relay] Listening on http://${host}:${port}; only POST /webhooks/chatwoot is forwarded.`);
  });
}
