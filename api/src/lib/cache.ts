import Redis from 'ioredis';
import { getLogger } from './monitoring.js';

// Redis client configuration
let redisClient: Redis | null = null;

export const initializeRedis = async (): Promise<Redis | null> => {
  if (redisClient) return redisClient;

  try {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

    redisClient = new Redis(redisUrl, { lazyConnect: true });

    redisClient.on('connect', () => {
      getLogger().info('Redis connected successfully');
    });

    redisClient.on('error', (error) => {
      getLogger().error('Redis connection error:', error);
    });

    await redisClient.connect();
    return redisClient;
  } catch (error) {
    try {
      await redisClient?.disconnect();
    } catch {
      // Ignore disconnect errors during startup fallback.
    }
    redisClient = null;
    getLogger().warn('Redis not available, running without cache:', error);
    return null;
  }
};

export const getRedisClient = (): Redis | null => {
  return redisClient;
};

export const resetRedisClientForTests = (): void => {
  redisClient = null;
};

// Cache operations
export const cacheGet = async (key: string): Promise<string | null> => {
  if (!redisClient) return null;

  try {
    return await redisClient.get(key);
  } catch (error) {
    getLogger().error('Cache get error:', error);
    return null;
  }
};

export const cacheSet = async (
  key: string,
  value: string,
  ttlSeconds?: number
): Promise<void> => {
  if (!redisClient) return;

  try {
    if (ttlSeconds) {
      await redisClient.setex(key, ttlSeconds, value);
    } else {
      await redisClient.set(key, value);
    }
  } catch (error) {
    getLogger().error('Cache set error:', error);
  }
};

export const cacheDelete = async (key: string): Promise<void> => {
  if (!redisClient) return;

  try {
    await redisClient.del(key);
  } catch (error) {
    getLogger().error('Cache delete error:', error);
  }
};

export const cacheFlush = async (): Promise<void> => {
  if (!redisClient) return;

  try {
    await redisClient.flushall();
  } catch (error) {
    getLogger().error('Cache flush error:', error);
  }
};

// Cache key generators
export const generateProductCacheKey = (productId: string): string => {
  return `product:${productId}`;
};

export const generatePriceHistoryCacheKey = (productId: string, days: number = 30): string => {
  return `price_history:${productId}:${days}`;
};

export const generateSearchCacheKey = (query: string, filters: any): string => {
  const filterStr = JSON.stringify(filters);
  return `search:${query}:${filterStr}`;
};

// Cache TTL constants
export const CACHE_TTL = {
  PRODUCT: 300, // 5 minutes
  PRICE_HISTORY: 1800, // 30 minutes
  SEARCH: 600, // 10 minutes
  HEALTH_CHECK: 60, // 1 minute
} as const;
