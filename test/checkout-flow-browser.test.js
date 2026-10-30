// test/checkout-flow-browser.test.js — BROWSER-LEVEL coverage for the money
// CTAs the audit called out as uncovered (audit gap F3, ticket
// zeus_1793167126689_cd3c8bd5; SAFE — Stripe is never contacted, every
// response is mocked).
//
// Surfaces under test (all previously string-match-only or uncovered):
//   1. checkout.html — the retired ?plan= bookmark shim that deep-links into
//      /index.html#pricing (referenced by no test before this file);
//   2. portal.html "Add SMS" CTA — startSmsCheckout(): exactly one
//      POST /portal/billing/addons/checkout with the selected SKU, then the
//      browser follows the returned session URL;
//   3. portal.html "Update SMS Plan" CTA — startSmsTierChange(): exactly one
//      POST /portal/billing/addons/change-tier with the selected SKU;
//   4. payment-success.html — add-on vs plan rendering and the failure
//      surface (5xx / network failure / no session_id);
//   5. portal.html checkout return — ?checkout=cancelled|success toasts, and
//      a cancelled return must NEVER show a success state.
//
// ON THE AC "exact request body for plan-only and bundled plan+SMS": the
// landing signup CTA that POSTs { plan, sms_sku } (plan-only vs bundle) is
// already asserted by test/pricing-signup-browser.test.js. The PORTAL surface
// has no plan-purchase CTA — its two money CTAs POST { sku } only — so this
// spec asserts the exact body in BOTH subscriber states the portal renders:
// a plan-only customer (no SMS add-on → purchase CTA) and a bundled
// plan+SMS customer (active add-on → change-tier CTA).
//
// Harness: same shape as test/portal-billing-browser.test.js — real Chromium
// (Playwright) against the working tree, a stateful mock on page.route, and
// auth seeded via addInitScript. Playwright missing → suite SKIPS loudly
// (auzora-website has no CI job that would install it).

'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const { URL } = require('url');

jest.setTimeout(120000);

const repoRoot = path.join(__dirname, '..');

// ── Playwright resolution (same fallback chain as portal-billing-browser) ───
function resolvePlaywright() {
  const candidates = [
    process.env.PLAYWRIGHT_PKG,
    'playwright',
    '@playwright/test',
    process.env.HOME ? path.join(process.env.HOME, 'Projects/atlas-ai/node_modules/playwright') : null,
  ].filter(Boolean);
  for (const c of candidates) {
    try { return require(c); } catch (e) { /* try the next candidate */ }
  }
  return null;
}

const playwright = resolvePlaywright();
const chromium = playwright && playwright.chromium ? playwright.chromium : null;

function chromiumInstalled() {
  if (!chromium) return false;
  try {
    const exe = chromium.executablePath();
    return !!exe && fs.existsSync(exe);
  } catch (e) {
    return false;
  }
}

const browserReady = chromiumInstalled();

if (!browserReady) {
  // eslint-disable-next-line no-console
  console.warn(
    '\n[checkout-flow-browser] SKIPPING the checkout/payment-outcome browser spec — ' +
    (chromium ? 'Playwright is installed but its Chromium build is not.\n' : 'Playwright is not installed.\n') +
    '  Install with:  npm i -D playwright && npx playwright install chromium\n' +
    '  (or point PLAYWRIGHT_PKG at an existing playwright install).\n'
  );
}

const describeBrowser = browserReady ? describe : describe.skip;

// ── Shared fixtures (synthetic; no real client/session data) ─────────────────
const ORIGIN_TOKEN = 'checkout-flow-browser-token';

const CLIENT = {
  business_name: 'Acme Checkout Flow Co',
  tutorial_completed: true, // suppress the first-run tutorial overlay
  webhook_url: '',
};

// Plan-only customer: capped Standard plan, SMS not included (cap 0).
const PLAN_ONLY_USAGE = {
  voiceMinutes: 1280,
  smsMessages: 30,
  limits: { voiceMinutes: 2500, smsMessages: 0 },
  percentUsed: { voice: 51, sms: 0 },
  period: '2026-10',
  unlimited: false,
  included: { voice: 1250, sms: 0 },
  overage: { voice: 30, sms: 30 },
};

// Bundled plan+SMS customer: active sms_2500 add-on on the same plan.
const BUNDLED_USAGE = Object.assign({}, PLAN_ONLY_USAGE, {
  smsMessages: 640,
  limits: { voiceMinutes: 2500, smsMessages: 2500 },
  percentUsed: { voice: 51, sms: 26 },
  included: { voice: 1250, sms: 2500 },
  overage: { voice: 30, sms: 0 },
});

const SMS_ADDON_ACTIVE = {
  sku: 'sms_2500',
  status: 'active',
  monthlyUsd: 25,
  messagesPerMonth: 2500,
};

