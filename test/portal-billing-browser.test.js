// test/portal-billing-browser.test.js — BROWSER-LEVEL smoke for the portal's
// billing / entitlement UI (ticket zeus_1791713110566_dfb175c7, QA weekly audit).
//
// WHY THIS FILE EXISTS
// portal.html ships money-handling UI — the Plan & Usage card's per-kind
// included/overage tallies ("Allow overages" toggles, OVERAGE-UI 4/5 → PATCH
// /portal/usage/overage, OVERAGE-ENFORCE 1/5), the SMS add-on block and its
// Checkout-Session CTA (SMS-CHECKOUT-FIX), and the admin SMS approval queue.
// Until now the only coverage was STRING-MATCHING: test/portal-overage-ui.test.js
// reads portal.html, slices out the inline <script>, brace-matches individual
// functions and calls them. Nothing RENDERED the page, so a renamed id, an
// unbound change handler, or a toggle default that disagrees with the persisted
// per-kind pref shipped green.
//
// This suite drives a REAL Chromium (Playwright) against the real portal.html
// served off the working tree, with the portal API mocked at the network layer
// so it runs offline and deterministically. It proves the four things the audit
// asked for:
//   1. an authenticated portal load renders the app (and the auth gate is real);
//   2. the Plan & Usage card renders included/overage tallies that match the
//      /portal/entitlements payload the page received;
//   3. each per-kind "Allow overages" checkbox reflects the STORED pref, sends
//      exactly ONE kind in a real PATCH, and survives a reload;
//   4. a FAILED PATCH reverts the checkbox (the UI never misreports enforcement).
//
// The mock is a stateful handler on `page.route`, so the PATCH is a genuine
// browser request (method/headers/body asserted off the intercepted request)
// and `page.reload()` re-reads the value the write stored.
//
// Playwright is the driver. It is declared in devDependencies; for a checkout
// where it is not installed yet the suite SKIPS with a loud message rather than
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

// A module that loads is not enough — the Chromium build has to be on disk too
// (a fresh `npm install` gets the driver, `npx playwright install chromium`
// gets the browser). Treat either gap as "skip", not "fail": auzora-website has
// no CI job that would install it, and an absent browser must not turn the
// suite red.
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
    '\n[portal-billing-browser] SKIPPING the portal billing browser smoke — ' +
    (chromium ? 'Playwright is installed but its Chromium build is not.\n' : 'Playwright is not installed.\n') +
    '  Install with:  npm i -D playwright && npx playwright install chromium\n' +
    '  (or point PLAYWRIGHT_PKG at an existing playwright install).\n'
  );
}

const describeBrowser = browserReady ? describe : describe.skip;

// ── Shared fixtures ──────────────────────────────────────────────────────────
const ORIGIN_TOKEN = 'browser-smoke-portal-token';

// One capped Standard plan mid-period, over on voice and over on SMS.
// Invariant (OVERAGE-TRACK 2/5): included + overage === total, per kind.
const BASE_USAGE = {
  voiceMinutes: 1280,
  smsMessages: 30,
  limits: { voiceMinutes: 2500, smsMessages: 0 },
  percentUsed: { voice: 51, sms: 0 },
  period: '2026-10',
  unlimited: false,
  included: { voice: 1250, sms: 0 },
  overage: { voice: 30, sms: 30 },
};

const CLIENT = {
  business_name: 'Acme Browser Smoke Co',
  tutorial_completed: true, // suppress the first-run tutorial overlay
  webhook_url: '',
};

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

