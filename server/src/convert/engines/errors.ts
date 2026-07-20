export function engineFailure(engineId: string, message: string): Error & {
  code: 'ENGINE_FAILED';
  engineId: string;
  fallbackEligible: true;
} {
  return Object.assign(new Error(message), {
    code: 'ENGINE_FAILED' as const,
    engineId,
    fallbackEligible: true as const,
  });
}

export function isFallbackEligible(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const typed = error as {
    code?: string;
    fallbackEligible?: boolean;
  };
  return (
    typed.fallbackEligible === true ||
    typed.code === 'ENGINE_FAILED' ||
    typed.code === 'UNAVAILABLE'
  );
}
