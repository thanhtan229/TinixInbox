export interface TikTokShopCredentials {
  appKey?: string;
  appSecret?: string;
  accessToken: string;
  refreshToken?: string;
  shopCipher?: string;
  shopId?: string;
}

export interface TikTokShopWebhookEvent {
  event_type: number | string; // e.g. 1: message, 2: order
  event_name?: string;
  timestamp?: number;
  data?: {
    conversation_id?: string;
    sender?: {
      id: string;
      role: 'BUYER' | 'SELLER' | 'SYSTEM';
      name?: string;
    };
    message_id?: string;
    message_type?: 'TEXT' | 'IMAGE' | 'PRODUCT' | 'ORDER';
    content?: string; // JSON string or plain text
    create_time?: number;
  };
}

export interface TikTokShopSendResponse {
  code: number;
  message: string;
  data?: {
    message_id?: string;
    create_time?: number;
  };
}
