// test/portal-campaigns-browser.test.js — BROWSER-LEVEL E2E for the portal's
// Campaigns builder UI (voice + SMS). Audit gap F5, ticket
// zeus_1793167127548_304cc372 (audit zeus_1793166491472_e99e6c8e).
//
// WHY THIS FILE EXISTS
// Campaigns are an outbound-spend surface: "Start" on the wrong lead set is a
// real cost/compliance risk. atlas-ai covers the services (campaignService,
// smsCampaignService, campaignEntitlement) but NOTHING rendered the portal
// campaigns page, so a wrong fetch method/path, a status chip that does not
// follow the response, or an entitlement gate that lets an unentitled plan
// reach the dialer would all ship green. This suite drives a real Chromium
// (Playwright) against the real portal.html served off the working tree, with
// the campaign API mocked at the network layer (offline, deterministic, no
// real call/SMS is ever placed).
//
// Covered, per the ticket's expected assertions:
//   1. entitlement gate: a plan without bulkCallCampaigns/bulkSmsCampaigns
//      hides the Campaigns nav, redirects showPage('campaigns') to the
//      dashboard, and issues ZERO /outbound/* requests;
//   2. an entitled plan renders the catalog (list + status chips + per-tab);
//   3. create campaign sends the exact POST (method, path, token, body with
//      the CSV-parsed leads) and refreshes the list;
//   4. detail/start/pause/delete issue the correct request and the status
//      chip follows the response (draft -> active -> paused -> deleted);
//   5. failure scenarios: API 500 on start (UI shows the failure, never
//      "running"), start on an empty campaign, client-side empty guards;
//   6. the SMS variant: create sends the exact POST incl. throttle_per_min;
//      start/pause/delete issue the correct requests.
//
// KNOWN BUG FOUND BY THIS SUITE (documented, NOT fixed here — this ticket is
// test-only): portal.html's SMS campaigns code renders with esc(...)
// (loadSmsCampaigns campaign rows and viewSmsCampaign's lead table) but NO
// global esc exists on the page — the inline scripts define escapeHtml and
// the js/*.js modules keep their esc private inside IIFEs. At runtime
// (verified against the working tree):
//   - loadSmsCampaigns() with >=1 campaign throws ReferenceError, caught by
//     its own try/catch, so #sms-cmp-list always shows "Could not load SMS
//     campaigns." — the SMS list can never render a campaign;
//   - viewSmsCampaign(id) with >=1 lead throws the same way BEFORE the modal
//     is shown, so the SMS detail modal never opens (toast: "esc is not
//     defined"). The modal's Start/Pause/Delete buttons are unreachable.
// The expected-render assertions therefore live in inverted tripwire tests
// (11 + 12): they assert the CURRENT broken state so the suite stays green,
// and they FAIL the day esc() is fixed, forcing that change to carry ordinary
// positive assertions for the SMS render. Fixing it is a one-line application
// change (use escapeHtml) that this ticket forbids.

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
// Treat either gap as "skip", not "fail": auzora-website has no CI job that
// would install it, and an absent browser must not turn the suite red.
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
    '\n[portal-campaigns-browser] SKIPPING the campaigns browser E2E — ' +
    (chromium ? 'Playwright is installed but its Chromium build is not.\n' : 'Playwright is not installed.\n') +
    '  Install with:  npm i -D playwright && npx playwright install chromium\n' +
    '  (or point PLAYWRIGHT_PKG at an existing playwright install).\n'
  );
}

const describeBrowser = browserReady ? describe : describe.skip;

// ── Shared fixtures (synthetic only — no real leads, no real send path) ──────
const ORIGIN_TOKEN = 'campaigns-e2e-portal-token';

const CLIENT = {
  business_name: 'Campaigns E2E Co',
  tutorial_completed: true, // suppress the first-run tutorial overlay
  webhook_url: '',
};

// Known-good usage shape for the dashboard boot (same payload family the
// billing browser suite uses; renderUsageCard reads it off the same
// /portal/entitlements response).
const BASE_USAGE = {
  voiceMinutes: 10,
  smsMessages: 10,
  limits: { voiceMinutes: 2500, smsMessages: 5000 },
  percentUsed: { voice: 1, sms: 1 },
  period: '2026-11',
  unlimited: false,
  included: { voice: 1250, sms: 5000 },
  overage: { voice: 0, sms: 0 },
};

// Entitlement flag sets. Legacy plans gate bulk campaigns OFF (atlas-ai
// tiers.js: current tiers true, legacy tiers false); every other flag is
// irrelevant to this page but included so the boot renders normally.
const ENTITLED = {
  bulkCallCampaigns: true,
  bulkSmsCampaigns: true,
  externalCrmIntegration: true,
  manualOutboundCalls: true,
  internalCrm: true,
  aiFollowUpCalls: true,
};
const NOT_ENTITLED = {
  bulkCallCampaigns: false,
  bulkSmsCampaigns: false,
  externalCrmIntegration: false,
  manualOutboundCalls: false,
  aiFollowUpCalls: true,
};

