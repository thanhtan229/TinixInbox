import type { MetaSendResponse } from './meta-types.ts';
import { RateLimitError, ProviderTemporaryError, ProviderPermanentError } from '../../core/errors.ts';

export interface MetaClientOptions {
  graphApiVersion?: string;
  fetchFn?: typeof fetch;
}

export class MetaClient {
  private graphApiVersion: string;
  private fetchFn: typeof fetch;

  constructor(options: MetaClientOptions = {}) {
    const configuredVersion = options.graphApiVersion || process.env.META_GRAPH_API_VERSION;
    if (!configuredVersion && process.env.NODE_ENV === 'production') {
      throw new Error('META_GRAPH_API_VERSION must be set and verified for the target Meta app in production');
    }
    this.graphApiVersion = configuredVersion || 'v21.0';
    if (!/^v\d+\.\d+$/.test(this.graphApiVersion)) {
      throw new Error('META_GRAPH_API_VERSION must use the form vNN.N');
    }
    this.fetchFn = options.fetchFn || fetch;
  }

  public async sendMessage(
    accessToken: string,
    pageId: string,
    recipientId: string,
    text?: string,
    attachmentUrl?: string,
    attachmentType: 'image' | 'video' | 'audio' | 'file' = 'image'
  ): Promise<MetaSendResponse> {
    if (!accessToken?.trim()) {
      throw new ProviderPermanentError('Meta access token is not configured');
    }
    if (!pageId?.trim()) {
      throw new ProviderPermanentError('Meta Page ID is not configured');
    }
    const url = `https://graph.facebook.com/${this.graphApiVersion}/${encodeURIComponent(pageId)}/messages`;

    const body: Record<string, unknown> = {
      recipient: { id: recipientId },
      messaging_type: 'RESPONSE',
    };

    if (attachmentUrl) {
      body.message = {
        attachment: {
          type: attachmentType,
          payload: { url: attachmentUrl, is_reusable: true },
        },
      };
    } else if (text) {
      body.message = { text };
    } else {
      throw new ProviderPermanentError('Meta send request requires either text or attachment');
    }

    try {
      const response = await this.fetchFn(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });

      const data = (await response.json()) as MetaSendResponse;

      if (!response.ok || data.error) {
        const error = data.error;
        const code = error?.code;
        const msg = error?.message || `Meta API failed with HTTP ${response.status}`;

        if (response.status === 429 || code === 4 || code === 17 || code === 32 || code === 613) {
          throw new RateLimitError(`Meta rate limit exceeded: ${msg}`, 60, { provider: 'meta', httpStatus: 429 });
        }
        if (response.status >= 500 || code === 1 || code === 2) {
          throw new ProviderTemporaryError(`Meta temporary service error: ${msg}`, { provider: 'meta', httpStatus: 502 });
        }
        throw new ProviderPermanentError(`Meta permanent error: ${msg} (code: ${code})`, { provider: 'meta', httpStatus: 400 });
      }

      return data;
    } catch (err) {
      if (err instanceof RateLimitError || err instanceof ProviderTemporaryError || err instanceof ProviderPermanentError) {
        throw err;
      }
      throw new ProviderTemporaryError(`Network error communicating with Meta: ${(err as Error).message}`, { provider: 'meta' });
    }
  }

  public async sendSenderAction(
    accessToken: string,
    pageId: string,
    recipientId: string,
    action: 'mark_seen' | 'typing_on' | 'typing_off'
  ): Promise<void> {
    const url = `https://graph.facebook.com/${this.graphApiVersion}/${encodeURIComponent(pageId)}/messages`;
    await this.fetchFn(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        recipient: { id: recipientId },
        sender_action: action,
      }),
      signal: AbortSignal.timeout(15_000),
    });
  }
}
