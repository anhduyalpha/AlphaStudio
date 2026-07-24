import { timingSafeEqual } from 'node:crypto';

/**
 * Constant-time bearer compare (S-06).
 * Unequal lengths never call timingSafeEqual with mismatched Buffer sizes.
 */
export function bearerTokensEqual(supplied: string, expected: string): boolean {
  const a = Buffer.from(supplied, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) {
    // Burn comparable work without short-circuiting on content.
    timingSafeEqual(b, b);
    return false;
  }
  return timingSafeEqual(a, b);
}
