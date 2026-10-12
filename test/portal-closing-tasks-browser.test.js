// test/portal-closing-tasks-browser.test.js — BROWSER-LEVEL smoke for the
// per-automation Closing Tasks editor (CLOSING-TASKS-CATEGORIES,
// board zeus_1791760575295_ba17804e).
//
// WHY THIS FILE EXISTS
// The wiring test (test/portal-closing-tasks-wiring.test.js) string-matches the
// authored HTML/JS. That cannot catch a renamed id, an unbound click handler,
// or a render path that never runs. This suite drives a REAL Chromium
// (Playwright) against the real portal.html served off the working tree, with
// the portal API mocked at the network layer so it runs offline and
// deterministically. It proves:
//   0. Leads & CRM renders NO closing-task UI at all (the pre-split card is
//      gone) — config now lives on the Automations page;
//   1. opening an automation's Customize panel renders one checkbox per option
//      of the CATALOG the params endpoint returns, grouped under
//      "Positive outcomes" and "Negative outcomes" in catalog order (sentinel
//      labels prove it is not a baked-in copy);
//   2. an automation with a saved checklist shows exactly that set; one with an
//      empty saved list shows the catalog DEFAULTS;
//   3. "Save Settings" issues a genuine PUT /portal/workflows/<id>/params
//      carrying `closing_tasks` in that automation's customize block, and the
//      saved set survives the panel re-render.
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
const AUTOMATION_ID = 3; // legacy preset id — a customizable automation row

// Distinct sentinel labels so a render that ignored the API catalog (and used a
// baked-in list) would be caught.
const CATALOG = {
  options: [
    { id: 'appointment_booked', label: 'Booked [CATALOG]', description: 'An appointment was booked.', category: 'positive' },
    { id: 'callback_agreed', label: 'Callback [CATALOG]', description: 'A callback was agreed.', category: 'positive' },
    { id: 'info_provided', label: 'Info [CATALOG]', description: 'The caller got what they needed.', category: 'positive' },
    { id: 'sms_opt_in', label: 'SMS opt-in [CATALOG]', description: 'The caller agreed to texts.', category: 'positive' },
    { id: 'opt_out_all', label: 'Opted out of all [CATALOG]', description: 'Asked to stop all contact.', category: 'negative' },
    { id: 'opt_out_sms', label: 'Opted out of SMS [CATALOG]', description: 'Asked to stop texts only.', category: 'negative' },
  ],
  categories: ['positive', 'negative'],
  groups: {
    positive: ['appointment_booked', 'callback_agreed', 'info_provided', 'sms_opt_in'],
    negative: ['opt_out_all', 'opt_out_sms'],
  },
  defaults: ['appointment_booked', 'opt_out_all'],
  threshold: 0.8,
};
const CATALOG_IDS = CATALOG.options.map(o => o.id);

