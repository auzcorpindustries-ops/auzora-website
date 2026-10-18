// test/pricing-signup-browser.test.js — BROWSER-LEVEL tests for the landing
// page's signup CTA. This is the MONEY PATH: index.html's pricing cards POST
// { plan, sms_sku } to atlas-ai's /api/billing/signup-checkout and hand the
// browser to the Stripe session the API returns.
//
// WHY THIS FILE EXISTS
// SIGNUP-BUNDLE (34e47f5) turned the three plan CTAs from Stripe Payment-Link
// anchors into <button id="az-plan-cta-<plan>"> that mint a Checkout Session
// server-side, deleted the standalone "Add SMS" purchase button, and made each
// card's SMS row a BUNDLE dropdown that feeds the CTA (updateSmsTotal). The
// only in-repo coverage was test/stripe-links.test.js, which string-matches
// index.html source. Nothing rendered the page, so a renamed id, an unbound
// change handler, a dropdown that never recomputes the combined total, a click
// that never fires the POST, or a broken inline failure path all shipped green.
//
// This suite drives a REAL Chromium (Playwright) against the real index.html
// served off the working tree, with the signup API mocked at the network layer
// (including the CORS preflight a cross-origin JSON POST triggers), so it runs
// offline and deterministically. It proves, in the browser:
//   1. selecting a plan reveals that card's SMS row + arms its CTA, and picking
//      an SMS tier recomputes the combined monthly total in the DOM;
//   2. clicking the CTA sends a genuine POST whose body is exactly
//      { plan, sms_sku } — to the API base that window.STRIPE_LINK_MODE picks
//      (test -> atlas-staging, live -> prod), asserted for BOTH variants;
//   3. an UNSELECTED plan's CTA mints nothing (the aria-disabled gate is real);
//   4. a successful mint navigates the page to the returned url;
//   5. a failed mint (non-200, and 200-without-url) surfaces the inline error
//      and does NOT navigate, leaving the CTA usable again.
//
// Playwright is the driver. It is declared in devDependencies; for a checkout
// where it is not installed the suite SKIPS with a loud message rather than
// failing (auzora-website has no CI job that would install it).

'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const { URL } = require('url');

// Chromium + page load is well over jest's 5s default.
jest.setTimeout(120000);

const repoRoot = path.join(__dirname, '..');

// ── Playwright resolution ────────────────────────────────────────────────────
// Prefer a normally-installed devDependency; fall back to the sibling atlas-ai
// install (same org, browsers already cached) for a local run without an
// `npm install` in this repo.
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

// A module that loads is not enough — the Chromium build has to be on disk too.
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
    '\n[pricing-signup-browser] SKIPPING the landing signup-CTA browser smoke — ' +
    (chromium ? 'Playwright is installed but its Chromium build is not.\n' : 'Playwright is not installed.\n') +
    '  Install with:  npm i -D playwright && npx playwright install chromium\n' +
    '  (or point PLAYWRIGHT_PKG at an existing playwright install).\n'
  );
}

const describeBrowser = browserReady ? describe : describe.skip;

// ── The contract under test (mirrored from index.html) ───────────────────────
const SIGNUP_PATH = '/api/billing/signup-checkout';
const API_HOST = { test: 'atlas-staging.6845165.xyz', live: 'atlas.6845165.xyz' };
const SIGNUP_BASE = { test: 'https://atlas-staging.6845165.xyz', live: 'https://atlas.6845165.xyz' };
const CHECKOUT_RETURN_URL = 'https://checkout.stripe.com/c/pay/cs_test_browser_smoke_abc123';
const FAILURE_COPY = 'We could not start checkout just now. Please try again.';

const MODES = [
  { mode: 'test', label: 'test mode (develop deploy -> staging API)', base: SIGNUP_BASE.test, host: API_HOST.test },
  { mode: 'live', label: 'live mode (production -> prod API)', base: SIGNUP_BASE.live, host: API_HOST.live },
];

// A cross-origin POST with Content-Type: application/json is not a CORS
// "simple" request: Chromium sends an OPTIONS preflight first. The mock has to
// answer it or the real POST never leaves the browser.
const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

