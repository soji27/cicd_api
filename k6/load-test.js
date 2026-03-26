import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Counter } from 'k6/metrics';

const cacheHits = new Counter('cache_hits');
const cacheMisses = new Counter('cache_misses');
const productsDuration = new Trend('products_duration', true);

export const options = {
  stages: [
    { duration: '30s', target: 20 },  // ramp up
    { duration: '1m',  target: 20 },  // sustain
    { duration: '10s', target: 0  },  // ramp down
  ],
  thresholds: {
    http_req_failed:   ['rate<0.01'],   // < 1% errors
    http_req_duration: ['p(95)<500'],   // 95% under 500ms
    products_duration: ['p(95)<200'],   // cached responses under 200ms
  },
};

const BASE_URL = __ENV.TARGET_URL || 'http://localhost:3000';

export default function () {
  // Health check
  const health = http.get(`${BASE_URL}/health`);
  check(health, { 'health status 200': (r) => r.status === 200 });

  // Products (Redis cache)
  const res = http.get(`${BASE_URL}/products`);
  productsDuration.add(res.timings.duration);
  check(res, {
    'products status 200': (r) => r.status === 200,
    'products body is array': (r) => Array.isArray(r.json()),
  });

  const xCache = res.headers['X-Cache'];
  if (xCache === 'HIT') {
    cacheHits.add(1);
  } else {
    cacheMisses.add(1);
  }

  sleep(1);
}
