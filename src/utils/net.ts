import crypto from 'node:crypto';

export function isLoopbackHost(host: string): boolean {
  const hostname = host.split(':')[0];
  return ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(hostname);
}

export function timingSafeCompare(a: string, b: string): boolean {
  const aHash = crypto.createHash('sha256').update(a).digest();
  const bHash = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(aHash, bHash);
}
