import crypto from 'node:crypto';

export function buildCanonicalRequest(
  method: string,
  pathname: string,
  timestamp: number,
  nonce: string,
  keyId: string,
  body: string,
): string {
  return [
    method.toUpperCase(),
    pathname,
    String(timestamp),
    nonce,
    keyId,
    body,
  ].join('\n');
}

export function signCanonicalRequest(privateKey: crypto.KeyObject, canonicalRequest: string): string {
  return crypto.sign(null, Buffer.from(canonicalRequest, 'utf8'), privateKey).toString('base64');
}
