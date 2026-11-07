// test/portal-auth-browser.test.js — BROWSER-LEVEL E2E for the portal + admin
// AUTHENTICATION gates (ticket zeus_1793167125889_c1899285, audit gap F1 —
// source audit zeus_1793166491472_e99e6c8e, P1 category: auth).
//
// WHY THIS FILE EXISTS
// Until now NOTHING in test/ exercised the login flow: 22 suites read
// portal.html as a string and 4 Playwright suites drove a PRE-authenticated
// page (sessionStorage seeded before load). A regression in the gate itself —
// the gate not showing, the shell rendering to an unauthenticated visitor, the
// access code never reaching the API — shipped green. Authentication is the
// P1 audit category: a broken gate either locks every client out (revenue
// outage) or worse, renders the portal shell while it only LOOKS populated.
//
// WHAT THIS SUITE PROVES (drives real Chromium against the working-tree
// portal.html / admin.html served over local http, API mocked at the network
// layer with stateful page.route handlers — the pattern proven in
// test/portal-billing-browser.test.js):
//   1. an unauthenticated load shows the auth gate and NEVER the app shell;
//   2. a valid access code fires EXACTLY ONE POST /portal/auth with the
//      entered credentials and yields the app shell with the right identity;
//   3. invalid / empty code, API 401, API 500 and an unreachable API all show
//      an inline error and never render the shell (fail closed);
//   4. a tampered stored token is rejected on reload — the gate re-shows with
//      the session-expired message and the stored session is cleared;
//   5. logout returns to a clean gate;
//   6. admin.html REFUSES a client credential at its gate, accepts only the
//      admin password, and its data calls carry the admin key — not a client
//      token (role separation).
//
// KNOWN DEVIATIONS (documented, pinned — see the marked tests)
// The audit's expected behavior says "reload while the API is unreachable must
// fail closed" and "admin.html with a client token does not render admin nav".
// The CURRENT pages trust the stored identity client-side: portal.html's
// launchApp() and admin.html's auzora_auth restore render the shell BEFORE any
// server validation, and neither page has a 401-logout (only portal.html has a
// global 401 interceptor). This test-only ticket forbids application-code
// changes, so those two scenarios are covered as DEVIATION-PINNING tests that
// assert today's actual behavior with loud comments — a future fail-closed fix
// must flip them deliberately.
//
// ZERO EXTERNAL EGRESS: every request the pages make is intercepted by
// page.route('**/*'). Only the local static server is ever continued; every
// other request (including the real https://atlas.6845165.xyz the pages target
// on a localhost origin) is fulfilled or aborted by the mock and NEVER leaves
// the browser. The suite asserts this invariant, so no atlas-staging /
// atlas.6845165.xyz / auzora.io call can ever hit the wire.
//
// Playwright is the driver (devDependency; falls back to the sibling atlas-ai
// install). If Chromium is not installed the suite SKIPS loudly rather than
// failing — same convention as the other browser suites in this repo.

'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const { URL } = require('url');

// Chromium + page load is well over jest's 5s default.
jest.setTimeout(120000);

const repoRoot = path.join(__dirname, '..');

// ── Playwright resolution (mirrors portal-billing-browser.test.js) ───────────
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
    '\n[portal-auth-browser] SKIPPING the portal auth browser suite — ' +
    (chromium ? 'Playwright is installed but its Chromium build is not.\n' : 'Playwright is not installed.\n') +
    '  Install with:  npm i -D playwright && npx playwright install chromium\n' +
    '  (or point PLAYWRIGHT_PKG at an existing playwright install).\n'
  );
}

const describeBrowser = browserReady ? describe : describe.skip;

// ── Synthetic fixtures (no real credentials, no staging DynamoDB) ────────────
const CLIENT = {
  client_id: 'e2e-auth-client-001',
  email: 'e2e-auth@example.com',
  business_name: 'E2E Auth Test Co',
  tutorial_completed: true, // suppress the first-run tutorial overlay
  webhook_url: '',
};
const ACCESS_CODE = 'E2ECODE1';
const VALID_TOKEN = 'e2e-valid-portal-token';
const ADMIN_PASSWORD = 'e2e-admin-password';
const ADMIN_KEY = 'e2e-admin-api-key';

