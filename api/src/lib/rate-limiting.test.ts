import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRateLimiter, strictRateLimiter, lenientRateLimiter } from '../lib/rate-limiting.js';

describe('Rate Limiting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createRateLimiter', () => {
    it('should create a rate limiter with default settings', () => {
      const limiter = createRateLimiter();
      expect(limiter).toBeDefined();
      // The actual implementation depends on @hono/rate-limiter
      // This is a basic structure test
    });
  });

  describe('strictRateLimiter', () => {
    it('should create a strict rate limiter', () => {
      const limiter = strictRateLimiter();
      expect(limiter).toBeDefined();
    });
  });

  describe('lenientRateLimiter', () => {
    it('should create a lenient rate limiter', () => {
      const limiter = lenientRateLimiter();
      expect(limiter).toBeDefined();
    });
  });
});