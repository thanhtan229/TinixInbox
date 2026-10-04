export interface MetaWebhookEntry {
  id: string;
  time: number;
  messaging?: MetaMessagingEvent[];
  standby?: MetaMessagingEvent[];
}

export interface MetaMessagingEvent {
  sender: { id: string };
  recipient: { id: string };
  timestamp: number;
  message?: {
    mid: string;
    text?: string;
    attachments?: Array<{
      type: 'image' | 'video' | 'audio' | 'file' | string;
      payload: { url: string; [key: string]: unknown };
    }>;
    reply_to?: { mid: string };
    is_echo?: boolean;
    app_id?: number;
  };
  delivery?: {
    mids?: string[];
    watermark: number;
  };
  read?: {
    watermark: number;
  };
}

export interface MetaSendResponse {
  recipient_id: string;
  message_id: string;
  error?: {
    message: string;
    type: string;
    code: number;
    error_subcode?: number;
    fbtrace_id?: string;
  };
}
