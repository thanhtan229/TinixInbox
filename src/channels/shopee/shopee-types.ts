export interface ShopeeCredentials {
  partnerId: number;
  partnerKey: string;
  accessToken: string;
  refreshToken?: string;
  shopId: number;
}

export interface ShopeeWebhookEvent {
  code: number; // e.g. 10: new message
  shop_id: number;
  timestamp: number;
  data?: {
    message_id?: string;
    conversation_id?: string;
    from_id?: number;
    to_id?: number;
    message_type?: 'text' | 'image';
    content?: {
      text?: string;
      image_url?: string;
    };
    created_timestamp?: number;
  };
}

export interface ShopeeSendResponse {
  error: string;
  message: string;
  response?: {
    message_id?: string;
    to_id?: number;
  };
}
