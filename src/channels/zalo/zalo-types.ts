export interface ZaloWebhookEvent {
  app_id?: string;
  oa_id?: string;
  user_id_by_app?: string;
  event_name: string;
  sender?: { id: string };
  recipient?: { id: string };
  timestamp?: string | number;
  message?: {
    msg_id: string;
    text?: string;
    attachments?: Array<{
      type: string;
      payload: { url?: string; thumbnail?: string; [key: string]: unknown };
    }>;
  };
}

export interface ZaloSendResponse {
  error: number;
  message: string;
  data?: {
    message_id?: string;
    user_id?: string;
  };
}

export interface ZaloTokenRefreshResponse {
  access_token: string;
  refresh_token: string;
  expires_in: string | number;
  error?: number;
  message?: string;
}

export interface ZaloCredentials {
  appId?: string;
  secretKey?: string;
  accessToken: string;
  refreshToken?: string;
  oaId?: string;
}
