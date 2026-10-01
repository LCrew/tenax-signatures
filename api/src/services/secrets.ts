import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Encrypts credentials (Graph client secret, certificate private key) at rest in the settings table.
 * Key comes from APP_SECRET, or is generated once into <DATA_DIR>/app.key (mode 600).
 */
export class SecretBox {
  private key: Buffer;

  constructor(dataDir: string, appSecret?: string) {
    if (appSecret) {
      this.key = crypto.createHash('sha256').update(appSecret).digest();
      return;
    }
    const file = path.join(dataDir, 'app.key');
    if (fs.existsSync(file)) {
      this.key = Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'base64');
    } else {
      fs.mkdirSync(dataDir, { recursive: true });
      this.key = crypto.randomBytes(32);
      fs.writeFileSync(file, this.key.toString('base64'), { mode: 0o600 });
    }
  }

  encrypt(plain: string): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), enc.toString('base64')].join('.');
  }

  decrypt(blob: string): string {
    const [v, iv, tag, data] = blob.split('.');
    if (v !== 'v1') throw new Error('Unknown secret format');
    const ivBuf = Buffer.from(iv, 'base64');
    if (ivBuf.length !== 12) throw new Error('Invalid secret');
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, ivBuf, { authTagLength: 16 });
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
  }

  /** HMAC key for things like session IDs; derived so it differs from the encryption key. */
  derive(label: string): Buffer {
    return crypto.createHmac('sha256', this.key).update(label).digest();
  }
}
