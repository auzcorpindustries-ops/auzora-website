// test/portal-closing-tasks-browser.test.js — BROWSER-LEVEL smoke for the
// Leads/CRM "Closing Tasks" section (CLOSING-TASKS-CONFIG,
// board zeus_1791744768507_f995a09e).
//
// WHY THIS FILE EXISTS
// The wiring test (test/portal-closing-tasks-wiring.test.js) string-matches the
// authored HTML/JS. That cannot catch a renamed id, an unbound click handler,
// or a render path that never runs. This suite drives a REAL Chromium
// (Playwright) against the real portal.html served off the working tree, with
// the portal API mocked at the network layer so it runs offline and
// deterministically. It proves the section actually RENDERS and SAVES:
//   1. opening Leads renders one checkbox per catalog option, from the API
//      catalog (a distinct sentinel label proves it is not the baked fallback);
//   2. a client with a stored closing_tasks list shows exactly that list;
//   3. a client with no stored list shows the catalog DEFAULTS;
//   4. "Save Closing Tasks" issues a genuine PATCH /portal/settings carrying the
//      selected set, and the saved client is written back to the session.
//
// Playwright is declared in devDependencies; where its Chromium build is absent
// the suite SKIPS with a loud message rather than failing (this repo has no CI
// job that would install it).

'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const { URL } = require('url');

jest.setTimeout(120000);

const repoRoot = path.join(__dirname, '..');

