import type { TikTokShopSendResponse } from './tiktok-shop-types.ts';
import { AuthorizationError } from '../../core/errors.ts';

export class TikTokShopClient {
  public async sendMessage(
    _accessToken: string,
    _conversationId: string,
    _text?: string,
    _attachmentUrl?: string
  ): Promise<TikTokShopSendResponse> {
    throw new AuthorizationError(
      'BLOCKED_BY_PROVIDER: TikTok Shop sending requires the approved seller.customer_service scope and a verified, signed current Open API integration.',
      { provider: 'tiktok_shop', httpStatus: 403 }
    );
  }
}
