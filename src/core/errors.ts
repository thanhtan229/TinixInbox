export abstract class InboxError extends Error {
  abstract readonly code: string;
  abstract readonly retryable: boolean;
  readonly httpStatus: number = 500;
  readonly provider?: string;
  readonly safeMessage: string;
  readonly internalDetails?: unknown;

  constructor(
    message: string,
    options: {
      safeMessage?: string;
      internalDetails?: unknown;
      provider?: string;
      httpStatus?: number;
    } = {}
  ) {
    super(message);
    this.name = this.constructor.name;
    this.safeMessage = options.safeMessage || 'An unexpected error occurred.';
    this.internalDetails = options.internalDetails;
    this.provider = options.provider;
    if (options.httpStatus) {
      this.httpStatus = options.httpStatus;
    }
  }
}

export class AuthenticationError extends InboxError {
  readonly code = 'AUTHENTICATION_ERROR';
  readonly retryable = false;
  readonly httpStatus = 401;
}

export class AuthorizationError extends InboxError {
  readonly code = 'AUTHORIZATION_ERROR';
  readonly retryable = false;
  readonly httpStatus = 403;
}

export class WebhookVerificationError extends InboxError {
  readonly code = 'WEBHOOK_VERIFICATION_ERROR';
  readonly retryable = false;
  readonly httpStatus = 401;
}

export class InvalidRequestError extends InboxError {
  readonly code = 'INVALID_REQUEST';
  readonly retryable = false;
  readonly httpStatus = 400;

  constructor(message: string) {
    super(message, { safeMessage: message, httpStatus: 400 });
  }
}

export class RateLimitError extends InboxError {
  readonly code = 'RATE_LIMIT_ERROR';
  readonly retryable = true;
  readonly httpStatus = 429;
  readonly retryAfterSeconds?: number;

  constructor(message: string, retryAfterSeconds?: number, options?: Record<string, unknown>) {
    super(message, options);
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class ProviderTemporaryError extends InboxError {
  readonly code = 'PROVIDER_TEMPORARY_ERROR';
  readonly retryable = true;
  readonly httpStatus = 502;
}

export class AttachmentPreparationError extends ProviderTemporaryError {}

export class ProviderPermanentError extends InboxError {
  readonly code = 'PROVIDER_PERMANENT_ERROR';
  readonly retryable = false;
  readonly httpStatus = 400;
}

export class UnsupportedMessageError extends InboxError {
  readonly code = 'UNSUPPORTED_MESSAGE_ERROR';
  readonly retryable = false;
  readonly httpStatus = 422;
}

export class ConversationProviderError extends InboxError {
  readonly code = 'CONVERSATION_PROVIDER_ERROR';
  readonly retryable = true;
  readonly httpStatus = 502;
}

export class DuplicateEventError extends InboxError {
  readonly code = 'DUPLICATE_EVENT_ERROR';
  readonly retryable = false;
  readonly httpStatus = 200; // acknowledged gracefully
}

export class InboundOutcomeUnknownError extends InboxError {
  readonly code = 'INBOUND_OUTCOME_UNKNOWN';
  readonly retryable = false;
  readonly httpStatus = 409;

  constructor(externalMessageId: string) {
    super(`Inbound message ${externalMessageId} has an unresolved ConversationProvider outcome`, {
      safeMessage: 'This message needs reconciliation before it can be processed again.',
    });
  }
}

export class CredentialExpiredError extends InboxError {
  readonly code = 'CREDENTIAL_EXPIRED_ERROR';
  readonly retryable = false;
  readonly httpStatus = 401;
}

export class ConnectionDisabledError extends InboxError {
  readonly code = 'CONNECTION_DISABLED_ERROR';
  readonly retryable = false;
  readonly httpStatus = 400;
}