function resolvePlaywright() {
  const candidates = [
    process.env.PLAYWRIGHT_PKG,
    'playwright',
    '@playwright/test',
    process.env.HOME ? path.join(process.env.HOME, 'Projects/atlas-ai/node_modules/playwright') : null,
  ].filter(Boolean);
  for (const c of candidates) {
    try { return require(c); } catch (e) { /* next */ }
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
  console.warn(
    '\n[portal-closing-tasks-browser] SKIPPING — ' +
    (chromium ? 'Playwright installed but its Chromium build is absent.' : 'Playwright not installed.') +
    '\n  Install with:  npm i -D playwright && npx playwright install chromium\n'
  );
}
const describeBrowser = browserReady ? describe : describe.skip;

// ── Fixtures ─────────────────────────────────────────────────────────────────
const ORIGIN_TOKEN = 'browser-smoke-portal-token';

// Distinct sentinel labels so a render that ignored the API catalog (and used
// the baked fallback) would be caught.
const CATALOG = {
  options: [
    { id: 'appointment_booked', label: 'Booked [CATALOG]', description: 'An appointment was booked.' },
    { id: 'lead_captured', label: 'Captured [CATALOG]', description: 'Contact details were captured.' },
    { id: 'callback_agreed', label: 'Callback [CATALOG]', description: 'A callback was agreed.' },
    { id: 'opt_out', label: 'Opted out [CATALOG]', description: 'The caller asked to stop.' },
    { id: 'info_provided', label: 'Info [CATALOG]', description: 'The caller got what they needed.' },
  ],
  defaults: ['appointment_booked', 'lead_captured', 'opt_out'],
};
const CATALOG_IDS = CATALOG.options.map(o => o.id);

const BASE_CLIENT = {
  business_name: 'Acme Closing Smoke Co',
  tutorial_completed: true,
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

// ── Mock portal API (stateful) ───────────────────────────────────────────────
function createMockApi(opts) {
  const o = opts || {};
  let origin = null;
  return {
    setOrigin(v) { origin = v; },
    liveClosingTasks: Array.isArray(o.storedClosingTasks) ? o.storedClosingTasks.slice() : [],
    catalogStatus: o.catalogStatus || 200,
    requests: [],

    isStatic(url) { return origin && url.origin === origin; },

    dispatch(method, pathname, headers, rawBody) {
      let body = null;
      if (rawBody) { try { body = JSON.parse(rawBody); } catch (e) { body = rawBody; } }
      const lower = {};
      Object.keys(headers || {}).forEach(k => { lower[k.toLowerCase()] = headers[k]; });
      const record = { method, pathname, headers: lower, body };
      this.requests.push(record);

      if (method === 'GET' && pathname === '/portal/settings') {
        return { status: 200, body: Object.assign({}, BASE_CLIENT, { closing_tasks: this.liveClosingTasks }) };
      }
      if (method === 'PATCH' && pathname === '/portal/settings') {
        const parsed = body && typeof body === 'object' ? body : {};
        if (Array.isArray(parsed.closing_tasks)) this.liveClosingTasks = parsed.closing_tasks.slice();
        return { status: 200, body: { client: Object.assign({}, BASE_CLIENT, { closing_tasks: this.liveClosingTasks }) } };
      }
      if (method === 'GET' && pathname === '/portal/automations') {
        if (this.catalogStatus >= 400) return { status: this.catalogStatus, body: { error: 'catalog unavailable' } };
        return {
          status: 200,
          body: { automations: [], triggers: [], types: [], plan_availability: {}, feature_flag_enabled: false, closing_tasks: CATALOG },
        };
      }
      // Everything else the boot fans out to — empty but valid JSON.
      return { status: 200, body: {} };
    },

    settingsPatches() {
      return this.requests.filter(r => r.method === 'PATCH' && r.pathname === '/portal/settings');
    },
    catalogGets() {
      return this.requests.filter(r => r.method === 'GET' && r.pathname === '/portal/automations');
    },
  };
}

async function installNetwork(page, api) {
  await page.route('**/*', (route) => {
    const req = route.request();
    const url = new URL(req.url());

    if (api.isStatic(url)) return route.continue();

    if (url.pathname.startsWith('/portal/') || url.pathname.startsWith('/api/')) {
      const r = api.dispatch(req.method(), url.pathname, req.headers(), req.postData());
      return route.fulfill({ status: r.status, contentType: 'application/json', body: JSON.stringify(r.body) });
    }
    if (/(^|\.)unpkg\.com$/.test(url.hostname)) {
      return route.fulfill({ status: 200, contentType: 'text/javascript', body: 'window.lucide = { createIcons: function () {} };' });
    }
    if (/(^|\.)googleapis\.com$/.test(url.hostname) || /(^|\.)gstatic\.com$/.test(url.hostname)) {
      return route.fulfill({ status: 200, contentType: 'text/css', body: '' });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
}

async function seedAuth(page, client) {
  await page.addInitScript((args) => {
    try {
      window.sessionStorage.setItem('atlas_token', args.token);
      window.sessionStorage.setItem('atlas_client', JSON.stringify(args.client));
    } catch (e) { /* about:blank frame */ }
  }, { token: ORIGIN_TOKEN, client });
}

async function waitFor(fn, timeoutMs = 15000) {
  const start = Date.now();
  for (;;) {
    if (await fn()) return undefined;
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise(r => setTimeout(r, 60));
  }
}

async function loadLeads(page, baseUrl) {
  await page.goto(baseUrl + '/portal.html', { waitUntil: 'domcontentloaded' });
  await waitFor(async () => page.evaluate(() => document.getElementById('app').style.display === 'block'));
  await page.click('#nav-leads');
  await waitFor(async () => page.evaluate(() => document.querySelectorAll('#closing-tasks-list .closing-task-cb').length > 0));
}

function readSection(page) {
  return page.evaluate(() => {
    const boxes = Array.from(document.querySelectorAll('#closing-tasks-list .closing-task-cb'));
    const card = document.getElementById('closing-tasks-card');
    return {
      cardVisible: !!card && getComputedStyle(card).display !== 'none',
      count: boxes.length,
      values: boxes.map(b => b.value),
      checkedValues: boxes.filter(b => b.checked).map(b => b.value),
      labels: Array.from(document.querySelectorAll('#closing-tasks-list label')).map(l => l.textContent.trim()),
    };
  });
}

// ── Suite ────────────────────────────────────────────────────────────────────
describeBrowser('portal Closing Tasks section — browser-level smoke', () => {
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

  async function withPage(api, client, fn) {
    api.setOrigin(baseUrl);
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    try {
      await installNetwork(page, api);
      await seedAuth(page, client || BASE_CLIENT);
      return await fn(page);
    } finally {
      await page.close();
    }
  }

  test('1. opening Leads renders one checkbox per CATALOG option (not the baked fallback)', async () => {
    const api = createMockApi();

    await withPage(api, BASE_CLIENT, async (page) => {
      await loadLeads(page, baseUrl);
      const s = await readSection(page);

      expect(s.cardVisible).toBe(true);
      expect(s.values).toEqual(CATALOG_IDS);
      // The labels come from the API catalog (sentinel), so a hard-coded
      // fallback render would fail here.
      expect(s.labels[0]).toContain('Booked [CATALOG]');

      // The catalog was fetched over the network with the portal token.
      const cat = api.catalogGets();
      expect(cat.length).toBeGreaterThan(0);
      expect(cat[0].headers['x-portal-token']).toBe(ORIGIN_TOKEN);
    });
  });

  test('2. a stored closing_tasks list renders exactly that set (no client list ⇒ defaults)', async () => {
    // stored list: only the callback
    const apiStored = createMockApi({ storedClosingTasks: ['callback_agreed'] });
    await withPage(apiStored, Object.assign({}, BASE_CLIENT, { closing_tasks: ['callback_agreed'] }), async (page) => {
      await loadLeads(page, baseUrl);
      const s = await readSection(page);
      expect(s.checkedValues).toEqual(['callback_agreed']);
    });

    // no stored list: the catalog DEFAULTS are checked
    const apiDefault = createMockApi();
    await withPage(apiDefault, BASE_CLIENT, async (page) => {
      await loadLeads(page, baseUrl);
      const s = await readSection(page);
      expect(s.checkedValues).toEqual(CATALOG.defaults);
    });
  });

  test('3. Save issues a real PATCH /portal/settings with the selected set', async () => {
    const api = createMockApi();

    await withPage(api, BASE_CLIENT, async (page) => {
      await loadLeads(page, baseUrl);

      // Select only "opt_out".
      await page.evaluate((id) => {
        document.querySelectorAll('#closing-tasks-list .closing-task-cb').forEach((b) => { b.checked = (b.value === id); });
      }, 'opt_out');

      await page.click('#closing-tasks-save');
      await waitFor(() => api.settingsPatches().length === 1);

      const patch = api.settingsPatches()[0];
      expect(patch.method).toBe('PATCH');
      expect(patch.pathname).toBe('/portal/settings');
      expect(patch.headers['x-portal-token']).toBe(ORIGIN_TOKEN);
      expect(patch.body).toEqual({ closing_tasks: ['opt_out'] });

      // The saved client is written back to the session …
      await waitFor(async () => (await page.textContent('#closing-tasks-status')).includes('Saved'));
      const stored = await page.evaluate(() => JSON.parse(sessionStorage.getItem('atlas_client') || '{}'));
      expect(stored.closing_tasks).toEqual(['opt_out']);
    });
  });

  test('4. a failed catalog fetch still renders the fallback options', async () => {
    const api = createMockApi({ catalogStatus: 500 });

    await withPage(api, BASE_CLIENT, async (page) => {
      await loadLeads(page, baseUrl);
      const s = await readSection(page);
      // Fallback has the same 5 canonical ids with human labels.
      expect(s.values).toEqual(CATALOG_IDS);
      expect(s.labels[0]).toContain('Appointment booked');
      expect(api.catalogGets().length).toBeGreaterThan(0);
    });
  });
});