// Same payload shape the proven billing suite serves for /portal/entitlements.
const BASE_USAGE = {
  voiceMinutes: 0,
  smsMessages: 0,
  limits: { voiceMinutes: 1250, smsMessages: 0 },
  percentUsed: { voice: 0, sms: 0 },
  period: '2026-11',
  unlimited: false,
  included: { voice: 1250, sms: 0 },
  overage: { voice: 0, sms: 0 },
};

// ── Static file server (serves the working tree) ─────────────────────────────
function startStaticServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      let pathname;
      try { pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname); }
      catch (e) { res.writeHead(400); res.end('bad url'); return; }
      const rel = pathname === '/' ? '/portal.html' : pathname;
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

// ── Mock API (stateful; drives the network layer) ────────────────────────────
function createAuthMock(opts) {
  const o = opts || {};
  return {
    baseUrl: null, // set once the static server is listening
    // apiDown=true aborts every /portal/* and /admin/* request (network dead).
    apiDown: !!o.apiDown,
    // loginStatus !== 200 makes POST /portal/auth answer with that status.
    loginStatus: o.loginStatus || 200,
    loginBody: o.loginBody || null,

    requests: [],            // every intercepted API dispatch
    abortedPaths: [],        // paths aborted while apiDown
    fulfilledApiResponses: 0,
    localContinues: 0,       // requests continued to the LOCAL static server
    externalContinued: 0,    // MUST stay 0: non-local requests never continue
    externalHosts: {},       // hostnames seen on intercepted external requests

    setBaseUrl(v) { this.baseUrl = v; },
    isStatic(url) { return this.baseUrl && url.origin === this.baseUrl; },

    authRequests() { return this.requests.filter(r => r.method === 'POST' && r.pathname === '/portal/auth'); },
    portalRequests() { return this.requests.filter(r => r.pathname.startsWith('/portal/')); },
    adminLoginRequests() { return this.requests.filter(r => r.method === 'POST' && r.pathname === '/admin/login'); },
    clientsRequests() { return this.requests.filter(r => r.method === 'GET' && r.pathname === '/admin/clients'); },

    entitlementsPayload() {
      return {
        plan: 'Standard',
        tier: 'standard',
        usage: BASE_USAGE,
        allow_overage: { voice: false, sms: false },
      };
    },

    dispatch(method, pathname, headers, rawBody) {
      let body = null;
      if (rawBody) { try { body = JSON.parse(rawBody); } catch (e) { body = rawBody; } }
      this.requests.push({ method, pathname, headers, body });

      // ── client portal login ──
      if (method === 'POST' && pathname === '/portal/auth') {
        if (this.loginStatus !== 200) {
          return { status: this.loginStatus, body: this.loginBody || { error: 'Login failed' } };
        }
        if (body && body.email === CLIENT.email && body.access_code === ACCESS_CODE) {
          return { status: 200, body: { token: VALID_TOKEN, client: CLIENT } };
        }
        return { status: 401, body: { error: 'Invalid email or access code.' } };
      }

      // ── every other portal call is token-gated, mirroring the backend's
      //    x-portal-token check: an unknown/tampered token gets a bare 401,
      //    which trips the page's global session-expiry interceptor.
      if (pathname.startsWith('/portal/')) {
        if ((headers['x-portal-token'] || '') !== VALID_TOKEN) {
          return { status: 401, body: { error: 'Invalid or expired session.' } };
        }
        if (method === 'GET' && pathname === '/portal/entitlements') {
          return { status: 200, body: this.entitlementsPayload() };
        }
        return { status: 200, body: {} };
      }

      // ── admin auth (POST /admin/login, key-gated data) ──
      if (method === 'POST' && pathname === '/admin/login') {
        if (body && body.password === ADMIN_PASSWORD) {
          return { status: 200, body: { apiKey: ADMIN_KEY } };
        }
        return { status: 401, body: { error: 'Incorrect password.' } };
      }
      if (method === 'GET' && pathname === '/admin/clients') {
        if ((headers['x-api-key'] || '') !== ADMIN_KEY) {
          return { status: 401, body: { error: 'Unauthorized' } };
        }
        return {
          status: 200,
          body: [{
            client_id: 'admin-seed-1',
            business_name: 'Admin Seed Client A',
            email: 'admin-seed@example.com',
            status: 'active',
            plan: 'pro',
            industry: 'HVAC',
            createdAt: '2026-11-01T00:00:00Z',
          }],
        };
      }

      // Everything else the boot fans out to — empty but valid JSON.
      return { status: 200, body: {} };
    },
  };
}

