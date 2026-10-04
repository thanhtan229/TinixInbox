import { ConversationProviderError, InboxError, ProviderPermanentError, RateLimitError } from '../../core/errors.ts';
import type { ImportedAttachment } from '../../services/attachment-fetcher.ts';

export interface ChatwootClientOptions {
  baseUrl: string;
  apiToken: string;
}

export class ChatwootClient {
  private baseUrl: string;
  private apiToken: string;

  constructor(options: ChatwootClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.apiToken = options.apiToken;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const multipart = body instanceof FormData;
    const headers: Record<string, string> = {
      api_access_token: this.apiToken,
      ...(multipart ? {} : { 'Content-Type': 'application/json' }),
      Accept: 'application/json',
    };

    try {
      const response = await fetch(url, {
        method,
        headers,
        body: multipart ? body as FormData : body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) {
        const errorText = await response.text();
        const details = { provider: 'chatwoot', httpStatus: response.status, internalDetails: errorText };
        if (response.status === 429) {
          throw new RateLimitError(`Chatwoot rate limit reached for ${method} ${path}`, 60, details);
        }
        if (response.status === 408 || response.status >= 500) {
          throw new ConversationProviderError(`Chatwoot temporarily unavailable [${method} ${path}] HTTP ${response.status}`, details);
        }
        throw new ProviderPermanentError(`Chatwoot rejected ${method} ${path} with HTTP ${response.status}`, details);
      }

      if (response.status === 204) {
        return {} as T;
      }

      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof InboxError) {
        throw error;
      }
      throw new ConversationProviderError(
        `Failed to connect to Chatwoot at ${url}: ${(error as Error).message}`,
        { internalDetails: error }
      );
    }
  }

  public async listInboxes(accountId: number): Promise<Array<Record<string, unknown>>> {
    const res = await this.request<{ payload: Array<Record<string, unknown>> }>(
      'GET',
      `/api/v1/accounts/${accountId}/inboxes`
    );
    return res.payload || [];
  }

  public async provisionInbox(accountId: number, name: string, callbackUrl: string, inboxId?: number): Promise<Record<string, unknown>> {
    if (inboxId) return this.request('GET', `/api/v1/accounts/${accountId}/inboxes/${inboxId}`);
    const existing = (await this.listInboxes(accountId)).find(inbox => inbox.name === name && inbox.channel_type === 'Channel::Api');
    if (existing) return this.request('GET', `/api/v1/accounts/${accountId}/inboxes/${existing.id}`);
    return this.request('POST', `/api/v1/accounts/${accountId}/inboxes`, { name, channel: { type: 'api', webhook_url: callbackUrl } });
  }

  public async createContact(
    accountId: number,
    data: {
      name: string;
      identifier?: string;
      inbox_id?: number;
      source_id?: string;
      custom_attributes?: Record<string, unknown>;
    }
  ): Promise<{ id: number; name: string; identifier?: string }> {
    const res = await this.request<{ payload: { contact: { id: number; name: string; identifier?: string } } }>(
      'POST',
      `/api/v1/accounts/${accountId}/contacts`,
      data
    );
    return res.payload?.contact || (res as unknown as { contact: { id: number; name: string } }).contact;
  }

  public async findIdentity(accountId: number, inboxId: number, sourceId: string, identifier: string): Promise<{ contactId: number; sourceId: string } | null> {
    try {
      const contact = await this.request<Record<string, unknown>>('POST', `/api/v1/accounts/${accountId}/contact_inboxes/filter`,
        { inbox_id: inboxId, source_id: sourceId });
      if (contact.identifier !== identifier) throw new ProviderPermanentError('Remote contact source conflicts with Tinix identity');
      return { contactId: Number(contact.id), sourceId };
    } catch (error) {
      if (!(error instanceof ProviderPermanentError) || !error.message.endsWith('HTTP 404')) throw error;
      return null;
    }
  }

  public async findContactConversation(accountId: number, contactId: number, inboxId: number): Promise<{ id: number } | null> {
    const result = await this.request<{ payload?: Array<{ id: number; inbox_id: number; status: string }> }>(
      'GET', `/api/v1/accounts/${accountId}/contacts/${contactId}/conversations`);
    return result.payload?.find(conversation => conversation.inbox_id === inboxId && conversation.status !== 'resolved') || null;
  }

