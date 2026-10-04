import { randomUUID } from 'node:crypto';
import type { ChannelAdapter, ChannelSendRequest, ChannelSendResult } from '../../core/channel-adapter.ts';
import type { ChannelConnection, ChannelProvider } from '../../core/types.ts';
import type { UnifiedMessage } from '../../core/unified-message.ts';

export type SyntheticFailureMode =
  | 'off'
  | '429'
  | '500'
  | 'timeout'
  | 'unknown';

export class SyntheticChannelAdapter implements ChannelAdapter {
  readonly provider: ChannelProvider = 'synthetic';

  public sendCount = 0;
  public lastPayload: ChannelSendRequest | null = null;
  public failureMode: SyntheticFailureMode = 'off';
  public sentMessages: Array<{ request: ChannelSendRequest; providerMessageId: string; sentAt: string }> = [];

  public reset(): void {
    this.sendCount = 0;
    this.lastPayload = null;
    this.failureMode = 'off';
    this.sentMessages = [];
  }

  public async validateConnection(_credentials: string): Promise<{ valid: boolean; error?: string }> {
    return { valid: true };
  }

  public async verifyWebhook(
    _rawBody: string,
    headers: Record<string, string | string[] | undefined>,
    secret: string
  ): Promise<boolean> {
    const signature = headers['x-synthetic-signature'];
    if (!signature) return false;
    return signature === `secret-${secret}`;
  }

  public async parseWebhook(rawBody: string): Promise<unknown[]> {
    try {
      const parsed = JSON.parse(rawBody);
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      return [];
    }
  }

  public async normalizeEvent(
    rawEvent: unknown,
    connection: ChannelConnection
  ): Promise<UnifiedMessage[]> {
    const evt = rawEvent as Record<string, unknown>;
    const externalMessageId = String(evt.message_id || evt.id || randomUUID());
    const externalUserId = String(evt.sender_id || evt.user_id || 'synthetic-user-1');
    const externalConversationId = String(evt.conversation_id || externalUserId);

    return [
      {
        id: randomUUID(),
        workspaceId: connection.workspaceId,
        provider: this.provider,
        channelConnectionId: connection.id,
        externalConversationId,
        externalMessageId,
        direction: (evt.direction as 'incoming' | 'outgoing') || 'incoming',
        messageType: 'text',
        sender: {
          externalId: externalUserId,
          displayName: evt.sender_name ? String(evt.sender_name) : undefined,
        },
        recipient: {
          externalId: connection.externalAccountId,
        },
        text: String(evt.text || evt.content || ''),
        attachments: [],
        sentAt: evt.timestamp ? new Date(Number(evt.timestamp)).toISOString() : new Date().toISOString(),
        receivedAt: new Date().toISOString(),
        providerMetadata: evt,
      },
    ];
  }

  public async sendMessage(request: ChannelSendRequest): Promise<ChannelSendResult> {
    this.lastPayload = request;

    if (this.failureMode === '429') {
      return {
        success: false,
        failureKind: 'retryable',
        sentAt: new Date().toISOString(),
        error: 'Rate limit exceeded (HTTP 429)',
      };
    }

    if (this.failureMode === '500') {
      return {
        success: false,
        failureKind: 'unknown',
        sentAt: new Date().toISOString(),
        error: 'Provider internal error (HTTP 500)',
      };
    }

    if (this.failureMode === 'unknown') {
      return {
        success: false,
        failureKind: 'unknown',
        sentAt: new Date().toISOString(),
        error: 'Provider response timed out after dispatch (state unknown)',
      };
    }

    this.sendCount++;
    const providerMessageId = `synth-msg-${randomUUID().slice(0, 8)}`;
    const sentAt = new Date().toISOString();

    this.sentMessages.push({
      request,
      providerMessageId,
      sentAt,
    });

    return {
      success: true,
      providerMessageId,
      sentAt,
      rawResponse: { status: 'delivered', provider_id: providerMessageId },
    };
  }
}
