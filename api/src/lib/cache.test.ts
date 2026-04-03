import { beforeEach, describe, expect, it, vi } from 'vitest';
import Redis from 'ioredis';
import {
  cacheDelete,
  cacheGet,
  cacheSet,
  generatePriceHistoryCacheKey,
  generateProductCacheKey,
  generateSearchCacheKey,
  getRedisClient,
  initializeRedis,
  resetRedisClientForTests,
} from '../lib/cache.js';

vi.mock('ioredis');

const mockRedis = {
  connect: vi.fn(),
  disconnect: vi.fn(),
  get: vi.fn(),
  set: vi.fn(),
  setex: vi.fn(),
  del: vi.fn(),
  flushall: vi.fn(),
  ping: vi.fn(),
  on: vi.fn(),
};

describe('cache utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRedisClientForTests();
    vi.mocked(Redis).mockImplementation(() => mockRedis as any);
    process.env.REDIS_URL = 'redis://localhost:6379';
  });

  it('initializes Redis successfully', async () => {
    mockRedis.connect.mockResolvedValueOnce(undefined);

    const client = await initializeRedis();

    expect(client).toBe(mockRedis);
    expect(Redis).toHaveBeenCalledWith('redis://localhost:6379', { lazyConnect: true });
    expect(mockRedis.connect).toHaveBeenCalledTimes(1);
  });

  it('returns null and clears state when Redis initialization fails', async () => {
    mockRedis.connect.mockRejectedValueOnce(new Error('Connection failed'));
    mockRedis.disconnect.mockResolvedValueOnce(undefined);

    const client = await initializeRedis();

    expect(client).toBeNull();
    expect(mockRedis.disconnect).toHaveBeenCalledTimes(1);
    expect(getRedisClient()).toBeNull();
  });

  it('reads a cached value when Redis is available', async () => {
    mockRedis.connect.mockResolvedValueOnce(undefined);
    mockRedis.get.mockResolvedValueOnce('cached-value');
    await initializeRedis();

    const result = await cacheGet('test-key');

    expect(result).toBe('cached-value');
    expect(mockRedis.get).toHaveBeenCalledWith('test-key');
  });

  it('returns null from cacheGet when Redis is unavailable', async () => {
    const result = await cacheGet('test-key');
    expect(result).toBeNull();
  });

  it('writes cache values without TTL', async () => {
    mockRedis.connect.mockResolvedValueOnce(undefined);
    mockRedis.set.mockResolvedValueOnce('OK');
    await initializeRedis();

    await cacheSet('test-key', 'test-value');

    expect(mockRedis.set).toHaveBeenCalledWith('test-key', 'test-value');
  });

  it('writes cache values with TTL', async () => {
    mockRedis.connect.mockResolvedValueOnce(undefined);
    mockRedis.setex.mockResolvedValueOnce('OK');
    await initializeRedis();

    await cacheSet('test-key', 'test-value', 300);

    expect(mockRedis.setex).toHaveBeenCalledWith('test-key', 300, 'test-value');
  });

  it('deletes cache values', async () => {
    mockRedis.connect.mockResolvedValueOnce(undefined);
    mockRedis.del.mockResolvedValueOnce(1);
    await initializeRedis();

    await cacheDelete('test-key');

    expect(mockRedis.del).toHaveBeenCalledWith('test-key');
  });

  it('generates the expected product cache key', () => {
    expect(generateProductCacheKey('product-123')).toBe('product:product-123');
  });

  it('generates the expected price history cache key', () => {
    expect(generatePriceHistoryCacheKey('product-123', 30)).toBe('price_history:product-123:30');
  });

  it('generates the expected search cache key', () => {
    expect(generateSearchCacheKey('laptop', { category: 'electronics', minPrice: 100 })).toBe(
      'search:laptop:{"category":"electronics","minPrice":100}'
    );
  });
});