  public async addContactInbox(
    accountId: number,
    contactId: number,
    data: { inbox_id: number; source_id: string }
  ): Promise<{ source_id: string; inbox_id: number; contact_inbox_id?: number }> {
    const res = await this.request<Record<string, unknown>>(
      'POST',
      `/api/v1/accounts/${accountId}/contacts/${contactId}/contact_inboxes`,
      data
    );
    const sourceId = String(res.source_id || data.source_id);
    const inboxId = data.inbox_id;
    const contactInboxId = res.id ? Number(res.id) : undefined;
    return { source_id: sourceId, inbox_id: inboxId, contact_inbox_id: contactInboxId };
  }

  public async createConversation(
    accountId: number,
    data: {
      inbox_id: number;
      source_id: string;
      contact_id?: number;
      custom_attributes?: Record<string, unknown>;
    }
  ): Promise<{ id: number; display_id: number; uuid?: string }> {
    const res = await this.request<{ id: number; uuid?: string }>(
      'POST',
      `/api/v1/accounts/${accountId}/conversations`,
      data
    );
    return {
      id: res.id,
      display_id: res.id,
      uuid: res.uuid,
    };
  }

  public async createMessage(
    accountId: number,
    conversationDisplayId: number,
    data: {
      content: string;
      message_type: 'incoming' | 'outgoing' | 0 | 1;
      private?: boolean;
      source_id?: string;
      content_attributes?: Record<string, unknown>;
      attachments?: ImportedAttachment[];
    }
  ): Promise<{ id: number; content: string; message_type: number; private: boolean; status: string; created_at: number }> {
    let body: unknown = data;
    if (data.attachments?.length) {
      const form = new FormData();
      form.set('content', data.content);
      form.set('message_type', String(data.message_type));
      form.set('private', String(data.private ?? false));
      if (data.source_id) form.set('source_id', data.source_id);
      if (data.content_attributes) form.set('content_attributes', JSON.stringify(data.content_attributes));
      for (const attachment of data.attachments) {
        form.append('attachments[]', new Blob([new Uint8Array(attachment.bytes)], { type: attachment.mimeType }), attachment.fileName);
      }
      body = form;
    }
    return this.request(
      'POST',
      `/api/v1/accounts/${accountId}/conversations/${conversationDisplayId}/messages`,
      body
    );
  }

  public async listMessages(
    accountId: number,
    conversationDisplayId: number,
    before?: number
  ): Promise<{ payload: Array<Record<string, unknown>> }> {
    const cursor = before === undefined ? '' : `?before=${encodeURIComponent(String(before))}`;
    return this.request(
      'GET',
      `/api/v1/accounts/${accountId}/conversations/${conversationDisplayId}/messages${cursor}`
    );
  }

  public async toggleStatus(
    accountId: number,
    conversationDisplayId: number,
    status: 'open' | 'resolved' | 'pending' | 'snoozed'
  ): Promise<void> {
    await this.request(
      'POST',
      `/api/v1/accounts/${accountId}/conversations/${conversationDisplayId}/toggle_status`,
      { status }
    );
  }

  public async assignAgent(
    accountId: number,
    conversationDisplayId: number,
    assigneeId: number
  ): Promise<void> {
    await this.request(
      'POST',
      `/api/v1/accounts/${accountId}/conversations/${conversationDisplayId}/assignments`,
      { assignee_id: assigneeId }
    );
  }

  public async listInboxAgents(accountId: number, inboxId: number): Promise<Array<Record<string, unknown>>> {
    const res = await this.request<{ payload?: Array<Record<string, unknown>> }>(
      'GET',
      `/api/v1/accounts/${accountId}/inbox_members/${inboxId}`
    );
    return res.payload || [];
  }

  public async getConversation(
    accountId: number,
    conversationDisplayId: number
  ): Promise<Record<string, unknown>> {
    return this.request(
      'GET',
      `/api/v1/accounts/${accountId}/conversations/${conversationDisplayId}`
    );
  }

