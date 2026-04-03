import * as Sentry from '@sentry/node';
import winston from 'winston';
import { getDb } from '../db';
import type { Env } from '../db';

// Environment variables for monitoring
export interface MonitoringConfig {
  SENTRY_DSN?: string;
  SENTRY_ENVIRONMENT?: string;
  LOG_LEVEL?: string;
  ENABLE_PROFILING?: boolean;
}

// Initialize Sentry
export function initSentry(config: MonitoringConfig) {
  if (!config.SENTRY_DSN) {
    console.warn('[monitoring] Sentry DSN not configured, skipping Sentry initialization');
    return;
  }

  Sentry.init({
    dsn: config.SENTRY_DSN,
    environment: config.SENTRY_ENVIRONMENT || 'development',
    // Performance Monitoring
    tracesSampleRate: 1.0, // Capture 100% of the transactions
  });

  console.log(`[monitoring] Sentry initialized for environment: ${config.SENTRY_ENVIRONMENT || 'development'}`);
}

// Create structured logger
export function createLogger(config: MonitoringConfig) {
  const level = config.LOG_LEVEL || 'info';

  const logger = winston.createLogger({
    level,
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.errors({ stack: true }),
      winston.format.json()
    ),
    defaultMeta: { service: 'price-tracker-api' },
    transports: [
      // Write all logs with importance level of `error` or less to `error.log`
      new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
      // Write all logs with importance level of `info` or less to `combined.log`
      new winston.transports.File({ filename: 'logs/combined.log' }),
    ],
  });

  // If we're not in production then log to the `console` with the format:
  // `${info.level}: ${info.message} JSON.stringify({ ...rest }) `
  if (process.env.NODE_ENV !== 'production') {
    logger.add(new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    }));
  }

  return logger;
}

// Global logger instance
let logger: winston.Logger;

export function getLogger(): winston.Logger {
  if (!logger) {
    logger = createLogger({
      LOG_LEVEL: process.env.LOG_LEVEL,
    });
  }
  return logger;
}

// Health check utilities
export async function checkDatabaseHealth(env: Env): Promise<{
  status: 'healthy' | 'unhealthy';
  latency: number;
  error?: string;
}> {
  const startTime = Date.now();

  try {
    const db = getDb(env);
    await db.execute('SELECT 1 as health_check');
    const latency = Date.now() - startTime;

    return {
      status: 'healthy',
      latency,
    };
  } catch (error) {
    const latency = Date.now() - startTime;
    return {
      status: 'unhealthy',
      latency,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function checkRedisHealth(): Promise<{
  status: 'healthy' | 'unhealthy';
  latency: number;
  error?: string;
}> {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    return {
      status: 'unhealthy',
      latency: 0,
      error: 'REDIS_URL not configured',
    };
  }

  const startTime = Date.now();

  try {
    const { getRedisClient } = await import('./cache.js');
    const client = getRedisClient();
    if (!client) {
      return {
        status: 'unhealthy',
        latency: Date.now() - startTime,
        error: 'Redis client not initialized',
      };
    }

    await client.ping();
    const latency = Date.now() - startTime;

    return {
      status: 'healthy',
      latency,
    };
  } catch (error) {
    const latency = Date.now() - startTime;
    return {
      status: 'unhealthy',
      latency,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function getSystemMetrics(env: Env) {
  const dbHealth = await checkDatabaseHealth(env);
  const redisHealth = await checkRedisHealth();

  const metrics = {
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: {
      used: process.memoryUsage().heapUsed,
      total: process.memoryUsage().heapTotal,
      external: process.memoryUsage().external,
      rss: process.memoryUsage().rss,
    },
    cpu: process.cpuUsage(),
    database: dbHealth,
    redis: redisHealth,
    environment: {
      node_version: process.version,
      platform: process.platform,
      arch: process.arch,
    },
  };

  return metrics;
}

// Performance monitoring middleware
export function createPerformanceMiddleware(logger: winston.Logger) {
  return async (c: any, next: any) => {
    const startTime = Date.now();
    const method = c.req.method;
    const url = c.req.url;

    try {
      await next();

      const duration = Date.now() - startTime;
      const status = c.res.status;

      // Log slow requests (>500ms)
      if (duration > 500) {
        logger.warn('Slow request detected', {
          method,
          url,
          duration,
          status,
          userAgent: c.req.header('User-Agent'),
          ip: c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || 'unknown',
        });

        // Send to Sentry for performance monitoring
        Sentry.withScope((scope) => {
          scope.setTag('method', method);
          scope.setTag('url', url);
          scope.setTag('status', status);
          scope.setExtra('duration', duration);
          Sentry.captureMessage(`Slow request: ${method} ${url}`, 'warning');
        });
      }

      // Log all errors (5xx)
      if (status >= 500) {
        logger.error('Server error occurred', {
          method,
          url,
          duration,
          status,
          userAgent: c.req.header('User-Agent'),
          ip: c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || 'unknown',
        });
      }

    } catch (error) {
      const duration = Date.now() - startTime;

      logger.error('Request failed with exception', {
        method,
        url,
        duration,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        userAgent: c.req.header('User-Agent'),
        ip: c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || 'unknown',
      });

      // Send to Sentry
      Sentry.captureException(error, {
        tags: {
          method,
          url,
        },
        extra: {
          duration,
          userAgent: c.req.header('User-Agent'),
        },
      });

      throw error;
    }
  };
}

// Error boundary for async operations
export function withErrorReporting<T extends any[], R>(
  fn: (...args: T) => Promise<R>,
  operationName: string
) {
  return async (...args: T): Promise<R> => {
    const logger = getLogger();

    try {
      return await fn(...args);
    } catch (error) {
      logger.error(`Operation failed: ${operationName}`, {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        args: args.length > 0 ? JSON.stringify(args) : undefined,
      });

      Sentry.captureException(error, {
        tags: {
          operation: operationName,
        },
      });

      throw error;
    }
  };
}

// Background job monitoring
export function monitorBackgroundJob(
  jobName: string,
  jobFn: () => Promise<void>
) {
  return async () => {
    const logger = getLogger();
    const startTime = Date.now();

    logger.info(`Starting background job: ${jobName}`);

    try {
      await jobFn();
      const duration = Date.now() - startTime;

      logger.info(`Background job completed: ${jobName}`, {
        duration,
        status: 'success',
      });

    } catch (error) {
      const duration = Date.now() - startTime;

      logger.error(`Background job failed: ${jobName}`, {
        duration,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });

      Sentry.captureException(error, {
        tags: {
          job: jobName,
          type: 'background_job',
        },
        extra: {
          duration,
        },
      });

      throw error;
    }
  };
}
