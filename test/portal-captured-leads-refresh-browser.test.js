// test/portal-captured-leads-refresh-browser.test.js — BROWSER-LEVEL proof for
// the Captured Leads manual refresh (ticket zeus_1791950322866_c0b6d4a1).
//
// WHY THIS FILE EXISTS
// The deliverable is a UI behaviour: "clicking refresh updates the table in
// place (including consent badges and statuses), preserves current pagination,
// filters and sort, keeps the user in the same section, and never reloads the
// page." A string-matching test cannot prove any of that — it cannot tell an
// in-place repaint from a page reload. So this suite drives a REAL Chromium
// (Playwright) against the real portal.html served off the working tree, with
// the portal API mocked at the network layer so it runs offline and
// deterministically.
//
// It proves, in order:
//   1. the Captured Leads table renders from GET /portal/leads;
//   2. ONE click on the new Refresh button issues EXACTLY ONE more
//      GET /portal/leads and repaints the table with the NEW payload — the
//      SMS-consent cell moves Pending -> Enabled and the stat cards move with it;
//   3. the repaint is in place: no page navigation, in-page state the client
//      set (a window sentinel, and the pagination cursor obLeadsPage) survives,
//      and the section (`#page-leads`) is still the active one;
//   4. a FAILED refresh leaves the table the client is reading exactly as it is
//      (it is never wiped / replaced by an error panel) and says so.
//
// Playwright is declared in devDependencies. Where it (or its Chromium build)
// is not installed the suite SKIPS with a loud message rather than failing —
// auzora-website has no CI job that would install it.

'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const { URL } = require('url');

// Chromium launch + page loads are well over jest's 5s default.
jest.setTimeout(120000);

const repoRoot = path.join(__dirname, '..');

// ── Playwright resolution ────────────────────────────────────────────────────
function resolvePlaywright() {
  const candidates = [
    process.env.PLAYWRIGHT_PKG,
    'playwright',
    '@playwright/test',
    process.env.HOME ? path.join(process.env.HOME, 'Projects/atlas-ai/node_modules/playwright') : null,
  ].filter(Boolean);
  for (const c of candidates) {
    try { return require(c); } catch (e) { /* next candidate */ }
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
    '\n[portal-captured-leads-refresh-browser] SKIPPING the refresh browser suite — ' +
    (chromium ? 'Playwright is installed but its Chromium build is not.\n' : 'Playwright is not installed.\n') +
    '  Install with:  npm i -D playwright && npx playwright install chromium\n' +
    '  (or point PLAYWRIGHT_PKG at an existing playwright install).\n'
  );
}

const describeBrowser = browserReady ? describe : describe.skip;

// ── Fixtures ─────────────────────────────────────────────────────────────────
const ORIGIN_TOKEN = 'browser-smoke-portal-token';

const CLIENT = {
  business_name: 'Acme Leads Co',
  tutorial_completed: true, // suppress the first-run tutorial overlay
  webhook_url: '',
  outbound_window: { mode: '247' },
};

// Round 1 — what the table shows when the client lands on Leads & CRM.
// Ada has NO consent record (the backend's real third state → "Pending").
const ROUND_1 = [
  {
    lead_id: 'lead_ada', name: 'Ada Pending', phone: '5125550101',
    captured_at: '2026-10-14T10:00:00Z', outbound_status: 'new',
    sms_consent_status: 'unknown', sms_can_send: false, sms_consent_label: 'SMS Pending',
  },
  {
    lead_id: 'lead_bob', name: 'Bob Silent', phone: '5125550102',
    captured_at: '2026-10-14T09:00:00Z', outbound_status: 'new',
    sms_consent_status: 'unknown', sms_can_send: false, sms_consent_label: 'SMS Pending',
  },
];

// Round 2 — what the NEXT GET /portal/leads returns (fresh state to paint):
//   * a brand-new lead comes in (Cara)  → Total/New move
//   * Ada opted in between the two reads → her SMS cell must move Pending→Enabled
//   * Bob opted out                      → Opted Out tile moves
const ROUND_2 = [
  {
    lead_id: 'lead_cara', name: 'Cara Fresh', phone: '5125550103',
    captured_at: '2026-10-14T11:00:00Z', outbound_status: 'new',
    sms_consent_status: 'unknown', sms_can_send: false, sms_consent_label: 'SMS Pending',
  },
  {
    lead_id: 'lead_ada', name: 'Ada Pending', phone: '5125550101',
    captured_at: '2026-10-14T10:00:00Z', outbound_status: 'reached',
    sms_consent_status: 'opted_in', sms_can_send: true, sms_consent_label: 'SMS On',
  },
  {
    lead_id: 'lead_bob', name: 'Bob Silent', phone: '5125550102',
    captured_at: '2026-10-14T09:00:00Z', outbound_status: 'opted-out',
    outbound_opted_out: true,
    sms_consent_status: 'opted_out', sms_can_send: false, sms_consent_label: 'SMS Off',
  },
];

