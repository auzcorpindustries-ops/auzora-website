// test/portal-scheduling-browser.test.js — BROWSER-LEVEL E2E for the portal's
// scheduling / calendar UI (audit gap F4, ticket zeus_1793167127151_3089818e).
//
// WHY THIS FILE EXISTS
// atlas-ai covers the scheduling BACKEND heavily (portal.calendar.events,
// calendarIntegrity, blackoutDates, availabilityRegression, bookingSlotClaim,
// nativeCalendar*). The FRONTEND had zero coverage: nothing ever rendered
// portal.html's scheduling surface, so an unbound confirm/reschedule/cancel
// handler, a table that ignored the payload, or a blackout that never
// re-rendered would all ship green. This suite drives a REAL Chromium
// (Playwright) against the working-tree portal.html with the portal API
// mocked at the network layer — a stateful `page.route` handler, the proven
// portal-billing-browser pattern — so it runs offline and deterministically.
//
// WHAT IT PROVES
//   1. the dashboard appointments list renders the /portal/appointments
//      payload (names, services, formatted datetimes, status badges, counts,
//      calendar-sync column) and carries the X-Portal-Token header;
//   2. an EMPTY list renders the truthful empty state, and a FAILED fetch
//      renders "Appointments unavailable right now." instead of a blank card;
//   3. Confirm (no calendar sync → fallback endpoint) fires exactly ONE POST
//      /portal/appointments/:id/confirm and the badge flips + survives reload;
//   4. the native-calendar confirm path fires exactly ONE POST
//      /portal/native-calendar/events/:id/confirm and the banner clears;
//   5. Reschedule fires ONE POST /portal/appointments/:id/reschedule with
//      body {new_datetime, timezone} and the row re-renders the
//      server-resolved time (persists across reload);
//   6. a reschedule CONFLICT (409 {ok:false,error}) surfaces the API's error
//      inline, keeps the modal open, and never reloads the list;
//   7. Cancel fires ONE POST /portal/appointments/:id/cancel with body {}
//      and the row disappears (persists across reload);
//   8. cancelling an ALREADY-CANCELLED appointment surfaces the API's error
//      toast and keeps the dialog open;
//   9. the blackout editor: + Add Date → Save and Apply sends the exact
//      blackout_dates in PATCH /portal/settings, the month grid re-renders
//      the day as blacked out immediately, clicking the day offers NO slot
//      ("unavailable for booking"), and the blackout survives a reload;
//  10. availability: an earliest-slot API failure leaves the New-Appointment
//      modal offering NO slot; a success renders the suggestion and
//      "Use this slot" fills the datetime field.
//
// NOTE ON THE ONLINE-BOOKING TOGGLE (named in the audit): the portal UI does
// NOT ship that control — it is backend-only (atlas-ai /portal/booking-settings
// + src/services/onlineBookingSettings, covered by atlas-ai's own suite).
// Adding UI for it would be an application-code change, out of scope for this
// test-only ticket. Everything the scheduling UI DOES ship is covered above.
//
// SAFETY: local Chromium + a fully mocked API (page.route answers every
// /portal call before it leaves the machine). No real calendar provider is
// contacted; all fixtures are synthetic and tagged to this suite only.

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
// `npm install` in this repo. Same seam as portal-billing-browser.test.js.
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
// Treat either gap as "skip", not "fail" (auzora-website has no CI job that
// would install it; an absent browser must not turn the suite red).
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
    '\n[portal-scheduling-browser] SKIPPING the scheduling browser E2E — ' +
    (chromium ? 'Playwright is installed but its Chromium build is not.\n' : 'Playwright is not installed.\n') +
    '  Install with:  npm i -D playwright && npx playwright install chromium\n' +
    '  (or point PLAYWRIGHT_PKG at an existing playwright install).\n'
  );
}

const describeBrowser = browserReady ? describe : describe.skip;

// ── Shared fixtures (synthetic; America/Chicago) ─────────────────────────────
const ORIGIN_TOKEN = 'scheduling-smoke-portal-token';
const TZ = 'America/Chicago';

// Absolute instants relative to suite start — always "future" for the action
// buttons (the UI hides Confirm/Reschedule/Cancel on past appointments) and
// always inside the 14-day recent window.
const T0 = Date.now();
const iso = (days) => new Date(T0 + days * 86400000).toISOString();

// The UI renders datetimes with exactly this format (formatDT in portal.html).
// The expected strings are computed with the SAME Intl call here, in the test
// process, so the assertion is "the row shows the payload's instant rendered
// in the business timezone" rather than a brittle literal.
function fmtDT(isoStr) {
  return new Date(isoStr).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    hour12: true, timeZone: TZ,
  });
}