const LEADS_TWO = [
  { phone: '5551234567', name: 'John Smith', service: 'Pool Cleaning', notes: 'Called last week' },
  { phone: '5559876543', name: 'Jane Doe', service: '', notes: 'Interested in weekly service' },
];
const LEAD_LIST_TEXT = [
  '5551234567, John Smith, Pool Cleaning, Called last week',
  '5559876543, Jane Doe, , Interested in weekly service',
].join('\n');

const SMS_TEMPLATE = 'Hi {{name}}, this is {{business_name}}. Book here: {{booking_url}}';

const CALL_DRAFT = {
  campaign_id: 'cmp-e2e-voice-draft',
  name: 'E2E Draft Dial',
  status: 'draft',
  script_context: 'Mention the spring discount',
  created_at: '2026-11-01T15:00:00.000Z',
  stats: { total: 3, reached: 0, 'no-answer': 0, deferred: 0, voicemail: 0, pending: 3, 'opted-out': 0 },
  leads: [
    { phone: '+15551230001', name: 'John Smith', outbound_status: 'pending' },
    { phone: '+15551230002', name: 'Jane Doe', outbound_status: 'pending' },
    { phone: '+15551230003', name: 'Sam Lee', outbound_status: 'pending' },
  ],
};

const CALL_EMPTY = {
  campaign_id: 'cmp-e2e-voice-empty',
  name: 'E2E Empty Dial',
  status: 'draft',
  created_at: '2026-11-02T15:00:00.000Z',
  stats: { total: 0, reached: 0, pending: 0 },
  leads: [],
};

