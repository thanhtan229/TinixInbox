import { lookup } from 'node:dns/promises';
import type { LookupAddress } from 'node:dns';
import { BlockList, isIP } from 'node:net';
import { request } from 'node:https';
import type { RequestOptions } from 'node:https';
import type { Attachment } from '../core/types.ts';
import { ProviderPermanentError, ProviderTemporaryError } from '../core/errors.ts';

export interface ImportedAttachment { bytes: Uint8Array; mimeType: string; fileName: string }
export interface AttachmentFetcher { download(attachment: Attachment): Promise<ImportedAttachment> }

const blocked = new BlockList();
const blockedV6 = new BlockList();
for (const [address, prefix] of [['2001:db8::', 32], ['2001::', 32], ['2001:10::', 28], ['2001:20::', 28], ['2002::', 16]] as const) {
  blockedV6.addSubnet(address, prefix, 'ipv6');
}
for (const [address, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]] as const) {
  blocked.addSubnet(address, prefix, 'ipv4');
}
export function isPublicMediaAddress(address: string): boolean {
  if (isIP(address) === 4) return !blocked.check(address, 'ipv4');
  // Only global IPv6 unicast; exclude documentation and transition mechanisms.
  return isIP(address) === 6 && /^[23][0-9a-f]{3}:/i.test(address)
    && !blockedV6.check(address, 'ipv6');
}

const extensions: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif',
  'image/webp': 'webp', 'audio/mpeg': 'mp3', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/mp4': 'm4a',
  'video/mp4': 'mp4', 'video/webm': 'webm', 'application/pdf': 'pdf', 'application/octet-stream': 'bin' };

export function validateImportedMedia(bytes: Uint8Array, mimeType: string, expectedType: string): void {
  if (!bytes.byteLength || bytes.byteLength > 12 * 1024 * 1024 || !extensions[mimeType]) {
    throw new ProviderPermanentError('Unsupported or oversized attachment');
  }
  if (expectedType !== 'file' && !mimeType.startsWith(`${expectedType}/`)) throw new ProviderPermanentError('Attachment MIME differs from its channel type');
  const b = Buffer.from(bytes);
  const matches = mimeType === 'image/png' ? b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : mimeType === 'image/jpeg' ? b[0] === 255 && b[1] === 216 && b[2] === 255
    : mimeType === 'image/gif' ? /^GIF8[79]a$/.test(b.subarray(0, 6).toString('ascii'))
    : mimeType === 'image/webp' ? b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP'
    : mimeType === 'application/pdf' ? b.subarray(0, 5).toString() === '%PDF-'
    : true;
  if (!matches) throw new ProviderPermanentError('Attachment signature differs from its MIME type');
}

export class SecureAttachmentFetcher implements AttachmentFetcher {
  private allowedHosts: string[];
  constructor(allowedHosts: string[]) {
    this.allowedHosts = allowedHosts.map(host => host.trim().toLowerCase()).filter(Boolean);
  }

  public validateUrl(value: string): URL {
    let url: URL;
    try { url = new URL(value); } catch { throw new ProviderPermanentError('Invalid attachment URL'); }
    const host = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')
      || isIP(host.replace(/^\[|\]$/g, '')) || !this.allowedHosts.some(allowed => host === allowed || host.endsWith(`.${allowed}`))) {
      throw new ProviderPermanentError('Attachment URL is outside the approved provider media hosts');
    }
    return url;
  }

  public async download(attachment: Attachment): Promise<ImportedAttachment> {
    let url = this.validateUrl(attachment.url || '');
    const deadline = Date.now() + 20000;
    for (let redirects = 0; redirects <= 3; redirects++) {
      const addresses = await new Promise<LookupAddress[]>((resolve, reject) => {
        const timer = setTimeout(() => reject(new ProviderTemporaryError('Media DNS lookup exceeded its deadline')), Math.max(1, deadline - Date.now()));
        lookup(url.hostname, { all: true }).then(resolve, () => reject(new ProviderTemporaryError('Media DNS lookup failed')))
          .finally(() => clearTimeout(timer));
      });
      if (!addresses.length || addresses.some(answer => !isPublicMediaAddress(answer.address))) {
        throw new ProviderPermanentError('Provider media host resolved to a non-public address');
      }
      const selected = addresses[0]!;
      const result = await new Promise<{ redirect?: string; bytes?: Uint8Array; mimeType?: string }>((resolve, reject) => {
        const remaining = deadline - Date.now();
        if (remaining <= 0) return reject(new ProviderTemporaryError('Attachment fetch exceeded its deadline'));
        const options: RequestOptions & { autoSelectFamily: boolean } = {
          method: 'GET', headers: { Accept: '*/*' }, autoSelectFamily: false, family: selected.family,
          // Pin the validated DNS result while retaining TLS verification for the original host.
          lookup: (_host, _options, callback) => callback(null, selected.address, selected.family),
        };
        const req = request(url, options, response => {
          const status = response.statusCode || 502;
          if (status >= 300 && status < 400) { response.destroy(); resolve({ redirect: response.headers.location }); return; }
          if (status !== 200) { response.destroy(); reject(status === 429 || status >= 500
            ? new ProviderTemporaryError('Provider media temporarily unavailable') : new ProviderPermanentError('Provider media is unavailable')); return; }
          const mimeType = String(response.headers['content-type'] || '').split(';')[0]!.trim().toLowerCase();
          if (!extensions[mimeType] || Number(response.headers['content-length']) > 12 * 1024 * 1024) {
            response.destroy(); reject(new ProviderPermanentError('Unsupported or oversized attachment')); return;
          }
          const chunks: Buffer[] = []; let size = 0;
          response.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > 12 * 1024 * 1024) { response.destroy(); reject(new ProviderPermanentError('Attachment exceeds 12 MB')); }
            else chunks.push(chunk);
          });
          response.on('end', () => resolve({ bytes: Buffer.concat(chunks), mimeType }));
          response.on('error', () => reject(new ProviderTemporaryError('Attachment stream was interrupted')));
        });
        const timer = setTimeout(() => req.destroy(new Error('deadline')), remaining);
        req.on('close', () => clearTimeout(timer));
        req.on('error', () => reject(new ProviderTemporaryError('Attachment fetch failed')));
        req.end();
      });
      if (result.redirect) {
        if (redirects === 3) throw new ProviderPermanentError('Attachment redirect limit exceeded');
        url = this.validateUrl(new URL(result.redirect, url).href);
        continue;
      }
      if (!result.bytes || !result.mimeType) throw new ProviderPermanentError('Invalid provider media response');
      validateImportedMedia(result.bytes, result.mimeType, attachment.type);
      return { bytes: result.bytes, mimeType: result.mimeType, fileName: `attachment.${extensions[result.mimeType]}` };
    }
    throw new ProviderPermanentError('Attachment redirect limit exceeded');
  }
}