// 'YYYY-MM-DDTHH:MM' wall-clock stamp in the business timezone — the shape the
// native calendar's start_local field uses for day-bucketing.
function chicagoStamp(d) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(d);
  const get = (t) => parts.find((p) => p.type === t).value;
  return get('year') + '-' + get('month') + '-' + get('day') + 'T' + get('hour') + ':' + get('minute');
}

const CLIENT_BASE = {
  business_name: 'Scheduling Smoke Pools',
  tutorial_completed: true, // suppress the first-run tutorial overlay
  webhook_url: '',
  timezone: TZ,
  office_hours: '24/7',
  scheduling_params: [],
  blackout_dates: [],
  service_areas: ['Pool Cleaning', 'Chemical Balance'],
  service_durations: { 'Pool Cleaning': 60, 'Chemical Balance': 45 },
};

// Three appointments: unconfirmed+unsynced (confirm fallback path),
// unconfirmed+synced (reschedule/cancel/native paths), confirmed+synced
// (badge contrast). Distinct created_at so the newest-first row order is
// deterministic: Harper (-1d), Riley (-2d), Quinn (-3d).
function baseAppointments() {
  return [
    {
      appointment_id: 'appt-riley',
      caller_name: 'Riley Carlson',
      caller_phone: '+13125550142',
      service: 'Pool Cleaning',
      datetime: iso(3),
      notes: 'Gate code 4412',
      confirmed: false,
      participant_added: false,
      calendar_event_id: null,
      status: 'scheduled',
      created_at: iso(-2),
    },
    {
      appointment_id: 'appt-harper',
      caller_name: 'Harper Lee',
      caller_phone: '+13125550188',
      service: 'Chemical Balance',
      datetime: iso(5),
      notes: '',
      confirmed: false,
      participant_added: false,
      calendar_event_id: 'ncevt-88',
      status: 'scheduled',
      created_at: iso(-1),
    },
    {
      appointment_id: 'appt-quinn',
      caller_name: 'Quinn Nakamura',
      caller_phone: '+13125550176',
      service: 'Pool Cleaning',
      datetime: iso(7),
      notes: '',
      confirmed: true,
      participant_added: true,
      calendar_event_id: 'ncevt-90',
      status: 'scheduled',
      created_at: iso(-3),
    },
  ];
}

// Native-calendar events for the scheduling page's month grid, derived from
// the synced appointments (event_id === calendar_event_id, same instants).
function baseCalEvents() {
  return baseAppointments()
    .filter((a) => a.calendar_event_id)
    .map((a) => ({
      event_id: a.calendar_event_id,
      title: a.service,
      service: a.service,
      caller_name: a.caller_name,
      caller_phone: a.caller_phone,
      start_utc: a.datetime,
      end_utc: new Date(new Date(a.datetime).getTime() + 45 * 60000).toISOString(),
      start_local: chicagoStamp(new Date(a.datetime)),
      duration_minutes: 45,
      timezone: TZ,
      status: a.confirmed ? 'confirmed' : 'unconfirmed',
      source: 'ai',
    }));
}

// One unconfirmed native event → the dashboard "needs confirmation" banner.
function baseUnconfirmed() {
  return [
    {
      event_id: 'ncevt-77',
      title: 'Filter Swap',
      service: 'Filter Swap',
      caller_name: 'Morgan Ellis',
      caller_phone: '+13125550111',
      start_utc: iso(1),
      start_local: chicagoStamp(new Date(T0 + 86400000)),
      status: 'unconfirmed',
      source: 'ai',
    },
  ];
}