// Mirrors atlas-ai SMS_ADDONS (src/config/tiers.js): sms_2500/5000/10000.
const BASE_ADDONS = [
  { sku: 'sms_2500', smsMessages: 2500, monthlyUsd: 25, purchasable: true, current: false },
  { sku: 'sms_5000', smsMessages: 5000, monthlyUsd: 50, purchasable: true, current: false },
  { sku: 'sms_10000', smsMessages: 10000, monthlyUsd: 100, purchasable: false, current: false },
];

// ── Static file server (serves the working tree) ─────────────────────────────
function startStaticServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      let pathname;
      try { pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname); }
      catch (e) { res.writeHead(400); res.end('bad url'); return; }
      const rel = pathname === '/' || pathname === '/portal' ? '/portal.html' : pathname;
      const file = path.resolve(repoRoot, '.' + rel);
      if (!file.startsWith(repoRoot) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404); res.end('not found'); return;
      }
      const ct = {
        '.html': 'text/html; charset=utf-8',
        '.js': 'text/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.json': 'application/json; charset=utf-8',
        '.png': 'image/png',
        '.svg': 'image/svg+xml',
      }[path.extname(file)] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': ct });
      fs.createReadStream(file).pipe(res);
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

// ── Mock portal/checkout API (stateful; drives the network layer) ────────────
function createMockApi(opts) {
  const o = opts || {};
  let origin = null; // set once the static server is listening
  return {
    setOrigin(v) { origin = v; },

    plan: o.plan || 'Standard',
    tier: o.tier || 'standard',
    usage: o.usage || PLAN_ONLY_USAGE,
    // entitlements-level SMS ledger state (null = plan-only customer)
    smsAddon: o.smsAddon !== undefined ? o.smsAddon : null,
    // the entitlement FLAGS object the real /portal/entitlements returns under
    // `entitlements` (portalEntitlements = data.entitlements in portal.html)
    entFlags: o.entFlags || { voice: true, sms: false },
    addons: o.addons !== undefined ? o.addons : BASE_ADDONS,
    catalogCurrent: o.catalogCurrent !== undefined ? o.catalogCurrent : null,

    // Endpoint behaviours (all mocked, never contacted for real).
    checkout: Object.assign({ status: 200, body: null, delayMs: 0, abort: false, raw: false }, o.checkout),
    changeTier: Object.assign({ status: 200, body: null, delayMs: 0, abort: false, raw: false }, o.changeTier),
    checkoutSession: Object.assign({ status: 200, body: {}, abort: false, raw: false }, o.checkoutSession),

    requests: [],

    isStatic(url) {
      return origin && url.origin === origin;
    },

    entitlementsPayload() {
      return {
        plan: this.plan,
        tier: this.tier,
        entitlements: Object.assign({}, this.entFlags),
        usage: JSON.parse(JSON.stringify(this.usage)),
        sms_addon: this.smsAddon ? JSON.parse(JSON.stringify(this.smsAddon)) : null,
        allow_overage: { voice: false, sms: false },
        tierVoices: { access: ['default'], defaultVoiceId: null, elevenlabsAddon: false },
      };
    },

    dispatch(method, pathname, search, headers, rawBody) {
      let body = null;
      if (rawBody) { try { body = JSON.parse(rawBody); } catch (e) { body = rawBody; } }
      const lower = {};
      Object.keys(headers || {}).forEach(k => { lower[k.toLowerCase()] = headers[k]; });
      this.requests.push({ method, pathname, search: search || '', headers: lower, body });

      // CORS preflight for the cross-origin portal fetches — answered free
      // (same as the sibling suites; route-fulfilled responses bypass CORS).
      if (method === 'OPTIONS') return { status: 200, body: {} };

      if (method === 'GET' && pathname === '/portal/entitlements') {
        return { status: 200, body: this.entitlementsPayload() };
      }
      if (method === 'GET' && pathname === '/portal/billing/addons') {
        return { status: 200, body: { addons: this.addons, current: this.catalogCurrent } };
      }
      if (method === 'POST' && pathname === '/portal/billing/addons/checkout') {
        const c = this.checkout;
        if (c.abort) return { abort: true };
        if (c.delayMs) { /* handled below via async wrapper */ }
        if (c.status >= 400) {
          return { status: c.status, body: c.raw ? 'Internal Server Error' : (c.body || { error: 'checkout failed' }), raw: !!c.raw };
        }
        return {
          status: 200,
          body: c.body || { url: origin + '/mock-stripe-checkout-session' },
        };
      }
      if (method === 'POST' && pathname === '/portal/billing/addons/change-tier') {
        const c = this.changeTier;
        if (c.abort) return { abort: true };
        if (c.status >= 400) {
          return { status: c.status, body: c.raw ? 'Internal Server Error' : (c.body || { error: 'tier change failed' }), raw: !!c.raw };
        }
        return {
          status: 200,
          body: c.body || {
            ok: true,
            tier_change_request: { sku: (body && body.sku) || 'sms_10000', requested_messages: 10000, status: 'pending' },
          },
        };
      }
      if (method === 'GET' && pathname === '/api/checkout-session') {
        const c = this.checkoutSession;
        if (c.abort) return { abort: true };
        if (c.status >= 400) {
          return { status: c.status, body: c.raw ? 'boom' : (c.body || { error: 'lookup failed' }), raw: !!c.raw };
        }
        return { status: 200, body: c.body };
      }
      // Everything else the dashboard boot fans out to — empty but valid JSON.
      return { status: 200, body: {} };
    },

    requestsTo(pathname) {
      return this.requests.filter(r => r.pathname === pathname);
    },
    postsTo(pathname) {
      return this.requests.filter(r => r.method === 'POST' && r.pathname === pathname);
    },
  };
}