  public async listConversations(
    accountId: number,
    inboxId: number,
    page: number
  ): Promise<Array<Record<string, unknown>>> {
    const query = new URLSearchParams({ inbox_id: String(inboxId), status: 'all', page: String(page) });
    const res = await this.request<{
      payload?: Array<Record<string, unknown>>;
      data?: { payload?: Array<Record<string, unknown>> };
    }>(
      'GET',
      `/api/v1/accounts/${accountId}/conversations?${query.toString()}`
    );
    return res.data?.payload || res.payload || [];
  }

  public async downloadAttachment(url: string): Promise<{ bytes: Uint8Array; mimeType: string; fileName: string; sizeBytes: number }> {
    const base = new URL(this.baseUrl);
    let target: URL;
    try {
      target = new URL(url, base);
    } catch {
      throw new ProviderPermanentError('Chatwoot attachment URL is invalid', { safeMessage: 'Không thể tải tệp đính kèm này.' });
    }
    const maxBytes = 12 * 1024 * 1024;
    let response: Response | undefined;

    for (let redirectCount = 0; redirectCount <= 3; redirectCount++) {
      const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
      if (loopbackHosts.has(base.hostname) && loopbackHosts.has(target.hostname)
        && target.protocol === base.protocol && target.port === base.port
        && target.pathname.startsWith('/rails/active_storage/') && !target.username && !target.password) {
        // Fetch through the configured origin; never send the server token to an alias.
        target = new URL(`${target.pathname}${target.search}`, base);
      }
      if (target.origin !== base.origin || (target.protocol !== 'http:' && target.protocol !== 'https:') || target.username || target.password) {
        throw new ProviderPermanentError('Chatwoot attachment URL left the configured origin', { safeMessage: 'Tệp đính kèm không nằm trên máy chủ hội thoại được cấu hình.' });
      }
      try {
        response = await fetch(target, {
          method: 'GET',
          headers: { api_access_token: this.apiToken, Accept: '*/*' },
          redirect: 'manual',
          signal: AbortSignal.timeout(15_000),
        });
      } catch (error) {
        throw new ConversationProviderError('Failed to fetch attachment from Chatwoot', { internalDetails: error });
      }
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        await response.body?.cancel();
        if (!location || redirectCount === 3) {
          throw new ProviderPermanentError('Chatwoot attachment redirect is invalid', { safeMessage: 'Không thể tải tệp đính kèm này.' });
        }
        target = new URL(location, target);
        continue;
      }
      break;
    }

    if (!response?.ok || !response.body) {
      throw new ProviderPermanentError(`Chatwoot attachment request failed with HTTP ${response?.status ?? 502}`, {
        safeMessage: 'Không thể tải tệp đính kèm từ hộp thư.',
      });
    }
    const declaredLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      await response.body.cancel();
      throw new ProviderPermanentError('Chatwoot attachment exceeds the 12 MB limit', { safeMessage: 'Tệp đính kèm vượt quá giới hạn 12 MB.' });
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let sizeBytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      sizeBytes += value.byteLength;
      if (sizeBytes > maxBytes) {
        await reader.cancel();
        throw new ProviderPermanentError('Chatwoot attachment exceeds the 12 MB limit', { safeMessage: 'Tệp đính kèm vượt quá giới hạn 12 MB.' });
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(sizeBytes);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }

    const rawContentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
    const inlineTypes = new Set([
      'image/jpeg', 'image/png', 'image/gif', 'image/webp',
      'audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/mp4',
      'video/mp4', 'video/webm',
    ]);
    const mimeType = rawContentType && inlineTypes.has(rawContentType) ? rawContentType : 'application/octet-stream';
    const disposition = response.headers.get('content-disposition') || '';
    const encodedName = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
    const plainName = disposition.match(/filename="?([^";]+)"?/i)?.[1];
    let fileName = plainName || 'attachment';
    try {
      if (encodedName) fileName = decodeURIComponent(encodedName);
      else if (!plainName) fileName = decodeURIComponent(target.pathname.split('/').pop() || 'attachment');
    } catch {
      fileName = 'attachment';
    }
    fileName = fileName.replace(/[\\/\r\n\0]/g, '_').trim().slice(0, 180) || 'attachment';
    return { bytes, mimeType, fileName, sizeBytes };
  }
}