// The reschedule field is free text parsed server-side. The mock resolves the
// one fixture phrase the tests type to a FIXED instant (what the real
// orchestrator would do), so the re-rendered row is assertable.
const RESCHEDULE_NL = {
  'November 17 at 10:00 AM': { resolved: '2026-11-17T16:00:00.000Z' }, // 10:00 CST (UTC-6)
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
  const store = {
    client: Object.assign({}, CLIENT_BASE, o.client || {}),
    appointments: (o.appointments !== undefined ? o.appointments : baseAppointments())
      .map((a) => Object.assign({}, a)),
    calEvents: o.calEvents !== undefined ? o.calEvents : baseCalEvents(),
    unconfirmed: (o.unconfirmed !== undefined ? o.unconfirmed : baseUnconfirmed())
      .map((e) => Object.assign({}, e)),
  };
  const knobs = {
    appointmentsStatus: o.appointmentsStatus || 200,
    earliestSlot: o.earliestSlot !== undefined ? o.earliestSlot : { status: 500 },
    rescheduleMode: o.rescheduleMode || 'ok',
  };

  return {
    setOrigin(v) { origin = v; },
    requests: [],
    store,
    knobs,

    isStatic(url) {
      return origin && url.origin === origin;
    },

    dispatch(method, pathname, query, headers, rawBody) {
      let body = null;
      if (rawBody) { try { body = JSON.parse(rawBody); } catch (e) { body = rawBody; } }
      const lower = {};
      Object.keys(headers || {}).forEach((k) => { lower[k.toLowerCase()] = headers[k]; });
      const record = { method, pathname, query, headers: lower, body };
      this.requests.push(record);

      if (method === 'GET' && pathname === '/portal/settings') {
        return { status: 200, body: { client: store.client } };
      }
      if ((method === 'PATCH' || method === 'POST') && pathname === '/portal/settings') {
        const parsed = body && typeof body === 'object' ? body : {};
        Object.assign(store.client, parsed);
        return { status: 200, body: { client: store.client } };
      }
      if (method === 'GET' && pathname === '/portal/appointments') {
        if (knobs.appointmentsStatus >= 400) {
          return { status: knobs.appointmentsStatus, body: { error: 'appointments unavailable' } };
        }
        return { status: 200, body: { appointments: store.appointments } };
      }

      let m;
      if (method === 'POST' && (m = pathname.match(/^\/portal\/appointments\/([^/]+)\/confirm$/))) {
        const id = decodeURIComponent(m[1]);
        const a = store.appointments.find((x) => x.appointment_id === id);
        if (a) { a.confirmed = true; a.participant_added = true; }
        return { status: 200, body: { success: true, appointment_id: id, confirmed: true } };
      }
      if (method === 'POST' && (m = pathname.match(/^\/portal\/appointments\/([^/]+)\/reschedule$/))) {
        const id = decodeURIComponent(m[1]);
        if (knobs.rescheduleMode === 'conflict') {
          return {
            status: 409,
            body: { ok: false, error: 'That time conflicts with another appointment. Pick a different slot.' },
          };
        }
        const a = store.appointments.find((x) => x.appointment_id === id);
        const nl = body && RESCHEDULE_NL[body.new_datetime];
        if (a && nl) a.datetime = nl.resolved;
        return { status: 200, body: { ok: true, message: 'Appointment rescheduled' } };
      }
      if (method === 'POST' && (m = pathname.match(/^\/portal\/appointments\/([^/]+)\/cancel$/))) {
        const id = decodeURIComponent(m[1]);
        const a = store.appointments.find((x) => x.appointment_id === id);
        // The API refuses a second cancel (the orchestrator reports the
        // appointment is already cancelled) — the UI must surface it.
        if (a && a.status === 'cancelled') {
          return { status: 400, body: { ok: false, error: 'This appointment was already cancelled.' } };
        }
        if (a) store.appointments = store.appointments.filter((x) => x.appointment_id !== id);
        return { status: 200, body: { ok: true, message: 'Appointment cancelled' } };
      }

      if (method === 'GET' && pathname === '/portal/native-calendar/unconfirmed') {
        return { status: 200, body: { events: store.unconfirmed } };
      }
      if (method === 'POST' && (m = pathname.match(/^\/portal\/native-calendar\/events\/([^/]+)\/confirm$/))) {
        const id = decodeURIComponent(m[1]);
        store.unconfirmed = store.unconfirmed.filter((e) => e.event_id !== id);
        const ev = store.calEvents.find((e) => e.event_id === id);
        if (ev) ev.status = 'confirmed';
        return { status: 200, body: { ok: true, event_id: id, status: 'confirmed' } };
      }
      if (method === 'GET' && pathname === '/portal/native-calendar/events') {
        return { status: 200, body: { events: store.calEvents, timezone: store.client.timezone || TZ } };
      }
      if (method === 'GET' && pathname === '/portal/native-calendar/status') {
        return { status: 200, body: { google: { connected: false }, timezone: store.client.timezone || TZ } };
      }
      if (method === 'GET' && pathname === '/portal/native-calendar/earliest-slot') {
        if (!knobs.earliestSlot || knobs.earliestSlot.status >= 400) {
          return {
            status: (knobs.earliestSlot && knobs.earliestSlot.status) || 500,
            body: { error: 'availability unavailable' },
          };
        }
        return { status: 200, body: knobs.earliestSlot };
      }

      // Everything else the dashboard boot fans out to (entitlements, leads,
      // summary, square status, voices, analytics…) — empty but valid JSON.
      return { status: 200, body: {} };
    },
  };
}

