// test/portal-analytics-contacts-browser.test.js — BROWSER-LEVEL proof for the
// Analytics contacts module + activity-feed pagination (ticket
// zeus_1793167128031_ed575190, audit gap F6; app code from PR #421 /
// zeus_1792018691455_30f56a64).
//
// WHY A REAL BROWSER
// The deliverable is interaction: "View all" opens a paginated contact book,
// Next pages it, and the feed's Next swaps a 5-row slice in place. A
// string-matching test cannot tell an in-place repaint from a reload, and it
// cannot tell which request the page really issued. So this suite drives a real
// Chromium against the working-tree portal.html with the portal API mocked at
// the network layer — offline and deterministic.
//
// It proves:
//   1. the contact book asks ONE page at a time, page cursor 1 then 2, and the
//      rows on screen match the payload for that cursor (no duplicates);
//   2. the activity feed fetches the recent window ONCE (limit=200) and Next
//      pages older items with NO extra request, no duplicate and no dropped row;
//   3. cross-client scoping: a second synthetic client's contacts never appear
//      on the first client's Analytics page (and vice versa) — the mock answers
//      by X-Portal-Token, so a renderer that cached/merged rows would leak;
//   4. empty contact book and empty feed both render their honest empty state
//      and hide the pager.
//
// Playwright is declared in devDependencies. Where it (or its Chromium build)
// is not installed the suite SKIPS with a loud message rather than failing.

'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const { URL } = require('url');

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
    '\n[portal-analytics-contacts-browser] SKIPPING the Analytics browser suite — ' +
    (chromium ? 'Playwright is installed but its Chromium build is not.\n' : 'Playwright is not installed.\n') +
    '  Install with:  npm i -D playwright && npx playwright install chromium\n'
  );
}

const describeBrowser = browserReady ? describe : describe.skip;

// ── Fixtures ─────────────────────────────────────────────────────────────────
const CLIENT = {
  business_name: 'Synthetic Analytics Co',
  tutorial_completed: true, // suppress the first-run tutorial overlay
  webhook_url: '',
  outbound_window: { mode: '247' },
};

const TOKEN_A = 'tok-client-A';
const TOKEN_B = 'tok-client-B';
const TOKEN_EMPTY = 'tok-client-empty';

// Two synthetic clients. Different names AND different event labels so any leak
// is unmistakable in the rendered DOM.
const CLIENTS = {
  [TOKEN_A]: {
    contacts: [
      { name: 'Ada Alvarez', phone: '5125550101', email: 'ada@a.example', company: 'Alvarez Co' },
      { name: 'Amos Ash', phone: '5125550102', email: 'amos@a.example', company: 'Ash LLC' },
      { name: 'Ava Austin', phone: '5125550103', email: 'ava@a.example', company: 'Austin Inc' },
    ],
    eventPrefix: 'alpha',
  },
  [TOKEN_B]: {
    contacts: [
      { name: 'Zara Zane', phone: '5125550201', email: 'zara@b.example', company: 'Zane Group' },
      { name: 'Zeke Zorn', phone: '5125550202', email: 'zeke@b.example', company: 'Zorn Co' },
      { name: 'Zoe Zulu', phone: '5125550203', email: 'zoe@b.example', company: 'Zulu Ltd' },
    ],
    eventPrefix: 'bravo',
  },
  [TOKEN_EMPTY]: { contacts: [], eventPrefix: 'charlie', events: 0 },
};

// 12 activity rows per client so the 5-per-page pager has 3 pages (5/5/2).
function activityFor(token) {
  const cfg = CLIENTS[token];
  if (!cfg) return [];
  const n = cfg.events === 0 ? 0 : 12;
  return Array.from({ length: n }, (_, i) => ({
    timestamp: `2026-10-2${(i % 9) + 1}T10:00:00Z`,
    status: i % 2 === 0 ? 'success' : 'info',
    event_type: `${cfg.eventPrefix}_${String(i + 1).padStart(2, '0')}`,
    workflow_id: 'wf_alpha',
    lead_id: `lead_${String(i + 1).padStart(4, '0')}`,
    details: { n: i + 1 },
  }));
}

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

