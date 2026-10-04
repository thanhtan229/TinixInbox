import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { InboundService } from '../services/inbound-service.ts';
import { InboxError } from '../core/errors.ts';
import { ChannelConnectionRepository, ProviderWebhookEventRepository } from '../persistence/repositories.ts';
import type { ChannelAdapter } from '../core/channel-adapter.ts';
import type { ChannelConnection } from '../core/types.ts';
import { channelEnabled } from '../config/feature-flags.ts';

export class WebhookController {
  private adapters: Map<string, ChannelAdapter> = new Map();
  private inboundService: InboundService;
  private connectionRepo: ChannelConnectionRepository;
  private eventRepo: ProviderWebhookEventRepository;

  constructor(
    inboundService: InboundService,
    connectionRepo: ChannelConnectionRepository,
    eventRepo: ProviderWebhookEventRepository
  ) {
    this.inboundService = inboundService;
    this.connectionRepo = connectionRepo;
    this.eventRepo = eventRepo;
  }

  public registerAdapter(provider: string, adapter: ChannelAdapter): void {
    this.adapters.set(provider, adapter);
  }

  public async handleWebhook(
    provider: string,
    connectionId: string | undefined,
    rawBody: string,
    headers: Record<string, string | string[] | undefined>
  ): Promise<{ status: number; body: unknown }> {
    if (!channelEnabled(provider)) return { status: 503, body: { error: 'Channel feature is disabled' } };
    let connection = connectionId ? this.connectionRepo.findById(connectionId) : null;
    if (!connection && provider && !connectionId) {
      const conns = this.connectionRepo.listByProvider('default-workspace', provider);
      connection = conns.find((c) => ['connected', 'degraded', 'pending'].includes(c.status)) || null;
    }
    if (!connection) {
      return { status: 404, body: { error: `Connection ${connectionId || provider} not found` } };
    }
    if (connection.provider !== provider || !['connected', 'degraded', 'pending'].includes(connection.status)) {
      return { status: 404, body: { error: 'Channel connection is unavailable' } };
    }

    const adapter = this.adapters.get(provider);
    if (!adapter) {
      return { status: 400, body: { error: `Provider ${provider} not supported` } };
    }

    const secret = this.resolveWebhookSecret(connection);
    if (!secret) {
      return { status: 401, body: { error: 'Webhook signing secret is not configured' } };
    }

    let signatureValid = false;
    try {
      signatureValid = await adapter.verifyWebhook(rawBody, headers, secret);
    } catch (err) {
      console.error(`[WebhookController] Signature verification error:`, err);
      signatureValid = false;
    }
    if (!signatureValid) {
      console.warn(`[WebhookController] Invalid signature for provider ${provider}, connection ${connectionId}. Header keys:`, Object.keys(headers));
      return { status: 401, body: { error: 'Provider webhook signature is invalid' } };
    }

    console.log(`[WebhookController] Verified webhook received for ${provider} (${connectionId}), payload length: ${rawBody.length}`);
    const payloadHash = createHash('sha256').update(rawBody).digest('hex');
    const eventId = randomUUID();
    const inserted = this.eventRepo.recordEvent({
      id: eventId,
      workspaceId: connection.workspaceId,
      provider,
      channelConnectionId: connection.id,
      providerEventId: payloadHash,
      payloadHash,
      rawPayload: rawBody,
      correlationId: randomUUID(),
      receivedAt: new Date().toISOString(),
    });
    if (!inserted) return { status: 200, body: { success: true, duplicate: true } };

    setImmediate(() => {
      this.processPendingProviderEvents().catch((error) => {
        console.error('[ProviderWebhookWorker] Event processing failed:', error);
      });
    });
    return { status: 200, body: { success: true, accepted: true, eventId } };
  }

  public recoverInterruptedEvents(): number {
    return this.eventRepo.recoverInterrupted();
  }

  public async processPendingProviderEvents(limit = 20): Promise<{ processed: number; failed: number }> {
    let processed = 0;
    let failed = 0;
    for (const event of this.eventRepo.claimReceived(limit)) {
      const id = String(event.id);
      try {
        const connection = this.connectionRepo.findById(String(event.channel_connection_id));
        const provider = String(event.provider);
        const adapter = this.adapters.get(provider);
        if (!connection || !adapter || !['connected', 'degraded'].includes(connection.status)) {
          throw new Error('Channel connection or adapter is no longer available');
        }
        await this.inboundService.processVerifiedInboundWebhook(
          adapter,
          connection,
          String(event.raw_payload),
          {}
        );
        this.eventRepo.markProcessed(id);
        processed++;
      } catch (error) {
        const status = this.eventRepo.markFailed(
          id,
          error instanceof Error ? error.message : 'Unknown webhook processing failure',
          error instanceof InboxError && error.retryable
        );
        if (status === 'dead_letter') {
          console.error('[ProviderWebhookWorker] Event moved to dead letter after retry limit', { eventId: id });
        }
        failed++;
      }
    }
    return { processed, failed };
  }

  public async verifyChallenge(
    provider: string,
    connectionId: string | undefined,
    query: URLSearchParams
  ): Promise<{ status: number; body: string }> {
    let connection = connectionId ? this.connectionRepo.findById(connectionId) : null;
    if (!connection && provider && !connectionId) {
      const conns = this.connectionRepo.listByProvider('default-workspace', provider);
      connection = conns.find((c) => ['connected', 'degraded', 'pending'].includes(c.status)) || null;
    }
    const mode = query.get('hub.mode');
    const suppliedToken = query.get('hub.verify_token') || '';
    const challenge = query.get('hub.challenge');
    let expectedToken = connection?.metadata.webhookVerifyToken;
    if (!expectedToken && connection?.credentialsEncrypted) {
      try {
        const creds = JSON.parse(connection.credentialsEncrypted) as Record<string, unknown>;
        if (typeof creds.webhookVerifyToken === 'string' && creds.webhookVerifyToken) {
          expectedToken = creds.webhookVerifyToken;
        }
      } catch {
        // Plain text token
      }
    }
    if (
      provider !== 'meta' || !connection || connection.provider !== provider ||
      !['connected', 'degraded', 'pending'].includes(connection.status) || mode !== 'subscribe' ||
      typeof expectedToken !== 'string' || !expectedToken || !constantTimeTextEqual(suppliedToken, expectedToken) || !challenge
    ) {
      return { status: 403, body: 'Forbidden' };
    }
    if (connection.status === 'pending') {
      this.connectionRepo.updateStatus(connection.id, 'connected', new Date().toISOString());
    }
    return { status: 200, body: challenge };
  }

  private resolveWebhookSecret(connection: ChannelConnection): string | undefined {
    const configured = connection.metadata.webhookSecret;
    if (typeof configured === 'string' && configured) return configured;
    try {
      const credentials = JSON.parse(connection.credentialsEncrypted) as Record<string, unknown>;
      for (const key of ['secretKey', 'appSecret', 'partnerKey', 'webhookSecret']) {
        const value = credentials[key];
        if (typeof value === 'string' && value) return value;
      }
    } catch {
      // Not JSON format
    }
    if (connection.provider === 'synthetic' && typeof connection.credentialsEncrypted === 'string' && connection.credentialsEncrypted) {
      return connection.credentialsEncrypted;
    }
    return undefined;
  }
}

function constantTimeTextEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}