// ── Static file server (serves the working tree) ─────────────────────────────
function startStaticServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      let pathname;
      try { pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname); }
      catch (e) { res.writeHead(400); res.end('bad url'); return; }
      const rel = pathname === '/' || pathname === '/index' ? '/index.html' : pathname;
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
        '.mp3': 'audio/mpeg',
      }[path.extname(file)] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': ct });
      fs.createReadStream(file).pipe(res);
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

// ── Mock signup API (stateful; drives the network layer) ─────────────────────
function createMockApi(opts) {
  const o = opts || {};
  let origin = null; // set once the static server is listening
  return {
    setOrigin(v) { origin = v; },
    signupStatus: o.signupStatus === undefined ? 200 : o.signupStatus,
    signupBody: o.signupBody === undefined ? { url: CHECKOUT_RETURN_URL } : o.signupBody,
    requests: [],

    isStatic(url) { return !!origin && url.origin === origin; },
    isApiHost(hostname) { return hostname === API_HOST.test || hostname === API_HOST.live; },

    dispatch(method, url, headers, rawBody) {
      let body = null;
      if (rawBody) { try { body = JSON.parse(rawBody); } catch (e) { body = rawBody; } }
      const lower = {};
      Object.keys(headers || {}).forEach(k => { lower[k.toLowerCase()] = headers[k]; });
      const record = {
        method,
        url: url.origin + url.pathname,
        hostname: url.hostname,
        pathname: url.pathname,
        headers: lower,
        body,
      };
      this.requests.push(record);

      if (url.pathname === SIGNUP_PATH) {
        if (method === 'OPTIONS') return { status: 200, body: {} }; // CORS preflight
        if (this.signupStatus >= 400) {
          return { status: this.signupStatus, body: { error: 'session mint rejected' } };
        }
        return { status: 200, body: this.signupBody };
      }
      // Anything else the landing page might ask the API host for.
      return { status: 200, body: {} };
    },

    signupPosts() { return this.requests.filter(r => r.method === 'POST' && r.pathname === SIGNUP_PATH); },
    requestsToHost(hostname) { return this.requests.filter(r => r.hostname === hostname); },
  };
}