// Intercept EVERY request the pages make. Only the local static server is ever
// continued — Chromium never sends an intercepted request to the network, so
// the pages' real target (https://atlas.6845165.xyz on a localhost origin) is
// answered by the mock and zero bytes reach atlas-staging / auzora.io.
async function installNetwork(page, api) {
  await page.route('**/*', (route) => {
    const req = route.request();
    let url;
    try { url = new URL(req.url()); } catch (e) { return route.abort(); }

    if (api.isStatic(url)) {
      api.localContinues += 1;
      return route.continue();
    }
    // Everything below is intercepted — it must NEVER continue to the network.
    api.externalHosts[url.hostname] = (api.externalHosts[url.hostname] || 0) + 1;

    if (api.apiDown && (url.pathname.startsWith('/portal/') || url.pathname.startsWith('/admin/'))) {
      api.abortedPaths.push(url.pathname);
      return route.abort('connectionrefused');
    }
    if (url.pathname.startsWith('/portal/') || url.pathname.startsWith('/admin/')) {
      const r = api.dispatch(req.method(), url.pathname, req.headers(), req.postData());
      api.fulfilledApiResponses += 1;
      return route.fulfill({
        status: r.status,
        contentType: 'application/json',
        body: JSON.stringify(r.body),
      });
    }
    if (/(^|\.)unpkg\.com$/.test(url.hostname)) {
      // Minimal lucide stub — the pages guard every call with `if (window.lucide)`.
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

// Zero-egress invariant: nothing non-local was ever continued, and the only
// external hosts seen were the CDN stubs plus the API origin the pages target
// on localhost (atlas.6845165.xyz — intercepted, never on the wire). No
// atlas-staging and no auzora.io host may appear at all.
function expectNoExternalEgress(api) {
  expect(api.externalContinued).toBe(0);
  expect(api.localContinues).toBeGreaterThan(0); // the page really was served locally
  const hosts = Object.keys(api.externalHosts);
  for (const h of hosts) {
    expect(h).toMatch(/^(atlas\.6845165\.xyz|([^\.]+\.)?unpkg\.com|([^\.]+\.)?googleapis\.com|([^\.]+\.)?gstatic\.com)$/);
  }
}

// ── Session seeding (runs before every document load, incl. reloads) ─────────
function seedPortalSession(token, clientRaw) {
  return (page) => page.addInitScript((args) => {
    try {
      if (args.token !== null) window.sessionStorage.setItem('atlas_token', args.token);
      if (args.clientRaw !== null) window.sessionStorage.setItem('atlas_client', args.clientRaw);
    } catch (e) { /* about:blank frame */ }
  }, { token, clientRaw });
}

// admin.html stores its session in localStorage: auzora_auth flag + admin key.
// Here the "stored key" is the CLIENT's portal token — the role-separation
// scenario from the audit.
function seedAdminStoredClientToken(page) {
  return page.addInitScript((token) => {
    try {
      window.localStorage.setItem('auzora_auth', '1');
      window.localStorage.setItem('atlas_admin_key', token);
    } catch (e) { /* about:blank frame */ }
  }, VALID_TOKEN);
}

// ── Small helpers ────────────────────────────────────────────────────────────
async function waitFor(fn, timeoutMs = 15000) {
  const start = Date.now();
  for (;;) {
    if (await fn()) return undefined;
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise(r => setTimeout(r, 60));
  }
}

// Wait until the portal boot has fully settled: shell visible with the right
// identity AND the entitlements round-trip has painted the usage card.
function portalBootSettled(page) {
  return async () => {
    const s = await page.evaluate(() => ({
      appDisplay: document.getElementById('app') ? document.getElementById('app').style.display : null,
      biz: document.getElementById('sidebar-biz') ? document.getElementById('sidebar-biz').textContent.trim() : '',
      tally: document.getElementById('usage-voice-tally') ? document.getElementById('usage-voice-tally').textContent.trim() : '',
    }));
    return s.appDisplay === 'block' && s.biz.length > 0 && s.tally.length > 0;
  };
}

function portalGateState(page) {
  return page.evaluate(() => ({
    loginVisible: getComputedStyle(document.getElementById('login-screen')).display !== 'none',
    appDisplay: getComputedStyle(document.getElementById('app')).display,
    loginError: (document.getElementById('login-error') || {}).textContent || '',
    storedToken: window.sessionStorage.getItem('atlas_token'),
    storedClient: window.sessionStorage.getItem('atlas_client'),
    sidebarBiz: (document.getElementById('sidebar-biz') || {}).textContent || '',
  }));
}

function adminGateState(page) {
  return page.evaluate(() => {
    const nav = document.querySelector('.nav-item');
    return {
      authVisible: getComputedStyle(document.getElementById('auth-screen')).display !== 'none',
      appDisplay: getComputedStyle(document.getElementById('app')).display,
      authError: (document.getElementById('auth-error') || {}).textContent || '',
      navRendered: !!nav && nav.offsetParent !== null, // visible ⇒ shell + nav are on screen
    };
  });
}

// ── Suite ────────────────────────────────────────────────────────────────────
describeBrowser('portal + admin authentication gates — browser-level E2E (audit F1)', () => {
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

  async function withPage(api, seedFn, fn) {
    api.setBaseUrl(baseUrl);
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    try {
      await installNetwork(page, api);
      if (seedFn) await seedFn(page);
      return await fn(page);
    } finally {
      await page.close();
    }
  }

  async function loadPortal(page) {
    await page.goto(baseUrl + '/portal.html', { waitUntil: 'domcontentloaded' });
    await waitFor(async () => page.evaluate(() =>
      document.getElementById('login-screen') && document.getElementById('app')
    ));
  }

  async function loadAdmin(page) {
    await page.goto(baseUrl + '/admin.html', { waitUntil: 'domcontentloaded' });
    await waitFor(async () => page.evaluate(() =>
      document.getElementById('auth-screen') && document.getElementById('app')
    ));
  }

  // ── 1. unauthenticated load: gate only, never the shell ──
  test('1. unauthenticated portal load shows the auth gate and never the app shell', async () => {
    const api = createAuthMock();
    await withPage(api, null, async (page) => {
      await loadPortal(page);
      const s = await portalGateState(page);
      expect(s.loginVisible).toBe(true);
      expect(s.appDisplay).toBe('none');
      expect(s.sidebarBiz).not.toBe(CLIENT.business_name);
      // No credentials in storage, and the gated page makes ZERO API calls.
      expect(s.storedToken).toBeNull();
      expect(s.storedClient).toBeNull();
      expect(api.portalRequests().length).toBe(0);
      expect(api.authRequests().length).toBe(0);
      expectNoExternalEgress(api);
    });
  });

  // ── 2. successful login: exactly one POST, shell + identity ──
  test('2. valid access code fires exactly one POST /portal/auth and boots the shell with the client identity', async () => {
    const api = createAuthMock();
    await withPage(api, null, async (page) => {
      await loadPortal(page);
      await page.fill('#login-email', CLIENT.email);
      await page.fill('#login-code', ACCESS_CODE);
      await page.click('#login-btn');

      await waitFor(portalBootSettled(page));
      const s = await portalGateState(page);
      expect(s.appDisplay).toBe('block');
      expect(s.loginVisible).toBe(false);
      expect(s.sidebarBiz).toBe(CLIENT.business_name);
      // The token the page issued is stored for the next visit.
      expect(s.storedToken).toBe(VALID_TOKEN);

      const posts = api.authRequests();
      expect(posts.length).toBe(1);
      expect(posts[0].body.email).toBe(CLIENT.email);
      expect(posts[0].body.access_code).toBe(ACCESS_CODE);
      expectNoExternalEgress(api);
    });
  });

  // ── 3. logout returns to a clean gate ──
  test('3. logout clears the stored session and returns to the auth gate', async () => {
    const api = createAuthMock();
    await withPage(api, null, async (page) => {
      await loadPortal(page);
      await page.fill('#login-email', CLIENT.email);
      await page.fill('#login-code', ACCESS_CODE);
      await page.click('#login-btn');
      await waitFor(portalBootSettled(page));

      await page.click('.logout-btn');
      await waitFor(async () => (await portalGateState(page)).loginVisible);
      const s = await portalGateState(page);
      expect(s.loginVisible).toBe(true);
      expect(s.appDisplay).toBe('none');
      expect(s.storedToken).toBeNull();
      expect(s.storedClient).toBeNull();
      expect(await page.inputValue('#login-email')).toBe('');
      expect(await page.inputValue('#login-code')).toBe('');
      expectNoExternalEgress(api);
    });
  });

  // ── 4. invalid code: inline error, no shell ──
  test('4. invalid access code shows the inline error and never renders the app shell', async () => {
    const api = createAuthMock();
    await withPage(api, null, async (page) => {
      await loadPortal(page);
      await page.fill('#login-email', CLIENT.email);
      await page.fill('#login-code', 'WRONGCOD');
      await page.click('#login-btn');

      await waitFor(async () => (await portalGateState(page)).loginError.length > 0);
      const s = await portalGateState(page);
      expect(s.loginError).toBe('Invalid email or access code.');
      expect(s.loginVisible).toBe(true);
      expect(s.appDisplay).toBe('none');
      expect(s.storedToken).toBeNull(); // nothing was persisted on failure
      expect(api.authRequests().length).toBe(1);
      expectNoExternalEgress(api);
    });
  });

  // ── 5. empty code: client-side validation, zero API calls ──
  test('5. empty access code is rejected client-side without any API call', async () => {
    const api = createAuthMock();
    await withPage(api, null, async (page) => {
      await loadPortal(page);
      await page.fill('#login-email', CLIENT.email);
      await page.click('#login-btn');

      await waitFor(async () => (await portalGateState(page)).loginError.length > 0);
      const s = await portalGateState(page);
      expect(s.loginError).toBe('Please enter your email and access code.');
      expect(s.loginVisible).toBe(true);
      expect(s.appDisplay).toBe('none');
      expect(api.authRequests().length).toBe(0);
      expect(api.portalRequests().length).toBe(0);
      expectNoExternalEgress(api);
    });
  });

  // ── 6. API 401 on login (wrong-credential server response) ──
  test('6. a 401 from POST /portal/auth shows the inline error and no app shell', async () => {
    const api = createAuthMock();
    await withPage(api, null, async (page) => {
      await loadPortal(page);
      // A credential the mock rejects with 401 — same wire path as a real 401.
      await page.fill('#login-email', 'someone@else.com');
      await page.fill('#login-code', ACCESS_CODE);
      await page.click('#login-btn');

      await waitFor(async () => (await portalGateState(page)).loginError.length > 0);
      const s = await portalGateState(page);
      expect(s.loginError).toBe('Invalid email or access code.');
      expect(s.loginVisible).toBe(true);
      expect(s.appDisplay).toBe('none');
      expect(api.authRequests().length).toBe(1);
      expectNoExternalEgress(api);
    });
  });

  // ── 7. API 500 on login ──
  test('7. a 500 from POST /portal/auth shows the inline error and no app shell', async () => {
    const api = createAuthMock({ loginStatus: 500, loginBody: { error: 'Something went wrong on our end.' } });
    await withPage(api, null, async (page) => {
      await loadPortal(page);
      await page.fill('#login-email', CLIENT.email);
      await page.fill('#login-code', ACCESS_CODE);
      await page.click('#login-btn');

      await waitFor(async () => (await portalGateState(page)).loginError.length > 0);
      const s = await portalGateState(page);
      expect(s.loginError).toBe('Something went wrong on our end.');
      expect(s.loginVisible).toBe(true);
      expect(s.appDisplay).toBe('none');
      expect(s.storedToken).toBeNull();
      expect(api.authRequests().length).toBe(1);
      expectNoExternalEgress(api);
    });
  });

  // ── 8. unreachable API on login: fail closed ──
  test('8. login with the API unreachable fails closed — connection error, gate stays, no shell', async () => {
    const api = createAuthMock({ apiDown: true });
    await withPage(api, null, async (page) => {
      await loadPortal(page);
      await page.fill('#login-email', CLIENT.email);
      await page.fill('#login-code', ACCESS_CODE);
      await page.click('#login-btn');

      await waitFor(async () => (await portalGateState(page)).loginError.length > 0);
      const s = await portalGateState(page);
      expect(s.loginError).toBe('Connection error. Please try again.');
      expect(s.loginVisible).toBe(true);
      expect(s.appDisplay).toBe('none');
      expect(s.storedToken).toBeNull();
      // The dead network was the only thing hit — nothing was fulfilled.
      expect(api.fulfilledApiResponses).toBe(0);
      expect(api.abortedPaths.length).toBeGreaterThan(0);
      for (const p of api.abortedPaths) expect(p.startsWith('/portal/')).toBe(true);
      expectNoExternalEgress(api);
    });
  });

  // ── 9. tampered stored token: rejected on reload ──
  test('9. reload with a tampered stored token re-shows the gate with the session-expired message', async () => {
    const api = createAuthMock();
    await withPage(api, seedPortalSession('tampered-token-000', JSON.stringify(CLIENT)), async (page) => {
      await loadPortal(page);
      // The boot's token-gated calls answer 401 → the global interceptor must
      // tear the shell down and re-show the gate.
      await waitFor(async () => {
        const s = await portalGateState(page);
        return s.loginVisible && s.loginError.toLowerCase().includes('session expired');
      });
      const s = await portalGateState(page);
      expect(s.loginVisible).toBe(true);
      expect(s.appDisplay).toBe('none');
      expect(s.loginError).toBe('Your session expired. Please sign in again.');
      // The rejected session was cleared from storage.
      expect(s.storedToken).toBeNull();
      expect(s.storedClient).toBeNull();
      // At least one token-gated call was made and rejected with 401.
      const rejected = api.portalRequests().filter(r => r.pathname !== '/portal/auth');
      expect(rejected.length).toBeGreaterThan(0);
      expectNoExternalEgress(api);
    });
  });

  // ── 10. malformed stored client JSON: gate only ──
  test('10. a malformed stored client payload cannot boot the shell — the gate stays', async () => {
    const api = createAuthMock();
    await withPage(api, seedPortalSession(VALID_TOKEN, 'not-json{'), async (page) => {
      await loadPortal(page);
      // JSON.parse of the stored client throws during init, launchApp never
      // runs, and the static default (gate visible, shell hidden) holds.
      const s = await portalGateState(page);
      expect(s.loginVisible).toBe(true);
      expect(s.appDisplay).toBe('none');
      expect(s.sidebarBiz).not.toBe(CLIENT.business_name);
      expectNoExternalEgress(api);
    });
  });

  // ── 11. valid stored token: session persistence boots the shell ──
  test('11. a valid stored token reloads straight into the shell with the client identity', async () => {
    const api = createAuthMock();
    await withPage(api, seedPortalSession(VALID_TOKEN, JSON.stringify(CLIENT)), async (page) => {
      await loadPortal(page);
      await waitFor(portalBootSettled(page));
      const s = await portalGateState(page);
      expect(s.appDisplay).toBe('block');
      expect(s.loginVisible).toBe(false);
      expect(s.sidebarBiz).toBe(CLIENT.business_name);
      expect(s.storedToken).toBe(VALID_TOKEN);
      expect(api.authRequests().length).toBe(0); // no re-auth was needed
      expectNoExternalEgress(api);
    });
  });

  // ── 12. DEVIATION PIN — stored session + unreachable API ──
  // The audit's expected behavior for this failure scenario is "must fail
  // closed, never render the shell". portal.html AS SHIPPED trusts the
  // sessionStorage identity client-side: launchApp() renders the shell BEFORE
  // any network call, and with the API dead the 401 interceptor never fires
  // (there is no response), so the shell stays with degraded data. Fixing that
  // is an application-code change — forbidden by this test-only ticket — so
  // this test pins TODAY'S behavior. If a fail-closed fix lands, this test is
  // SUPPOSED to fail until it is flipped to assert the gate.
  test('12. DEVIATION PIN: stored-session reload with the API unreachable renders the cached shell (current cache-trust behavior)', async () => {
    const api = createAuthMock({ apiDown: true });
    await withPage(api, seedPortalSession(VALID_TOKEN, JSON.stringify(CLIENT)), async (page) => {
      await loadPortal(page);
      await waitFor(async () => (await portalGateState(page)).sidebarBiz === CLIENT.business_name);
      const s = await portalGateState(page);
      // CURRENT behavior (cache-trust): shell renders from the stored identity…
      expect(s.appDisplay).toBe('block');
      expect(s.sidebarBiz).toBe(CLIENT.business_name);
      // …with ZERO fulfilled API responses (every data call was aborted).
      expect(api.fulfilledApiResponses).toBe(0);
      expect(api.abortedPaths.length).toBeGreaterThan(0);
      expectNoExternalEgress(api);
    });
  });

  // ── 13. admin gate refuses a client credential ──
  test('13. admin.html refuses a client credential at its gate — error shown, admin shell never renders', async () => {
    const api = createAuthMock();
    await withPage(api, null, async (page) => {
      await loadAdmin(page);
      const before = await adminGateState(page);
      expect(before.authVisible).toBe(true);
      expect(before.appDisplay).toBe('none');
      expect(before.navRendered).toBe(false);

      // Try the CLIENT's access code as the admin password.
      await page.fill('#admin-pass', ACCESS_CODE);
      await page.click('#auth-screen .btn-primary');

      await waitFor(async () => (await adminGateState(page)).authError.length > 0);
      const s = await adminGateState(page);
      expect(s.authError).toBe('Incorrect password.');
      expect(s.authVisible).toBe(true);
      expect(s.appDisplay).toBe('none');
      expect(s.navRendered).toBe(false);

      const posts = api.adminLoginRequests();
      expect(posts.length).toBe(1);
      expect(posts[0].body.password).toBe(ACCESS_CODE);
      expectNoExternalEgress(api);
    });
  });

  // ── 14. admin accepts only the admin password (role separation) ──
  test('14. admin.html accepts the admin password and its data calls carry the admin key — not a client token', async () => {
    const api = createAuthMock();
    await withPage(api, null, async (page) => {
      await loadAdmin(page);
      await page.fill('#admin-pass', ADMIN_PASSWORD);
      await page.click('#auth-screen .btn-primary');

      await waitFor(async () => (await adminGateState(page)).appDisplay === 'block');
      const s = await adminGateState(page);
      expect(s.appDisplay).toBe('block');
      expect(s.authVisible).toBe(false);
      expect(s.navRendered).toBe(true);

      const posts = api.adminLoginRequests();
      expect(posts.length).toBe(1);
      expect(posts[0].body.password).toBe(ADMIN_PASSWORD);
      // The follow-up data call authenticates with the issued ADMIN key.
      const clients = api.clientsRequests();
      expect(clients.length).toBeGreaterThan(0);
      for (const r of clients) expect(r.headers['x-api-key']).toBe(ADMIN_KEY);
      expectNoExternalEgress(api);
    });
  });

  // ── 15. DEVIATION PIN — admin with a stored CLIENT token ──
  // The audit's expected behavior is "admin.html with a client token does not
  // render admin nav". admin.html AS SHIPPED restores the shell client-side
  // from localStorage (auzora_auth === '1') with NO server validation and has
  // no 401-logout, so the nav DOES render while every data call is rejected
  // with 401 (zero client data crosses the gate). Fixing that is an
  // application-code change — forbidden by this test-only ticket — so this
  // test pins TODAY'S behavior. If a fail-closed fix lands, this test is
  // SUPPOSED to fail until it is flipped to assert the gate.
  test('15. DEVIATION PIN: admin.html with a stored CLIENT token renders the cached shell (current cache-trust behavior) but loads zero client data', async () => {
    const api = createAuthMock();
    await withPage(api, seedAdminStoredClientToken, async (page) => {
      await loadAdmin(page);
      await waitFor(async () => (await adminGateState(page)).appDisplay === 'block');
      const s = await adminGateState(page);
      // CURRENT behavior (cache-trust): shell + nav render client-side…
      expect(s.appDisplay).toBe('block');
      expect(s.navRendered).toBe(true); // DEVIATION from the audit expectation

      // …but the client token is rejected: the data call carried the CLIENT
      // token and got a 401, so no client data ever rendered.
      const clients = api.clientsRequests();
      expect(clients.length).toBeGreaterThan(0);
      for (const r of clients) expect(r.headers['x-api-key']).toBe(VALID_TOKEN);
      const bodyText = await page.evaluate(() => document.body.textContent);
      expect(bodyText).not.toContain('Admin Seed Client A');
      expectNoExternalEgress(api);
    });
  });
});
