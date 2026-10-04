import { createHmac, timingSafeEqual } from 'node:crypto';
import type { ChannelAdapter, ChannelSendRequest, ChannelSendResult } from '../../core/channel-adapter.ts';
import type { ChannelConnection, ChannelProvider } from '../../core/types.ts';
import type { UnifiedMessage } from '../../core/unified-message.ts';
import { TikTokShopClient } from './tiktok-shop-client.ts';
import { normalizeTikTokShopWebhookEvent } from './tiktok-shop-normalizer.ts';
import type { TikTokShopCredentials, TikTokShopWebhookEvent } from './tiktok-shop-types.ts';

export class TikTokShopChannelAdapter implements ChannelAdapter {
  readonly provider: ChannelProvider = 'tiktok_shop';
  private client: TikTokShopClient;

  constructor(client?: TikTokShopClient) {
    this.client = client || new TikTokShopClient();
  }

  public async validateConnection(credentials: string): Promise<{ valid: boolean; error?: string }> {
    if (!credentials || credentials.trim().length === 0) {
      return { valid: false, error: 'BLOCKED_BY_PROVIDER: TikTok Shop app credentials not provided' };
    }

    try {
      const parsed = JSON.parse(credentials) as TikTokShopCredentials;
      if (!parsed.accessToken || !parsed.shopCipher || !parsed.appKey || !parsed.appSecret) {
        return { valid: false, error: 'BLOCKED_BY_PROVIDER: TikTok Shop seller token, app signing keys, and shop cipher are required' };
      }
      return { valid: false, error: 'BLOCKED_BY_PROVIDER: Credentials are present, but customer-service scope approval and authorized-seller E2E are not verified' };
    } catch {
      return { valid: false, error: 'BLOCKED_BY_PROVIDER: TikTok Shop requires a structured, approved seller credential set' };
    }
  }

  public async verifyWebhook(
    rawBody: string,
    headers: Record<string, string | string[] | undefined>,
    secret: string
  ): Promise<boolean> {
    const signature =
      (headers['authorization'] ||
        headers['x-tts-signature'] ||
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
    return normalizeTikTokShopWebhookEvent(rawEvent as TikTokShopWebhookEvent, connection);
  }

  public async sendMessage(request: ChannelSendRequest): Promise<ChannelSendResult> {
    void request;
    return {
      success: false,
      failureKind: 'permanent',
      sentAt: new Date().toISOString(),
      error: 'BLOCKED_BY_PROVIDER: TikTok Shop customer-service send has not passed app-scope and authorized-seller E2E verification.',
    };
  }
}
