// test/portal-lead-call-modal-browser.test.js — BROWSER-LEVEL proof for the
// Leads & CRM manual-call Call Objective modal (OBJ-2, board
// zeus_1793928216002_917eb18d).
//
// WHY THIS FILE EXISTS
// The deliverable is UI behaviour: clicking a per-lead Call button opens a
// small modal with an OPTIONAL "Call Objective" field, and Start call fires
// POST /outbound/call with {lead_id, objective?} — the objective key present
// only when the field is non-empty. A string-matching test cannot prove any
// of that. So this suite drives a REAL Chromium (Playwright) against the real
// portal.html served off the working tree, with the portal API mocked at the
// network layer so it runs offline and deterministically.
//
// It proves, in order:
//   1. the modal opens from the REAL Call button, renders the labeled
//      textarea with the ticket's placeholder, the 0/120 counter and the
//      newline sub-hint; Start call sends EXACTLY ONE POST carrying the
//      objective in the body; toast + delayed table refresh unchanged;
//   2. an empty (whitespace-only) objective posts the LEGACY body — no
//      objective key at all;
//   3. an over-cap objective (125 chars) is blocked client-side: guidance is
//      shown, no request fires, the field is never silently truncated, and
//      shortening the text re-enables the call;
//   4. Cancel and Esc close the modal WITHOUT dialing and leave the Call
//      button's label untouched;
//   5. the modal is usable at 320 / 480 / 768 px widths (the ticket's mobile
//      requirement).
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

// ── Playwright resolution (same as portal-captured-leads-refresh-browser) ────
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
    '\n[portal-lead-call-modal-browser] SKIPPING the call-objective modal suite — ' +
    (chromium ? 'Playwright is installed but its Chromium build is not.\n' : 'Playwright is not installed.\n') +
    '  Install with:  npm i -D playwright && npx playwright install chromium\n' +
    '  (or point PLAYWRIGHT_PKG at an existing playwright install).\n'
  );
}

const describeBrowser = browserReady ? describe : describe.skip;

// ── Fixtures ─────────────────────────────────────────────────────────────────────────
const ORIGIN_TOKEN = 'browser-call-objective-token';

const CLIENT = {
  business_name: 'Acme Leads Co',
  tutorial_completed: true, // suppress the first-run tutorial overlay
  webhook_url: '',
  outbound_window: { mode: '247' },
};