// Intercept every request the page makes: let the local static server through,
// answer the atlas API hosts with the mock (CORS headers included), and stub
// the third-party CDNs (fonts, CRM logo images, voice-preview audio) so the
// offline page still renders and nothing stalls.
async function installNetwork(page, api) {
  await page.route('**/*', (route) => {
    const req = route.request();
    const url = new URL(req.url());

    if (api.isStatic(url)) return route.continue();

    if (api.isApiHost(url.hostname)) {
      const r = api.dispatch(req.method(), url, req.headers(), req.postData());
      return route.fulfill({
        status: r.status,
        headers: Object.assign({ 'content-type': 'application/json' }, CORS_HEADERS),
        body: JSON.stringify(r.body),
      });
    }

    // The success path hands the browser to Stripe — stand in for it so the
    // navigation is observable (page.url() === the url the API returned).
    if (req.resourceType() === 'document') {
      return route.fulfill({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: '<!doctype html><title>Stripe Checkout</title><p id="stripe-checkout">stubbed checkout</p>',
      });
    }
    if (/(^|\.)googleapis\.com$/.test(url.hostname) || /(^|\.)gstatic\.com$/.test(url.hostname)) {
      return route.fulfill({ status: 200, contentType: 'text/css', body: '' });
    }
    if (req.resourceType() === 'image') {
      return route.fulfill({ status: 200, contentType: 'image/png', body: '' });
    }
    if (req.resourceType() === 'media') {
      return route.fulfill({ status: 200, contentType: 'audio/mpeg', body: '' });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
}

async function waitFor(fn, timeoutMs = 15000) {
  const start = Date.now();
  for (;;) {
    if (await fn()) return undefined;
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise(r => setTimeout(r, 60));
  }
}

// ── Suite ────────────────────────────────────────────────────────────────────
describeBrowser('landing signup CTA (money path) — browser-level smoke', () => {
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

  // `mode` selects the window.STRIPE_LINK_MODE netlify.toml injects at build
  // time: 'test' for the develop context, undefined/'live' for production.
  async function withPage(api, mode, fn) {
    api.setOrigin(baseUrl);
    const page = await browser.newPage({ viewport: { width: 1280, height: 1200 } });
    try {
      if (mode === 'test') {
        await page.addInitScript(() => { window.STRIPE_LINK_MODE = 'test'; });
      }
      await installNetwork(page, api);
      return await fn(page);
    } finally {
      await page.close();
    }
  }

  async function loadPricing(page) {
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await waitFor(async () => page.evaluate(() => !!document.getElementById('az-plan-cta-basic')));
  }

  function totalText(page, plan) {
    return page.evaluate((p) => document.getElementById('az-sms-total-' + p).textContent.trim(), plan);
  }

  function cardState(page, plan) {
    return page.evaluate((p) => {
      const card = document.querySelector('.az-pricing-card[data-plan="' + p + '"]');
      const row = document.querySelector('.az-card-sms[data-sms-row="' + p + '"]');
      const cta = document.getElementById('az-plan-cta-' + p);
      const sel = card.querySelector('.az-plan-select');
      return {
        ariaSelected: card.getAttribute('aria-selected'),
        rowHidden: row.hidden,
        rowDisplay: getComputedStyle(row).display,
        ctaAriaDisabled: cta.getAttribute('aria-disabled'),
        ctaText: cta.textContent.trim(),
        ctaBusy: cta.hasAttribute('aria-busy'),
        ctaClassName: cta.className,
        selectPressed: sel.getAttribute('aria-pressed'),
        selectText: sel.textContent.trim(),
      };
    }, plan);
  }

  test('1. selecting a plan reveals its SMS row and picking a tier recomputes the combined total', async () => {
    const api = createMockApi();

    await withPage(api, 'test', async (page) => {
      await loadPricing(page);

      // Cold load: nothing selected, no card's SMS row visible, every CTA gated.
      const cold = await cardState(page, 'basic');
      expect(cold.ariaSelected).toBe('false');
      expect(cold.rowHidden).toBe(true);
      expect(cold.ctaAriaDisabled).toBe('true');
      expect(cold.selectPressed).toBe('false');
      expect(cold.selectText).toBe('Select');
      expect(await totalText(page, 'basic')).toBe('$299/mo — no SMS add-on');

      // Select Basic -> its row is revealed and its CTA is armed.
      await page.click('.az-plan-select[data-plan="basic"]');
      await waitFor(async () => (await cardState(page, 'basic')).ariaSelected === 'true');

      const selected = await cardState(page, 'basic');
      expect(selected.rowHidden).toBe(false);
      expect(selected.rowDisplay).not.toBe('none');
      expect(selected.ctaAriaDisabled).toBe(null);
      expect(selected.selectPressed).toBe('true');
      expect(selected.selectText).toBe('Selected');

      // The OTHER cards are untouched — exactly one SMS row is ever open.
      const otherStandard = await cardState(page, 'standard');
      const otherEnterprise = await cardState(page, 'enterprise');
      expect(otherStandard.rowHidden).toBe(true);
      expect(otherStandard.ctaAriaDisabled).toBe('true');
      expect(otherEnterprise.rowHidden).toBe(true);
      expect(otherEnterprise.ctaAriaDisabled).toBe('true');

      // The dropdown is wired to the total: 5,000 / 10,000 / back to plan-only.
      await page.selectOption('#az-sms-select-basic', { value: 'sms_5000' });
      await waitFor(async () => (await totalText(page, 'basic')) === '$299 plan + $50 SMS = $349/mo');
      expect(await totalText(page, 'basic')).toBe('$299 plan + $50 SMS = $349/mo');

      await page.selectOption('#az-sms-select-basic', { value: 'sms_10000' });
      await waitFor(async () => (await totalText(page, 'basic')) === '$299 plan + $100 SMS = $399/mo');
      expect(await totalText(page, 'basic')).toBe('$299 plan + $100 SMS = $399/mo');

      await page.selectOption('#az-sms-select-basic', { value: '' });
      await waitFor(async () => (await totalText(page, 'basic')) === '$299/mo — no SMS add-on');
      expect(await totalText(page, 'basic')).toBe('$299/mo — no SMS add-on');

      // Moving to another plan moves the row AND re-derives that plan's total
      // from ITS OWN dropdown (Basic's 10,000-tier pick must not leak).
      await page.selectOption('#az-sms-select-basic', { value: 'sms_10000' });
      await waitFor(async () => (await totalText(page, 'basic')) === '$299 plan + $100 SMS = $399/mo');

      await page.click('.az-plan-select[data-plan="standard"]');
      await waitFor(async () => (await cardState(page, 'standard')).ariaSelected === 'true');
      expect((await cardState(page, 'basic')).rowHidden).toBe(true);
      expect(await totalText(page, 'standard')).toBe('$499/mo — no SMS add-on');

      await page.selectOption('#az-sms-select-standard', { value: 'sms_2500' });
      await waitFor(async () => (await totalText(page, 'standard')) === '$499 plan + $25 SMS = $524/mo');
      expect(await totalText(page, 'standard')).toBe('$499 plan + $25 SMS = $524/mo');

      // Selecting / pricing out a bundle never mints anything by itself.
      expect(api.signupPosts().length).toBe(0);
    });
  });

  MODES.forEach(({ mode, label, base, host }) => {
    test('2. ' + label + ' — the CTA POSTs exactly { plan, sms_sku } to ' + base, async () => {
      const api = createMockApi();
      const otherHost = mode === 'test' ? API_HOST.live : API_HOST.test;

      await withPage(api, mode, async (page) => {
        await loadPricing(page);

        // (a) The gate is real: an UNSELECTED plan's CTA mints nothing.
        await page.evaluate(() => document.getElementById('az-plan-cta-enterprise').click());
        await new Promise(r => setTimeout(r, 250));
        expect(api.signupPosts().length).toBe(0);

        // (b) Select Standard + a 10,000 SMS bundle, then click the real CTA.
        await page.click('.az-plan-select[data-plan="standard"]');
        await waitFor(async () => (await cardState(page, 'standard')).ariaSelected === 'true');
        await page.selectOption('#az-sms-select-standard', { value: 'sms_10000' });
        await waitFor(async () => (await totalText(page, 'standard')) === '$499 plan + $100 SMS = $599/mo');

        await page.click('#az-plan-cta-standard');
        await waitFor(() => api.signupPosts().length === 1);

        const post = api.signupPosts()[0];
        expect(post.method).toBe('POST');
        expect(post.pathname).toBe(SIGNUP_PATH);
        // The base follows window.STRIPE_LINK_MODE — exactly one variant.
        expect(post.url).toBe(base + SIGNUP_PATH);
        expect(post.hostname).toBe(host);
        expect(post.headers['content-type']).toContain('application/json');
        // The body is EXACTLY the contract: plan + the dropdown's SKU.
        expect(post.body).toEqual({ plan: 'standard', sms_sku: 'sms_10000' });
        // The other mode's API host is never contacted.
        expect(api.requestsToHost(otherHost).length).toBe(0);
      });
    });
  });

  test('3. plan-only checkout posts { plan } with no sms_sku key', async () => {
    const api = createMockApi();

    await withPage(api, 'live', async (page) => {
      await loadPricing(page);

      await page.click('.az-plan-select[data-plan="enterprise"]');
      await waitFor(async () => (await cardState(page, 'enterprise')).ariaSelected === 'true');

      // Dropdown left on "No SMS add-on — plan only".
      await page.selectOption('#az-sms-select-enterprise', { value: '' });
      expect(await totalText(page, 'enterprise')).toBe('$899/mo — no SMS add-on');

      await page.click('#az-plan-cta-enterprise');
      await waitFor(() => api.signupPosts().length === 1);

      const post = api.signupPosts()[0];
      expect(post.url).toBe(SIGNUP_BASE.live + SIGNUP_PATH);
      expect(post.body).toEqual({ plan: 'enterprise' });
      expect(Object.keys(post.body)).toEqual(['plan']);
    });
  });

  test('4. a successful mint navigates the page to the returned checkout url', async () => {
    const api = createMockApi(); // default: 200 { url: CHECKOUT_RETURN_URL }

    await withPage(api, 'test', async (page) => {
      await loadPricing(page);

      await page.click('.az-plan-select[data-plan="basic"]');
      await waitFor(async () => (await cardState(page, 'basic')).ariaSelected === 'true');
      await page.selectOption('#az-sms-select-basic', { value: 'sms_5000' });
      await waitFor(async () => (await totalText(page, 'basic')) === '$299 plan + $50 SMS = $349/mo');

      await page.click('#az-plan-cta-basic');
      await page.waitForURL(CHECKOUT_RETURN_URL, { timeout: 20000 });

      // The browser really left the landing page for the minted session url.
      expect(page.url()).toBe(CHECKOUT_RETURN_URL);
      expect(await page.evaluate(() => !!document.getElementById('stripe-checkout'))).toBe(true);
      // …and the failure path never ran on the way out.
      expect(await page.evaluate(() => !!document.getElementById('pricing'))).toBe(false);

      expect(api.signupPosts().length).toBe(1);
      expect(api.signupPosts()[0].body).toEqual({ plan: 'basic', sms_sku: 'sms_5000' });
    });
  });

  test('5. a non-200 mint surfaces the inline error, restores the CTA and does NOT navigate', async () => {
    const api = createMockApi({ signupStatus: 502, signupBody: { error: 'stripe unavailable' } });

    await withPage(api, 'test', async (page) => {
      await loadPricing(page);

      await page.click('.az-plan-select[data-plan="standard"]');
      await waitFor(async () => (await cardState(page, 'standard')).ariaSelected === 'true');
      const urlBefore = page.url();

      await page.click('#az-plan-cta-standard');
      await waitFor(() => api.signupPosts().length === 1);
      await waitFor(async () => page.evaluate(() =>
        document.getElementById('az-sms-error-standard').hidden === false));

      // The failure is surfaced ON THE PAGE, not swallowed.
      const err = await page.evaluate(() => {
        const el = document.getElementById('az-sms-error-standard');
        return { text: el.textContent.trim(), hidden: el.hidden, display: getComputedStyle(el).display };
      });
      expect(err.text).toBe(FAILURE_COPY);
      expect(err.hidden).toBe(false);
      expect(err.display).not.toBe('none');

      // NO navigation — the buyer stays on the pricing section.
      expect(page.url()).toBe(urlBefore);

      // The CTA is usable again (not stuck on "Starting checkout…").
      const cta = await cardState(page, 'standard');
      expect(cta.ctaText).toBe('Get started with Standard');
      expect(cta.ctaBusy).toBe(false);
      expect(cta.ctaClassName).not.toMatch(/\bdisabled\b/);
      expect(cta.ctaAriaDisabled).toBe(null);
    });
  });

  test('6. a 200 mint with no url fails closed: inline error, no navigation', async () => {
    const api = createMockApi({ signupBody: {} }); // 200 but no session url

    await withPage(api, 'test', async (page) => {
      await loadPricing(page);

      await page.click('.az-plan-select[data-plan="basic"]');
      await waitFor(async () => (await cardState(page, 'basic')).ariaSelected === 'true');
      const urlBefore = page.url();

      await page.click('#az-plan-cta-basic');
      await waitFor(() => api.signupPosts().length === 1);
      await waitFor(async () => page.evaluate(() =>
        document.getElementById('az-sms-error-basic').hidden === false));

      expect(await page.evaluate(() => document.getElementById('az-sms-error-basic').textContent.trim()))
        .toBe(FAILURE_COPY);
      expect(page.url()).toBe(urlBefore);
      expect(await cardState(page, 'basic')).toMatchObject({
        ctaText: 'Get started with Basic',
        ctaBusy: false,
      });
    });
  });
});
