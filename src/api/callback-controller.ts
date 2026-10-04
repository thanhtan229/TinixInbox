import { OutboundService } from '../services/outbound-service.ts';
import { OutboxService } from '../services/outbox-service.ts';
import { InvalidRequestError, WebhookVerificationError } from '../core/errors.ts';

export class CallbackController {
  private outboundService: OutboundService;
  private outboxService: OutboxService;

  constructor(
    outboundService: OutboundService,
    outboxService: OutboxService
  ) {
    this.outboundService = outboundService;
    this.outboxService = outboxService;
  }

  public async handleCallback(
    rawBody: string,
    headers: Record<string, string | string[] | undefined>
  ): Promise<{ status: number; body: unknown }> {
    const signature = headers['x-chatwoot-signature'] as string | undefined;
    const timestamp = headers['x-chatwoot-timestamp'] as string | undefined;

    try {
      const result = await this.outboundService.handleChatwootCallback(rawBody, signature, timestamp);

      // Async dispatch outbox message if accepted
      if (result.status === 'accepted' && result.outboxId) {
        setImmediate(() => {
          this.outboxService.dispatchItem(result.outboxId!).catch((err) => {
            console.error(`[Outbox] Dispatch error for ${result.outboxId}:`, err);
          });
        });
      }

      return { status: 200, body: { ok: true, ...result } };
    } catch (error) {
      if (error instanceof WebhookVerificationError) {
        return { status: 401, body: { error: error.message } };
      }
      if (error instanceof InvalidRequestError) {
        return { status: error.httpStatus, body: { error: error.safeMessage, code: error.code } };
      }
      console.error('[Callback] Durable processing failed', { errorName: (error as Error).name });
      return { status: 500, body: { error: 'Callback processing failed; retry is required' } };
    }
  }
}