// Two eligible leads (phone on file, nobody opted out) → BOTH rows render a
// real Call button. Ada is clicked in most tests; Bob takes the empty-objective
// legacy-body case.
const LEADS = [
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

const PLACEHOLDER = 'Describe what you want the AI receptionist to accomplish during this call.';

// ── Static file server (serves the working tree) ────────────────────────────────────
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

// ── Mock portal API ──────────────────────────────────────────────────────────────────
function createMockApi() {
  let origin = null; // STRING, not a URL object (the setOrigin trap)
  return {
    setOrigin(v) { origin = v; },
    leads: LEADS,
    leadsCalls: 0,
    requests: [],

    isStatic(url) { return !!origin && url.origin === origin; },

    dispatch(method, pathname, headers, rawBody) {
      let body = null;
      if (rawBody) { try { body = JSON.parse(rawBody); } catch (e) { body = rawBody; } }
      const lower = {};
      Object.keys(headers || {}).forEach(k => { lower[k.toLowerCase()] = headers[k]; });
      this.requests.push({ method, pathname, headers: lower, body });

      if (method === 'GET' && pathname === '/portal/leads') {
        this.leadsCalls++;
        return { status: 200, body: { leads: this.leads } };
      }
      // The Call button is entitlement-gated — the mock plan includes it.
      if (method === 'GET' && pathname === '/portal/entitlements') {
        return { status: 200, body: { entitlements: { manualOutboundCalls: true } } };
      }
      // The lead timeline modal (the LIVE per-lead Call entry point) reads
      // this to render the lead header + action buttons.
      if (method === 'GET' && /^\/portal\/leads\/[^/]+\/timeline$/.test(pathname)) {
        const id = decodeURIComponent(pathname.split('/')[3]);
        const lead = this.leads.find(l => l.lead_id === id) || {};
        return { status: 200, body: { lead, timeline: [] } };
      }
      if (method === 'POST' && pathname === '/outbound/call') {
        return { status: 200, body: { success: true } };
      }
      // Everything else the boot fans out to — empty but valid JSON.
      return { status: 200, body: {} };
    },

    callPosts() {
      return this.requests.filter(r => r.method === 'POST' && r.pathname === '/outbound/call');
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

    // /portal/ + /api/ cover the boot and CRM reads; the manual-call POST is
    // ${API}/outbound/call — no prefix at all — so it needs its own match.
    if (url.pathname.startsWith('/portal/') || url.pathname.startsWith('/api/') || url.pathname.startsWith('/outbound/')) {
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
      // Deliberately NOT seeding atlas_entitlements here: the boot waits below
      // key on fetchEntitlements() STAMPING it on success, which guarantees
      // portalEntitlements is set BEFORE the rows render the Call button.
      // A pre-seeded cache would let showPage('leads') race the fetch and
      // render 'Not included' rows that never recover.
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

// Boot into the portal, then open Leads & CRM and wait until the REAL,
// entitlement-gated Call button is on the page.
async function openLeadsPage(page, baseUrl) {
  await page.goto(baseUrl + '/portal.html', { waitUntil: 'domcontentloaded' });
  await waitFor(async () => page.evaluate(() =>
    !!document.getElementById('app') && document.getElementById('app').style.display === 'block'));
  // fetchEntitlements() stamps sessionStorage on success — wait for it so the
  // rows render WITH the Call button (boot/render order is not guaranteed).
  await waitFor(async () => page.evaluate(() => !!sessionStorage.getItem('atlas_entitlements')));
  await page.evaluate(() => { showPage('leads'); });
  await waitFor(async () => page.evaluate(() =>
    (document.getElementById('ob-lead-list') || {}).innerHTML.includes('<table')));
  await waitFor(async () => page.evaluate(() =>
    !!document.querySelector('#ob-lead-list div[onclick*="showLeadTimeline"]')));
}

// The LIVE per-lead Call entry point: the Captured Leads table's per-row Call
// cell was folded into the lead TIMELINE modal, so reaching the Call Objective
// modal means clicking the lead's name -> timeline modal -> its Call button.
async function openCallModal(page, leadId) {
  await page.click(`#ob-lead-list div[onclick*="showLeadTimeline('${leadId}')"]`);
  await waitFor(async () => page.evaluate(() => {
    const ov = document.getElementById('lead-timeline-overlay');
    return !!ov && ov.style.display === 'flex';
  }));
  await waitFor(async () => page.evaluate(() =>
    !!document.querySelector('#timeline-content button[onclick*="callLead"]')));
  await page.click(`#timeline-content button[onclick*="callLead('${leadId}'"]`);
  await waitFor(async () => page.evaluate(() =>
    !!document.getElementById('lead-call-modal-overlay')));
}

// Read the modal's whole state in one round-trip.
async function modalState(page) {
  return page.evaluate(() => {
    const m = document.getElementById('lead-call-modal-overlay');
    const ta = document.getElementById('lead-call-objective-input');
    const count = document.getElementById('lead-call-objective-count');
    const err = document.getElementById('lead-call-objective-error');
    const card = m ? m.firstElementChild : null;
    const btnText = (sel) => {
      const el = document.querySelector(sel);
      return el ? el.textContent.trim() : null;
    };
    return {
      open: !!m,
      title: btnText('#lead-call-modal-title'),
      label: m ? (Array.from(m.querySelectorAll('label')).find(l => l.textContent.trim() === 'Call Objective') || {}).textContent || null : null,
      placeholder: ta ? ta.getAttribute('placeholder') : null,
      value: ta ? ta.value : null,
      counter: count ? count.textContent : null,
      counterColor: count ? getComputedStyle(count).color : null,
      errorShown: err ? err.style.display !== 'none' && !!err.textContent : false,
      errorText: err ? err.textContent : null,
      hintShown: m ? m.textContent.includes('newlines are collapsed to single spaces') : false,
      cancelBtn: m ? (Array.from(m.querySelectorAll('button')).find(b => b.textContent.trim() === 'Cancel') || {}).textContent || null : null,
      startBtn: btnText('#lead-call-start-btn'),
      cardRect: card ? card.getBoundingClientRect().toJSON() : null,
      callBtnLabel: btnText('#timeline-content button[onclick*="callLead"]'),
    };
  });
}

// ── Suite ────────────────────────────────────────────────────────────────────────────
describeBrowser('Leads & CRM manual call — Call Objective modal (browser)', () => {
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

  async function withPage(api, fn, viewport) {
    api.setOrigin(baseUrl);
    const page = await browser.newPage({ viewport: viewport || { width: 1400, height: 900 } });
    try {
      await installNetwork(page, api);
      await seedAuth(page);
      return await fn(page);
    } finally {
      await page.close();
    }
  }

  test('1. the modal opens from the Call button and Start call fires the objective in the body', async () => {
    const api = createMockApi();
    await withPage(api, async (page) => {
      await openLeadsPage(page, baseUrl);
      expect(api.callPosts()).toHaveLength(0);

      // ONE real click on the REAL per-lead Call button.
      await openCallModal(page, 'lead_ada');

      let st = await modalState(page);
      expect(st.open).toBe(true);
      expect(st.title).toBe('Call this lead');
      expect(st.label).toBe('Call Objective');
      expect(st.placeholder).toBe(PLACEHOLDER);
      expect(st.counter).toBe('0/120');
      expect(st.hintShown).toBe(true);
      expect(st.cancelBtn).toBe('Cancel');
      expect(st.startBtn).toBe('Start call');
      // the subtitle resolves the lead name from the Captured Leads cache
      expect(await page.evaluate(() =>
        document.getElementById('lead-call-modal-overlay').textContent.includes('Ada Pending'))).toBe(true);

      const objective = 'Offer a free estimate and book a visit this week';
      await page.fill('#lead-call-objective-input', objective);
      st = await modalState(page);
      expect(st.counter).toBe(objective.length + '/120');

      const leadsBefore = api.leadsCalls;
      await page.click('#lead-call-start-btn');

      // EXACTLY ONE POST, with the objective in the body.
      await waitFor(() => api.callPosts().length >= 1);
      const posts = api.callPosts();
      expect(posts).toHaveLength(1);
      expect(posts[0].headers['x-portal-token']).toBe(ORIGIN_TOKEN);
      expect(posts[0].body).toEqual({ lead_id: 'lead_ada', objective });

      // the modal closed and the success toast appeared (same copy as before)
      expect((await modalState(page)).open).toBe(false);
      await waitFor(async () =>
        (await page.evaluate(() => document.getElementById('toast').textContent)).includes('dialing the lead'));

      // the delayed loadOutbound() refresh still happens (identical to develop)
      await waitFor(() => api.leadsCalls >= leadsBefore + 1);

      // after the repaint the button is back at rest with its original label
      await waitFor(async () => (await modalState(page)).callBtnLabel === 'Call');
      expect((await modalState(page)).open).toBe(false);
    });
  });

  test('2. an empty objective keeps the LEGACY body — no objective key at all', async () => {
    const api = createMockApi();
    await withPage(api, async (page) => {
      await openLeadsPage(page, baseUrl);

      await openCallModal(page, 'lead_bob');
      expect((await modalState(page)).open).toBe(true);

      // whitespace-only trims to empty — still must not send the key
      await page.fill('#lead-call-objective-input', '   ');
      await page.click('#lead-call-start-btn');

      await waitFor(() => api.callPosts().length >= 1);
      const posts = api.callPosts();
      expect(posts).toHaveLength(1);
      // toEqual is an EXACT key-set match: proves no objective key is present
      expect(posts[0].body).toEqual({ lead_id: 'lead_bob' });
      expect((await modalState(page)).open).toBe(false);
      await waitFor(async () =>
        (await page.evaluate(() => document.getElementById('toast').textContent)).includes('dialing the lead'));
    });
  });

  test('3. an over-cap objective is blocked client-side — guidance, no request, no truncation', async () => {
    const api = createMockApi();
    await withPage(api, async (page) => {
      await openLeadsPage(page, baseUrl);

      await openCallModal(page, 'lead_ada');
      const long = 'x'.repeat(125);
      await page.fill('#lead-call-objective-input', long);

      let st = await modalState(page);
      expect(st.counter).toBe('125/120');
      // same guidance tone as the Automations counter: red at/over the ceiling
      expect(st.counterColor).toMatch(/239,\s*68,\s*68|#ef4444/);

      await page.click('#lead-call-start-btn');

      // blocked: modal stays open, guidance shown, NOTHING dialed
      st = await modalState(page);
      expect(st.open).toBe(true);
      expect(st.errorShown).toBe(true);
      expect(st.errorText).toContain('120');
      expect(api.callPosts()).toHaveLength(0);

      // no silent truncation: the field still holds all 125 characters
      expect(st.value).toBe(long);

      // shortening the text re-enables the call — the error clears itself
      await page.fill('#lead-call-objective-input', 'short objective');
      st = await modalState(page);
      expect(st.errorShown).toBe(false);
      await page.click('#lead-call-start-btn');
      await waitFor(() => api.callPosts().length >= 1);
      expect(api.callPosts()[0].body).toEqual({ lead_id: 'lead_ada', objective: 'short objective' });
    });
  });

  test('4. Cancel and Esc close without dialing; the button keeps its label', async () => {
    const api = createMockApi();
    await withPage(api, async (page) => {
      await openLeadsPage(page, baseUrl);

      // Cancel path
      await openCallModal(page, 'lead_ada');
      expect((await modalState(page)).open).toBe(true);
      await page.evaluate(() => {
        const b = Array.from(document.querySelectorAll('#lead-call-modal-overlay button'))
          .find(x => x.textContent.trim() === 'Cancel');
        b.click();
      });
      let st = await modalState(page);
      expect(st.open).toBe(false);
      expect(st.callBtnLabel).toBe('Call'); // original label, never touched
      expect(api.callPosts()).toHaveLength(0);

      // Esc path — the timeline modal is still open after the Cancel, so
      // reopen the call modal via its Call button (the lead-name click is
      // covered by the open timeline overlay).
      await page.click('#timeline-content button[onclick*="callLead"]');
      expect((await modalState(page)).open).toBe(true);
      await page.keyboard.press('Escape');
      st = await modalState(page);
      expect(st.open).toBe(false);
      expect(st.callBtnLabel).toBe('Call');
      expect(api.callPosts()).toHaveLength(0);

      // a fresh open still works after both cancels (listener state is clean)
      await page.click('#timeline-content button[onclick*="callLead"]');
      expect((await modalState(page)).open).toBe(true);
      await page.evaluate(() => {
        const m = document.getElementById('lead-call-modal-overlay');
        if (m) m.remove();
      });
    });
  });

  test('5. the modal is usable at 320 / 480 / 768 px widths', async () => {
    const api = createMockApi();
    await withPage(api, async (page) => {
      await openLeadsPage(page, baseUrl);

      for (const width of [320, 480, 768]) {
        await page.setViewportSize({ width, height: 800 });

        // Raw DOM clicks for this loop: the LAYOUT is under test, not the
        // click plumbing, and a stale overlay must never flake the geometry
        // assertions. Defensive-close first so no prior width leaks state.
        await page.evaluate(() => {
          const m = document.getElementById('lead-call-modal-overlay');
          if (m) m.remove();
          const ov = document.getElementById('lead-timeline-overlay');
          if (ov) ov.style.display = 'none';
        });
        await page.evaluate((id) => {
          document.querySelector(`#ob-lead-list div[onclick*="showLeadTimeline('${id}')"]`).click();
        }, 'lead_ada');
        await waitFor(async () => page.evaluate(() => {
          const ov = document.getElementById('lead-timeline-overlay');
          return !!ov && ov.style.display === 'flex';
        }));
        await waitFor(async () => page.evaluate(() =>
          !!document.querySelector('#timeline-content button[onclick*="callLead"]')));
        await page.evaluate(() => {
          document.querySelector('#timeline-content button[onclick*="callLead"]').click();
        });
        await waitFor(async () => page.evaluate(() =>
          !!document.getElementById('lead-call-modal-overlay')));

        const st = await modalState(page);
        expect(st.open).toBe(true);
        const card = st.cardRect;
        expect(card.width).toBeLessThanOrEqual(width + 0.5);
        expect(card.left).toBeGreaterThanOrEqual(-0.5);
        expect(card.right).toBeLessThanOrEqual(width + 0.5);

        // usable: the field accepts input and the counter tracks it
        const text = 'call at ' + width;
        await page.fill('#lead-call-objective-input', text);
        expect((await modalState(page)).counter).toBe(text.length + '/120');

        // both actions are visible inside the viewport
        const btns = await page.evaluate(() => {
          const start = document.getElementById('lead-call-start-btn');
          const cancel = Array.from(document.querySelectorAll('#lead-call-modal-overlay button'))
            .find(b => b.textContent.trim() === 'Cancel');
          const fits = (el) => {
            if (!el) return false;
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.left >= -0.5 && r.right <= window.innerWidth + 0.5;
          };
          return { start: fits(start), cancel: fits(cancel) };
        });
        expect(btns.start).toBe(true);
        expect(btns.cancel).toBe(true);

        // no POST fired while just inspecting at each width
        expect(api.callPosts()).toHaveLength(0);

        await page.evaluate(() => {
          const m = document.getElementById('lead-call-modal-overlay');
          if (m) m.remove();
          // the timeline modal stays open behind the call modal and would
          // intercept the next width's lead-name click — close it too
          if (typeof closeLeadTimeline === 'function') closeLeadTimeline();
        });
      }
    });
  });
});
