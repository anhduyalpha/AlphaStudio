/** Remove local absolute paths from messages that may be returned to clients. */
export function sanitizeUserError(message: string): string {
  let msg = String(message || 'Unknown error');
  msg = msg.replace(/[A-Za-z]:\\[^\s)'"`]+/g, '[path]');
  msg = msg.replace(
    /\/(?:Users|home|tmp|var|opt|usr|workspace|mnt|srv|run)\/[^\s)'"`]+/g,
    '[path]',
  );
  msg = msg.replace(/\\\\[^\s)'"`]+/g, '[path]');
  return msg;
}
