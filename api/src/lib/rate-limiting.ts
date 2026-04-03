import { Hono } from 'hono';
import { getRedisClient } from './cache.js';

// In-memory store for rate limiting (fallback when Redis is not available)
const memoryStore = new Map<string, { count: number; resetTime: number }>();

export const createRateLimiter = (options: {
  windowMs?: number;
  limit?: number;
  skipSuccessfulRequests?: boolean;
  skipFailedRequests?: boolean;
} = {}) => {
  const {
    windowMs = 15 * 60 * 1000, // 15 minutes
    limit = 100,
    skipSuccessfulRequests = false,
    skipFailedRequests = false,
  } = options;

  return async (c: any, next: any) => {
    const redis = getRedisClient();
    const key = `ratelimit:${c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || 'unknown'}`;
    const now = Date.now();
    const windowStart = Math.floor(now / windowMs) * windowMs;

    try {
      let current = 0;
      let resetTime = windowStart + windowMs;

      if (redis) {
        // Use Redis for distributed rate limiting
        const data = await redis.hgetall(key);
        const storedResetTime = parseInt(data.resetTime || '0');

        if (storedResetTime <= now) {
          // Window expired, reset counter
          await redis.hset(key, { count: 1, resetTime });
          await redis.pexpire(key, windowMs);
          current = 1;
        } else {
          // Window still active, increment counter
          current = parseInt(data.count || '0') + 1;
          await redis.hset(key, { count: current, resetTime: storedResetTime });
        }
      } else {
        // Fallback to in-memory store
        const stored = memoryStore.get(key);
        if (!stored || stored.resetTime <= now) {
          memoryStore.set(key, { count: 1, resetTime });
          current = 1;
        } else {
          current = stored.count + 1;
          memoryStore.set(key, { count: current, resetTime: stored.resetTime });
        }
      }

      // Set rate limit headers
      c.header('X-RateLimit-Limit', limit.toString());
      c.header('X-RateLimit-Remaining', Math.max(0, limit - current).toString());
      c.header('X-RateLimit-Reset', resetTime.toString());

      if (current > limit) {
        c.header('Retry-After', Math.ceil((resetTime - now) / 1000).toString());
        return c.json({
          error: 'Too Many Requests',
          message: 'Rate limit exceeded',
          retryAfter: Math.ceil((resetTime - now) / 1000)
        }, 429);
      }

      await next();

      // Skip successful/failed requests from count if configured
      if ((c.res.status >= 400 && skipFailedRequests) ||
          (c.res.status < 400 && skipSuccessfulRequests)) {
        // Decrement the counter
        if (redis) {
          const data = await redis.hgetall(key);
          const newCount = Math.max(0, parseInt(data.count || '0') - 1);
          await redis.hset(key, { count: newCount, resetTime: data.resetTime });
        } else {
          const stored = memoryStore.get(key);
          if (stored) {
            memoryStore.set(key, { count: Math.max(0, stored.count - 1), resetTime: stored.resetTime });
          }
        }
      }

    } catch (error) {
      console.error('Rate limiting error:', error);
      // Allow request to proceed if rate limiting fails
      await next();
    }
  };
};

// Different rate limits for different endpoints
export const strictRateLimiter = () => {
  return createRateLimiter({
    windowMs: 60 * 1000, // 1 minute
    limit: 10, // 10 requests per minute
  });
};

export const lenientRateLimiter = () => {
  return createRateLimiter({
    windowMs: 60 * 60 * 1000, // 1 hour
    limit: 1000, // 1000 requests per hour
  });
};

export const apiRateLimiter = () => {
  return createRateLimiter({
    windowMs: 15 * 60 * 1000, // 15 minutes
    limit: 100, // 100 requests per 15 minutes
  });
};