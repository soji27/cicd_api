import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Counter } from 'k6/metrics';

const cacheHits = new Counter('cache_hits');
const cacheMisses = new Counter('cache_misses');
const productsDuration = new Trend('products_duration', true);

export const options = {
  duration: '10s',
  vus: 10,
  thresholds: {
    http_req_failed:   ['rate<0.01'],
    http_req_duration: ['p(95)<500'],
  },
};

const BASE_URL = __ENV.TARGET_URL || 'http://localhost:3000';

export default function () {
  const res = http.get(`${BASE_URL}/products`);
  productsDuration.add(res.timings.duration);

  check(res, {
    'status 200':        (r) => r.status === 200,
    'body is array':     (r) => Array.isArray(r.json()),
  });

  const xCache = res.headers['X-Cache'];
  if (xCache === 'HIT') {
    cacheHits.add(1);
  } else {
    cacheMisses.add(1);
  }

  sleep(0.5);
}