const BASE_CLIENT = {
  business_name: 'Acme Closing Smoke Co',
  tutorial_completed: true,
  webhook_url: '',
};
const ENTITLEMENTS = { aiFollowUpCalls: true, bulkCallCampaigns: true };

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
    requests: [],

    isStatic(url) { return origin && url.origin === origin; },

    paramsPayload() {
      return {
        template_id: AUTOMATION_ID,
        name: 'Preset 3',
        client_timezone: 'America/Chicago',
        waits: [], templates: [], steps: [],
        merge_fields: [], wait_units: [], wait_modes: [], timezones: [], max_wait_by_unit: {},
        sms_limits: { segment_chars: 160, warn_chars: 480, max_chars: 1600 },
        closing_tasks: Object.assign({}, CATALOG, { configured: this.liveClosingTasks.slice() }),
      };
    },

    dispatch(method, pathname, headers, rawBody) {
      let body = null;
      if (rawBody) { try { body = JSON.parse(rawBody); } catch (e) { body = rawBody; } }
      const lower = {};
      Object.keys(headers || {}).forEach(k => { lower[k.toLowerCase()] = headers[k]; });
      const record = { method, pathname, headers: lower, body };
      this.requests.push(record);

      if (method === 'GET' && pathname === '/portal/settings') {
        return { status: 200, body: BASE_CLIENT };
      }
      if (method === 'GET' && pathname === '/portal/entitlements') {
        // The Customize control only renders on an UNLOCKED card, so the
        // entitlement that gates call automations must be present (otherwise
        // every call card renders as an "Upgrade required" locked card).
        return { status: 200, body: { entitlements: ENTITLEMENTS, tier_voices: [] } };
      }
      if (method === 'GET' && pathname === '/portal/workflows') {
        return { status: 200, body: { workflows: [{ templateId: AUTOMATION_ID, status: 'off' }] } };
      }
      if (method === 'GET' && pathname === `/portal/workflows/${AUTOMATION_ID}/params`) {
        return { status: 200, body: this.paramsPayload() };
      }
      if (method === 'PUT' && pathname === `/portal/workflows/${AUTOMATION_ID}/params`) {
        const parsed = body && typeof body === 'object' ? body : {};
        if (Array.isArray(parsed.closing_tasks)) this.liveClosingTasks = parsed.closing_tasks.slice();
        return {
          status: 200,
          body: {
            ok: true,
            template_id: AUTOMATION_ID,
            waits: parsed.waits || {},
            templates: parsed.templates || {},
            closing_tasks: this.liveClosingTasks.slice(),
            warnings: [],
          },
        };
      }
      // Everything else the boot fans out to — empty but valid JSON.
      return { status: 200, body: {} };
    },

    paramsPuts() {
      return this.requests.filter(r => r.method === 'PUT' && r.pathname === `/portal/workflows/${AUTOMATION_ID}/params`);
    },
    paramsGets() {
      return this.requests.filter(r => r.method === 'GET' && r.pathname === `/portal/workflows/${AUTOMATION_ID}/params`);
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
      window.sessionStorage.setItem('atlas_entitlements', JSON.stringify(args.entitlements));
    } catch (e) { /* about:blank frame */ }
  }, { token: ORIGIN_TOKEN, client, entitlements: ENTITLEMENTS });
}

async function waitFor(fn, timeoutMs = 15000) {
  const start = Date.now();
  for (;;) {
    if (await fn()) return undefined;
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise(r => setTimeout(r, 60));
  }
}

async function bootPortal(page, baseUrl) {
  await page.goto(baseUrl + '/portal.html', { waitUntil: 'domcontentloaded' });
  await waitFor(async () => page.evaluate(() => document.getElementById('app').style.display === 'block'));
}

// Open the Automations page and expand one automation's Customize panel.
async function openClosingChecklist(page, baseUrl) {
  await bootPortal(page, baseUrl);
  await page.click('#nav-automations');
  await waitFor(async () => page.evaluate((id) => !!document.getElementById(`wf-cfg-btn-${id}`), AUTOMATION_ID));
  await page.click(`#wf-cfg-btn-${AUTOMATION_ID}`);
  await waitFor(async () => page.evaluate((id) => {
    const panel = document.getElementById(`wf-params-${id}`);
    return !!panel && panel.querySelectorAll('.wf-closing-task-cb').length > 0;
  }, AUTOMATION_ID));
}

function readChecklist(page) {
  return page.evaluate((id) => {
    const panel = document.getElementById(`wf-params-${id}`);
    const boxes = Array.from(panel.querySelectorAll('.wf-closing-task-cb'));
    const groups = [];
    Array.from(panel.querySelectorAll(`#wfp-${id}-closing > div`)).forEach(g => {
      const ids = Array.from(g.querySelectorAll('.wf-closing-task-cb')).map(b => b.value);
      if (!ids.length) return;
      const titleEl = g.querySelector('div');
      groups.push({ title: titleEl ? titleEl.textContent.trim() : '', ids });
    });
    return {
      sectionVisible: !!panel.querySelector(`#wfp-${id}-closing`),
      count: boxes.length,
      values: boxes.map(b => b.value),
      checkedValues: boxes.filter(b => b.checked).map(b => b.value),
      labels: boxes.map(b => b.closest('label').textContent.trim()),
      groups,
    };
  }, AUTOMATION_ID);
}