// ── Mock portal API — scoped by the X-Portal-Token header ────────────────────
// This is the whole point: the mock refuses to look at any other client id. A
// renderer that asked for another client's rows would get nothing back, and a
// renderer that cached another client's rows would still show them — which is
// exactly what the scoping assertions look for.
function createMockApi() {
  let origin = null;
  const api = {
    requests: [],
    setOrigin(v) { origin = v; },
    isStatic(url) { return !!origin && url.origin === origin; },

    dispatch(method, pathname, search, headers) {
      const lower = {};
      Object.keys(headers || {}).forEach((k) => { lower[k.toLowerCase()] = headers[k]; });
      const token = lower['x-portal-token'] || null;
      const params = new URLSearchParams(search || '');
      api.requests.push({ method, pathname, params, token });

      const cfg = CLIENTS[token];

      if (method === 'GET' && pathname === '/portal/contacts') {
        if (!cfg) return { status: 401, body: { error: 'unauthorized' } };
        const qstr = (params.get('search') || '').trim().toLowerCase();
        let rows = cfg.contacts;
        if (qstr) {
          rows = rows.filter((c) => [c.name, c.phone, c.email, c.company]
            .some((f) => String(f || '').toLowerCase().includes(qstr)));
        }
        const page = Number(params.get('page') || 1);
        const pageSize = Number(params.get('page_size') || rows.length || 1);
        const start = (page - 1) * pageSize;
        return {
          status: 200,
          body: {
            contacts: rows.slice(start, start + pageSize),
            total: rows.length,
            total_pages: Math.max(1, Math.ceil(rows.length / pageSize)),
          },
        };
      }

      if (method === 'GET' && pathname === '/portal/activity') {
        if (!cfg) return { status: 401, body: { error: 'unauthorized' } };
        return { status: 200, body: { logs: activityFor(token) } };
      }

      // Everything else the portal boot fans out to — empty but valid JSON.
      return { status: 200, body: {} };
    },

    matched(predicate) { return api.requests.filter(predicate); },
    contactsCalls() { return api.requests.filter((r) => r.pathname === '/portal/contacts'); },
    activityCalls() { return api.requests.filter((r) => r.pathname === '/portal/activity'); },
    reset() { api.requests.length = 0; },
  };
  return api;
}

