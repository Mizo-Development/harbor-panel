import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';
import { BadRequestException } from '@nestjs/common';
const scrypt = promisify(scryptCallback);
export function digest(value: string) {
  return createHash('sha256').update(value).digest('hex');
}
export function token() {
  return randomBytes(32).toString('hex');
}
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  const hash = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt:${salt}:${hash.toString('hex')}`;
}
export async function verifyPassword(password: string, encoded: string) {
  const [algorithm, salt, expected] = encoded.split(':');
  if (algorithm !== 'scrypt' || !salt || expected?.length !== 128) return false;
  const actual = (await scrypt(password, salt, 64)) as Buffer;
  return timingSafeEqual(actual, Buffer.from(expected, 'hex'));
}
export function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
export function encryptionKey() {
  const key = process.env.ENCRYPTION_KEY;
  if (!key || !/^[a-f0-9]{64}$/i.test(key))
    throw new Error('ENCRYPTION_KEY must be 32 bytes encoded as 64 hexadecimal characters');
  return Buffer.from(key, 'hex');
}
export function encrypt(value: unknown) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return [iv.toString('hex'), cipher.getAuthTag().toString('hex'), data.toString('hex')].join('.');
}
export function decrypt<T = Record<string, string>>(encoded: string): T {
  const [iv, tag, data] = encoded.split('.');
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(tag, 'hex'));
  return JSON.parse(
    Buffer.concat([decipher.update(Buffer.from(data, 'hex')), decipher.final()]).toString(),
  );
}
export function validConnectionUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new BadRequestException('Invalid connection URL');
  }
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/')
    throw new BadRequestException('Use an origin URL without credentials or a path');
  if (
    url.protocol !== 'https:' &&
    !(process.env.NODE_ENV !== 'production' && url.protocol === 'http:')
  )
    throw new BadRequestException('Connections require HTTPS');
  return url.origin;
}
export function appUrl() {
  const value = process.env.APP_URL || 'http://localhost:3000';
  return new URL(value).origin;
}
