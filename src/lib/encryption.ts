import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto';

const ALGORITHM = 'aes-256-gcm';

function getEncryptionKey(): Buffer {
  const keyEnv = process.env.DATA_ENCRYPTION_KEY;
  
  if (!keyEnv) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('DATA_ENCRYPTION_KEY is not defined in environment variables');
    }
    // Fallback for dev - NOT SECURE for production but allows running
    // We'll use a fixed key for dev if none provided to ensure restarts don't break decryption of dev data
    // Ideally this should still be persistent, but for now:
    console.warn('DATA_ENCRYPTION_KEY not found, using insecure default for development');
    return createHash('sha256').update('dev-insecure-key-do-not-use-in-prod').digest();
  }
  
  // If the key is provided as hex and is 32 bytes (64 chars), use it directly.
  if (keyEnv.length === 64 && /^[0-9a-fA-F]+$/.test(keyEnv)) {
      return Buffer.from(keyEnv, 'hex');
  }
  
  // Otherwise treat it as a passphrase and hash it to get 32 bytes
  return createHash('sha256').update(keyEnv).digest();
}

export function encrypt(text: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(16);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  const authTag = cipher.getAuthTag();
  
  // Return format: iv:authTag:encrypted
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

export function decrypt(text: string): string {
  const parts = text.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted text format');
  }
  
  const iv = Buffer.from(parts[0], 'hex');
  const authTag = Buffer.from(parts[1], 'hex');
  const encrypted = parts[2];
  
  const key = getEncryptionKey();
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  
  decipher.setAuthTag(authTag);
  
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
}