const SMS_DRAFT = {
  campaign_id: 'cmp-e2e-sms-1',
  name: 'E2E SMS Blast',
  status: 'draft',
  message_template: SMS_TEMPLATE,
  created_at: '2026-11-03T15:00:00.000Z',
  stats: { total: 2, sent: 0, delivered: 0, failed: 0, 'opted-out': 0, pending: 2 },
  leads: [
    { phone: '+15551230001', name: 'John Smith', sms_status: 'pending' },
    { phone: '+15551230002', name: 'Jane Doe', sms_status: 'pending' },
  ],
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

// ── Mock portal + campaigns API (stateful; drives the network layer) ─────────
// The portal talks to https://atlas.6845165.xyz with pathnames /portal/* and
// /outbound/* — the route interceptor answers those by pathname, so the mock
// is origin-agnostic exactly like the billing suite's.
function createMockApi(opts) {
  const o = opts || {};
  let createdSeq = 0;

  const api = {
    plan: o.plan || 'Pro',
    entitlementFlags: o.entitlements || ENTITLED,
    callCampaigns: (o.callCampaigns || []).map(c => JSON.parse(JSON.stringify(c))),
    smsCampaigns: (o.smsCampaigns || []).map(c => JSON.parse(JSON.stringify(c))),
    // failure injection for start endpoints (both variants)
    startStatus: o.startStatus || 200,
    startError: o.startError || 'dialer unavailable',
    requests: [],

    entitlementsPayload() {
      return {
        plan: this.plan,
        tier: '',
        entitlements: Object.assign({}, this.entitlementFlags),
        tierVoices: null,
        usage: BASE_USAGE,
        allow_overage: { voice: false, sms: false },
      };
    },

    isStatic(url, origin) {
      return url.origin === origin;
    },

    dispatch(method, pathname, headers, rawBody) {
      let body = null;
      if (rawBody) { try { body = JSON.parse(rawBody); } catch (e) { body = rawBody; } }
      const lower = {};
      Object.keys(headers || {}).forEach(k => { lower[k.toLowerCase()] = headers[k]; });
      this.requests.push({ method, pathname, headers: lower, body });

      if (method === 'GET' && pathname === '/portal/entitlements') {
        return { status: 200, body: this.entitlementsPayload() };
      }
      if (pathname === '/portal/activity') {
        return { status: 200, body: { events: [] } };
      }

      // ── Call campaigns ──
      if (pathname === '/outbound/campaigns' && method === 'GET') {
        return { status: 200, body: { campaigns: this.callCampaigns } };
      }
      if (pathname === '/outbound/campaigns' && method === 'POST') {
        const leads = (body && body.leads) || [];
        const created = Object.assign({}, body, {
          campaign_id: 'cmp-e2e-created-' + (++createdSeq),
          status: 'draft',
          created_at: '2026-11-08T12:00:00.000Z',
          stats: { total: leads.length, reached: 0, pending: leads.length },
          leads: leads.map(l => Object.assign({ outbound_status: 'pending' }, l)),
        });
        this.callCampaigns.push(created);
        return { status: 200, body: { success: true, imported: leads.length, skipped: [] } };
      }

      // ── SMS campaigns ──
      if (pathname === '/outbound/sms/campaigns' && method === 'GET') {
        return { status: 200, body: { campaigns: this.smsCampaigns } };
      }
      if (pathname === '/outbound/sms/campaigns' && method === 'POST') {
        const leads = (body && body.leads) || [];
        const created = Object.assign({}, body, {
          campaign_id: 'cmp-e2e-sms-created-' + (++createdSeq),
          status: 'draft',
          created_at: '2026-11-08T12:00:00.000Z',
          stats: { total: leads.length, sent: 0, delivered: 0, failed: 0, 'opted-out': 0, pending: leads.length },
          leads: leads.map(l => Object.assign({ sms_status: 'pending' }, l)),
        });
        this.smsCampaigns.push(created);
        return { status: 200, body: { success: true, imported: leads.length } };
      }

      // ── /outbound[/sms]/campaigns/:id(, /start, /pause) ──
      const m = pathname.match(/^\/outbound(?:\/sms)?\/campaigns\/([^/]+)(\/start|\/pause)?$/);
      if (m) {
        const isSms = pathname.startsWith('/outbound/sms/');
        const store = isSms ? this.smsCampaigns : this.callCampaigns;
        const campaign = store.find(c => c.campaign_id === m[1]);

        if (method === 'DELETE') {
          if (!campaign) return { status: 404, body: { error: 'not found' } };
          store.splice(store.indexOf(campaign), 1);
          return { status: 200, body: { success: true } };
        }
        if (method === 'GET' && !m[2]) {
          if (!campaign) return { status: 404, body: { error: 'not found' } };
          return { status: 200, body: { campaign } };
        }
        if (method === 'POST' && m[2]) {
          if (!campaign) return { status: 404, body: { error: 'not found' } };
          if (campaign.leads.length === 0) {
            // Mirrors the server's empty-campaign validation.
            return { status: 400, body: { error: 'No leads in this campaign' } };
          }
          if (this.startStatus >= 400) {
            return { status: this.startStatus, body: { error: this.startError } };
          }
          campaign.status = m[2] === '/start' ? 'active' : 'paused';
          return { status: 200, body: { success: true } };
        }
      }

      // Everything else the boot fans out to (appointments, leads, summary,
      // conversations preload, …) — empty but valid JSON, as in the billing
      // browser suite.
      return { status: 200, body: {} };
    },

    reqs(method, pathname) {
      return this.requests.filter(r => r.method === method && r.pathname === pathname);
    },
    outboundReqs() {
      return this.requests.filter(r => r.pathname.startsWith('/outbound/'));
    },
  };
  return api;
}

// Intercept every request the page makes: let the local static server through,
// answer the portal API with the mock, and stub third-party CDNs (the page
// loads lucide + Google Fonts; offline that must not stall the render).
async function installNetwork(page, api, baseUrl) {
  await page.route('**/*', (route) => {
    const req = route.request();
    const url = new URL(req.url());

    if (api.isStatic(url, baseUrl)) return route.continue();

    if (url.pathname.startsWith('/portal/') || url.pathname.startsWith('/outbound/') || url.pathname.startsWith('/api/')) {
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
    let ok = false;
    try { ok = await fn(); } catch (e) { ok = false; }
    if (ok) return undefined;
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise(r => setTimeout(r, 60));
  }
}

// Load the portal and wait until the app has booted behind the auth gate.
async function loadPortal(page, baseUrl) {
  await page.goto(baseUrl + '/portal.html', { waitUntil: 'domcontentloaded' });
  await waitFor(async () => page.evaluate(() =>
    document.getElementById('app') && document.getElementById('app').style.display === 'block'));
}

async function goCampaigns(page) {
  await page.click('#nav-campaigns');
  await waitFor(async () => page.evaluate(() =>
    document.getElementById('page-campaigns').classList.contains('active')));
  await waitFor(async () => page.evaluate(() => {
    const el = document.getElementById('cmp-list');
    return !!el && el.textContent.indexOf('Loading campaigns…') === -1 && el.innerHTML.length > 0;
  }));
}

// Toast helper — #toast keeps its text for 3s, so poll quickly.
async function readToast(page) {
  return page.evaluate(() => ({
    text: document.getElementById('toast').textContent,
    cls: document.getElementById('toast').className,
  }));
}
async function waitForToast(page, testFn, timeoutMs = 8000) {
  await waitFor(async () => {
    const t = await readToast(page);
    return testFn(t);
  }, timeoutMs);
  return readToast(page);
}

// Row chip reader for the call-campaigns list (2nd cell holds the status chip).
// Only DATA rows count: the renderer emits `<table><tr><th>…</tr><tbody>…` and
// the HTML parser wraps the header row in an anonymous tbody of its own, so
// selector-level tbody targeting alone picks the header up too.
function readListRows(page, listSel) {
  return page.evaluate((sel) => Array.from(document.querySelectorAll(sel + ' tr'))
    .filter(tr => tr.querySelector('td'))
    .map(tr => ({
      text: tr.textContent,
      chip: tr.querySelector('td:nth-child(2)') ? tr.querySelector('td:nth-child(2)').textContent.trim() : '',
    })), listSel);
}

// ── Suite ────────────────────────────────────────────────────────────────────
describeBrowser('portal campaigns UI (voice + SMS) — browser E2E', () => {
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
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    try {
      await installNetwork(page, api, baseUrl);
      await seedAuth(page);
      return await fn(page);
    } finally {
      await page.close();
    }
  }

  test('1. entitlement gate: a plan without bulk-campaign flags hides the nav, redirects to the dashboard and issues no /outbound request', async () => {
    const api = createMockApi({ entitlements: NOT_ENTITLED, plan: 'Legacy Starter' });

    await withPage(api, async (page) => {
      await loadPortal(page, baseUrl);

      // (a) the Campaigns nav item is hidden for this plan
      const navHidden = await page.evaluate(() =>
        document.getElementById('nav-campaigns').style.display === 'none');
      expect(navHidden).toBe(true);

      // (b) showPage('campaigns') — the nav item's own handler — must bounce
      //     to the dashboard, never activate the campaigns page
      await page.evaluate(() => showPage('campaigns'));
      const pages = await page.evaluate(() => ({
        campaignsActive: document.getElementById('page-campaigns').classList.contains('active'),
        dashboardActive: document.getElementById('page-dashboard').classList.contains('active'),
      }));
      expect(pages.campaignsActive).toBe(false);
      expect(pages.dashboardActive).toBe(true);

      // (c) and it issued NO /outbound/* request at all — an unentitled plan
      //     never even touches the campaign API ("issues no request")
      expect(api.outboundReqs()).toEqual([]);

      // (d) both campaign sub-tabs are hidden for this plan
      const tabsHidden = await page.evaluate(() => ({
        call: document.querySelector('.cmp-tab[data-tab="call"]').style.display,
        sms: document.querySelector('.cmp-tab[data-tab="sms"]').style.display,
      }));
      expect(tabsHidden.call).toBe('none');
      expect(tabsHidden.sms).toBe('none');
    });
  });

  test('2. entitled plan: Campaigns nav visible, both tabs visible, catalog renders with status chips', async () => {
    const api = createMockApi({ callCampaigns: [CALL_DRAFT, CALL_EMPTY], smsCampaigns: [SMS_DRAFT] });

    await withPage(api, async (page) => {
      await loadPortal(page, baseUrl);
      await goCampaigns(page);

      const state = await page.evaluate(() => ({
        navDisplay: document.getElementById('nav-campaigns').style.display,
        callTab: document.querySelector('.cmp-tab[data-tab="call"]').style.display,
        smsTab: document.querySelector('.cmp-tab[data-tab="sms"]').style.display,
        title: document.getElementById('topbar-title').textContent,
      }));
      expect(state.navDisplay).toBe('');
      expect(state.callTab).toBe('');
      expect(state.smsTab).toBe('');
      expect(state.title).toBe('Campaigns');

      // Catalog rows render with the status chip following the seeded status
      const rows = await readListRows(page, '#cmp-list');
      expect(rows.length).toBe(2);
      expect(rows[0].text).toContain('E2E Draft Dial');
      expect(rows[0].chip).toBe('draft');
      expect(rows[1].text).toContain('E2E Empty Dial');
      expect(rows[1].chip).toBe('draft');

      // Both catalogs were fetched with the portal token header
      const listGets = api.reqs('GET', '/outbound/campaigns');
      expect(listGets.length).toBeGreaterThan(0);
      expect(listGets[0].headers['x-portal-token']).toBe(ORIGIN_TOKEN);
      const smsGets = api.reqs('GET', '/outbound/sms/campaigns');
      expect(smsGets.length).toBeGreaterThan(0);
      expect(smsGets[0].headers['x-portal-token']).toBe(ORIGIN_TOKEN);
    });
  });

  test('3. create call campaign: exact POST (method/path/token/body with CSV-parsed leads), success status line, form cleared, list refreshed', async () => {
    const api = createMockApi({ callCampaigns: [CALL_DRAFT], smsCampaigns: [] });

    await withPage(api, async (page) => {
      await loadPortal(page, baseUrl);
      await goCampaigns(page);

      // Client-side guards first: no name → no request; name but no leads → no request.
      await page.click('#cmp-create-btn');
      await waitForToast(page, t => t.cls.includes('error') && t.text.includes('Campaign name is required'));
      expect(api.reqs('POST', '/outbound/campaigns')).toEqual([]);

      await page.fill('#cmp-name', 'E2E Voice Blast');
      await page.click('#cmp-create-btn');
      await waitForToast(page, t => t.cls.includes('error') && t.text.includes('Add at least one lead (phone number required)'));
      expect(api.reqs('POST', '/outbound/campaigns')).toEqual([]);

      // The real create: name + script + CSV-pasted lead list.
      await page.fill('#cmp-script', 'Mention the spring discount');
      await page.fill('#cmp-leads', LEAD_LIST_TEXT);
      await page.click('#cmp-create-btn');

      await waitFor(() => api.reqs('POST', '/outbound/campaigns').length === 1);
      const post = api.reqs('POST', '/outbound/campaigns')[0];
      expect(post.headers['x-portal-token']).toBe(ORIGIN_TOKEN);
      expect(post.headers['content-type']).toContain('application/json');
      expect(post.body).toEqual({
        name: 'E2E Voice Blast',
        script_context: 'Mention the spring discount',
        max_retries: 2,
        retry_delay_minutes: 60,
        leads: LEADS_TWO,
      });

      // Success status line + toast + form cleared.
      await waitFor(async () => (await page.evaluate(() =>
        document.getElementById('cmp-create-status').textContent)) === '✓ Created — 2 leads imported');
      await waitForToast(page, t => t.cls.includes('success') && t.text.includes('Campaign "E2E Voice Blast" created with 2 leads ✓'));
      const cleared = await page.evaluate(() => ({
        name: document.getElementById('cmp-name').value,
        script: document.getElementById('cmp-script').value,
        leads: document.getElementById('cmp-leads').value,
      }));
      expect(cleared).toEqual({ name: '', script: '', leads: '' });

      // The list was refreshed: the created campaign is now in the catalog.
      await waitFor(async () => (await readListRows(page, '#cmp-list')).length === 2);
      const rows = await readListRows(page, '#cmp-list');
      expect(rows[1].text).toContain('E2E Voice Blast');
      expect(rows[1].chip).toBe('draft');
      expect(rows[1].text).toContain('2 leads');
    });
  });

  test('4. detail modal + lifecycle: start/pause issue the correct request and the status chip follows the response', async () => {
    const api = createMockApi({ callCampaigns: [CALL_DRAFT] });

    await withPage(api, async (page) => {
      await loadPortal(page, baseUrl);
      await goCampaigns(page);

      // Open the detail modal like a user (row click → GET /outbound/campaigns/:id)
      await page.locator('#cmp-list tr', { hasText: 'E2E Draft Dial' }).first().click();
      await waitFor(() => api.reqs('GET', '/outbound/campaigns/cmp-e2e-voice-draft').length === 1);
      const detailGet = api.reqs('GET', '/outbound/campaigns/cmp-e2e-voice-draft')[0];
      expect(detailGet.headers['x-portal-token']).toBe(ORIGIN_TOKEN);

      // The modal shell is shown synchronously; wait for the FETCH+RENDER to
      // complete (title set from the payload) before reading the chip/actions.
      await waitFor(async () => (await page.evaluate(() =>
        document.getElementById('cmp-modal-title').textContent)) === 'E2E Draft Dial');
      const detail = await page.evaluate(() => ({
        title: document.getElementById('cmp-modal-title').textContent,
        chip: document.getElementById('cmp-modal-status').querySelector('span').textContent,
        actions: Array.from(document.querySelectorAll('#cmp-modal-actions button')).map(b => b.textContent),
        leadRows: Array.from(document.querySelectorAll('#cmp-modal-leads tr')).filter(tr => tr.querySelector('td')).length,
      }));
      expect(detail.title).toBe('E2E Draft Dial');
      expect(detail.chip).toBe('draft');
      expect(detail.leadRows).toBe(3);
      // A draft offers Start + Delete, but NOT Pause (only an active one does).
      expect(detail.actions).toEqual(['▶ Start Dialing', '🗑 Delete']);

      // START — exact request; mock flips the status; the re-rendered modal
      // chip must follow the response (draft → active).
      await page.locator('#cmp-modal-actions button', { hasText: 'Start Dialing' }).click();
      await waitFor(() => api.reqs('POST', '/outbound/campaigns/cmp-e2e-voice-draft/start').length === 1);
      const startPost = api.reqs('POST', '/outbound/campaigns/cmp-e2e-voice-draft/start')[0];
      expect(startPost.headers['x-portal-token']).toBe(ORIGIN_TOKEN);

      await waitForToast(page, t => t.cls.includes('success') && t.text.includes('Campaign started — AI will dial leads during business hours ✓'));
      await waitFor(async () => (await page.evaluate(() =>
        document.getElementById('cmp-modal-status').querySelector('span').textContent)) === 'active');
      const activeActions = await page.evaluate(() =>
        Array.from(document.querySelectorAll('#cmp-modal-actions button')).map(b => b.textContent));
      // Active offers Pause (no Start), Delete stays.
      expect(activeActions).toEqual(['⏸ Pause', '🗑 Delete']);

      // The campaigns list also reloaded and now shows the active chip.
      await waitFor(async () => {
        const rows = await readListRows(page, '#cmp-list');
        return rows[0] && rows[0].chip === 'active';
      });

      // PAUSE — exact request; chip follows (active → paused); Start returns.
      await page.locator('#cmp-modal-actions button', { hasText: 'Pause' }).click();
      await waitFor(() => api.reqs('POST', '/outbound/campaigns/cmp-e2e-voice-draft/pause').length === 1);
      const pausePost = api.reqs('POST', '/outbound/campaigns/cmp-e2e-voice-draft/pause')[0];
      expect(pausePost.headers['x-portal-token']).toBe(ORIGIN_TOKEN);

      await waitForToast(page, t => t.cls.includes('info') && t.text.includes('Campaign paused'));
      await waitFor(async () => (await page.evaluate(() =>
        document.getElementById('cmp-modal-status').querySelector('span').textContent)) === 'paused');
      const pausedActions = await page.evaluate(() =>
        Array.from(document.querySelectorAll('#cmp-modal-actions button')).map(b => b.textContent));
      expect(pausedActions).toEqual(['▶ Start Dialing', '🗑 Delete']);
    });
  });

  test('5. delete: confirm dialog, exact DELETE request, modal closes, row removed from the list', async () => {
    const api = createMockApi({ callCampaigns: [CALL_DRAFT, CALL_EMPTY] });

    await withPage(api, async (page) => {
      await loadPortal(page, baseUrl);
      await goCampaigns(page);

      await page.locator('#cmp-list tr', { hasText: 'E2E Draft Dial' }).first().click();
      await waitFor(async () => (await page.evaluate(() =>
        document.getElementById('cmp-modal-title').textContent)) === 'E2E Draft Dial');

      // deleteCampaign() guards with window.confirm — accept it.
      page.once('dialog', (dialog) => dialog.accept());
      await page.locator('#cmp-modal-actions button', { hasText: 'Delete' }).click();

      await waitFor(() => api.reqs('DELETE', '/outbound/campaigns/cmp-e2e-voice-draft').length === 1);
      const del = api.reqs('DELETE', '/outbound/campaigns/cmp-e2e-voice-draft')[0];
      expect(del.headers['x-portal-token']).toBe(ORIGIN_TOKEN);

      await waitForToast(page, t => t.cls.includes('info') && t.text.includes('Campaign deleted'));

      // Modal closed and the list no longer contains the deleted campaign.
      await waitFor(async () => (await page.evaluate(() =>
        document.getElementById('cmp-modal').style.display)) === 'none');
      await waitFor(async () => (await readListRows(page, '#cmp-list')).length === 1);
      const rows = await readListRows(page, '#cmp-list');
      expect(rows[0].text).toContain('E2E Empty Dial');
    });
  });

  test('6. failure: API 500 on start shows the failure and never claims "running"', async () => {
    const api = createMockApi({ callCampaigns: [CALL_DRAFT], startStatus: 500, startError: 'dialer unavailable' });

    await withPage(api, async (page) => {
      await loadPortal(page, baseUrl);
      await goCampaigns(page);

      await page.locator('#cmp-list tr', { hasText: 'E2E Draft Dial' }).first().click();
      await waitFor(async () => (await page.evaluate(() =>
        document.getElementById('cmp-modal-title').textContent)) === 'E2E Draft Dial');

      await page.locator('#cmp-modal-actions button', { hasText: 'Start Dialing' }).click();
      await waitFor(() => api.reqs('POST', '/outbound/campaigns/cmp-e2e-voice-draft/start').length === 1);

      // Error toast carries the server's message.
      await waitForToast(page, t => t.cls.includes('error') && t.text.includes('dialer unavailable'));

      // The chip did NOT move to active/running, and no second detail fetch
      // happened (the handler re-renders only on success).
      const chip = await page.evaluate(() =>
        document.getElementById('cmp-modal-status').querySelector('span').textContent);
      expect(chip).toBe('draft');
      expect(api.reqs('GET', '/outbound/campaigns/cmp-e2e-voice-draft').length).toBe(1);
      expect(api.reqs('POST', '/outbound/campaigns/cmp-e2e-voice-draft/start').length).toBe(1);

      // Start remains offered (still a draft), Delete stays.
      const actions = await page.evaluate(() =>
        Array.from(document.querySelectorAll('#cmp-modal-actions button')).map(b => b.textContent));
      expect(actions).toEqual(['▶ Start Dialing', '🗑 Delete']);
    });
  });

  test('7. failure: start on an empty campaign surfaces the server rejection and never claims "running"', async () => {
    const api = createMockApi({ callCampaigns: [CALL_EMPTY] });

    await withPage(api, async (page) => {
      await loadPortal(page, baseUrl);
      await goCampaigns(page);

      await page.locator('#cmp-list tr', { hasText: 'E2E Empty Dial' }).first().click();
      await waitFor(async () => (await page.evaluate(() =>
        document.getElementById('cmp-modal-title').textContent)) === 'E2E Empty Dial');

      await page.locator('#cmp-modal-actions button', { hasText: 'Start Dialing' }).click();
      await waitFor(() => api.reqs('POST', '/outbound/campaigns/cmp-e2e-voice-empty/start').length === 1);

      await waitForToast(page, t => t.cls.includes('error') && t.text.includes('No leads in this campaign'));

      const chip = await page.evaluate(() =>
        document.getElementById('cmp-modal-status').querySelector('span').textContent);
      expect(chip).toBe('draft');
      expect(api.reqs('GET', '/outbound/campaigns/cmp-e2e-voice-empty').length).toBe(1);
    });
  });

  test('8. SMS variant: tab switch renders the builder, create sends the exact POST (incl. throttle_per_min) with parsed leads', async () => {
    const api = createMockApi({ callCampaigns: [], smsCampaigns: [] });

    await withPage(api, async (page) => {
      await loadPortal(page, baseUrl);
      await goCampaigns(page);

      // Switch to the SMS campaigns tab (empty state first).
      await page.click('.cmp-tab[data-tab="sms"]');
      await waitFor(async () => page.evaluate(() =>
        document.getElementById('cmp-sms-panel').style.display === 'flex' &&
        document.getElementById('cmp-call-panel').style.display === 'none'));
      await waitFor(async () => (await page.evaluate(() =>
        document.getElementById('sms-cmp-list').textContent)).includes('No SMS campaigns yet'));

      // Client-side: the builder fields are real inputs wired to createSmsCampaign().
      await page.fill('#sms-name', 'E2E SMS Blast');
      await page.fill('#sms-template', SMS_TEMPLATE);
      await page.fill('#sms-leads', LEAD_LIST_TEXT);
      await page.click('#sms-create-btn');

      await waitFor(() => api.reqs('POST', '/outbound/sms/campaigns').length === 1);
      const post = api.reqs('POST', '/outbound/sms/campaigns')[0];
      expect(post.headers['x-portal-token']).toBe(ORIGIN_TOKEN);
      expect(post.body).toEqual({
        name: 'E2E SMS Blast',
        message_template: SMS_TEMPLATE,
        max_retries: 2,
        retry_delay_minutes: 60,
        throttle_per_min: 30,
        leads: LEADS_TWO,
      });

      await waitForToast(page, t => t.cls.includes('success') && t.text.includes('SMS campaign created — 2 leads imported'));
      const cleared = await page.evaluate(() => ({
        name: document.getElementById('sms-name').value,
        template: document.getElementById('sms-template').value,
        leads: document.getElementById('sms-leads').value,
      }));
      expect(cleared).toEqual({ name: '', template: '', leads: '' });

      // The list GET re-fired after create (loadSmsCampaigns contract).
      expect(api.reqs('GET', '/outbound/sms/campaigns').length).toBeGreaterThanOrEqual(2);
    });
  });

  test('9. SMS lifecycle start/pause/delete issue the correct requests (driven at the function level — see known-bug note)', async () => {
    const api = createMockApi({ smsCampaigns: [SMS_DRAFT] });

    await withPage(api, async (page) => {
      await loadPortal(page, baseUrl);
      await goCampaigns(page);

      // KNOWN BUG (esc undefined): the SMS detail modal never opens, so the
      // Start/Pause/Delete buttons inside it are unreachable via the UI.
      // Drive the handlers directly to still pin the REQUEST CONTRACT for each
      // action — the render side of this surface is covered by test 11's
      // test.fails tripwire, which will force a revisit when esc is fixed.
      await page.evaluate(() => startSmsCampaign('cmp-e2e-sms-1'));
      await waitFor(() => api.reqs('POST', '/outbound/sms/campaigns/cmp-e2e-sms-1/start').length === 1);
      const start = api.reqs('POST', '/outbound/sms/campaigns/cmp-e2e-sms-1/start')[0];
      expect(start.headers['x-portal-token']).toBe(ORIGIN_TOKEN);
      expect(api.smsCampaigns[0].status).toBe('active'); // mock flipped on success

      await page.evaluate(() => pauseSmsCampaign('cmp-e2e-sms-1'));
      await waitFor(() => api.reqs('POST', '/outbound/sms/campaigns/cmp-e2e-sms-1/pause').length === 1);
      expect(api.smsCampaigns[0].status).toBe('paused');

      await page.evaluate(() => deleteSmsCampaign('cmp-e2e-sms-1'));
      await waitFor(() => api.reqs('DELETE', '/outbound/sms/campaigns/cmp-e2e-sms-1').length === 1);
      const del = api.reqs('DELETE', '/outbound/sms/campaigns/cmp-e2e-sms-1')[0];
      expect(del.headers['x-portal-token']).toBe(ORIGIN_TOKEN);
      expect(api.smsCampaigns).toHaveLength(0);
    });
  });

  test('10. failure: API 500 on SMS start shows the error toast (function-level, same known-bug caveat)', async () => {
    const api = createMockApi({ smsCampaigns: [SMS_DRAFT], startStatus: 500, startError: 'sms queue unavailable' });

    await withPage(api, async (page) => {
      await loadPortal(page, baseUrl);
      await goCampaigns(page);

      await page.evaluate(() => startSmsCampaign('cmp-e2e-sms-1'));
      await waitFor(() => api.reqs('POST', '/outbound/sms/campaigns/cmp-e2e-sms-1/start').length === 1);
      await waitForToast(page, t => t.cls.includes('error') && t.text.includes('sms queue unavailable'));
      // The mock never flipped the status — nothing claims "running".
      expect(api.smsCampaigns[0].status).toBe('draft');
    });
  });

  // ── KNOWN-BUG TRIPWIRES ─────────────────────────────────────────────────────
  // These assert the CURRENT (broken) render state, so the suite stays green
  // while the esc() bug exists — and they FAIL the moment esc is fixed (the
  // rows render, the modal opens, the error text disappears). At that point
  // the inverted expects below must be flipped into ordinary positive
  // assertions. Do not "fix" the suite by deleting these tests; fix esc() in
  // portal.html (use escapeHtml) instead.
  test('11. KNOWN BUG (esc undefined): SMS list cannot render campaign rows — tripwire flips when esc is fixed', async () => {
    const api = createMockApi({ callCampaigns: [], smsCampaigns: [SMS_DRAFT] });

    await withPage(api, async (page) => {
      await loadPortal(page, baseUrl);
      await goCampaigns(page);

      const html = await page.evaluate(() => document.getElementById('sms-cmp-list').innerHTML);
      const rendersRow = html.includes('E2E SMS Blast');
      const showsError = html.includes('Could not load SMS campaigns');

      // TRIPWIRE: expected behavior is rendersRow === true (row + status badge
      // rendered from the fixture). Actual today: ReferenceError: esc is not
      // defined, swallowed by the renderer's try/catch → the graceful-degradation
      // text is shown instead. When esc is fixed, rendersRow flips to true and
      // the next line FAILS — convert this test to
      //   expect(rendersRow).toBe(true); expect(showsError).toBe(false);
      expect(rendersRow).toBe(false);
      // The broken render degrades gracefully (never a blank/garbage list).
      expect(showsError).toBe(true);
    });
  });

  test('12. KNOWN BUG (esc undefined): SMS detail modal cannot open when leads exist — tripwire flips when esc is fixed', async () => {
    const api = createMockApi({ callCampaigns: [], smsCampaigns: [SMS_DRAFT] });

    await withPage(api, async (page) => {
      await loadPortal(page, baseUrl);
      await goCampaigns(page);

      // viewSmsCampaign renders the lead table with esc(l.phone) BEFORE it
      // shows the modal — with leads present it throws, the catch toasts
      // "esc is not defined" and the modal stays hidden. Drive the handler
      // directly (the list row that would open it cannot render per test 11).
      await page.evaluate(() => viewSmsCampaign('cmp-e2e-sms-1'));
      await waitFor(async () => {
        const t = await readToast(page);
        return t.cls.includes('error') && t.text.includes('esc is not defined');
      }, 6000);

      const display = await page.evaluate(() =>
        document.getElementById('sms-cmp-modal').style.display);
      // TRIPWIRE: expected behavior is display === 'flex' (modal open with the
      // lead table). When esc is fixed, this FAILS — flip it to 'flex' and add
      // positive assertions for title/badge/lead rows.
      expect(display).toBe('none');
    });
  });
});
