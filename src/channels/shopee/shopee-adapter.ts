import { createHmac, timingSafeEqual } from 'node:crypto';
import type { ChannelAdapter, ChannelSendRequest, ChannelSendResult } from '../../core/channel-adapter.ts';
import type { ChannelConnection, ChannelProvider } from '../../core/types.ts';
import type { UnifiedMessage } from '../../core/unified-message.ts';
import { ShopeeClient } from './shopee-client.ts';
import { normalizeShopeeWebhookEvent } from './shopee-normalizer.ts';
import type { ShopeeCredentials, ShopeeWebhookEvent } from './shopee-types.ts';

export class ShopeeChannelAdapter implements ChannelAdapter {
  readonly provider: ChannelProvider = 'shopee';
  private client: ShopeeClient;

  constructor(client?: ShopeeClient) {
    this.client = client || new ShopeeClient();
  }

  public async validateConnection(credentials: string): Promise<{ valid: boolean; error?: string }> {
    if (!credentials || credentials.trim().length === 0) {
      return { valid: false, error: 'BLOCKED_BY_PROVIDER: Shopee app credentials not configured' };
    }

    try {
      const parsed = JSON.parse(credentials) as ShopeeCredentials;
      if (!parsed.accessToken || !parsed.partnerKey) {
        return { valid: false, error: 'BLOCKED_BY_PROVIDER: Missing partnerKey or accessToken in Shopee credentials' };
      }
      return { valid: false, error: 'BLOCKED_BY_PROVIDER: Shopee Seller Chat access and an approved partner app have not been verified' };
    } catch {
      return { valid: false, error: 'BLOCKED_BY_PROVIDER: Shopee requires structured partner and shop credentials' };
    }
  }

  public async verifyWebhook(
    rawBody: string,
    headers: Record<string, string | string[] | undefined>,
    secret: string
  ): Promise<boolean> {
    const signature =
      (headers['authorization'] ||
        headers['x-shopee-signature'] ||
        headers['signature']) as string | undefined;

    if (!signature) {
      return false;
    }

    const cleanSig = signature.replace(/^sha256=/i, '').trim();
    const expectedSig = createHmac('sha256', secret).update(rawBody).digest('hex');

    const expectedBuf = Buffer.from(expectedSig, 'utf8');
    const actualBuf = Buffer.from(cleanSig, 'utf8');

    if (expectedBuf.length !== actualBuf.length) {
      return false;
    }

    return timingSafeEqual(expectedBuf, actualBuf);
  }

  public async parseWebhook(rawBody: string): Promise<unknown[]> {
    try {
      const data = JSON.parse(rawBody);
      if (!data) return [];
      if (Array.isArray(data)) return data;
      return [data];
    } catch {
      return [];
    }
  }

  public async normalizeEvent(
    rawEvent: unknown,
    connection: ChannelConnection
  ): Promise<UnifiedMessage[]> {
    return normalizeShopeeWebhookEvent(rawEvent as ShopeeWebhookEvent, connection);
  }

  public async sendMessage(request: ChannelSendRequest): Promise<ChannelSendResult> {
    void request;
    return {
      success: false,
      failureKind: 'permanent',
      sentAt: new Date().toISOString(),
      error: 'BLOCKED_BY_PROVIDER: Shopee Seller Chat messaging access is not verified for an approved app and shop.',
    };
  }
}
