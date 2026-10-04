import type { ShopeeCredentials, ShopeeSendResponse } from './shopee-types.ts';
import { AuthorizationError } from '../../core/errors.ts';

export class ShopeeClient {
  public async sendMessage(
    _creds: ShopeeCredentials,
    _toId: number,
    _text?: string
  ): Promise<ShopeeSendResponse> {
    throw new AuthorizationError(
      'BLOCKED_BY_PROVIDER: Shopee Seller Chat sending remains disabled until official account access, endpoint permissions, and seller E2E are verified.',
      { provider: 'shopee', httpStatus: 403 }
    );
  }
}