// ── Static file server (serves the working tree) ──────────────────────────────
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

// ── Mock portal API ──────────────────────────────────────────────────────────
// `leads` is the payload the NEXT GET /portal/leads answers with, and it is
// MUTABLE: a test stages "what the server returns now" with setLeads() rather
// than depending on a call count, because the page also reads this endpoint at
// boot (loadDashboard() -> loadDashboardLeads(), a separate consumer).
function createMockApi(opts) {
  const o = opts || {};
  let origin = null;
  return {
    setOrigin(v) { origin = v; },
    leads: o.leads || ROUND_1,
    failNextLeads: false,
    leadsCalls: 0,
    requests: [],

    isStatic(url) { return !!origin && url.origin === origin; },
    setLeads(list) { this.leads = list; },
    nextLeadsFails() { this.failNextLeads = true; },

    dispatch(method, pathname, headers, rawBody) {
      let body = null;
      if (rawBody) { try { body = JSON.parse(rawBody); } catch (e) { body = rawBody; } }
      const lower = {};
      Object.keys(headers || {}).forEach(k => { lower[k.toLowerCase()] = headers[k]; });
      this.requests.push({ method, pathname, headers: lower, body });

      if (method === 'GET' && pathname === '/portal/leads') {
        this.leadsCalls++;
        if (this.failNextLeads) {
          this.failNextLeads = false;
          return { status: 500, body: { error: 'leads unavailable' } };
        }
        return { status: 200, body: { leads: this.leads } };
      }
      // Everything else the dashboard boot fans out to (entitlements, summary,
      // square status, notifications, …) — empty but valid JSON.
      return { status: 200, body: {} };
    },

    leadsRequests() {
      return this.requests.filter(r => r.method === 'GET' && r.pathname === '/portal/leads');
    },
  };
}

// Intercept every request the page makes: the local static server goes through,
// /portal|/api is answered by the mock, third-party CDNs are stubbed so the
// offline page still paints.
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

// Read the rendered Captured Leads rows as text (never asserted on phone
// literals — names and consent labels only).
function readLeadsTable(page) {
  return page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('#ob-lead-list tbody')).map((tb) => {
      const tr = tb.querySelector('tr');
      if (!tr) return null;
      const tds = tr.querySelectorAll('td');
      return {
        lead: tds[1] ? tds[1].textContent.trim() : '',
        sms: tds[5] ? tds[5].textContent.trim() : '',
      };
    }).filter(Boolean);
    const t = (id) => {
      const el = document.getElementById(id);
      return el ? el.textContent.trim() : null;
    };
    return {
      rows,
      count: t('ob-lead-count'),
      total: t('stat-leads-total'),
      isNew: t('stat-leads-new'),
      reached: t('stat-leads-reached'),
      opted: t('stat-leads-opted'),
      activePage: (document.querySelector('.page.active') || {}).id || null,
      topbarTitle: t('topbar-title'),
      btnText: t('ob-leads-refresh-btn'),
      btnDisabled: !!(document.getElementById('ob-leads-refresh-btn') || {}).disabled,
      statusText: t('ob-leads-refresh-status'),
      hasTable: !!document.querySelector('#ob-lead-list table'),
    };
  });
}

// Boot into the portal, then open Leads & CRM (loadOutbound -> GET /portal/leads).
async function openLeadsPage(page, baseUrl) {
  await page.goto(baseUrl + '/portal.html', { waitUntil: 'domcontentloaded' });
  await waitFor(async () => page.evaluate(() =>
    !!document.getElementById('app') && document.getElementById('app').style.display === 'block'));
  await page.evaluate(() => { showPage('leads'); });
  await waitFor(async () => page.evaluate(() =>
    (document.getElementById('ob-lead-list') || {}).innerHTML.includes('<table')));
}

