import { createHmac, timingSafeEqual } from 'node:crypto';

export interface VerifySignatureOptions {
  toleranceSeconds?: number;
  nowSeconds?: number;
}

export interface SignatureVerificationResult {
  valid: boolean;
  reason?: 'missing_signature' | 'missing_timestamp' | 'stale_timestamp' | 'signature_mismatch';
}

export function verifyChatwootSignature(
  rawBody: string,
  signatureHeader: string | undefined,
  timestampHeader: string | undefined,
  secret: string,
  options: VerifySignatureOptions = {}
): SignatureVerificationResult {
  if (!signatureHeader) {
    return { valid: false, reason: 'missing_signature' };
  }
  if (!timestampHeader) {
    return { valid: false, reason: 'missing_timestamp' };
  }

  const timestamp = Number(timestampHeader);
  if (isNaN(timestamp)) {
    return { valid: false, reason: 'missing_timestamp' };
  }

  const tolerance = options.toleranceSeconds ?? 300;
  const now = options.nowSeconds ?? Math.floor(Date.now() / 1000);

  if (Math.abs(now - timestamp) > tolerance) {
    return { valid: false, reason: 'stale_timestamp' };
  }

  const expectedSignature = `sha256=${createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex')}`;

  const expectedBuffer = Buffer.from(expectedSignature, 'utf8');
  const actualBuffer = Buffer.from(signatureHeader, 'utf8');

  if (expectedBuffer.length !== actualBuffer.length) {
    return { valid: false, reason: 'signature_mismatch' };
  }

  if (!timingSafeEqual(expectedBuffer, actualBuffer)) {
    return { valid: false, reason: 'signature_mismatch' };
  }

  return { valid: true };
}
