/**
 * Refuse non-loopback bind unless auth is configured or ALLOW_INSECURE_BIND=1.
 */
export function assertSafeBindHost(host: string): void {
  const h = (host || '127.0.0.1').trim().toLowerCase();
  const loopback =
    h === '127.0.0.1' ||
    h === '::1' ||
    h === 'localhost' ||
    h === '0:0:0:0:0:0:0:1';

  if (loopback) return;

  const insecure = process.env.ALLOW_INSECURE_BIND === '1' || process.env.ALLOW_INSECURE_BIND === 'true';
  const hasAuth =
    Boolean(process.env.API_AUTH_TOKEN) ||
    Boolean(process.env.AUTH_REQUIRED === '1') ||
    Boolean(process.env.ALPHASTUDIO_AUTH_TOKEN);

  if (insecure || hasAuth) return;

  throw new Error(
    `Refusing to bind host "${host}" (non-loopback) without auth. ` +
      `Use HOST=127.0.0.1 (default), set API_AUTH_TOKEN, or ALLOW_INSECURE_BIND=1 for explicit insecure LAN bind.`,
  );
}

export function isLoopbackHost(host: string): boolean {
  const h = (host || '').trim().toLowerCase();
  return (
    h === '127.0.0.1' ||
    h === '::1' ||
    h === 'localhost' ||
    h === '0:0:0:0:0:0:0:1'
  );
}
