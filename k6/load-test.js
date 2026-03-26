import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Counter, Rate } from 'k6/metrics';

const cacheHits = new Counter('cache_hits');
const cacheMisses = new Counter('cache_misses');
const productsDuration = new Trend('products_duration', true);
const errorRate = new Rate('error_rate');

export const options = {
  stages: [
    { duration: '30s', target: 20 }, // ramp up
    { duration: '1m', target: 20 },  // sustain
    { duration: '10s', target: 0 },  // ramp down
  ],
  thresholds: {
    http_req_failed: ['rate<0.01'],    // < 1% errors
    http_req_duration: ['p(95)<500'], // 95% under 500ms
    products_duration: ['p(95)<200'], // cached responses under 200ms
    error_rate: ['rate<0.01'],
  },
};

const BASE_URL = __ENV.TARGET_URL || 'http://localhost:3000';

export default function () {
  // Health check
  const health = http.get(`${BASE_URL}/health`);
  const healthOk = check(health, {
    'health status 200': (r) => r.status === 200,
  });
  errorRate.add(!healthOk);

  // GET /products (cache test)
  const res = http.get(`${BASE_URL}/products`);
  productsDuration.add(res.timings.duration);

  const productsOk = check(res, {
    'products status 200': (r) => r.status === 200,
    'products body is array': (r) => Array.isArray(r.json()),
    'products not empty': (r) => { const d = r.json(); return Array.isArray(d) && d.length > 0; },
  });
  errorRate.add(!productsOk);

  const xCache = res.headers['X-Cache'];
  if (xCache === 'HIT') {
    cacheHits.add(1);
  } else {
    cacheMisses.add(1);
  }

  // GET /products/:id
  const detail = http.get(`${BASE_URL}/products/1`);
  check(detail, {
    'product detail status 200': (r) => r.status === 200,
    'product has name': (r) => r.json('name') !== undefined,
  });

  sleep(1);
}