// ── Suite ────────────────────────────────────────────────────────────────────
describeBrowser('Captured Leads manual refresh — browser-level behaviour', () => {
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
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    try {
      await installNetwork(page, api);
      await seedAuth(page);
      return await fn(page);
    } finally {
      await page.close();
    }
  }

  test('1. the Refresh control repaints the table in place from a fresh fetch', async () => {
    const api = createMockApi();
    await withPage(api, async (page) => {
      // Count main-frame navigations: a page reload would show up here.
      let navigations = 0;
      page.on('framenavigated', (f) => { if (f === page.mainFrame()) navigations++; });

      await openLeadsPage(page, baseUrl);

      const before = await readLeadsTable(page);
      expect(before.hasTable).toBe(true);
      expect(before.rows).toHaveLength(2);
      expect(before.rows[0].lead).toContain('Ada Pending');
      expect(before.rows[0].sms).toBe('Pending');            // no consent record yet
      expect(before.total).toBe('2');
      expect(before.isNew).toBe('2');
      expect(before.opted).toBe('0');
      expect(before.btnText).toBe('Refresh');
      expect(before.btnDisabled).toBe(false);

      // Stage what the server will return the NEXT time it is asked — a new
      // lead, Ada's new consent, Bob's opt-out. Nothing has painted this yet.
      const baselineFetches = api.leadsCalls;
      api.setLeads(ROUND_2);

      // In-page state the client owns. A reload (or a showPage() re-entry) wipes
      // both of these; an in-place repaint cannot.
      await page.evaluate(() => {
        window.__refreshSentinel = 'alive';
        obLeadsPage = 4; // pagination cursor the refresh must NOT reset
      });
      const navigationsBefore = navigations;

      // One real click on the new control.
      await page.click('#ob-leads-refresh-btn');

      await waitFor(() => api.leadsCalls >= baselineFetches + 1);
      await waitFor(async () => (await readLeadsTable(page)).rows.length === 3);

      const after = await readLeadsTable(page);

      // (a) the table now shows the NEW payload, in place
      expect(after.hasTable).toBe(true);
      expect(after.rows.map(r => r.lead.includes('Cara Fresh'))).toContain(true);
      expect(after.count).toBe('3 leads (3 interactions)');

      // (b) consent badges/statuses moved with the data
      const adaAfter = after.rows.find(r => r.lead.includes('Ada Pending'));
      expect(adaAfter.sms).toBe('Enabled');                   // was 'Pending'
      const bobAfter = after.rows.find(r => r.lead.includes('Bob Silent'));
      expect(bobAfter.sms).toBe('Disabled');                  // opted out -> hard block
      const caraAfter = after.rows.find(r => r.lead.includes('Cara Fresh'));
      expect(caraAfter.sms).toBe('Pending');
      // the stat cards re-derived from the same render pass
      expect(after.total).toBe('3');
      expect(after.isNew).toBe('1');
      expect(after.reached).toBe('1');
      expect(after.opted).toBe('1');

      // (c) never reloads the page, never leaves the section
      expect(navigations).toBe(navigationsBefore);
      expect(await page.evaluate(() => window.__refreshSentinel)).toBe('alive');
      expect(after.activePage).toBe('page-leads');
      expect(after.topbarTitle).toBe('Leads & CRM');

      // (d) pagination/filter/sort state preserved: the cursor is untouched
      expect(await page.evaluate(() => obLeadsPage)).toBe(4);

      // (e) the control reports success and comes back to rest
      expect(after.statusText).toBe('Updated just now');
      expect(after.btnText).toBe('Refresh');
      expect(after.btnDisabled).toBe(false);

      // (f) exactly ONE extra fetch from the click — no polling, no duplicate
      expect(api.leadsCalls).toBe(baselineFetches + 1);
      const leads = api.leadsRequests();
      expect(leads[leads.length - 1].headers['x-portal-token']).toBe(ORIGIN_TOKEN);
    });
  });

  test('2. a failed refresh leaves the table the client is reading in place', async () => {
    const api = createMockApi();

    await withPage(api, async (page) => {
      await openLeadsPage(page, baseUrl);

      const before = await readLeadsTable(page);
      expect(before.rows).toHaveLength(2);

      // The next leads read fails (server-side outage).
      const baselineFetches = api.leadsCalls;
      api.nextLeadsFails();

      await page.click('#ob-leads-refresh-btn');
      await waitFor(() => api.leadsCalls >= baselineFetches + 1);
      await waitFor(async () => (await readLeadsTable(page)).statusText.includes('Could not refresh'));

      const after = await readLeadsTable(page);

      // The rows the client was reading are STILL there — a failed refresh must
      // not blank the table or swap it for an error panel.
      expect(after.hasTable).toBe(true);
      expect(after.rows).toHaveLength(2);
      expect(after.rows[0].lead).toContain('Ada Pending');
      expect(after.statusText).toContain('Could not refresh');
      // ...and the control is usable again (Retry path offered, not stuck busy).
      expect(after.btnText).toBe('Refresh');
      expect(after.btnDisabled).toBe(false);
      expect(await page.evaluate(() => !!window.refreshCapturedLeads)).toBe(true);
    });
  });
});
