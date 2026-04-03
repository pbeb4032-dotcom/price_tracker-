import { register, collectDefaultMetrics, Gauge, Counter, Histogram } from 'prom-client';

// Enable default metrics collection
collectDefaultMetrics();

// Custom metrics
export const metrics = {
  // HTTP request metrics
  httpRequestTotal: new Counter({
    name: 'http_requests_total',
    help: 'Total number of HTTP requests',
    labelNames: ['method', 'route', 'status_code'],
  }),

  httpRequestDuration: new Histogram({
    name: 'http_request_duration_seconds',
    help: 'Duration of HTTP requests in seconds',
    labelNames: ['method', 'route'],
    buckets: [0.1, 0.5, 1, 2, 5, 10],
  }),

  // Database metrics
  dbQueryTotal: new Counter({
    name: 'db_queries_total',
    help: 'Total number of database queries',
    labelNames: ['operation', 'table'],
  }),

  dbQueryDuration: new Histogram({
    name: 'db_query_duration_seconds',
    help: 'Duration of database queries in seconds',
    labelNames: ['operation', 'table'],
    buckets: [0.01, 0.05, 0.1, 0.5, 1, 2],
  }),

  // Cache metrics
  cacheHitTotal: new Counter({
    name: 'cache_hits_total',
    help: 'Total number of cache hits',
    labelNames: ['cache_type'],
  }),

  cacheMissTotal: new Counter({
    name: 'cache_misses_total',
    help: 'Total number of cache misses',
    labelNames: ['cache_type'],
  }),

  // Business metrics
  productsTracked: new Gauge({
    name: 'products_tracked_total',
    help: 'Total number of products being tracked',
  }),

  priceUpdatesTotal: new Counter({
    name: 'price_updates_total',
    help: 'Total number of price updates processed',
  }),

  alertsSentTotal: new Counter({
    name: 'alerts_sent_total',
    help: 'Total number of alerts sent',
    labelNames: ['type'],
  }),

  // System health metrics
  crawlerJobsActive: new Gauge({
    name: 'crawler_jobs_active',
    help: 'Number of active crawler jobs',
  }),

  crawlerJobsCompleted: new Counter({
    name: 'crawler_jobs_completed_total',
    help: 'Total number of completed crawler jobs',
    labelNames: ['status'],
  }),

  // Error metrics
  errorsTotal: new Counter({
    name: 'errors_total',
    help: 'Total number of errors',
    labelNames: ['type', 'component'],
  }),
};

// Middleware to collect HTTP metrics
export const metricsMiddleware = async (c: any, next: any) => {
  const start = Date.now();
  const method = c.req.method;
  const path = c.req.path;

  try {
    await next();

    const duration = (Date.now() - start) / 1000;
    const statusCode = c.res.status;

    metrics.httpRequestTotal.inc({ method, route: path, status_code: statusCode });
    metrics.httpRequestDuration.observe({ method, route: path }, duration);

  } catch (error) {
    const duration = (Date.now() - start) / 1000;

    metrics.httpRequestTotal.inc({ method, route: path, status_code: 500 });
    metrics.httpRequestDuration.observe({ method, route: path }, duration);
    metrics.errorsTotal.inc({ type: 'http', component: 'middleware' });

    throw error;
  }
};

// Database metrics wrapper
export const withDbMetrics = async <T>(
  operation: string,
  table: string,
  fn: () => Promise<T>
): Promise<T> => {
  const start = Date.now();

  try {
    const result = await fn();
    const duration = (Date.now() - start) / 1000;

    metrics.dbQueryTotal.inc({ operation, table });
    metrics.dbQueryDuration.observe({ operation, table }, duration);

    return result;
  } catch (error) {
    const duration = (Date.now() - start) / 1000;

    metrics.dbQueryTotal.inc({ operation, table });
    metrics.dbQueryDuration.observe({ operation, table }, duration);
    metrics.errorsTotal.inc({ type: 'database', component: table });

    throw error;
  }
};

// Cache metrics wrapper
export const withCacheMetrics = async <T>(
  cacheType: string,
  fn: () => Promise<T>,
  isHit: boolean = false
): Promise<T> => {
  const result = await fn();

  if (isHit) {
    metrics.cacheHitTotal.inc({ cache_type: cacheType });
  } else {
    metrics.cacheMissTotal.inc({ cache_type: cacheType });
  }

  return result;
};

// Get metrics for Prometheus scraping
export const getMetrics = async (): Promise<string> => {
  return register.metrics();
};

// Reset metrics (useful for testing)
export const resetMetrics = (): void => {
  register.resetMetrics();
  collectDefaultMetrics();
};