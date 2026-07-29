import crypto from 'crypto';
import config from '../config/index.js';

const ALGO = 'aes-256-gcm';
const PREFIX = 'enc:';

const getKey = () => crypto.scryptSync(
  config.jwt.accessSecret || 'bharatq-totp-fallback-key',
  'bharatq-totp-salt',
  32
);

export const encryptSecret = (plaintext) => {
  if (!plaintext) return plaintext;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
};

export const decryptSecret = (payload) => {
  if (!payload) return payload;
  if (!payload.startsWith(PREFIX)) return payload;

  const parts = payload.slice(PREFIX.length).split(':');
  if (parts.length !== 3) return payload;

  const [ivHex, tagHex, dataHex] = parts;
  const decipher = crypto.createDecipheriv(
    ALGO,
    getKey(),
    Buffer.from(ivHex, 'hex')
  );
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataHex, 'hex')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
};