// Intercept every request the page makes: let the local static server through,
// answer /portal|/api with the mock, and stub third-party CDNs (the page loads
// lucide + Google Fonts; offline that must not stall the render). The portal's
// API base is an absolute production URL on localhost — intercepting by PATH
// (not host) is what keeps every byte of egress at zero.
async function installNetwork(page, api) {
  await page.route('**/*', (route) => {
    const req = route.request();
    const url = new URL(req.url());

    if (api.isStatic(url)) return route.continue();

    if (url.pathname.startsWith('/portal/') || url.pathname.startsWith('/api/')) {
      const r = api.dispatch(req.method(), url.pathname, url.search, req.headers(), req.postData());
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
      // Seed the client record only when absent: saveSettings persists the
      // saved client here, so after a save a reload must keep reading the
      // SAVED record — that is how the blackout-persistence assertion works.
      if (!window.sessionStorage.getItem('atlas_client')) {
        window.sessionStorage.setItem('atlas_client', JSON.stringify(args.client));
      }
    } catch (e) { /* about:blank frame */ }
  }, { token: ORIGIN_TOKEN, client: CLIENT_BASE });
}

async function waitFor(fn, timeoutMs = 15000) {
  const start = Date.now();
  for (;;) {
    if (await fn()) return undefined;
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 60));
  }
}

// Load the portal and wait until the dashboard's appointment list has painted.
async function waitDashboardLoaded(page) {
  await page.goto('http://127.0.0.1:' + serverPort + '/portal.html', { waitUntil: 'domcontentloaded' });
  await waitFor(async () => page.evaluate(() => {
    const t = document.getElementById('stat-appts');
    return !!t && t.textContent.trim() !== '' && t.textContent.trim() !== '—';
  }));
}

// Navigate to the scheduling page through the real sidebar and wait for the
// native calendar month grid to paint.
async function gotoScheduling(page) {
  await waitDashboardLoaded(page);
  await page.click('#nav-scheduling');
  await waitFor(async () => page.evaluate(() => {
    const label = document.getElementById('native-cal-month-label');
    const grid = document.getElementById('native-cal-grid');
    return !!label && label.textContent.trim().length > 0 &&
           !!grid && !!grid.querySelector('.native-cal-day');
  }));
}

// Read the dashboard's compact appointment table: Name | Service | When | Badge | Sync.
async function readRows(page) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('#dash-appt-list tbody tr')).map((tr) => {
      const tds = Array.from(tr.querySelectorAll('td')).map((td) => td.textContent.trim());
      return { name: tds[0], service: tds[1], when: tds[2], badge: tds[3], sync: tds[4] };
    }));
}

// ── Suite ────────────────────────────────────────────────────────────────────
let server;
let serverPort;
let browser;
let baseUrl;

