import { describe, it, expect } from 'vitest';
import { AppError, toAppError } from '@/lib/errors';

describe('AppError', () => {
  it('creates error with correct code and httpStatus', () => {
    const err = new AppError({
      code: 'VALIDATION_ERROR',
      message: 'Invalid input',
    });
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.httpStatus).toBe(400);
    expect(err.name).toBe('AppError');
  });

  it('maps all error codes to correct HTTP statuses', () => {
    const codeStatusMap: Array<[string, number]> = [
      ['VALIDATION_ERROR', 400],
      ['UNAUTHORIZED', 401],
      ['FORBIDDEN', 403],
      ['NOT_FOUND', 404],
      ['CONFLICT', 409],
      ['RATE_LIMITED', 429],
      ['INTERNAL_ERROR', 500],
    ];
    for (const [code, status] of codeStatusMap) {
      const err = new AppError({ code: code as any, message: 'test' });
      expect(err.httpStatus).toBe(status);
    }
  });

  it('defaults messageAr to message when not provided', () => {
    const err = new AppError({ code: 'NOT_FOUND', message: 'Not found' });
    expect(err.messageAr).toBe('Not found');
  });

  it('uses provided messageAr', () => {
    const err = new AppError({
      code: 'NOT_FOUND',
      message: 'Not found',
      messageAr: 'غير موجود',
    });
    expect(err.messageAr).toBe('غير موجود');
  });
});

describe('toAppError', () => {
  it('returns AppError unchanged', () => {
    const original = new AppError({ code: 'FORBIDDEN', message: 'no' });
    expect(toAppError(original)).toBe(original);
  });

  it('wraps standard Error', () => {
    const result = toAppError(new Error('oops'));
    expect(result).toBeInstanceOf(AppError);
    expect(result.code).toBe('INTERNAL_ERROR');
    expect(result.message).toBe('oops');
  });

  it('wraps string errors', () => {
    const result = toAppError('something broke');
    expect(result).toBeInstanceOf(AppError);
    expect(result.code).toBe('INTERNAL_ERROR');
  });

  it('wraps null/undefined', () => {
    expect(toAppError(null)).toBeInstanceOf(AppError);
    expect(toAppError(undefined)).toBeInstanceOf(AppError);
  });
});
