import { createHash, timingSafeEqual } from 'node:crypto';
import type { ChannelAdapter, ChannelSendRequest, ChannelSendResult } from '../../core/channel-adapter.ts';
import type { ChannelConnection, ChannelProvider } from '../../core/types.ts';
import type { UnifiedMessage } from '../../core/unified-message.ts';
import { CredentialExpiredError, ProviderTemporaryError, RateLimitError } from '../../core/errors.ts';
import { ZaloClient } from './zalo-client.ts';
import { normalizeZaloWebhookEvent } from './zalo-normalizer.ts';
import type { ZaloCredentials, ZaloWebhookEvent } from './zalo-types.ts';

export class ZaloChannelAdapter implements ChannelAdapter {
  readonly provider: ChannelProvider = 'zalo';
  private client: ZaloClient;

  constructor(client?: ZaloClient) {
    this.client = client || new ZaloClient();
  }

  public async validateConnection(credentials: string): Promise<{ valid: boolean; error?: string }> {
    if (!credentials || credentials.trim().length === 0) {
      return { valid: false, error: 'Empty credentials provided' };
    }

    try {
      const parsed = JSON.parse(credentials) as ZaloCredentials;
      if (!parsed.accessToken || parsed.accessToken.trim().length < 5) {
        return { valid: false, error: 'Missing or invalid accessToken in credentials JSON' };
      }
      return { valid: true };
    } catch {
      // If plain token string
      if (credentials.trim().length < 10) {
        return { valid: false, error: 'Invalid Zalo access token format' };
      }
      return { valid: true };
    }
  }

  public async verifyWebhook(
    rawBody: string,
    headers: Record<string, string | string[] | undefined>,
    secret: string
  ): Promise<boolean> {
    const rawSig = headers['x-zevent-signature'] || headers['X-ZEvent-Signature'];
    if (typeof rawSig !== 'string' || !secret) {
      return false;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      return false;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return false;
    }

    const event = parsed as Record<string, unknown>;
    const appId = event.app_id;
    const timestamp = event.timestamp;
    if ((typeof appId !== 'string' && typeof appId !== 'number') ||
        (typeof timestamp !== 'string' && typeof timestamp !== 'number')) {
      return false;
    }

    const signature = rawSig.trim().match(/^(?:mac=)?([a-f0-9]{64})$/i)?.[1];
    if (!signature) return false;

    const expected = createHash('sha256')
      .update(`${appId}${rawBody}${timestamp}${secret}`)
      .digest();
    const actual = Buffer.from(signature, 'hex');
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }

  public async parseWebhook(rawBody: string): Promise<unknown[]> {
    try {
      const data = JSON.parse(rawBody);
      if (!data) return [];
      if (Array.isArray(data)) return data;
      // Single event payload
      return [data];
    } catch {
      return [];
    }
  }

  public async normalizeEvent(
    rawEvent: unknown,
    connection: ChannelConnection
  ): Promise<UnifiedMessage[]> {
    return normalizeZaloWebhookEvent(rawEvent as ZaloWebhookEvent, connection);
  }

  public async sendMessage(request: ChannelSendRequest): Promise<ChannelSendResult> {
    let accessToken = request.metadata?.accessToken as string | undefined;
    if (!accessToken && request.metadata?.credentials) {
      try {
        const creds = JSON.parse(request.metadata.credentials as string) as ZaloCredentials;
        accessToken = creds.accessToken;
      } catch {
        accessToken = request.metadata.credentials as string;
      }
    }
    if (!accessToken?.trim()) {
      return {
        success: false,
        failureKind: 'permanent',
        sentAt: new Date().toISOString(),
        error: 'Zalo access token is not configured for this connection',
      };
    }

    const attachmentUrl =
      request.attachments && request.attachments.length > 0
        ? request.attachments[0].url
        : undefined;

    try {
      const res = await this.client.sendMessage(
        accessToken,
        request.recipientExternalId,
        request.text,
        attachmentUrl
      );

      return {
        success: true,
        providerMessageId: res.data?.message_id,
        sentAt: new Date().toISOString(),
        rawResponse: res,
      };
    } catch (err) {
      return {
        success: false,
        failureKind: err instanceof RateLimitError ? 'retryable' : err instanceof ProviderTemporaryError ? 'unknown' : err instanceof CredentialExpiredError ? 'permanent' : 'permanent',
        sentAt: new Date().toISOString(),
        error: (err as Error).message,
      };
    }
  }

  public async refreshCredentials(
    connection: ChannelConnection
  ): Promise<{ refreshed: boolean; newCredentials?: string; error?: string }> {
    try {
      let creds: ZaloCredentials;
      try {
        creds = JSON.parse(connection.credentialsEncrypted) as ZaloCredentials;
      } catch {
        return { refreshed: false, error: 'Credentials is not JSON format' };
      }

      if (!creds.appId || !creds.secretKey || !creds.refreshToken) {
        return {
          refreshed: false,
          error: 'Missing appId, secretKey or refreshToken for Zalo token refresh',
        };
      }

      const res = await this.client.refreshToken(creds.appId, creds.secretKey, creds.refreshToken);

      const updatedCreds: ZaloCredentials = {
        ...creds,
        accessToken: res.access_token,
        refreshToken: res.refresh_token,
      };

      return {
        refreshed: true,
        newCredentials: JSON.stringify(updatedCreds),
      };
    } catch (err) {
      return {
        refreshed: false,
        error: (err as Error).message,
      };
    }
  }
}