// The two billing POSTs support a delay (for the double-click in-flight test)
// and a raw non-JSON 5xx (exercises res.json() failure handling). The delay
// lives in the route handler so the request is genuinely in flight.
function makeDelay(api, pathname) {
  const cfg = pathname === '/portal/billing/addons/checkout' ? api.checkout : api.changeTier;
  return cfg.delayMs || 0;
}

// Intercept every request the page makes: answer the mocked session URL with a
// stub page, let the local static server through, answer /portal|/api with the
// mock, and stub third-party CDNs so an offline run cannot stall the render.
async function installNetwork(page, api) {
  await page.route('**/*', async (route) => {
    const req = route.request();
    let url;
    try { url = new URL(req.url()); } catch (e) { return route.abort(); }

    // The mocked Stripe Checkout Session URL — a tiny local page the browser
    // "hands over" to. Must be matched BEFORE the static-origin passthrough.
    if (url.pathname === '/mock-stripe-checkout-session') {
      return route.fulfill({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: '<!DOCTYPE html><html><body id="mock-stripe">MOCK STRIPE CHECKOUT SESSION</body></html>',
      });
    }

    if (api.isStatic(url)) return route.continue();

    if (url.pathname.startsWith('/portal/') || url.pathname.startsWith('/api/')) {
      const r = api.dispatch(req.method(), url.pathname, url.search, req.headers(), req.postData());
      if (r && r.abort) return route.abort('failed');
      const delay = makeDelay(api, url.pathname);
      if (delay) await new Promise(res => setTimeout(res, delay));
      if (r && r.raw) {
        return route.fulfill({ status: r.status, contentType: 'text/plain; charset=utf-8', body: String(r.body) });
      }
      return route.fulfill({
        status: (r && r.status) || 200,
        contentType: 'application/json',
        body: JSON.stringify((r && r.body) || {}),
      });
    }
    if (/(^|\.)unpkg\.com$/.test(url.hostname)) {
      // Minimal lucide stub — the portal guards every call with `if (window.lucide)`.
      return route.fulfill({
        status: 200,
        contentType: 'text/javascript',
        body: 'window.lucide = { createIcons: function () {} };',
      });
    }
    if (/(^|\.)googleapis\.com$/.test(url.hostname) || /(^|\.)gstatic\.com$/.test(url.hostname)) {
      return route.fulfill({ status: 200, contentType: 'text/css', body: '' });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
}

async function seedAuth(page) {
  // Runs before every document load in this page (including reloads).
  await page.addInitScript((args) => {
    try {
      window.sessionStorage.setItem('atlas_token', args.token);
      window.sessionStorage.setItem('atlas_client', JSON.stringify(args.client));
    } catch (e) { /* about:blank frame */ }
  }, { token: ORIGIN_TOKEN, client: CLIENT });
}

// Navigation-safe waitFor: a mid-test document swap (checkout redirect, Stripe
// hand-over) destroys the execution context and would otherwise surface as a
// spurious evaluate error.
async function waitFor(fn, timeoutMs = 15000) {
  const start = Date.now();
  for (;;) {
    let ok = false;
    try { ok = await fn(); } catch (e) { ok = false; }
    if (ok) return undefined;
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise(r => setTimeout(r, 60));
  }
}

// Load the portal and wait until the entitlements-driven usage card has painted.
async function loadPortal(page, baseUrl) {
  await page.goto(baseUrl + '/portal.html', { waitUntil: 'domcontentloaded' });
  await waitFor(() => page.evaluate(() => {
    const t = document.getElementById('usage-voice-tally');
    return !!t && t.textContent.trim().length > 0;
  }));
}

// Wait until the purchase row's select is populated from the catalog.
async function waitForSmsCatalog(page) {
  await waitFor(() => page.evaluate(() => {
    const sel = document.getElementById('usage-sms-select');
    return !!sel && sel.options.length > 0 && sel.options[0].value !== '';
  }));
}

// Wait until the change-tier row's select is populated from the catalog.
async function waitForChangeRow(page) {
  await waitFor(() => page.evaluate(() => {
    const sel = document.getElementById('usage-sms-change-select');
    return !!sel && sel.options.length > 0 && sel.options[0].value !== '';
  }));
}

function ctaState(page, sel) {
  return page.evaluate((s) => {
    const b = document.querySelector(s);
    if (!b) return null;
    return {
      text: b.textContent.trim(),
      ariaDisabled: b.getAttribute('aria-disabled'),
      cls: b.className,
      hasHref: b.hasAttribute('href'),
    };
  }, sel);
}

function errState(page) {
  return page.evaluate(() => {
    const el = document.getElementById('usage-sms-addon-err');
    return {
      display: el ? el.style.display : null,
      text: el ? el.textContent : null,
    };
  });
}

function toastState(page) {
  return page.evaluate(() => {
    const t = document.getElementById('toast');
    return { text: t ? t.textContent : null, cls: t ? t.className : '' };
  });
}

// ── Suite ────────────────────────────────────────────────────────────────────
describeBrowser('checkout flow + payment outcome UI — browser-level spec (audit gap F3)', () => {
  let server;
  let baseUrl;
  let browser;

  beforeAll(async () => {
    server = await startStaticServer();
    baseUrl = 'http://127.0.0.1:' + server.address().port;
    browser = await chromium.launch({ headless: true });
  });

  afterAll(async () => {
    if (browser) await browser.close();
    if (server) await new Promise(r => server.close(r));
  });

  async function withPage(api, fn) {
    api.setOrigin(baseUrl);
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const pageErrors = [];
    page.on('pageerror', e => pageErrors.push(String((e && e.message) || e)));
    try {
      await installNetwork(page, api);
      await seedAuth(page);
      return await fn(page, pageErrors);
    } finally {
      await page.close();
    }
  }

  // ── checkout.html: the retired ?plan= bookmark shim ────────────────────────

  test('1. checkout.html deep-links known plans (and normalizes case) into the pricing route', async () => {
    const api = createMockApi();

    await withPage(api, async (page) => {
      for (const plan of ['basic', 'standard', 'enterprise', 'STANDARD']) {
        await page.goto(baseUrl + '/checkout.html?plan=' + plan, { waitUntil: 'load' });
        // The inline shim replaces the document with the pricing deep link,
        // carrying the (lowercased) plan param for known plans.
        await waitFor(() => Promise.resolve(page.url().startsWith(baseUrl + '/index.html#pricing')));
        expect(page.url()).toBe(baseUrl + '/index.html#pricing?plan=' + plan.toLowerCase());
      }
    });
  });

  test('2. checkout.html falls back to the generic pricing anchor for no/unknown plan', async () => {
    const api = createMockApi();

    await withPage(api, async (page) => {
      for (const qs of ['', '?plan=', '?plan=pro']) { // pro is a RETIRED plan name
        await page.goto(baseUrl + '/checkout.html' + qs, { waitUntil: 'load' });
        await waitFor(() => Promise.resolve(page.url().startsWith(baseUrl + '/index.html#pricing')));
        // No plan params may leak into the target for unknown/absent plans.
        expect(page.url()).toBe(baseUrl + '/index.html#pricing');
      }
    });
  });

  // ── portal "Add SMS" CTA — POST /portal/billing/addons/checkout ────────────
  // Plan-only customer state (no active SMS add-on).

  test('3. Add-SMS CTA: exactly one POST with the exact selected SKU, then the browser follows the session URL', async () => {
    const api = createMockApi({ usage: PLAN_ONLY_USAGE, smsAddon: null });

    await withPage(api, async (page) => {
      await loadPortal(page, baseUrl);
      await waitForSmsCatalog(page);

      // The plan-only state rendered the purchase row (not the active-addon row).
      const row = await page.evaluate(() => ({
        selectValue: document.getElementById('usage-sms-select').value,
        addonBlock: document.getElementById('usage-sms-addon').style.display,
      }));
      expect(row.addonBlock).toBe('block');

      // Pick the 5,000 tier: the UI must reflect the selection AND its price.
      await page.selectOption('#usage-sms-select', 'sms_5000');
      const picked = await page.evaluate(() => {
        const sel = document.getElementById('usage-sms-select');
        return { sku: sel.value, label: sel.options[sel.selectedIndex].textContent };
      });
      expect(picked.sku).toBe('sms_5000');
      expect(picked.label).toBe('5,000 messages — $50/mo'); // wrong price in the UI fails here

      // A non-purchasable tier is Coming Soon: the CTA must be dead for it.
      await page.selectOption('#usage-sms-select', 'sms_10000');
      const soon = await Promise.all([
        ctaState(page, '#usage-sms-btn'),
        page.evaluate(() => !document.getElementById('usage-sms-coming').hidden),
      ]);
      expect(soon[0].ariaDisabled).toBe('true');
      expect(soon[0].hasHref).toBe(false);
      expect(soon[1]).toBe(true);

      // Back to sms_5000 — CTA arms, one real click, one real request.
      await page.selectOption('#usage-sms-select', 'sms_5000');
      const armed = await ctaState(page, '#usage-sms-btn');
      expect(armed.ariaDisabled).toBe(null);

      await page.click('#usage-sms-btn');

      await waitFor(() => Promise.resolve(api.postsTo('/portal/billing/addons/checkout').length === 1));
      const post = api.postsTo('/portal/billing/addons/checkout')[0];
      expect(post.method).toBe('POST');
      expect(post.pathname).toBe('/portal/billing/addons/checkout');
      expect(post.headers['x-portal-token']).toBe(ORIGIN_TOKEN);
      expect(post.headers['content-type']).toContain('application/json');
      expect(post.body).toEqual({ sku: 'sms_5000' }); // EXACT body — nothing extra

      // The returned session URL is followed: the browser lands on the
      // (mocked) Stripe session page.
      await waitFor(() => Promise.resolve(page.url() === baseUrl + '/mock-stripe-checkout-session'));
      expect(page.url()).toBe(baseUrl + '/mock-stripe-checkout-session');
      await waitFor(() => page.evaluate(() =>
        document.body && document.body.textContent.includes('MOCK STRIPE CHECKOUT SESSION')));
    });
  });

  test('4. double-click while the checkout request is in flight mints exactly ONE session', async () => {
    const api = createMockApi({
      usage: PLAN_ONLY_USAGE,
      checkout: { delayMs: 600 }, // keep the first request in flight
    });

    await withPage(api, async (page) => {
      await loadPortal(page, baseUrl);
      await waitForSmsCatalog(page);
      await page.selectOption('#usage-sms-select', 'sms_2500');

      // Two rapid clicks: the first sets aria-disabled synchronously, so the
      // second must be a no-op — two Stripe sessions from one double-tap is
      // the money bug this test exists to catch. The SECOND click is a raw DOM
      // click (bypassing Playwright's actionability retries, which would wait
      // out the aria-disabled gate instead of racing it — exactly what a real
      // fast double-tap does not do).
      await page.click('#usage-sms-btn');
      await page.evaluate(() => document.getElementById('usage-sms-btn').click());

      await waitFor(() => Promise.resolve(api.postsTo('/portal/billing/addons/checkout').length === 1));
      await waitFor(() => Promise.resolve(page.url() === baseUrl + '/mock-stripe-checkout-session'));
      // The count must STILL be one after the response landed and navigation happened.
      expect(api.postsTo('/portal/billing/addons/checkout').length).toBe(1);
    });
  });

  test('5. 4xx/5xx from the checkout endpoint: recoverable error, CTA reverts, no navigation, no success state', async () => {
    // (a) 400 with a JSON error body.
    const api400 = createMockApi({
      usage: PLAN_ONLY_USAGE,
      checkout: { status: 400, body: { error: 'SMS add-on is not available for your plan.' } },
    });
    await withPage(api400, async (page) => {
      await loadPortal(page, baseUrl);
      await waitForSmsCatalog(page);
      await page.selectOption('#usage-sms-select', 'sms_2500');
      await page.click('#usage-sms-btn');

      await waitFor(async () => (await errState(page)).display === 'block');
      const err = await errState(page);
      expect(err.text).toBe('SMS add-on is not available for your plan.');

      // The optimistic disable reverts — the CTA is clickable again.
      const btn = await ctaState(page, '#usage-sms-btn');
      expect(btn.text).toBe('Add SMS');
      expect(btn.ariaDisabled).toBe(null);
      expect(btn.hasHref).toBe(true);
      expect(btn.cls).not.toContain('disabled');

      // No navigation, and the page never shows a success state.
      expect(page.url()).toBe(baseUrl + '/portal.html');
      const toast = await toastState(page);
      expect(toast.cls).not.toContain('success');
      expect(toast.text || '').not.toContain('✓');
      expect(api400.postsTo('/portal/billing/addons/checkout').length).toBe(1);
    });

    // (b) 500 with a NON-JSON body — res.json() throws, the fallback
    //     `checkout ${status}` message must surface.
    const api500 = createMockApi({
      usage: PLAN_ONLY_USAGE,
      checkout: { status: 500, raw: true },
    });
    await withPage(api500, async (page) => {
      await loadPortal(page, baseUrl);
      await waitForSmsCatalog(page);
      await page.selectOption('#usage-sms-select', 'sms_2500');
      await page.click('#usage-sms-btn');

      await waitFor(async () => (await errState(page)).display === 'block');
      expect((await errState(page)).text).toBe('checkout 500');
      const btn = await ctaState(page, '#usage-sms-btn');
      expect(btn.ariaDisabled).toBe(null);
      expect(page.url()).toBe(baseUrl + '/portal.html');
    });
  });

  test('6. network failure (aborted request): recoverable error, CTA reverts, no navigation', async () => {
    const api = createMockApi({
      usage: PLAN_ONLY_USAGE,
      checkout: { abort: true },
    });

    await withPage(api, async (page) => {
      await loadPortal(page, baseUrl);
      await waitForSmsCatalog(page);
      await page.selectOption('#usage-sms-select', 'sms_2500');
      await page.click('#usage-sms-btn');

      await waitFor(async () => (await errState(page)).display === 'block');
      const err = await errState(page);
      expect(err.text && err.text.length).toBeGreaterThan(0); // truthful message, not silence

      const btn = await ctaState(page, '#usage-sms-btn');
      expect(btn.text).toBe('Add SMS');
      expect(btn.ariaDisabled).toBe(null);
      expect(btn.cls).not.toContain('disabled');
      expect(page.url()).toBe(baseUrl + '/portal.html'); // never navigated
      const toast = await toastState(page);
      expect(toast.cls).not.toContain('success');
    });
  });

  // ── portal "Update SMS Plan" CTA — POST /portal/billing/addons/change-tier ─
  // Bundled plan+SMS customer state (active sms_2500 add-on).

  test('7. Update-SMS-Plan CTA: same-tier guard disabled, then exactly one POST with the exact new SKU; success toasts, no navigation', async () => {
    const api = createMockApi({
      usage: BUNDLED_USAGE,
      smsAddon: SMS_ADDON_ACTIVE,
      catalogCurrent: { sku: 'sms_2500', monthlyUsd: 25 },
      addons: BASE_ADDONS.map(a => Object.assign({}, a, { purchasable: true })),
    });

    await withPage(api, async (page) => {
      await loadPortal(page, baseUrl);
      await waitForChangeRow(page);

      // The active-addon state rendered the change row with the CURRENT tier
      // preselected and the CTA dead for it (same-tier guard).
      const initial = await page.evaluate(() => {
        const sel = document.getElementById('usage-sms-change-select');
        return {
          value: sel.value,
          label: sel.options[sel.selectedIndex].textContent,
          pendingVisible: !!document.getElementById('usage-sms-change-pending'),
        };
      });
      expect(initial.value).toBe('sms_2500'); // current tier preselected
      expect(initial.label).toBe('2,500 messages — $25/mo');
      expect(initial.pendingVisible).toBe(false); // no pending request yet
      const armed0 = await ctaState(page, '#usage-sms-change-btn');
      expect(armed0.ariaDisabled).toBe('true'); // same-tier CTA is dead

      // Select a different tier — the UI reflects it and the CTA arms.
      await page.selectOption('#usage-sms-change-select', 'sms_10000');
      const picked = await page.evaluate(() => {
        const sel = document.getElementById('usage-sms-change-select');
        return { sku: sel.value, label: sel.options[sel.selectedIndex].textContent };
      });
      expect(picked.sku).toBe('sms_10000');
      expect(picked.label).toBe('10,000 messages — $100/mo');
      const armed = await ctaState(page, '#usage-sms-change-btn');
      expect(armed.ariaDisabled).toBe(null);

      await page.click('#usage-sms-change-btn');

      await waitFor(() => Promise.resolve(api.postsTo('/portal/billing/addons/change-tier').length === 1));
      const post = api.postsTo('/portal/billing/addons/change-tier')[0];
      expect(post.method).toBe('POST');
      expect(post.pathname).toBe('/portal/billing/addons/change-tier');
      expect(post.headers['x-portal-token']).toBe(ORIGIN_TOKEN);
      expect(post.body).toEqual({ sku: 'sms_10000' }); // EXACT body — nothing extra

      // Success feedback, and NO browser hand-off (this flow is approval-queued,
      // not a Stripe redirect).
      await waitFor(async () => (await toastState(page)).cls.includes('show'));
      const toast = await toastState(page);
      expect(toast.text).toBe('✓ SMS plan change requested — pending approval.');
      expect(toast.cls).toContain('success');
      expect(page.url()).toBe(baseUrl + '/portal.html');
      expect(api.postsTo('/portal/billing/addons/checkout').length).toBe(0); // no session minted
    });
  });

  test('8. change-tier 4xx: exact error surfaced, CTA reverts, no navigation, no success toast', async () => {
    const api = createMockApi({
      usage: BUNDLED_USAGE,
      smsAddon: SMS_ADDON_ACTIVE,
      catalogCurrent: { sku: 'sms_2500', monthlyUsd: 25 },
      addons: BASE_ADDONS.map(a => Object.assign({}, a, { purchasable: true })),
      changeTier: { status: 409, body: { error: 'You already have a tier change pending approval.' } },
    });

    await withPage(api, async (page) => {
      await loadPortal(page, baseUrl);
      await waitForChangeRow(page);
      await page.selectOption('#usage-sms-change-select', 'sms_10000');
      await page.click('#usage-sms-change-btn');

      await waitFor(async () => (await errState(page)).display === 'block');
      expect((await errState(page)).text).toBe('You already have a tier change pending approval.');

      const btn = await ctaState(page, '#usage-sms-change-btn');
      expect(btn.text).toBe('Update SMS Plan'); // optimistic label reverted
      expect(btn.ariaDisabled).toBe(null);
      expect(btn.cls).not.toContain('disabled');

      expect(page.url()).toBe(baseUrl + '/portal.html');
      const toast = await toastState(page);
      expect(toast.cls).not.toContain('success');
      expect(api.postsTo('/portal/billing/addons/change-tier').length).toBe(1);
    });
  });

  test('gap: a SUCCESSFUL tier change hides the SMS add-on block instead of showing the awaiting-approval note', async () => {
    // KNOWN GAP, pinned as current behaviour (the handler comment says the row
    // should reflect "awaiting approval" in place). Root cause: the success
    // path calls renderUsageSmsAddon(portalEntitlements), but portalEntitlements
    // is data.entitlements — the entitlement FLAGS object, which carries no
    // `usage` — so renderUsageSmsAddon early-returns and sets display:none on
    // the whole block. Flip this test when the success path re-renders from a
    // payload that has `usage` (then assert the pending note instead).
    const api = createMockApi({
      usage: BUNDLED_USAGE,
      smsAddon: SMS_ADDON_ACTIVE,
      catalogCurrent: { sku: 'sms_2500', monthlyUsd: 25 },
      addons: BASE_ADDONS.map(a => Object.assign({}, a, { purchasable: true })),
    });

    await withPage(api, async (page) => {
      await loadPortal(page, baseUrl);
      await waitForChangeRow(page);
      await page.selectOption('#usage-sms-change-select', 'sms_10000');
      await page.click('#usage-sms-change-btn');

      await waitFor(async () => (await toastState(page)).cls.includes('show'));
      const after = await page.evaluate(() => ({
        blockDisplay: document.getElementById('usage-sms-addon').style.display,
        pendingNote: !!document.getElementById('usage-sms-change-pending'),
      }));
      expect(after.blockDisplay).toBe('none'); // current behaviour: the block hides
      expect(after.pendingNote).toBe(false);   // the awaiting-approval note never renders
    });
  });

  // ── payment-success.html — outcome rendering ───────────────────────────────

  test('9. add-on checkout session renders the activation banner with exact amounts; onboarding surfaces hide', async () => {
    const api = createMockApi({
      checkoutSession: {
        body: {
          type: 'addon',
          addon: { name: 'SMS 5,000', messagesPerMonth: 5000, monthlyUsd: 50 },
          email: 'owner@acme.test',
        },
      },
    });

    await withPage(api, async (page, pageErrors) => {
      await page.goto(baseUrl + '/payment-success.html?session_id=cs_test_123', { waitUntil: 'load' });

      await waitFor(async () => (await page.evaluate(() =>
        document.getElementById('addon-banner').style.display)) === 'block');
      const state = await page.evaluate(() => ({
        banner: document.getElementById('addon-banner').style.display,
        desc: document.getElementById('addon-desc').textContent,
        h2: document.getElementById('success-h2').textContent,
        nextSteps: document.querySelector('.next-steps').style.display,
        spamNote: document.querySelector('.spam-note').style.display,
        emailClass: document.getElementById('email-display').className,
        emailText: document.getElementById('email-display').textContent,
        emailLabel: document.getElementById('email-label').innerHTML,
      }));
      expect(state.banner).toBe('block');
      expect(state.desc).toBe(
        'Up to 5,000 messages/mo has been added to your account ' +
        '(SMS 5,000 — $50/mo). Your new SMS allowance is active immediately — no setup needed.');
      expect(state.h2).toBe('Your SMS add-on is live');
      // Existing subscriber: no setup email / onboarding steps.
      expect(state.nextSteps).toBe('none');
      expect(state.spamNote).toBe('none');
      expect(state.emailClass).toBe('email-display');
      expect(state.emailText).toBe('owner@acme.test');
      expect(state.emailLabel).toBe('The add-on was attached to <strong>Auzora</strong> account:');

      // Exactly one lookup with the session id from the URL.
      expect(api.requestsTo('/api/checkout-session').length).toBe(1);
      expect(api.requestsTo('/api/checkout-session')[0].search).toBe('?session_id=cs_test_123');
      expect(pageErrors).toEqual([]); // no uncaught errors on the money surface
    });
  });

  test('10. plan checkout session keeps the onboarding path and shows the buyer email', async () => {
    const api = createMockApi({
      checkoutSession: { body: { email: 'owner@acme.test' } }, // no type:'addon'
    });

    await withPage(api, async (page) => {
      await page.goto(baseUrl + '/payment-success.html?session_id=cs_test_plan', { waitUntil: 'load' });

      await waitFor(async () => (await page.evaluate(() =>
        document.getElementById('email-display').className)) === 'email-display');
      const state = await page.evaluate(() => ({
        banner: getComputedStyle(document.getElementById('addon-banner')).display,
        h2: document.getElementById('success-h2').textContent,
        nextSteps: document.querySelector('.next-steps').style.display,
        emailText: document.getElementById('email-display').textContent,
        emailLabel: document.getElementById('email-label').innerHTML,
      }));
      expect(state.banner).toBe('none'); // plan checkouts: no add-on banner (class default)
      expect(state.h2).toContain('setup link');
      expect(state.nextSteps).not.toBe('none');
      expect(state.emailText).toBe('owner@acme.test');
      expect(state.emailLabel).toBe('A setup link has been sent to <strong>Auzora</strong> at:');
    });
  });

  test('11. checkout-session lookup fails (5xx / network): page stays recoverable — no crash, no add-on banner, no success claim', async () => {
    // (a) 5xx with a non-JSON body (res.json() throws → catch branch).
    const api500 = createMockApi({ checkoutSession: { status: 500, raw: true } });
    await withPage(api500, async (page, pageErrors) => {
      await page.goto(baseUrl + '/payment-success.html?session_id=cs_test_err', { waitUntil: 'load' });
      await waitFor(async () => (await page.evaluate(() =>
        document.getElementById('email-display').style.display)) === 'none');
      const state = await page.evaluate(() => ({
        h1: document.querySelector('.success-header h1').textContent,
        banner: getComputedStyle(document.getElementById('addon-banner')).display,
        email: document.getElementById('email-display').style.display,
      }));
      // The page still renders (recoverable) but claims nothing add-on-specific.
      expect(state.h1).toBe('Payment Confirmed');
      expect(state.banner).toBe('none');
      expect(state.email).toBe('none');
      expect(pageErrors).toEqual([]);
    });

    // (b) network failure — same recoverable outcome.
    const apiAbort = createMockApi({ checkoutSession: { abort: true } });
    await withPage(apiAbort, async (page, pageErrors) => {
      await page.goto(baseUrl + '/payment-success.html?session_id=cs_test_err', { waitUntil: 'load' });
      await waitFor(async () => (await page.evaluate(() =>
        document.getElementById('email-display').style.display)) === 'none');
      const state = await page.evaluate(() => ({
        banner: getComputedStyle(document.getElementById('addon-banner')).display,
        email: document.getElementById('email-display').style.display,
      }));
      expect(state.banner).toBe('none');
      expect(state.email).toBe('none');
      expect(pageErrors).toEqual([]);
    });
  });

  test('12. payment-success.html without a session_id never calls the lookup API', async () => {
    const api = createMockApi();

    await withPage(api, async (page) => {
      await page.goto(baseUrl + '/payment-success.html', { waitUntil: 'load' });
      await page.waitForTimeout(300); // give any (wrong) fetch a chance to fire
      expect(api.requestsTo('/api/checkout-session').length).toBe(0);
      expect(await page.evaluate(() => document.getElementById('email-display').style.display)).toBe('none');
    });
  });

  // ── portal checkout return — ?checkout=cancelled|success ───────────────────

  test('13. cancelled checkout return: not-charged error toast, NEVER a success state, URL cleaned (no re-toast on reload)', async () => {
    const api = createMockApi({ usage: PLAN_ONLY_USAGE });

    await withPage(api, async (page) => {
      // Mirrors atlas-ai's cancel_url shape: /portal?checkout=cancelled&addon=<sku>
      // Single navigation: loadPortal() would re-goto /portal.html WITHOUT the
      // query and wipe the param before the toast can be asserted.
      await page.goto(baseUrl + '/portal.html?checkout=cancelled&addon=sms_5000', { waitUntil: 'domcontentloaded' });
      await waitFor(() => page.evaluate(() => {
        const t = document.getElementById('usage-voice-tally');
        return !!t && t.textContent.trim().length > 0;
      }));

      await waitFor(async () => (await toastState(page)).text.includes('cancelled'));
      const toast = await toastState(page);
      expect(toast.text).toBe('✗ SMS add-on checkout cancelled — you were not charged.');
      expect(toast.cls).toContain('error');
      expect(toast.cls).not.toContain('success');

      // The URL was cleaned so a refresh does not re-toast.
      expect(page.url()).toBe(baseUrl + '/portal.html');

      // The reload (now param-free) must NOT toast again.
      await page.reload({ waitUntil: 'domcontentloaded' });
      await waitFor(() => page.evaluate(() => {
        const t = document.getElementById('usage-voice-tally');
        return !!t && t.textContent.trim().length > 0;
      }));
      const after = await toastState(page);
      expect(after.text).toBe(''); // no re-toast
      expect(after.cls).not.toContain('success');
    });
  });

  test('14. successful checkout return: pending-approval confirmation toast, URL cleaned', async () => {
    const api = createMockApi({ usage: PLAN_ONLY_USAGE });

    await withPage(api, async (page) => {
      // Mirrors atlas-ai's success_url shape:
      // /portal?checkout=success&addon=<sku>&session_id=<cs>
      // Single navigation — see test 13 (a re-goto would wipe the query).
      await page.goto(baseUrl + '/portal.html?checkout=success&addon=sms_5000&session_id=cs_test_9', { waitUntil: 'domcontentloaded' });
      await waitFor(() => page.evaluate(() => {
        const t = document.getElementById('usage-voice-tally');
        return !!t && t.textContent.trim().length > 0;
      }));

      await waitFor(async () => (await toastState(page)).text.includes('Payment received'));
      const toast = await toastState(page);
      expect(toast.text).toBe('✓ Payment received — your SMS add-on is pending approval.');
      expect(toast.cls).toContain('success');
      expect(page.url()).toBe(baseUrl + '/portal.html');
    });
  });
});