// ── Mock portal API (stateful; drives the network layer) ─────────────────────
function createMockApi(opts) {
  const o = opts || {};
  let origin = null; // set once the static server is listening
  return {
    setOrigin(v) { origin = v; },
    // stored per-kind preference — the value enforcement would read back
    liveOverages: Object.assign({ voice: false, sms: false }, o.overages || {}),
    patchStatus: o.patchStatus || 200,
    baseUsage: o.usage || BASE_USAGE,
    addons: o.addons !== undefined ? o.addons : [
      { sku: 'sms_5000', smsMessages: 5000, monthlyUsd: 50, purchasable: true, current: false },
    ],
    requests: [],

    isStatic(url) {
      return origin && url.origin === origin;
    },

    entitlementsPayload() {
      return {
        plan: o.plan || 'Standard',
        tier: o.tier || '',
        usage: Object.assign({}, this.baseUsage, { allowOverage: Object.assign({}, this.liveOverages) }),
        allow_overage: Object.assign({}, this.liveOverages),
      };
    },

    dispatch(method, pathname, headers, rawBody) {
      let body = null;
      if (rawBody) { try { body = JSON.parse(rawBody); } catch (e) { body = rawBody; } }
      const lower = {};
      Object.keys(headers || {}).forEach(k => { lower[k.toLowerCase()] = headers[k]; });
      const record = { method, pathname, headers: lower, body };
      this.requests.push(record);

      if (method === 'GET' && pathname === '/portal/entitlements') {
        return { status: 200, body: this.entitlementsPayload() };
      }
      if (method === 'PATCH' && pathname === '/portal/usage/overage') {
        if (this.patchStatus >= 400) {
          return { status: this.patchStatus, body: { error: 'overage write rejected' } };
        }
        const parsed = body && typeof body === 'object' ? body : {};
        ['voice', 'sms'].forEach(k => {
          if (typeof parsed[k] === 'boolean') this.liveOverages[k] = parsed[k];
        });
        return { status: 200, body: { allow_overage: Object.assign({}, this.liveOverages) } };
      }
      if (method === 'GET' && pathname === '/portal/billing/addons') {
        return { status: 200, body: { addons: this.addons, current: null } };
      }
      // Everything else the dashboard boot fans out to (appointments, leads,
      // summary, square status, intake token, …) — empty but valid JSON.
      return { status: 200, body: {} };
    },

    patchRequests() {
      return this.requests.filter(r => r.method === 'PATCH' && r.pathname === '/portal/usage/overage');
    },
  };
}