async function installNetwork(page, api) {
  await page.route('**/*', (route) => {
    const req = route.request();
    const url = new URL(req.url());

    if (api.isStatic(url)) return route.continue();

    if (url.pathname.startsWith('/portal/') || url.pathname.startsWith('/api/')) {
      const r = api.dispatch(req.method(), url.pathname, url.search.replace(/^\?/, ''), req.headers());
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

async function seedAuth(page, token) {
  await page.addInitScript((args) => {
    try {
      window.sessionStorage.setItem('atlas_token', args.token);
      window.sessionStorage.setItem('atlas_client', JSON.stringify(args.client));
    } catch (e) { /* about:blank frame */ }
  }, { token, client: CLIENT });
}

async function waitFor(fn, timeoutMs = 15000) {
  const start = Date.now();
  for (;;) {
    if (await fn()) return undefined;
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 60));
  }
}

// Boot into the portal and open Analytics (loadActivity + loadLeadAnalytics +
// resetContactsModule all fire from showPage).
async function openAnalytics(page, baseUrl) {
  await page.goto(baseUrl + '/portal.html', { waitUntil: 'domcontentloaded' });
  await waitFor(async () => page.evaluate(() =>
    !!document.getElementById('app') && document.getElementById('app').style.display === 'block'));
  await page.evaluate(() => { showPage('analytics'); });
  await waitFor(async () => page.evaluate(() => {
    const feed = document.getElementById('activity-feed');
    return !!feed && !feed.innerHTML.includes('Loading activity...');
  }));
}

function readFeed(page) {
  return page.evaluate(() => {
    const feed = document.getElementById('activity-feed');
    // .empty is the placeholder/empty-state panel, not a feed row.
    const rows = Array.from(feed.children)
      .filter((el) => !el.classList.contains('empty'))
      .map((el) => el.textContent.replace(/\s+/g, ' ').trim());
    const pager = document.getElementById('activity-pager');
    const next = document.getElementById('activity-next-btn');
    const prev = document.getElementById('activity-prev-btn');
    const label = document.getElementById('activity-pager-label');
    return {
      rows,
      count: rows.length,
      label: label ? label.textContent.trim() : null,
      nextDisabled: !!(next && next.disabled),
      prevDisabled: !!(prev && prev.disabled),
      pagerVisible: !!pager && pager.style.display !== 'none',
      emptyText: feed.innerHTML,
      isEmptyPanel: !!feed.querySelector('.empty'),
    };
  });
}

function readContactBook(page) {
  return page.evaluate(() => {
    const book = document.getElementById('contacts-book');
    const rows = Array.from(book.querySelectorAll('tbody tr')).map((tr) => {
      const tds = tr.querySelectorAll('td');
      return {
        name: tds[0] ? tds[0].textContent.trim() : '',
        phone: tds[1] ? tds[1].textContent.trim() : '',
        email: tds[2] ? tds[2].textContent.trim() : '',
      };
    });
    const nextBtn = book.querySelector('[onclick*="contactsBookNext"]');
    const prevBtn = book.querySelector('[onclick*="contactsBookPrev"]');
    return {
      rows,
      html: book.innerHTML,
      text: book.textContent.replace(/\s+/g, ' ').trim(),
      nextDisabled: !!(nextBtn && nextBtn.disabled),
      prevDisabled: !!(prevBtn && prevBtn.disabled),
    };
  });
}

function readSearchResults(page) {
  return page.evaluate(() => {
    const box = document.getElementById('contacts-results');
    const rows = Array.from(box.querySelectorAll('tbody tr')).map((tr) => {
      const tds = tr.querySelectorAll('td');
      return {
        name: tds[0] ? tds[0].textContent.trim() : '',
        phone: tds[1] ? tds[1].textContent.trim() : '',
        email: tds[2] ? tds[2].textContent.trim() : '',
      };
    });
    const pageText = document.getElementById('page-analytics').textContent.replace(/\s+/g, ' ');
    return { rows, pageText, html: box.innerHTML };
  });
}

const names = (rows) => rows.map((r) => r.name);

// ── Suite ────────────────────────────────────────────────────────────────────
describeBrowser('Analytics contacts module + activity feed pagination — browser behaviour', () => {
  let server;
  let baseUrl;
  let browser;

  beforeAll(async () => {
    server = await startStaticServer();
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ args: ['--no-sandbox'] });
  });

  afterAll(async () => {
    if (browser) await browser.close();
    if (server) await new Promise((r) => server.close(r));
  });

  // One page per client, each with its own mock so request logs never mix.
  async function newClientPage(token) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const api = createMockApi();
    api.setOrigin(baseUrl);
    await seedAuth(page, token);
    await installNetwork(page, api);
    await openAnalytics(page, baseUrl);
    return { ctx, page, api };
  }

  test('activity feed: one request for the window, Next pages older items in place', async () => {
    const { ctx, page, api } = await newClientPage(TOKEN_A);
    try {
      // Exactly one feed request, and it asked for the recent window.
      expect(api.activityCalls()).toHaveLength(1);
      expect(api.activityCalls()[0].params.get('limit')).toBe('200');
      expect(api.activityCalls()[0].token).toBe(TOKEN_A);

      let feed = await readFeed(page);
      expect(feed.count).toBe(5);
      expect(feed.label).toBe('1\u20135 of 12');
      expect(feed.prevDisabled).toBe(true);
      expect(feed.nextDisabled).toBe(false);
      expect(feed.pagerVisible).toBe(true);

      const seen = [];
      const collect = (f) => f.rows.map((t) => (t.match(/alpha (\d\d)/) || [])[1]).filter(Boolean);
      seen.push(...collect(feed));

      // Page 2 — in place, no refetch.
      await page.click('#activity-next-btn');
      await waitFor(async () => (await readFeed(page)).label === '6\u201310 of 12');
      feed = await readFeed(page);
      expect(feed.count).toBe(5);
      seen.push(...collect(feed));
      expect(api.activityCalls()).toHaveLength(1); // still one request

      // Page 3 — the tail page: 11–12, Next has no cursor left.
      await page.click('#activity-next-btn');
      await waitFor(async () => (await readFeed(page)).label === '11\u201312 of 12');
      feed = await readFeed(page);
      expect(feed.count).toBe(2);
      expect(feed.nextDisabled).toBe(true);
      expect(feed.prevDisabled).toBe(false);
      seen.push(...collect(feed));

      expect(api.activityCalls()).toHaveLength(1); // still one request
      // No duplicates, no dropped rows: all 12 unique in canonical order.
      expect(seen).toHaveLength(12);
      expect(new Set(seen).size).toBe(12);
      expect(seen.slice().sort()).toEqual(
        ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12']);

      // Back returns toward the newest without a refetch.
      await page.click('#activity-prev-btn');
      await waitFor(async () => (await readFeed(page)).label === '6\u201310 of 12');
      expect(api.activityCalls()).toHaveLength(1);
    } finally {
      await ctx.close();
    }
  });

  test('contact book: one request per page with the right cursor, rows scoped to the client', async () => {
    const { ctx, page, api } = await newClientPage(TOKEN_A);
    try {
      expect(api.contactsCalls()).toHaveLength(0); // search-only until asked

      await page.click('#contacts-book-toggle');
      await waitFor(async () => (await readContactBook(page)).rows.length > 0);

      const page1Calls = api.contactsCalls().filter((c) => c.params.get('page'));
      expect(page1Calls).toHaveLength(1);
      expect(page1Calls[0].params.get('page')).toBe('1');
      expect(page1Calls[0].params.get('page_size')).toBe('25');
      expect(page1Calls[0].token).toBe(TOKEN_A);

      let book = await readContactBook(page);
      expect(names(book.rows).sort()).toEqual(['Ada Alvarez', 'Amos Ash', 'Ava Austin']);
      expect(book.text).toContain('Page 1 of 1'); // 3 synthetic contacts fit one page
      expect(book.nextDisabled).toBe(true); // no cursor: Next is dead, not a dead link
      expect(book.prevDisabled).toBe(true);

      // Nothing from the other synthetic client reached the DOM at all.
      const analyticsText = await page.evaluate(() =>
        document.getElementById('page-analytics').textContent.replace(/\s+/g, ' '));
      for (const c of CLIENTS[TOKEN_B].contacts) {
        expect(analyticsText).not.toContain(c.name);
        expect(analyticsText).not.toContain(c.phone);
      }
    } finally {
      await ctx.close();
    }
  });

  test('search results are scoped to the authenticated client', async () => {
    const { ctx, page, api } = await newClientPage(TOKEN_B);
    try {
      await page.fill('#contacts-search', 'z');
      await page.click('button:has-text("Search")');
      await waitFor(async () => (await readSearchResults(page)).rows.length > 0);

      const results = await readSearchResults(page);
      expect(names(results.rows).sort()).toEqual(['Zara Zane', 'Zeke Zorn', 'Zoe Zulu']);
      // Client A's people must be nowhere on client B's page.
      for (const c of CLIENTS[TOKEN_A].contacts) {
        expect(results.pageText).not.toContain(c.name);
        expect(results.pageText).not.toContain(c.email);
      }
      const searchCall = api.contactsCalls().find((c) => c.params.get('search') === 'z');
      expect(searchCall).toBeTruthy();
      expect(searchCall.token).toBe(TOKEN_B);
    } finally {
      await ctx.close();
    }
  });

  test('a client with no contacts and no activity gets honest empty states', async () => {
    const { ctx, page } = await newClientPage(TOKEN_EMPTY);
    try {
      const feed = await readFeed(page);
      expect(feed.count).toBe(0);
      expect(feed.isEmptyPanel).toBe(true);
      expect(feed.emptyText).toContain('No activity yet.');
      expect(feed.pagerVisible).toBe(false);

      await page.click('#contacts-book-toggle');
      await waitFor(async () => (await readContactBook(page)).html.includes('No contacts yet.'));
      const book = await readContactBook(page);
      expect(book.html).toContain('No contacts yet.');
      expect(book.rows).toHaveLength(0);
      // With no rows there is no pager at all — no "Next" control is offered
      // against an empty book (nothing to page to).
      expect(book.html).not.toContain('contactsBookNext');
      expect(book.html).not.toContain('contactsBookPrev');
    } finally {
      await ctx.close();
    }
  });
});
