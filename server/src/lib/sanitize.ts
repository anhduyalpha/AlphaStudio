/** Remove local absolute paths from messages that may be returned to clients. */
export function sanitizeUserError(message: string): string {
  let msg = String(message || 'Unknown error');
  // Windows drive paths: C:\Users\...
  msg = msg.replace(/[A-Za-z]:\\[^\s)'"`]+/g, '[path]');
  // UNC paths
  msg = msg.replace(/\\\\[^\s)'"`]+/g, '[path]');
  // Unix absolute paths with at least two segments (covers /work/..., /Users/..., Docker layouts)
  msg = msg.replace(/\/(?:[\w.+@-]+\/)+[^\s)'"`]*/g, '[path]');
  return msg;
}