// Intercept every request the page makes: let the local static server through,
// answer /portal|/api with the mock, and stub third-party CDNs (the page loads
// lucide + Google Fonts; offline that must not stall the render).
async function installNetwork(page, api) {
  await page.route('**/*', (route) => {
    const req = route.request();
    const url = new URL(req.url());

    if (api.isStatic(url)) return route.continue();

    if (url.pathname.startsWith('/portal/') || url.pathname.startsWith('/api/')) {
      const r = api.dispatch(req.method(), url.pathname, req.headers(), req.postData());
      return route.fulfill({
        status: r.status,
        contentType: 'application/json',
        body: JSON.stringify(r.body),
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

async function waitFor(fn, timeoutMs = 15000) {
  const start = Date.now();
  for (;;) {
    if (await fn()) return undefined;
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise(r => setTimeout(r, 60));
  }
}

// Load the portal and wait until the entitlements-driven usage card has painted.
async function loadPortal(page, baseUrl) {
  await page.goto(baseUrl + '/portal.html', { waitUntil: 'domcontentloaded' });
  await waitFor(async () => page.evaluate(() => {
    const t = document.getElementById('usage-voice-tally');
    return !!t && t.textContent.trim().length > 0;
  }));
}

// ── Suite ────────────────────────────────────────────────────────────────────
describeBrowser('portal billing / entitlement UI — browser-level smoke', () => {
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
    try {
      await installNetwork(page, api);
      await seedAuth(page);
      return await fn(page);
    } finally {
      await page.close();
    }
  }

  test('1. authenticated portal load renders the app behind the auth gate', async () => {
    const api = createMockApi();

    // (a) authenticated: a seeded session boots straight into the portal.
    await withPage(api, async (page) => {
      await loadPortal(page, baseUrl);

      const authed = await page.evaluate(() => ({
        loginDisplay: document.getElementById('login-screen').style.display,
        appDisplay: document.getElementById('app').style.display,
        sidebarBiz: document.getElementById('sidebar-biz').textContent.trim(),
        hasDashNav: !!document.getElementById('nav-dashboard'),
      }));
      expect(authed.appDisplay).toBe('block');
      expect(authed.loginDisplay).toBe('none');
      expect(authed.sidebarBiz).toBe(CLIENT.business_name);
      expect(authed.hasDashNav).toBe(true);
    });

    // (b) the gate is real: the SAME page with no seeded session does not render
    //     the app — otherwise (a) would pass against a page that ignores auth.
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    try {
      const unauthApi = createMockApi();
      unauthApi.setOrigin(baseUrl);
      await installNetwork(page, unauthApi);
      await page.goto(baseUrl + '/portal.html', { waitUntil: 'domcontentloaded' });
      const unauth = await page.evaluate(() => ({
        loginVisible: getComputedStyle(document.getElementById('login-screen')).display !== 'none',
        appDisplay: getComputedStyle(document.getElementById('app')).display,
      }));
      expect(unauth.loginVisible).toBe(true);
      expect(unauth.appDisplay).toBe('none');
    } finally {
      await page.close();
    }
  });

  test('2. Plan & Usage card renders included/overage tallies from the API payload', async () => {
    const api = createMockApi({ usage: BASE_USAGE });

    await withPage(api, async (page) => {
      await loadPortal(page, baseUrl);

      const rendered = await page.evaluate(() => ({
        cardDisplay: document.getElementById('usage-card').style.display,
        voiceTally: document.getElementById('usage-voice-tally').textContent.trim(),
        smsTally: document.getElementById('usage-sms-tally').textContent.trim(),
        planBadge: document.getElementById('usage-plan-badge').textContent.trim(),
      }));

      // The card is actually shown (not the markup default of display:none).
      expect(rendered.cardDisplay).toBe('block');
      expect(rendered.planBadge).toBe('Standard');

      // Tallies are read off usage.included / usage.overage — assert the exact
      // strings the payload implies, per kind.
      expect(rendered.voiceTally).toBe('Included 1,250 · Overage 30');
      expect(rendered.smsTally).toBe('Included 0 · Overage 30');

      // The page did fetch the entitlement payload over the network first.
      const got = api.requests.filter(r => r.method === 'GET' && r.pathname === '/portal/entitlements');
      expect(got.length).toBeGreaterThan(0);
      expect(got[0].headers['x-portal-token']).toBe(ORIGIN_TOKEN);
    });
  });

  test('3. each per-kind "Allow overages" checkbox reflects and persists the stored pref', async () => {
    const api = createMockApi({ usage: BASE_USAGE, overages: { voice: true, sms: false } });

    await withPage(api, async (page) => {
      await loadPortal(page, baseUrl);

      // Reflects the STORED pref on first paint (voice on, sms off) — a toggle
      // default that disagreed with the persisted pref would fail here.
      expect(await page.isChecked('#usage-voice-overage')).toBe(true);
      expect(await page.isChecked('#usage-sms-overage')).toBe(false);

      // One real user click on the SMS toggle.
      await page.click('#usage-sms-overage');

      await waitFor(() => api.patchRequests().length === 1);
      const patch = api.patchRequests()[0];

      // The request is a genuine PATCH round trip: real method, real endpoint,
      // portal token header, and a body carrying EXACTLY the toggled kind.
      expect(patch.method).toBe('PATCH');
      expect(patch.pathname).toBe('/portal/usage/overage');
      expect(patch.headers['x-portal-token']).toBe(ORIGIN_TOKEN);
      expect(patch.body).toEqual({ sms: true });

      // Reload: the persisted value comes back from the API, and the checkbox
      // must render it — i.e. the write really stuck.
      await page.reload({ waitUntil: 'domcontentloaded' });
      await waitFor(async () => page.evaluate(() => {
        const t = document.getElementById('usage-voice-tally');
        return !!t && t.textContent.trim().length > 0;
      }));
      expect(await page.isChecked('#usage-sms-overage')).toBe(true);
      expect(await page.isChecked('#usage-voice-overage')).toBe(true); // untouched kind
    });
  });

  test('4. a failed PATCH reverts the checkbox and reports the failure', async () => {
    const api = createMockApi({
      usage: BASE_USAGE,
      overages: { voice: false, sms: false },
      patchStatus: 500,
    });

    await withPage(api, async (page) => {
      await loadPortal(page, baseUrl);
      expect(await page.isChecked('#usage-voice-overage')).toBe(false);

      // Click it "on" — the browser flips it, the PATCH 500s, the handler must
      // put it back so the UI never misreports what enforcement is doing.
      await page.click('#usage-voice-overage');
      await waitFor(() => api.patchRequests().length === 1);

      await waitFor(async () => (await page.isChecked('#usage-voice-overage')) === false);
      expect(await page.isChecked('#usage-voice-overage')).toBe(false);

      const toast = await page.evaluate(() => {
        const t = document.getElementById('toast');
        return { text: t.textContent, cls: t.className };
      });
      expect(toast.text).toContain('Could not save the overage preference');
      expect(toast.cls).toContain('error');
    });
  });

  test('5. rate + firm-cap microcopy renders per section and toggles with the checkbox (both themes)', async () => {
    const api = createMockApi({ usage: BASE_USAGE, overages: { voice: false, sms: true } });

    await withPage(api, async (page) => {
      await loadPortal(page, baseUrl);

      // The rate line (billing consequence) is EXACT and always present, per kind.
      const rates = await page.evaluate(() => ({
        voice: document.getElementById('usage-voice-rate').textContent.trim(),
        sms: document.getElementById('usage-sms-rate').textContent.trim(),
      }));
      expect(rates.voice).toBe('Extra minutes billed at $0.10/min');
      expect(rates.sms).toBe('Extra messages billed at $0.015/message');

      // Firm-cap line shows ONLY while the kind is UNCHECKED: voice is off (so
      // the cap line is visible), SMS is on (so it is hidden — no stale cap text).
      const initial = await page.evaluate(() => ({
        voiceCapText: document.getElementById('usage-voice-firmcap').textContent.trim(),
        voiceCapDisplay: getComputedStyle(document.getElementById('usage-voice-firmcap')).display,
        smsCapDisplay: getComputedStyle(document.getElementById('usage-sms-firmcap')).display,
      }));
      expect(initial.voiceCapText).toBe('Calls stop at your plan limit');
      expect(initial.voiceCapDisplay).not.toBe('none');
      expect(initial.smsCapDisplay).toBe('none');

      // Toggle voice ON: the firm-cap line must disappear (metered continuation
      // is now on) while the tally treatment stays.
      await page.click('#usage-voice-overage');
      await waitFor(() => api.patchRequests().length === 1);
      await waitFor(async () => page.evaluate(() =>
        getComputedStyle(document.getElementById('usage-voice-firmcap')).display === 'none'));
      const tallyStillThere = await page.evaluate(() =>
        document.getElementById('usage-voice-tally').textContent.trim().length > 0);
      expect(tallyStillThere).toBe(true);

      // Toggle SMS OFF: the firm-cap line must come back with its exact copy.
      await page.click('#usage-sms-overage');
      await waitFor(() => api.patchRequests().length === 2);
      await waitFor(async () => page.evaluate(() =>
        getComputedStyle(document.getElementById('usage-sms-firmcap')).display !== 'none'));
      const smsCapText = await page.evaluate(() =>
        document.getElementById('usage-sms-firmcap').textContent.trim());
      expect(smsCapText).toBe('Texting stops at your plan limit');

      // Light + dark: the copy resolves theme variables in BOTH themes (never a
      // hardcoded hex that would vanish on one of them).
      const themed = await page.evaluate(() => {
        const rate = document.getElementById('usage-voice-rate');
        const cap = document.getElementById('usage-sms-firmcap');
        const light = { rate: getComputedStyle(rate).color, cap: getComputedStyle(cap).color };
        document.documentElement.classList.add('dark');
        const dark = { rate: getComputedStyle(rate).color, cap: getComputedStyle(cap).color };
        const tokens = {
          muted: getComputedStyle(document.documentElement).getPropertyValue('--muted').trim(),
          accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
        };
        document.documentElement.classList.remove('dark');
        return { light, dark, tokens };
      });
      expect(themed.light.rate).toBeTruthy();
      expect(themed.dark.rate).toBeTruthy();
      expect(themed.light.cap).toBeTruthy();
      expect(themed.dark.cap).toBeTruthy();
      expect(themed.tokens.muted).toBeTruthy();
      expect(themed.tokens.accent).toBeTruthy();
      // the colours actually CHANGE between themes (proves a resolved variable)
      expect(themed.light.rate).not.toBe(themed.dark.rate);
    });
  });
});
