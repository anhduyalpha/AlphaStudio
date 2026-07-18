export class AppError extends Error {
  statusCode: number;
  code: string;
  details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export function unavailable(tool: string, reason?: string): AppError {
  return new AppError(
    503,
    'UNAVAILABLE',
    reason || `${tool} is unavailable on this machine`,
    { tool },
  );
}

export function badRequest(message: string, details?: unknown): AppError {
  return new AppError(400, 'BAD_REQUEST', message, details);
}

export function notFound(message = 'Not found'): AppError {
  return new AppError(404, 'NOT_FOUND', message);
}

export function payloadTooLarge(message: string): AppError {
  return new AppError(413, 'PAYLOAD_TOO_LARGE', message);
}

export function unsupported(message: string, details?: unknown): AppError {
  return new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', message, details);
}

export function toErrorBody(err: unknown) {
  if (err instanceof AppError) {
    return {
      error: {
        code: err.code,
        message: err.message,
        details: err.details ?? null,
      },
    };
  }
  // Duck-typed AppError from modules that construct plain Error + fields
  const duck = err as { code?: string; message?: string; details?: unknown; statusCode?: number; name?: string };
  if (duck && (duck.name === 'AppError' || duck.code === 'UNAVAILABLE' || duck.code === 'BAD_REQUEST')) {
    return {
      error: {
        code: duck.code || 'ERROR',
        message: duck.message || 'Error',
        details: duck.details ?? null,
      },
    };
  }
  const message = err instanceof Error ? err.message : 'Internal server error';
  return {
    error: {
      code: 'INTERNAL_ERROR',
      message,
      details: null,
    },
  };
}
