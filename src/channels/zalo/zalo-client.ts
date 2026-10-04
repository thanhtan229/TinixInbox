import type { ZaloSendResponse, ZaloTokenRefreshResponse } from './zalo-types.ts';
import {
  RateLimitError,
  ProviderTemporaryError,
  ProviderPermanentError,
  CredentialExpiredError,
} from '../../core/errors.ts';

export interface ZaloClientOptions {
  fetchFn?: typeof fetch;
}

export class ZaloClient {
  private fetchFn: typeof fetch;

  constructor(options: ZaloClientOptions = {}) {
    this.fetchFn = options.fetchFn || fetch;
  }

  public async sendMessage(
    accessToken: string,
    recipientUserId: string,
    text?: string,
    attachmentUrl?: string
  ): Promise<ZaloSendResponse> {
    if (!accessToken?.trim()) {
      throw new ProviderPermanentError('Zalo access token is not configured');
    }
    const url = 'https://openapi.zalo.me/v3.0/oa/message/cs';

    let body: Record<string, unknown>;

    if (attachmentUrl) {
      body = {
        recipient: { user_id: recipientUserId },
        message: {
          attachment: {
            type: 'template',
            payload: {
              template_type: 'media',
              elements: [
                {
                  media_type: 'image',
                  url: attachmentUrl,
                },
              ],
            },
          },
        },
      };
    } else if (text) {
      body = {
        recipient: { user_id: recipientUserId },
        message: { text },
      };
    } else {
      throw new ProviderPermanentError('Zalo send request requires either text or attachment');
    }

    try {
      const response = await this.fetchFn(url, {
        method: 'POST',
        headers: {
          access_token: accessToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      const data = (await response.json()) as ZaloSendResponse;

      if (!response.ok || (data.error && data.error !== 0)) {
        const errCode = data.error;
        const msg = data.message || `Zalo API failed with HTTP ${response.status}`;

        if (response.status === 429 || errCode === -32 || errCode === -216) {
          throw new RateLimitError(`Zalo rate limit or quota exceeded: ${msg}`, 60, {
            provider: 'zalo',
            internalDetails: { providerErrorCode: errCode },
            httpStatus: 429,
          });
        }

        if (errCode === -213 || errCode === -214) {
          throw new CredentialExpiredError(`Zalo access token expired or invalid: ${msg}`, {
            provider: 'zalo',
            internalDetails: { providerErrorCode: errCode },
            httpStatus: 401,
          });
        }

        if (response.status >= 500 || errCode === -1) {
          throw new ProviderTemporaryError(`Zalo temporary error: ${msg}`, {
            provider: 'zalo',
            internalDetails: { providerErrorCode: errCode },
            httpStatus: 502,
          });
        }

        if (errCode === -204 || errCode === -210 || errCode === -211) {
          throw new ProviderPermanentError(`Zalo customer window or recipient error: ${msg}`, {
            provider: 'zalo',
            internalDetails: { providerErrorCode: errCode },
            httpStatus: 400,
          });
        }

        throw new ProviderPermanentError(`Zalo send error: ${msg} (code: ${errCode})`, {
          provider: 'zalo',
          internalDetails: { providerErrorCode: errCode },
          httpStatus: response.status >= 400 ? response.status : 400,
        });
      }

      return data;
    } catch (err) {
      if (
        err instanceof RateLimitError ||
        err instanceof ProviderTemporaryError ||
        err instanceof ProviderPermanentError ||
        err instanceof CredentialExpiredError
      ) {
        throw err;
      }
      throw new ProviderTemporaryError(`Network error communicating with Zalo: ${(err as Error).message}`, {
        provider: 'zalo',
      });
    }
  }

  public async refreshToken(
    appId: string,
    secretKey: string,
    refreshToken: string
  ): Promise<ZaloTokenRefreshResponse> {
    const url = 'https://oauth.zaloapp.com/v4/oa/access_token';

    const params = new URLSearchParams({
      app_id: appId,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    });

    try {
      const response = await this.fetchFn(url, {
        method: 'POST',
        headers: {
          secret_key: secretKey,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      });

      const data = (await response.json()) as ZaloTokenRefreshResponse;

      if (!response.ok || (data.error && data.error !== 0)) {
        throw new ProviderPermanentError(
          `Zalo token refresh failed: ${data.message || `HTTP ${response.status}`}`,
          { provider: 'zalo', internalDetails: { providerErrorCode: data.error } }
        );
      }

      return data;
    } catch (err) {
      if (err instanceof ProviderPermanentError || err instanceof ProviderTemporaryError) {
        throw err;
      }
      throw new ProviderTemporaryError(`Network error during Zalo token refresh: ${(err as Error).message}`, {
        provider: 'zalo',
      });
    }
  }
}
