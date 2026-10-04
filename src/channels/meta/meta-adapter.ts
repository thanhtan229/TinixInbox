import { createHmac, timingSafeEqual } from 'node:crypto';
import type { ChannelAdapter, ChannelSendRequest, ChannelSendResult } from '../../core/channel-adapter.ts';
import type { ChannelConnection, ChannelProvider } from '../../core/types.ts';
import type { UnifiedMessage } from '../../core/unified-message.ts';
import { ProviderTemporaryError, RateLimitError } from '../../core/errors.ts';
import { MetaClient } from './meta-client.ts';
import { normalizeMetaMessagingEvent } from './meta-normalizer.ts';
import type { MetaMessagingEvent, MetaWebhookEntry } from './meta-types.ts';

export class MetaChannelAdapter implements ChannelAdapter {
  readonly provider: ChannelProvider = 'meta';
  private client: MetaClient;

  constructor(client?: MetaClient) {
    this.client = client || new MetaClient();
  }

  public async validateConnection(credentials: string): Promise<{ valid: boolean; error?: string }> {
    if (!credentials || credentials.trim().length < 10) {
      return { valid: false, error: 'Invalid Meta access token format' };
    }
    return { valid: true };
  }

  public async verifyWebhook(
    rawBody: string,
    headers: Record<string, string | string[] | undefined>,
    secret: string
  ): Promise<boolean> {
    const signature = (headers['x-hub-signature-256'] || headers['X-Hub-Signature-256']) as string | undefined;
    if (!signature) {
      return false;
    }

    const expectedSignature = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
    const expectedBuf = Buffer.from(expectedSignature, 'utf8');
    const actualBuf = Buffer.from(signature, 'utf8');

    if (expectedBuf.length !== actualBuf.length) {
      return false;
    }

    return timingSafeEqual(expectedBuf, actualBuf);
  }

  public async parseWebhook(rawBody: string): Promise<unknown[]> {
    try {
      const data = JSON.parse(rawBody) as { object?: string; entry?: MetaWebhookEntry[] };
      if (!data.entry || !Array.isArray(data.entry)) {
        return [];
      }

      const events: MetaMessagingEvent[] = [];
      for (const entry of data.entry) {
        if (entry.messaging && Array.isArray(entry.messaging)) {
          events.push(...entry.messaging);
        }
      }
      return events;
    } catch {
      return [];
    }
  }

  public async normalizeEvent(
    rawEvent: unknown,
    connection: ChannelConnection
  ): Promise<UnifiedMessage[]> {
    return normalizeMetaMessagingEvent(rawEvent as MetaMessagingEvent, connection);
  }

  public async sendMessage(request: ChannelSendRequest): Promise<ChannelSendResult> {
    const token =
      (request.metadata?.accessToken as string | undefined) ||
      (request.metadata?.credentials as string | undefined);
    if (!token?.trim()) {
      return {
        success: false,
        sentAt: new Date().toISOString(),
        failureKind: 'permanent',
        error: 'Meta access token is not configured for this connection',
      };
    }
    const pageId = request.metadata?.pageId as string | undefined;
    if (!pageId?.trim()) {
      return {
        success: false,
        failureKind: 'permanent',
        sentAt: new Date().toISOString(),
        error: 'Meta Page ID is not configured for this connection',
      };
    }
    if (request.attachments && (request.attachments.length > 1 || request.attachments.some((item) => item.type !== 'image'))) {
      return {
        success: false,
        failureKind: 'permanent',
        sentAt: new Date().toISOString(),
        error: 'This Meta adapter currently supports one image attachment per message',
      };
    }
    const attachmentUrl = request.attachments && request.attachments.length > 0 ? request.attachments[0].url : undefined;

    try {
      const res = await this.client.sendMessage(
        token,
        pageId,
        request.recipientExternalId,
        request.text,
        attachmentUrl
      );

      return {
        success: true,
        providerMessageId: res.message_id,
        sentAt: new Date().toISOString(),
        rawResponse: res,
      };
    } catch (err) {
      return {
        success: false,
        failureKind: err instanceof RateLimitError ? 'retryable' : err instanceof ProviderTemporaryError ? 'unknown' : 'permanent',
        sentAt: new Date().toISOString(),
        error: (err as Error).message,
      };
    }
  }

}
