/**
 * Shkad Aadel — Error Handling
 * 
 * Structured error class and utilities.
 * All errors in the app should use AppError.
 */

import type { ErrorCode } from '@/lib/types/domain';

export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly messageAr: string;
  public readonly context?: Record<string, unknown>;
  public readonly httpStatus: number;

  constructor(params: {
    code: ErrorCode;
    message: string;
    messageAr?: string;
    context?: Record<string, unknown>;
  }) {
    super(params.message);
    this.name = 'AppError';
    this.code = params.code;
    this.messageAr = params.messageAr ?? params.message;
    this.context = params.context;
    this.httpStatus = ERROR_STATUS_MAP[params.code] ?? 500;
  }
}

const ERROR_STATUS_MAP: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
};

/**
 * Wrap an unknown error into AppError
 */
export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  
  const message = err instanceof Error ? err.message : 'خطأ غير متوقع';
  return new AppError({
    code: 'INTERNAL_ERROR',
    message,
    messageAr: 'حدث خطأ غير متوقع، يرجى المحاولة لاحقاً',
    context: { originalError: String(err) },
  });
}
