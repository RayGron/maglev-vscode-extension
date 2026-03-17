import crypto from 'node:crypto';
import fs from 'node:fs/promises';

export interface LocalIdentity {
  keyId: string;
  privateKey: crypto.KeyObject;
  publicKeyPayload: string;
}

function toBase64Url(input: Buffer): string {
  return input.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export class KeyManager {
  async loadIdentity(privateKeyPath: string, publicKeyPath?: string): Promise<LocalIdentity> {
    const privateKeyPem = await fs.readFile(privateKeyPath, 'utf8');
    const privateKey = crypto.createPrivateKey(privateKeyPem);
    const publicKey = publicKeyPath
      ? crypto.createPublicKey(await fs.readFile(publicKeyPath, 'utf8'))
      : crypto.createPublicKey(privateKey);
    const publicKeyDer = publicKey.export({ type: 'spki', format: 'der' });

    return {
      keyId: `SHA256:${toBase64Url(crypto.createHash('sha256').update(publicKeyDer).digest())}`,
      privateKey,
      publicKeyPayload: publicKeyDer.toString('base64'),
    };
  }
}