// ── Suite ────────────────────────────────────────────────────────────────────
describeBrowser('portal Closing Tasks editor — browser-level smoke', () => {
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

  test('0. Leads & CRM no longer renders any closing-task UI', async () => {
    const api = createMockApi();
    await withPage(api, BASE_CLIENT, async (page) => {
      await bootPortal(page, baseUrl);
      await page.click('#nav-leads');
      await waitFor(async () => page.evaluate(() => !!document.getElementById('page-leads')));

      const leads = await page.evaluate(() => ({
        card: !!document.getElementById('closing-tasks-card'),
        list: !!document.getElementById('closing-tasks-list'),
        boxes: document.querySelectorAll('.closing-task-cb').length,
        saveFn: typeof window.saveClosingTasks,
        loadFn: typeof window.loadClosingTasks,
      }));
      expect(leads).toEqual({ card: false, list: false, boxes: 0, saveFn: 'undefined', loadFn: 'undefined' });
    });
  });

  test('1. the Customize panel renders one checkbox per CATALOG option, grouped positive/negative', async () => {
    const api = createMockApi();

    await withPage(api, BASE_CLIENT, async (page) => {
      await openClosingChecklist(page, baseUrl);
      const s = await readChecklist(page);

      expect(s.sectionVisible).toBe(true);
      expect(s.count).toBe(CATALOG_IDS.length);
      expect(s.values).toEqual(CATALOG_IDS); // catalog order: positives then negatives
      expect(s.labels[0]).toContain('Booked [CATALOG]'); // from the API, not baked in
      expect(s.groups).toEqual([
        { title: 'Positive outcomes', ids: CATALOG.groups.positive },
        { title: 'Negative outcomes', ids: CATALOG.groups.negative },
      ]);

      // The catalog was fetched over the network with the portal token.
      const gets = api.paramsGets();
      expect(gets.length).toBeGreaterThan(0);
      expect(gets[0].headers['x-portal-token']).toBe(ORIGIN_TOKEN);
    });
  });

  test('2. a saved checklist renders exactly that set (empty ⇒ catalog defaults)', async () => {
    const apiStored = createMockApi({ storedClosingTasks: ['opt_out_sms'] });
    await withPage(apiStored, BASE_CLIENT, async (page) => {
      await openClosingChecklist(page, baseUrl);
      const s = await readChecklist(page);
      expect(s.checkedValues).toEqual(['opt_out_sms']);
    });

    const apiDefault = createMockApi();
    await withPage(apiDefault, BASE_CLIENT, async (page) => {
      await openClosingChecklist(page, baseUrl);
      const s = await readChecklist(page);
      expect(s.checkedValues).toEqual(CATALOG.defaults);
    });
  });

  test('3. Save issues a real PUT /portal/workflows/:id/params with the selected set', async () => {
    const api = createMockApi();

    await withPage(api, BASE_CLIENT, async (page) => {
      await openClosingChecklist(page, baseUrl);

      // Select only the SMS opt-in positive task.
      await page.evaluate((id) => {
        const panel = document.getElementById(`wf-params-${id}`);
        panel.querySelectorAll('.wf-closing-task-cb').forEach((b) => { b.checked = (b.value === 'sms_opt_in'); });
      }, AUTOMATION_ID);

      await page.evaluate((id) => {
        const panel = document.getElementById(`wf-params-${id}`);
        Array.from(panel.querySelectorAll('button'))
          .find(b => b.textContent.trim() === 'Save Settings')
          .click();
      }, AUTOMATION_ID);

      await waitFor(() => api.paramsPuts().length === 1);
      const put = api.paramsPuts()[0];
      expect(put.headers['x-portal-token']).toBe(ORIGIN_TOKEN);
      expect(put.body.closing_tasks).toEqual(['sms_opt_in']);
      expect(put.body).toHaveProperty('waits');
      expect(put.body).toHaveProperty('templates');

      // The saved set survives the post-save re-render.
      await waitFor(async () => page.evaluate((id) => {
        const panel = document.getElementById(`wf-params-${id}`);
        const boxes = Array.from(panel.querySelectorAll('.wf-closing-task-cb'));
        const checked = boxes.filter(b => b.checked).map(b => b.value);
        return checked.length === 1 && checked[0] === 'sms_opt_in';
      }, AUTOMATION_ID));
    });
  });
});
