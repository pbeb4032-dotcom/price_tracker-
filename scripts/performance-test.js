import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.API_URL || 'http://localhost:8787';
const ENDPOINTS = [
  '/health',
  '/views/best_offers?limit=20',
  '/views/trusted_price_summary?limit=20',
];

export const options = {
  stages: [
    { duration: '1m', target: 25 },
    { duration: '3m', target: 25 },
    { duration: '1m', target: 50 },
    { duration: '3m', target: 50 },
    { duration: '1m', target: 0 },
  ],
  thresholds: {
    http_req_failed: ['rate<0.05'],
    http_req_duration: ['p(95)<750'],
  },
};

export function setup() {
  const response = http.get(`${BASE_URL}/health`);
  check(response, {
    'health endpoint returned 200': (r) => r.status === 200,
  });

  return { baseUrl: BASE_URL };
}

export default function (data) {
  const endpoint = ENDPOINTS[__ITER % ENDPOINTS.length];
  const response = http.get(`${data.baseUrl}${endpoint}`);

  check(response, {
    [`${endpoint} returned success`]: (r) => r.status >= 200 && r.status < 300,
    [`${endpoint} completed under 1000ms`]: (r) => r.timings.duration < 1000,
  });

  sleep(1);
}
