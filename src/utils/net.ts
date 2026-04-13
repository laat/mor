import crypto from 'node:crypto';

export function isLoopbackHost(host: string): boolean {
  let hostname: string;
  if (host.startsWith('[')) {
    hostname = host.slice(1, host.indexOf(']'));
  } else if (host.includes('::')) {
    hostname = host;
  } else {
    hostname = host.split(':')[0];
  }
  return ['127.0.0.1', 'localhost', '::1'].includes(hostname);
}

export function timingSafeCompare(a: string, b: string): boolean {
  const aHash = crypto.createHash('sha256').update(a).digest();
  const bHash = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(aHash, bHash);
}