describeBrowser('portal scheduling / calendar UI — browser-level E2E', () => {
  beforeAll(async () => {
    server = await startStaticServer();
    serverPort = server.address().port;
    baseUrl = 'http://127.0.0.1:' + serverPort;
    browser = await chromium.launch({ headless: true });
  });

  afterAll(async () => {
    if (browser) await browser.close();
    if (server) await new Promise((r) => server.close(r));
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

  test('1. appointments list renders the /portal/appointments payload', async () => {
    const api = createMockApi();

    await withPage(api, async (page) => {
      await waitDashboardLoaded(page);

      expect(await page.evaluate(() =>
        document.getElementById('stat-appts').textContent.trim())).toBe('3');
      expect(await page.evaluate(() =>
        document.getElementById('dash-appt-count').textContent.trim())).toBe('3 in last 14 days');

      const rows = await readRows(page);
      expect(rows).toHaveLength(3);

      // Newest booking first (the list sorts by created_at descending).
      const expected = [...baseAppointments()]
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      expected.forEach((a, i) => {
        expect(rows[i].name).toBe(a.caller_name);
        expect(rows[i].service).toBe(a.service);
        expect(rows[i].when).toBe(fmtDT(a.datetime));
        expect(rows[i].badge).toBe(a.confirmed ? '✓ Confirmed' : '⚠ Unconfirmed');
        expect(rows[i].sync).toBe(a.calendar_event_id ? 'Calendar synced' : 'No calendar sync');
      });

      // The payload really came over the network with the portal token.
      const gets = api.requests.filter((r) => r.method === 'GET' && r.pathname === '/portal/appointments');
      expect(gets.length).toBeGreaterThan(0);
      expect(gets[0].headers['x-portal-token']).toBe(ORIGIN_TOKEN);
    });
  });

  test('2. an empty list renders the empty state; a failed fetch renders the unavailable state', async () => {
    // (a) empty payload → truthful empty state, zero counts, no banner.
    const emptyApi = createMockApi({ appointments: [], unconfirmed: [] });
    await withPage(emptyApi, async (page) => {
      await waitDashboardLoaded(page);
      expect(await page.evaluate(() =>
        document.getElementById('stat-appts').textContent.trim())).toBe('0');
      expect(await page.evaluate(() =>
        document.getElementById('dash-appt-list').textContent.trim()))
        .toBe('No appointments in the last 14 days.');
      expect(await page.evaluate(() =>
        document.getElementById('dash-appt-count').textContent.trim())).toBe('0 in last 14 days');
      expect(await page.evaluate(() =>
        getComputedStyle(document.getElementById('dash-unconfirmed-wrap')).display)).toBe('none');
    });

    // (b) the API fails → "Appointments unavailable right now.", never a
    // blank card indistinguishable from "you have no appointments".
    const failApi = createMockApi({ appointmentsStatus: 500, unconfirmed: [] });
    await withPage(failApi, async (page) => {
      await page.goto(baseUrl + '/portal.html', { waitUntil: 'domcontentloaded' });
      await waitFor(async () => page.evaluate(() =>
        document.getElementById('dash-appt-list').textContent.includes('Appointments unavailable right now.')));
      expect(await page.evaluate(() =>
        document.getElementById('dash-appt-count').textContent.trim())).toBe('');
    });
  });

  test('3. Confirm fires exactly ONE POST /portal/appointments/:id/confirm and the state flips + persists', async () => {
    const api = createMockApi();

    await withPage(api, async (page) => {
      await waitDashboardLoaded(page);

      // Riley has NO calendar sync → the fallback confirm endpoint, and only
      // the Confirm action (no Reschedule/Cancel without a calendar event).
      await page.click('#dash-appt-list tr:has-text("Riley Carlson")');
      await waitFor(async () => page.evaluate(() =>
        document.getElementById('appt-detail-modal').style.display === 'flex'));
      const actions = await page.evaluate(() =>
        Array.from(document.querySelectorAll('#appt-detail-actions button')).map((b) => b.textContent.trim()));
      expect(actions.some((t) => t.includes('Confirm Appointment'))).toBe(true);
      expect(actions).not.toContain('Reschedule');
      expect(actions).not.toContain('Cancel');

      await page.click('#appt-detail-actions button:has-text("Confirm Appointment")');

      await waitFor(() => api.requests.filter((r) =>
        r.method === 'POST' && r.pathname === '/portal/appointments/appt-riley/confirm').length === 1);
      const post = api.requests.find((r) =>
        r.method === 'POST' && r.pathname === '/portal/appointments/appt-riley/confirm');
      expect(post.headers['x-portal-token']).toBe(ORIGIN_TOKEN);
      expect(post.body).toBe(null); // confirm sends no body

      await waitFor(async () => page.evaluate(() =>
        document.getElementById('appt-detail-modal').style.display === 'none'));
      const toast = await page.evaluate(() => document.getElementById('toast').textContent);
      expect(toast).toContain('Appointment confirmed');

      // The list re-renders the confirmed badge.
      await waitFor(async () => page.evaluate(() => {
        const tr = Array.from(document.querySelectorAll('#dash-appt-list tbody tr'))
          .find((r) => r.textContent.includes('Riley Carlson'));
        return !!tr && tr.textContent.includes('✓ Confirmed');
      }));

      // The write is persisted server-side: a reload shows it again.
      await page.reload({ waitUntil: 'domcontentloaded' });
      await waitFor(async () => page.evaluate(() =>
        document.getElementById('stat-appts').textContent.trim() === '3'));
      const rowsAfter = await readRows(page);
      const riley = rowsAfter.find((r) => r.name === 'Riley Carlson');
      expect(riley.badge).toBe('✓ Confirmed');
    });
  });

  test('4. the unconfirmed banner confirm fires exactly ONE POST /portal/native-calendar/events/:id/confirm', async () => {
    const api = createMockApi();

    await withPage(api, async (page) => {
      await waitDashboardLoaded(page);

      // The banner renders with the count headline.
      await waitFor(async () => page.evaluate(() =>
        document.getElementById('dash-unconfirmed-wrap').style.display !== 'none'));
      expect(await page.evaluate(() =>
        document.getElementById('dash-unconfirmed-count').textContent.trim()))
        .toBe('1 appointment needs confirmation');

      // Expand (Review) and confirm the native event.
      await page.click('#dash-unconfirmed-toggle');
      await waitFor(async () => page.evaluate(() =>
        !document.getElementById('dash-unconfirmed-list').hidden));
      await page.click('#dash-unconfirmed-list button:has-text("Confirm")');

      await waitFor(() => api.requests.filter((r) =>
        r.method === 'POST' && r.pathname === '/portal/native-calendar/events/ncevt-77/confirm').length === 1);
      const post = api.requests.find((r) =>
        r.method === 'POST' && r.pathname === '/portal/native-calendar/events/ncevt-77/confirm');
      expect(post.headers['x-portal-token']).toBe(ORIGIN_TOKEN);
      // one request per action — no duplicate confirm, no stray writes
      expect(api.requests.filter((r) => r.pathname.includes('/confirm')).length).toBe(1);

      // The refetched unconfirmed list is now empty → banner hides.
      await waitFor(async () => page.evaluate(() =>
        document.getElementById('dash-unconfirmed-wrap').style.display === 'none'));
      const toast = await page.evaluate(() => document.getElementById('toast').textContent);
      expect(toast).toContain('Appointment confirmed');
    });
  });

  test('5. Reschedule fires ONE POST with {new_datetime, timezone} and the row re-renders the resolved time', async () => {
    const api = createMockApi();

    await withPage(api, async (page) => {
      await waitDashboardLoaded(page);

      await page.click('#dash-appt-list tr:has-text("Harper Lee")');
      await waitFor(async () => page.evaluate(() =>
        document.getElementById('appt-detail-modal').style.display === 'flex'));
      await page.click('#appt-detail-actions button:has-text("Reschedule")');
      await waitFor(async () => page.evaluate(() =>
        document.getElementById('reschedule-modal').style.display === 'flex'));

      const current = await page.evaluate(() =>
        document.getElementById('reschedule-current').textContent);
      expect(current).toContain('Harper Lee');
      expect(current).toContain('Chemical Balance');

      await page.fill('#reschedule-datetime', 'November 17 at 10:00 AM');
      expect(await page.evaluate(() =>
        document.getElementById('reschedule-timezone').value)).toBe('America/Chicago');
      await page.click('#reschedule-submit');

      await waitFor(() => api.requests.filter((r) =>
        r.method === 'POST' && r.pathname === '/portal/appointments/appt-harper/reschedule').length === 1);
      const post = api.requests.find((r) =>
        r.method === 'POST' && r.pathname === '/portal/appointments/appt-harper/reschedule');
      expect(post.headers['x-portal-token']).toBe(ORIGIN_TOKEN);
      expect(post.body).toEqual({ new_datetime: 'November 17 at 10:00 AM', timezone: 'America/Chicago' });

      await waitFor(async () => page.evaluate(() =>
        document.getElementById('reschedule-modal').style.display === 'none'));

      // The row re-renders the server-resolved instant (the mock resolved the
      // fixture phrase to 2026-11-17T16:00:00Z — what the orchestrator does).
      const expectedWhen = fmtDT('2026-11-17T16:00:00.000Z');
      await waitFor(async () => page.evaluate((exp) => {
        const tr = Array.from(document.querySelectorAll('#dash-appt-list tbody tr'))
          .find((r) => r.textContent.includes('Harper Lee'));
        return !!tr && tr.querySelectorAll('td')[2].textContent.trim() === exp;
      }, expectedWhen));

      // Persisted server-side → survives reload.
      await page.reload({ waitUntil: 'domcontentloaded' });
      await waitFor(async () => page.evaluate(() =>
        document.getElementById('stat-appts').textContent.trim() === '3'));
      const rows = await readRows(page);
      expect(rows.find((r) => r.name === 'Harper Lee').when).toBe(expectedWhen);
    });
  });

  test('6. a reschedule conflict (409 ok:false) surfaces inline and never reloads the list', async () => {
    const api = createMockApi({ rescheduleMode: 'conflict' });

    await withPage(api, async (page) => {
      await waitDashboardLoaded(page);
      const listGetsBefore = api.requests.filter((r) =>
        r.method === 'GET' && r.pathname === '/portal/appointments').length;

      await page.click('#dash-appt-list tr:has-text("Harper Lee")');
      await waitFor(async () => page.evaluate(() =>
        document.getElementById('appt-detail-modal').style.display === 'flex'));
      await page.click('#appt-detail-actions button:has-text("Reschedule")');
      await waitFor(async () => page.evaluate(() =>
        document.getElementById('reschedule-modal').style.display === 'flex'));
      await page.fill('#reschedule-datetime', 'November 17 at 10:00 AM');
      await page.click('#reschedule-submit');

      await waitFor(() => api.requests.filter((r) =>
        r.method === 'POST' && r.pathname === '/portal/appointments/appt-harper/reschedule').length === 1);

      // The API's error surfaces INLINE with its exact text.
      await waitFor(async () => page.evaluate(() =>
        getComputedStyle(document.getElementById('reschedule-error')).display !== 'none'));
      expect(await page.evaluate(() =>
        document.getElementById('reschedule-error').textContent.trim()))
        .toBe('That time conflicts with another appointment. Pick a different slot.');

      // The modal stays open and the submit re-enables for another try.
      expect(await page.evaluate(() =>
        document.getElementById('reschedule-modal').style.display)).toBe('flex');
      expect(await page.evaluate(() =>
        document.getElementById('reschedule-submit').disabled)).toBe(false);
      expect(await page.evaluate(() =>
        document.getElementById('reschedule-submit').textContent.trim())).toBe('Reschedule');

      // ...and the failure never triggers a list reload.
      await new Promise((r) => setTimeout(r, 700));
      const listGetsAfter = api.requests.filter((r) =>
        r.method === 'GET' && r.pathname === '/portal/appointments').length;
      expect(listGetsAfter).toBe(listGetsBefore);
    });
  });

  test('7. Cancel fires ONE POST with {} and the row disappears + persists', async () => {
    const api = createMockApi();

    await withPage(api, async (page) => {
      await waitDashboardLoaded(page);

      await page.click('#dash-appt-list tr:has-text("Harper Lee")');
      await waitFor(async () => page.evaluate(() =>
        document.getElementById('appt-detail-modal').style.display === 'flex'));
      await page.click('#appt-detail-actions button:has-text("Cancel")');
      await waitFor(async () => page.evaluate(() =>
        document.getElementById('cancel-dialog').style.display === 'flex'));
      const detail = await page.evaluate(() =>
        document.getElementById('cancel-detail').textContent);
      expect(detail).toContain('Chemical Balance');
      expect(detail).toContain('cannot be undone');

      await page.click('#cancel-submit');

      await waitFor(() => api.requests.filter((r) =>
        r.method === 'POST' && r.pathname === '/portal/appointments/appt-harper/cancel').length === 1);
      const post = api.requests.find((r) =>
        r.method === 'POST' && r.pathname === '/portal/appointments/appt-harper/cancel');
      expect(post.headers['x-portal-token']).toBe(ORIGIN_TOKEN);
      expect(post.body).toEqual({});

      await waitFor(async () => page.evaluate(() =>
        document.getElementById('cancel-dialog').style.display === 'none'));
      const toast = await page.evaluate(() => document.getElementById('toast').textContent);
      expect(toast).toContain('Appointment cancelled');

      // The refetched list no longer contains Harper.
      await waitFor(async () => page.evaluate(() =>
        document.getElementById('stat-appts').textContent.trim() === '2'));
      const rows = await readRows(page);
      expect(rows.find((r) => r.name === 'Harper Lee')).toBeUndefined();

      // Persisted server-side → survives reload.
      await page.reload({ waitUntil: 'domcontentloaded' });
      await waitFor(async () => page.evaluate(() =>
        document.getElementById('stat-appts').textContent.trim() === '2'));
      const rowsAfter = await readRows(page);
      expect(rowsAfter.find((r) => r.name === 'Harper Lee')).toBeUndefined();
    });
  });

  test('8. cancelling an already-cancelled appointment surfaces the API error and keeps the dialog open', async () => {
    // A stale view still lists the appointment the backend has cancelled.
    const seed = baseAppointments().map((a) => (a.appointment_id === 'appt-quinn'
      ? Object.assign({}, a, { status: 'cancelled' })
      : a));
    const api = createMockApi({ appointments: seed });

    await withPage(api, async (page) => {
      await waitDashboardLoaded(page);

      await page.click('#dash-appt-list tr:has-text("Quinn Nakamura")');
      await waitFor(async () => page.evaluate(() =>
        document.getElementById('appt-detail-modal').style.display === 'flex'));
      await page.click('#appt-detail-actions button:has-text("Cancel")');
      await waitFor(async () => page.evaluate(() =>
        document.getElementById('cancel-dialog').style.display === 'flex'));
      await page.click('#cancel-submit');

      await waitFor(() => api.requests.filter((r) =>
        r.method === 'POST' && r.pathname === '/portal/appointments/appt-quinn/cancel').length === 1);

      // The API's 400 error is surfaced as an error toast — exact text.
      await waitFor(async () => page.evaluate(() =>
        document.getElementById('toast').textContent.includes('already cancelled')));
      const toast = await page.evaluate(() => ({
        text: document.getElementById('toast').textContent,
        cls: document.getElementById('toast').className,
      }));
      expect(toast.text).toContain('This appointment was already cancelled.');
      expect(toast.cls).toContain('error');

      // Exactly one cancel request, dialog still open, button re-enabled.
      expect(api.requests.filter((r) =>
        r.method === 'POST' && r.pathname === '/portal/appointments/appt-quinn/cancel').length).toBe(1);
      expect(await page.evaluate(() =>
        document.getElementById('cancel-dialog').style.display)).toBe('flex');
      expect(await page.evaluate(() =>
        document.getElementById('cancel-submit').disabled)).toBe(false);
    });
  });

  test('9. the blackout editor PATCHes the exact blackout_dates, re-renders the grid, offers no slot, and survives reload', async () => {
    const api = createMockApi();
    const now = new Date();
    const blkDate = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-15';

    await withPage(api, async (page) => {
      await gotoScheduling(page);

      // Starts empty.
      expect(await page.evaluate(() =>
        document.getElementById('s-blackout-list').textContent))
        .toContain('No blackout dates set');

      // Add one blackout entry through the real editor.
      await page.click('#sched-blackout-card button:has-text("+ Add Date")');
      await waitFor(async () => page.evaluate(() =>
        !!document.querySelector('#s-blackout-list [id^="blk-"]')));
      await page.fill('#s-blackout-list input[type="date"]', blkDate);
      await page.fill('#s-blackout-list input[type="text"]', 'Thanksgiving closure');

      // Save and Apply → PATCH /portal/settings carries the exact entry.
      await page.click('#floating-save-btn');
      await waitFor(() => api.requests.filter((r) =>
        r.method === 'PATCH' && r.pathname === '/portal/settings').length === 1);
      const patch = api.requests.find((r) =>
        r.method === 'PATCH' && r.pathname === '/portal/settings');
      expect(patch.headers['x-portal-token']).toBe(ORIGIN_TOKEN);
      expect(patch.body.blackout_dates).toEqual([{ startDate: blkDate, label: 'Thanksgiving closure' }]);

      // The month grid re-renders IMMEDIATELY with the day blacked out.
      await waitFor(async () => page.evaluate(() =>
        !!document.querySelector('#native-cal-grid .native-cal-day.is-blackout')));
      const cell = await page.evaluate(() => {
        const el = document.querySelector('#native-cal-grid .native-cal-day.is-blackout');
        const chip = el.querySelector('.native-cal-chip');
        return {
          day: el.querySelector('.native-cal-daynum').textContent.trim(),
          chip: chip ? chip.textContent.trim() : '',
        };
      });
      expect(cell.day).toBe('15');
      expect(cell.chip).toBe('Thanksgiving closure');

      // Clicking the blacked-out day offers NO slot — only the closure notice.
      await page.click('#native-cal-grid .native-cal-day.is-blackout');
      await waitFor(async () => page.evaluate(() =>
        document.getElementById('native-cal-day-detail').textContent.includes('unavailable for booking')));
      const detail = await page.evaluate(() =>
        document.getElementById('native-cal-day-detail').textContent);
      expect(detail).toContain('Thanksgiving closure');
      expect(detail).not.toContain('Add appointment');

      // The write survives a reload (boot reads the saved client record).
      await page.reload({ waitUntil: 'domcontentloaded' });
      await waitFor(async () => page.evaluate(() =>
        document.getElementById('stat-appts').textContent.trim() === '3'));
      await page.click('#nav-scheduling');
      await waitFor(async () => page.evaluate(() =>
        !!document.querySelector('#native-cal-grid .native-cal-day.is-blackout')));
      expect(await page.evaluate(() =>
        document.querySelector('#native-cal-grid .native-cal-day.is-blackout .native-cal-daynum').textContent.trim()))
        .toBe('15');
    });
  });

  test('10. availability: API failure offers NO slot; success offers one and "Use this slot" fills the field', async () => {
    const SUGGESTION = 'Friday, November 13th at 9:30 AM';
    const api = createMockApi({ earliestSlot: { status: 500 } });

    await withPage(api, async (page) => {
      await gotoScheduling(page);

      // Open the New Appointment modal (new events only fetch the earliest slot).
      await page.click('#page-scheduling button:has-text("+ New Appointment")');
      await waitFor(async () => page.evaluate(() =>
        document.getElementById('native-event-modal').style.display === 'flex'));
      await waitFor(() => api.requests.some((r) =>
        r.pathname === '/portal/native-calendar/earliest-slot'));
      const req = api.requests.find((r) => r.pathname === '/portal/native-calendar/earliest-slot');
      expect(req.headers['x-portal-token']).toBe(ORIGIN_TOKEN);
      expect(req.query).toContain('duration=60');

      // API failed → the UI must offer NO slot.
      await new Promise((r) => setTimeout(r, 300));
      expect(await page.evaluate(() =>
        document.getElementById('native-event-earliest').style.display)).toBe('none');
      expect(await page.evaluate(() =>
        document.getElementById('native-event-earliest-text').textContent.trim())).toBe('');

      // Now the availability API succeeds → the suggestion is offered.
      api.knobs.earliestSlot = { slot: { suggestion: SUGGESTION } };
      await page.evaluate(() => closeNativeEventModal());
      await page.click('#page-scheduling button:has-text("+ New Appointment")');
      await waitFor(async () => page.evaluate(() =>
        document.getElementById('native-event-modal').style.display === 'flex'));
      await waitFor(async () => page.evaluate(() =>
        document.getElementById('native-event-earliest').style.display === 'flex'));
      expect(await page.evaluate(() =>
        document.getElementById('native-event-earliest-text').textContent.trim()))
        .toBe('Earliest opening: ' + SUGGESTION);

      // "Use this slot" fills the datetime field with the suggestion.
      await page.click('#native-event-earliest button:has-text("Use this slot")');
      expect(await page.evaluate(() =>
        document.getElementById('native-event-datetime').value)).toBe(SUGGESTION);
    });
  });
});
