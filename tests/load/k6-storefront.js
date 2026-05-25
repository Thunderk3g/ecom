// k6 load test — storefront browse + checkout flows.
//
// Run:
//   k6 run tests/load/k6-storefront.js -e BASE_URL=http://localhost:3000
//
// Optional env:
//   VARIANT_ID   — uuid of a stock variant to exercise the checkout flow
//                  (defaults to a placeholder that will 404 against an
//                  un-seeded DB; seed first with `pnpm db:seed`).
//   PRODUCT_SLUG — slug used by the browse scenario for GET /p/<slug>.
//   CATEGORY_SLUG — slug used by the browse scenario for GET /c/<slug>.
//   SEARCH_Q     — search query used by the browse scenario.
//
// Thresholds enforce the SP-9 targets: p(95) < 800ms for cacheable browse
// traffic, p(95) < 1500ms for the checkout flow (which crosses Postgres,
// Redis, and the payment provider stub).

import http from 'k6/http';
import { check, group, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const PRODUCT_SLUG = __ENV.PRODUCT_SLUG || 'sample-notebook';
const CATEGORY_SLUG = __ENV.CATEGORY_SLUG || 'notebooks';
const SEARCH_Q = __ENV.SEARCH_Q || 'notebook';
const VARIANT_ID =
  __ENV.VARIANT_ID || '00000000-0000-0000-0000-000000000001';

export const options = {
  scenarios: {
    browse: {
      executor: 'ramping-vus',
      exec: 'browse',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 50 },
        { duration: '1m', target: 50 },
        { duration: '30s', target: 0 },
      ],
      gracefulRampDown: '15s',
      tags: { scenario: 'browse' },
    },
    checkout: {
      executor: 'ramping-vus',
      exec: 'checkout',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 10 },
        { duration: '1m', target: 10 },
        { duration: '30s', target: 0 },
      ],
      gracefulRampDown: '15s',
      tags: { scenario: 'checkout' },
    },
  },
  thresholds: {
    // Per-scenario latency budgets.
    'http_req_duration{scenario:browse}': ['p(95)<800'],
    'http_req_duration{scenario:checkout}': ['p(95)<1500'],
    // Functional ceiling: anything above 1% failure rate fails the run.
    http_req_failed: ['rate<0.01'],
  },
};

// Common headers. The storefront cart/checkout endpoints require a CSRF
// token + idempotency key on mutations — k6 mints a fresh idempotency key
// per request and reuses the cart_sid cookie that the server sets on the
// first POST /api/v1/cart response.
function commonHeaders(extra) {
  return Object.assign(
    {
      'User-Agent': 'k6-storefront/1.0',
      Accept: 'application/json,text/html',
    },
    extra || {},
  );
}

function jsonHeaders(extra) {
  return commonHeaders(
    Object.assign(
      {
        'Content-Type': 'application/json',
        'Idempotency-Key': `k6-${__VU}-${__ITER}-${Date.now()}`,
      },
      extra || {},
    ),
  );
}

export function browse() {
  group('home', () => {
    const res = http.get(`${BASE_URL}/`, { headers: commonHeaders() });
    check(res, { 'home 200': r => r.status === 200 });
  });
  sleep(1);

  group('search', () => {
    const res = http.get(
      `${BASE_URL}/search?q=${encodeURIComponent(SEARCH_Q)}`,
      { headers: commonHeaders() },
    );
    check(res, { 'search 200': r => r.status === 200 });
  });
  sleep(1);

  group('product', () => {
    const res = http.get(`${BASE_URL}/p/${PRODUCT_SLUG}`, {
      headers: commonHeaders(),
    });
    check(res, { 'product 200': r => r.status === 200 });
  });
  sleep(1);

  group('category', () => {
    const res = http.get(`${BASE_URL}/c/${CATEGORY_SLUG}`, {
      headers: commonHeaders(),
    });
    check(res, { 'category 200': r => r.status === 200 });
  });
  sleep(1);
}

export function checkout() {
  // 1. Create cart. The server sets a `cart_sid` cookie that k6's
  //    per-VU cookie jar will carry forward, plus a CSRF token (also via
  //    cookie). Subsequent mutations need the CSRF header — read it back
  //    from the response.
  let cartId = null;
  let csrf = '';

  group('cart:create', () => {
    const res = http.post(`${BASE_URL}/api/v1/cart`, '{}', {
      headers: jsonHeaders(),
    });
    check(res, { 'cart create 201': r => r.status === 201 });
    try {
      const body = res.json();
      cartId = body && body.data && body.data.cart && body.data.cart.id;
    } catch (e) {
      // body might not be JSON if the route 4xx'd before the handler.
    }
    csrf =
      res.headers['X-Csrf-Token'] ||
      res.cookies['csrf'] && res.cookies['csrf'][0] && res.cookies['csrf'][0].value ||
      '';
  });

  if (!cartId) {
    // Can't continue without a cart id; bail this iteration.
    sleep(1);
    return;
  }

  group('cart:add-item', () => {
    const res = http.post(
      `${BASE_URL}/api/v1/cart/${cartId}/items`,
      JSON.stringify({ variantId: VARIANT_ID, qty: 1 }),
      { headers: jsonHeaders({ 'X-CSRF-Token': csrf }) },
    );
    check(res, { 'add item 2xx': r => r.status >= 200 && r.status < 300 });
  });

  group('cart:addresses', () => {
    const res = http.patch(
      `${BASE_URL}/api/v1/cart/${cartId}/addresses`,
      JSON.stringify({
        shippingAddress: {
          name: 'Load Test',
          line1: '1 Test Street',
          city: 'Mumbai',
          region: 'MH',
          postal: '400001',
          country: 'IN',
          phone: '+910000000000',
        },
      }),
      { headers: jsonHeaders({ 'X-CSRF-Token': csrf }) },
    );
    check(res, { 'addresses 2xx': r => r.status >= 200 && r.status < 300 });
  });

  group('checkout:start', () => {
    const res = http.post(
      `${BASE_URL}/api/v1/checkout/start`,
      JSON.stringify({ cartId, provider: 'razorpay' }),
      { headers: jsonHeaders({ 'X-CSRF-Token': csrf }) },
    );
    check(res, {
      'checkout start 2xx': r => r.status >= 200 && r.status < 300,
    });
  });

  sleep(1);
}
