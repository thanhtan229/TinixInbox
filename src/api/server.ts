import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { ENV } from '../config/env.ts';
import { InboxError } from '../core/errors.ts';
import { CallbackController } from './callback-controller.ts';
import { InboxController } from './inbox-controller.ts';
import { WebhookController } from './webhook-controller.ts';
import type { InboxEventBus } from './event-bus.ts';

export interface AppServerOptions {
  port: number;
  host: string;
  publicDir?: string;
  callbackController: CallbackController;
  webhookController: WebhookController;
  inboxController: InboxController;
  eventBus?: InboxEventBus;
  operatorToken?: string;
}

function constantTimeTextEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

export function isLoopbackAddress(address: string | undefined): boolean {
  if (!address) return false;
  const normalized = address.toLowerCase().replace(/^::ffff:/, '');
  if (normalized === '::1') return true;
  const parts = normalized.split('.');
  return parts.length === 4
    && parts[0] === '127'
    && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}


export function resolvePublicFilePath(publicDir: string, pathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const root = resolve(publicDir);
  const target = resolve(root, decoded.replace(/^[/\\]+/, ''));
  const rel = relative(root, target);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return null;
  return target;
}

export function createAppServer(options: AppServerOptions) {
  const publicDir = options.publicDir || join(process.cwd(), 'public');
  const maxBodyBytes = 1024 * 1024;
  const operatorToken = options.operatorToken !== undefined ? options.operatorToken : ENV.TINIX_OPERATOR_TOKEN;

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;
    const correlationId = randomUUID();

    const sendJson = (statusCode: number, data: unknown) => {
      res.writeHead(statusCode, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    };

    if (pathname.startsWith('/webhooks/') || pathname.startsWith('/api/')) {
      console.log(`[HTTP] ${req.method} ${pathname} (from ${req.socket.remoteAddress})`);
    }

    // Buffer body for POST/PUT requests
    const chunks: Buffer[] = [];
    let bodyBytes = 0;
    for await (const chunk of req) {
      const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
      bodyBytes += buffer.byteLength;
      if (bodyBytes > maxBodyBytes) return sendJson(413, { error: 'Request body exceeds the 1 MB limit' });
      chunks.push(buffer);
    }
    const rawBody = Buffer.concat(chunks).toString('utf8');

    let jsonBody: Record<string, unknown> = {};
    if (rawBody && req.headers['content-type']?.includes('application/json')) {
      try {
        jsonBody = JSON.parse(rawBody);
      } catch {
        return sendJson(400, { error: 'Request body is not valid JSON' });
      }
    }

    try {
      // 1. Health check
      if (req.method === 'GET' && (pathname === '/health' || pathname === '/api/health')) {
        return sendJson(200, options.inboxController.getHealth());
      }

      if (req.method === 'GET' && pathname === '/metrics') {
        if (!isLoopbackAddress(req.socket.remoteAddress) || req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for']) {
          return sendJson(403, { error: 'Metrics are available only from loopback clients' });
        }
        res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' });
        res.end(options.inboxController.getPrometheusMetrics());
        return;
      }

      // 2. Chatwoot Callback Receiver
      if (req.method === 'POST' && pathname === '/webhooks/chatwoot') {
        const contentType = req.headers['content-type']?.split(';', 1)[0].trim().toLowerCase();
        if (contentType !== 'application/json') {
          return sendJson(415, { error: 'Content-Type must be application/json' });
        }
        const result = await options.callbackController.handleCallback(rawBody, req.headers);
        return sendJson(result.status, result.body);
      }

      // 3. Provider Webhook Ingestion
      const channelWebhookMatch = pathname.match(/^\/webhooks\/(?:channels|inbox)\/([^/]+)(?:\/([^/]+))?$/);
      if (channelWebhookMatch) {
        const [, provider, connectionId] = channelWebhookMatch;
        if (req.method === 'GET') {
          const result = await options.webhookController.verifyChallenge(provider, connectionId, url.searchParams);
          res.writeHead(result.status, { 'Content-Type': 'text/plain' });
          res.end(result.body);
          return;
        }
        if (req.method === 'POST') {
          const result = await options.webhookController.handleWebhook(provider, connectionId, rawBody, req.headers);
          return sendJson(result.status, result.body);
        }
      }

      // 4. API Endpoints
      if (pathname.startsWith('/api/')) {
        const requestHost = url.hostname.toLowerCase();
        if (!operatorToken && (!isLoopbackAddress(req.socket.remoteAddress)
          || !['localhost', '127.0.0.1', '[::1]', '::1'].includes(requestHost)
          || req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'])) {
          return sendJson(401, { error: 'Operator authentication is required for proxied or remote API access' });
        }
        const origin = req.headers.origin;
        if (origin && origin !== url.origin) return sendJson(403, { error: 'Cross-origin operator requests are forbidden' });
        if (pathname !== '/api/health' && operatorToken) {
          const authHeader = req.headers['authorization'];
          const tokenHeader = req.headers['x-tinix-token'];
          const tokenQuery = url.searchParams.get('token');
          const bearerToken = typeof authHeader === 'string' && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : undefined;
          const supplied = bearerToken || (typeof tokenHeader === 'string' ? tokenHeader : undefined) || tokenQuery;

          if (!supplied || !constantTimeTextEqual(supplied, operatorToken)) {
            return sendJson(401, { error: 'Unauthorized: invalid or missing operator token' });
          }
        }

        // Realtime Server-Sent Events (SSE)
        if (req.method === 'GET' && pathname === '/api/events') {
          if (!options.eventBus) {
            return sendJson(503, { error: 'EventBus not available' });
          }
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no',
          });
          options.eventBus.registerClient(res);
          req.on('close', () => {
            options.eventBus?.removeClient(res);
          });
          return;
        }

        // Connections
        if (req.method === 'GET' && pathname === '/api/connections') {
          return sendJson(200, options.inboxController.getConnections());
        }
        if (req.method === 'POST' && pathname === '/api/connections') {
          return sendJson(201, options.inboxController.createConnection(jsonBody));
        }
        const connectionLifecycleMatch = pathname.match(/^\/api\/connections\/([^/]+)\/lifecycle$/);
        if (req.method === 'POST' && connectionLifecycleMatch) {
          const enabled = jsonBody.enabled;
          if (typeof enabled !== 'boolean') {
            return sendJson(400, { error: 'enabled must be a boolean' });
          }
          return sendJson(200, options.inboxController.setConnectionEnabled(connectionLifecycleMatch[1], enabled));
        }
        const connectionDeleteMatch = pathname.match(/^\/api\/connections\/([^/]+)$/);
        if (req.method === 'DELETE' && connectionDeleteMatch) {
          const result = options.inboxController.deleteConnection(connectionDeleteMatch[1]);
          return sendJson(result.success ? 200 : 404, result);
        }

        // Meta inspect and connect routes
        if (req.method === 'POST' && pathname === '/api/channels/inspect-meta') {
          const token = typeof jsonBody.token === 'string' ? jsonBody.token : '';
          const result = await options.inboxController.inspectMetaToken(token);
          return sendJson(result.valid ? 200 : 400, result);
        }
        if (req.method === 'POST' && pathname === '/api/channels/connect-meta') {
          const token = typeof jsonBody.token === 'string' ? jsonBody.token : '';
          const displayName = typeof jsonBody.displayName === 'string' ? jsonBody.displayName : undefined;
          const pageId = typeof jsonBody.pageId === 'string' ? jsonBody.pageId : undefined;
          const result = await options.inboxController.connectMetaPage({ token, displayName, pageId });
          return sendJson(result.success ? 200 : 400, result);
        }

        // Conversations
        if (req.method === 'GET' && pathname === '/api/conversations') {
          return sendJson(200, await options.inboxController.getConversations());
        }

        // Messages in conversation
        const attachmentMatch = pathname.match(/^\/api\/conversations\/([^/]+)\/messages\/(\d+)\/attachments\/(\d+)$/);
        if (req.method === 'GET' && attachmentMatch) {
          const messageId = Number(attachmentMatch[2]);
          const attachmentIndex = Number(attachmentMatch[3]);
          if (!Number.isSafeInteger(messageId) || messageId <= 0 || !Number.isSafeInteger(attachmentIndex) || attachmentIndex < 0) {
            return sendJson(400, { error: 'message ID or attachment index is invalid' });
          }
          const attachment = await options.inboxController.downloadMessageAttachment(attachmentMatch[1], messageId, attachmentIndex);
          const safeName = attachment.fileName.replace(/["\\\r\n\0]/g, '_');
          const disposition = attachment.mimeType === 'application/octet-stream' ? 'attachment' : 'inline';
          res.writeHead(200, {
            'Content-Type': attachment.mimeType,
            'Content-Length': String(attachment.sizeBytes),
            'Content-Disposition': `${disposition}; filename*=UTF-8''${encodeURIComponent(safeName)}`,
            'Cache-Control': 'private, no-store',
            'X-Content-Type-Options': 'nosniff',
            'Content-Security-Policy': "default-src 'none'; sandbox",
          });
          res.end(Buffer.from(attachment.bytes));
          return;
        }

        const messagesMatch = pathname.match(/^\/api\/conversations\/([^/]+)\/messages$/);
        if (messagesMatch) {
          const convId = messagesMatch[1];
          if (req.method === 'GET') {
            const beforeParam = url.searchParams.get('before');
            const before = beforeParam === null ? undefined : Number(beforeParam);
            if (before !== undefined && (!Number.isSafeInteger(before) || before <= 0)) {
              return sendJson(400, { error: 'before must be a positive message ID' });
            }
            const msgs = await options.inboxController.getMessages(convId, before);
            return sendJson(200, msgs);
          }
          if (req.method === 'POST') {
            if (typeof jsonBody.operationId !== 'string') return sendJson(400, { error: 'A stable operationId is required for message submission' });
            const result = await options.inboxController.sendMessage(
              convId,
              String(jsonBody.content || ''),
              Boolean(jsonBody.isPrivate),
              typeof jsonBody.operationId === 'string' ? jsonBody.operationId : undefined
            );
            return sendJson(201, result);
          }
        }

        const conversationStatusMatch = pathname.match(/^\/api\/conversations\/([^/]+)\/status$/);
        if (req.method === 'POST' && conversationStatusMatch) {
          const allowedStatuses = ['open', 'resolved', 'pending', 'snoozed'];
          const status = jsonBody.status;
          if (typeof status !== 'string' || !allowedStatuses.includes(status)) {
            return sendJson(400, { error: 'status must be open, resolved, pending, or snoozed' });
          }
          await options.inboxController.updateConversationStatus(
            conversationStatusMatch[1],
            status as 'open' | 'resolved' | 'pending' | 'snoozed'
          );
          return sendJson(200, { ok: true, status });
        }

        const assignmentMatch = pathname.match(/^\/api\/conversations\/([^/]+)\/assignment$/);
        if (assignmentMatch && req.method === 'GET') {
          return sendJson(200, await options.inboxController.getConversationAssignment(assignmentMatch[1]));
        }
        if (assignmentMatch && req.method === 'POST') {
          const agentId = jsonBody.agentId;
          if (typeof agentId !== 'number' || !Number.isSafeInteger(agentId) || agentId <= 0) {
            return sendJson(400, { error: 'agentId must be a positive integer' });
          }
          const assignment = await options.inboxController.assignConversation(assignmentMatch[1], agentId);
          return sendJson(200, { ok: true, ...assignment });
        }

        // Takeover / Resume
        const takeoverMatch = pathname.match(/^\/api\/conversations\/([^/]+)\/takeover$/);
        if (req.method === 'POST' && takeoverMatch) {
          options.inboxController.takeoverConversation(takeoverMatch[1]);
          return sendJson(200, { ok: true, mode: 'human' });
        }

        const resumeMatch = pathname.match(/^\/api\/conversations\/([^/]+)\/resume$/);
        if (req.method === 'POST' && resumeMatch) {
          options.inboxController.resumeAI(resumeMatch[1]);
          return sendJson(200, { ok: true, mode: 'ai' });
        }

        const retryMatch = pathname.match(/^\/api\/messages\/([^/]+)\/retry$/);
        if (req.method === 'POST' && retryMatch) {
          const msgId = parseInt(retryMatch[1], 10);
          const result = await options.inboxController.retryMessage(msgId);
          return sendJson(result.success ? 200 : 400, result);
        }

        // Reconciliation
        if (req.method === 'POST' && pathname === '/api/reconcile') {
          const res = await options.inboxController.triggerReconcile();
          return sendJson(200, res);
        }

        // Outbox Dead-Letter Redrive All
        if (req.method === 'POST' && pathname === '/api/outbox/redrive-all') {
          const res = await options.inboxController.redriveDeadLetters();
          return sendJson(200, res);
        }

        // Outbox & Inbound Unknown/Dead-letter inspection
        if (req.method === 'GET' && pathname === '/api/outbox/unknown') {
          return sendJson(200, options.inboxController.getUnknownOutboxMessages());
        }
        if (req.method === 'GET' && pathname === '/api/outbox/dead-letter') {
          return sendJson(200, options.inboxController.getDeadLetterOutboxMessages());
        }
        if (req.method === 'GET' && pathname === '/api/inbound/unknown') {
          return sendJson(200, options.inboxController.getUnknownInboundMessages());
        }

        return sendJson(404, { error: 'API endpoint not found' });
      }

      // 5. Static File Serving (Web UI)
      const publicPath = pathname === '/' ? '/index.html' : pathname;
      const filePath = resolvePublicFilePath(publicDir, publicPath);
      if (filePath && existsSync(filePath)) {
        let contentType = 'text/plain';
        if (filePath.endsWith('.html')) contentType = 'text/html';
        else if (filePath.endsWith('.css')) contentType = 'text/css';
        else if (filePath.endsWith('.js')) contentType = 'application/javascript';
        else if (filePath.endsWith('.json')) contentType = 'application/json';
        else if (filePath.endsWith('.png')) contentType = 'image/png';
        else if (filePath.endsWith('.ico')) contentType = 'image/x-icon';

        const fileContent = readFileSync(filePath);
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(fileContent);
        return;
      }

      // Default fallback to index.html for SPA routing if present
      const indexFile = join(publicDir, 'index.html');
      if (existsSync(indexFile)) {
        const fileContent = readFileSync(indexFile);
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(fileContent);
        return;
      }

      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    } catch (err) {
      if (err instanceof InboxError) {
        console.warn('[Server] Request failed:', { correlationId, code: err.code, provider: err.provider });
        return sendJson(err.httpStatus, { error: err.safeMessage, code: err.code, correlationId });
      }
      console.error('[Server] Unhandled request error:', {
        correlationId,
        errorName: err instanceof Error ? err.name : 'UnknownError',
      });
      sendJson(500, { error: 'Internal server error', correlationId });
    }
  });

  return {
    start: () =>
      new Promise<void>((resolve) => {
        server.listen(options.port, options.host, () => {
          console.log(`[Tinix Inbox] Server listening on http://${options.host}:${options.port}`);
          resolve();
        });
      }),
    stop: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
    server,
  };
}
