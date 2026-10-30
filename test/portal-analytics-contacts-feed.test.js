// test/portal-analytics-contacts-feed.test.js
// Ticket zeus_1793167128031_ed575190 — audit gap F6.
//
// WHAT IS UNDER TEST
// The Analytics-page contacts module and the activity-feed pager that ship
// commit 9a211f0 added to portal.html (PR #421, zeus_1792018691455_30f56a64),
// which landed with no test at all (`grep -rli contacts test/*.test.js` → 0).
// portal.html is a single-file app with no module boundary, so — exactly like
// test/portal-lead-stats-wiring.test.js — this suite slices the REAL functions
// out of portal.html and executes them against synthetic fixtures. Nothing here
// is a copy of the implementation: a regression in portal.html changes what
// these assertions see.
//
// WHAT THE CODE ACTUALLY DOES (asserted as-is, not as the ticket imagined it)
//  * Contacts book (GET /portal/contacts?page=N&page_size=25) is SERVER-paginated:
//    each page is one request carrying the page cursor; "Next" is disabled on
//    the last page because the response's `total_pages` says there is no cursor.
//  * Activity feed (GET /portal/activity?limit=200) is CLIENT-side pagination:
//    one request pulls a 200-row window, then Next/Back swap a 5-row slice in
//    place with no refetch. So "one request per page" is the contacts book;
//    for the feed the invariant is "one request for the whole window, and
//    paging never refetches".
//  * Client scoping is carried by the X-Portal-Token header and by the fact
//    that every render is a pure function of the CURRENT response — the module
//    holds no cross-request accumulation of rows.
//
// KNOWN GAP, ASSERTED AS CURRENT BEHAVIOUR (see the two tests marked "gap")
// The ticket asked for "API failure mid-pagination must keep the already-loaded
// rows". The shipped code replaces the pane with a Retry message instead. This
// ticket forbids application-code changes, so the suite pins today's honest
// failure state and the gap is reported on the board for a follow-up — writing
// a red test here would only break the existing green suite.

'use strict';

const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'portal.html'), 'utf8');

// ── Extract the real blocks ──────────────────────────────────────────────────
function sliceBetween(startMarker, endMarker) {
  const s = html.indexOf(startMarker);
  if (s === -1) throw new Error(`portal.html no longer contains: ${startMarker}`);
  const e = html.indexOf(endMarker, s);
  if (e === -1) throw new Error(`portal.html no longer contains: ${endMarker}`);
  return html.slice(s, e);
}

function activityStateSource() {
  return sliceBetween('let activityAll = [];', '// ── LEAD ANALYTICS DASHBOARD');
}

function activityFeedSource() {
  return sliceBetween('async function loadActivity()', '// ─── CONTACTS MODULE');
}

function contactsModuleSource() {
  return sliceBetween('// ─── CONTACTS MODULE', '// ─── LEAD TIMELINE');
}

// The portal defines escapeHtml twice (marketing block + portal block). The
// contacts renderer uses the portal one — take the LAST definition so the test
// escapes exactly what the real renderer escapes with.
function escapeHtmlSource() {
  const s = html.lastIndexOf('function escapeHtml(str)');
  if (s === -1) throw new Error('portal.html no longer contains escapeHtml');
  const e = html.indexOf('\n}', s);
  return html.slice(s, e + 2);
}

// ── Sandbox ──────────────────────────────────────────────────────────────────
// Runs the real functions with a stubbed document/fetch. `TOKEN` is a mutable
// box so a test can switch the authenticated client mid-life WITHOUT rebuilding
// the module — that is what makes the no-cross-client-accumulation assertion
// meaningful (a fresh sandbox per client would hide leaked state).
function makeSandbox() {
  const els = {};
  const el = (id) => {
    if (!els[id]) {
      els[id] = {
        id, innerHTML: '', textContent: '', value: '', disabled: false,
        style: {}, classList: { add() {}, remove() {} },
      };
    }
    return els[id];
  };

  const calls = [];
  const state = { respond: null };

  const fetch = async (url, init) => {
    const entry = { url: String(url), init: init || {} };
    calls.push(entry);
    expect(state.respond).toBeTruthy(); // every call must be answered by the test
    const r = await state.respond(entry, calls.filter(c => c.url === entry.url).length);
    if (r instanceof Error) throw r;
    return {
      status: r.status,
      ok: r.status >= 200 && r.status < 300,
      json: async () => r.body,
    };
  };

  const document = {
    getElementById(id) {
      // Filter inputs are absent on the feed path unless a test seeds them;
      // loadActivity uses optional chaining for exactly this reason.
      if (id === 'activity-filter-workflow' || id === 'activity-filter-status' || id === 'activity-search') {
        return els[id] || null;
      }
      return el(id);
    },
  };

  const body = [
    'let portalToken = null;',
    activityStateSource(),
    activityFeedSource(),
    contactsModuleSource(),
    escapeHtmlSource(),
    `return {
      loadActivity, filterActivity, renderActivity, updateActivityPager,
      activityNextPage, activityPrevPage,
      getActivityAll: () => activityAll,
      getActivityPage: () => activityPage,
      ACTIVITY_PAGE_SIZE,
      loadContactsSearch, toggleContactsBook, loadContactsBook,
      contactsBookNext, contactsBookPrev, resetContactsModule,
      renderContactsTable,
      getContactsBookOpen: () => contactsBookOpen,
      getContactsBookPage: () => contactsBookPage,
      CONTACTS_BOOK_PAGE_SIZE,
      // portal.html assigns portalToken at login; the test flips it to model a
      // different authenticated client WITHOUT rebuilding the module.
      setToken: (t) => { portalToken = t; },
    };`,
  ].join('\n');

  const api = new Function(
    'document', 'fetch', 'API', 'escapeHtml', 'URLSearchParams', 'console', 'clearTimeout', 'setTimeout',
    body
  )(document, fetch, 'https://api.test', new Function(`${escapeHtmlSource()}; return escapeHtml;`)(),
    URLSearchParams, { error() {}, log() {}, warn() {} }, () => {}, () => {});

  api.setToken('token-client-A'); // default authenticated client for a fresh portal

  return { api, els, el, calls, state };
}

const jsonRes = (body) => ({ status: 200, body });
const errRes = (status, body = {}) => ({ status, body });

const q = (url) => new URL(url).searchParams;

// Two synthetic clients — deliberately disjoint alphabets so a leak is obvious.
const CLIENT_A_CONTACTS = [
  { name: 'Ada Alvarez', phone: '5125550101', email: 'ada@a.example', company: 'Alvarez Co' },
  { name: 'Amos Ash', phone: '5125550102', email: 'amos@a.example', company: 'Ash LLC' },
  { name: 'Ava Austin', phone: '5125550103', email: 'ava@a.example', company: 'Austin Inc' },
];
const CLIENT_B_CONTACTS = [
  { name: 'Zara Zane', phone: '5125550201', email: 'zara@b.example', company: 'Zane Group' },
  { name: 'Zeke Zorn', phone: '5125550202', email: 'zeke@b.example', company: 'Zorn Co' },
];

// 60 synthetic contacts so 3 pages of 25 hold 25 / 25 / 10.
function bookPage(prefix, page, pageSize, total) {
  const start = (page - 1) * pageSize;
  const count = Math.max(0, Math.min(pageSize, total - start));
  return Array.from({ length: count }, (_, i) => ({
    name: `${prefix} ${String(start + i + 1).padStart(2, '0')}`,
    phone: `512555${String(start + i + 1).padStart(4, '0')}`,
    email: `${prefix.toLowerCase()}${start + i + 1}@example.test`,
    company: 'Synthetic Co',
  }));
}

// ── Contacts: cross-client scoping ───────────────────────────────────────────
describe('portal.html Analytics contacts module — client scoping', () => {
  test('the module sends the authenticated token and never a client id in the URL', async () => {
    const sb = makeSandbox();
    sb.state.respond = () => jsonRes({ contacts: CLIENT_A_CONTACTS, total: 3, total_pages: 1 });

    sb.el('contacts-search').value = 'a';
    await sb.api.loadContactsSearch();

    expect(sb.calls).toHaveLength(1);
    const [call] = sb.calls;
    expect(call.init.headers['X-Portal-Token']).toBe('token-client-A');
    // Scoping must ride the session token, never a caller-supplied client key.
    for (const key of ['client_id', 'clientId', 'tenant', 'org_id', 'account_id']) {
      expect(q(call.url).has(key)).toBe(false);
    }
    expect([...q(call.url).keys()]).toEqual(['search']);
  });

  test('client B contacts never render for client A, and A rows do not survive the switch', async () => {
    const sb = makeSandbox();
    // Same module instance, both requests answered; the response is chosen by
    // the token the module actually sent — i.e. the server-side scoping contract.
    sb.state.respond = (call) => {
      const tok = call.init.headers['X-Portal-Token'];
      const contacts = tok === 'token-client-B' ? CLIENT_B_CONTACTS : CLIENT_A_CONTACTS;
      return jsonRes({ contacts, total: contacts.length, total_pages: 1 });
    };

    // Pass 1 — client A.
    sb.el('contacts-search').value = 'a';
    await sb.api.loadContactsSearch();
    const aHtml = sb.el('contacts-results').innerHTML;
    expect(aHtml).toContain('Ada Alvarez');
    expect(aHtml).not.toContain('Zara Zane');

    // Pass 2 — the portal re-authenticates as client B (token swap, same module).
    sb.api.setToken('token-client-B');
    await sb.api.loadContactsSearch();
    const bHtml = sb.el('contacts-results').innerHTML;

    expect(sb.calls[1].init.headers['X-Portal-Token']).toBe('token-client-B');
    expect(bHtml).toContain('Zara Zane');
    expect(bHtml).toContain('Zeke Zorn');
    // The leak this ticket exists to prevent: B's pane must not carry A's rows.
    for (const c of CLIENT_A_CONTACTS) {
      expect(bHtml).not.toContain(c.name);
      expect(bHtml).not.toContain(c.phone);
      expect(bHtml).not.toContain(c.email);
    }
  });

  test('the contact book is scoped the same way (page requests carry the session token)', async () => {
    const sb = makeSandbox();
    sb.state.respond = (call) => {
      const tok = call.init.headers['X-Portal-Token'];
      const contacts = tok === 'token-client-B' ? CLIENT_B_CONTACTS : CLIENT_A_CONTACTS;
      return jsonRes({ contacts, total: contacts.length, total_pages: 1 });
    };

    await sb.api.toggleContactsBook();
    expect(sb.el('contacts-book').innerHTML).toContain('Ada Alvarez');
    expect(sb.el('contacts-book').innerHTML).not.toContain('Zara Zane');

    sb.api.resetContactsModule();
    sb.api.setToken('token-client-B');
    await sb.api.toggleContactsBook();
    const bHtml = sb.el('contacts-book').innerHTML;
    expect(bHtml).toContain('Zara Zane');
    expect(bHtml).not.toContain('Ada Alvarez');
  });
});

// ── Contacts: pagination ────────────────────────────────────────────────────
describe('portal.html contact book pagination', () => {
  const TOTAL = 60;
  const PAGE_SIZE = 25;

  function pagedSandbox(total = TOTAL) {
    const sb = makeSandbox();
    sb.state.respond = (call) => {
      const params = q(call.url);
      const page = Number(params.get('page') || 1);
      const pageSize = Number(params.get('page_size') || PAGE_SIZE);
      const totalPages = Math.max(1, Math.ceil(total / pageSize));
      return jsonRes({
        contacts: bookPage('Contact', page, pageSize, total),
        total,
        total_pages: totalPages,
      });
    };
    return sb;
  }

  test('opening the book issues exactly one request for page 1', async () => {
    const sb = pagedSandbox();
    await sb.api.toggleContactsBook();

    expect(sb.calls).toHaveLength(1);
    expect(q(sb.calls[0].url).get('page')).toBe('1');
    expect(q(sb.calls[0].url).get('page_size')).toBe(String(PAGE_SIZE));
    expect(sb.el('contacts-book').innerHTML).toContain('Page 1 of 3');
  });

  test('each Next issues exactly one request with the next page cursor', async () => {
    const sb = pagedSandbox();
    await sb.api.toggleContactsBook();
    sb.api.contactsBookNext();
    await new Promise((r) => setImmediate(r));
    sb.api.contactsBookNext();
    await new Promise((r) => setImmediate(r));

    expect(sb.calls).toHaveLength(3);
    expect(sb.calls.map((c) => q(c.url).get('page'))).toEqual(['1', '2', '3']);
    // One request per page — never a duplicate fetch of the same cursor.
    const cursors = sb.calls.map((c) => q(c.url).get('page'));
    expect(new Set(cursors).size).toBe(cursors.length);
  });

  test('pages are disjoint: 60 contacts across 3 pages, none duplicated, none dropped', async () => {
    const sb = pagedSandbox();
    const seen = [];

    await sb.api.toggleContactsBook();
    const collect = () => {
      const rows = [...sb.el('contacts-book').innerHTML.matchAll(/<td style="font-weight:600;font-size:14px;">([^<]+)<\/td>/g)];
      return rows.map((m) => m[1]);
    };

    let pageNames = collect();
    expect(pageNames).toHaveLength(25);
    seen.push(...pageNames);

    sb.api.contactsBookNext();
    await new Promise((r) => setImmediate(r));
    pageNames = collect();
    expect(pageNames).toHaveLength(25);
    seen.push(...pageNames);

    sb.api.contactsBookNext();
    await new Promise((r) => setImmediate(r));
    pageNames = collect();
    expect(pageNames).toHaveLength(10); // last page holds the remainder
    seen.push(...pageNames);

    expect(seen).toHaveLength(TOTAL);
    expect(new Set(seen).size).toBe(TOTAL); // no contact rendered twice
    expect(seen).toEqual(bookPage('Contact', 1, TOTAL, TOTAL).map((c) => c.name)); // no rows dropped
  });

  test('the last page has no cursor: Next is disabled and Back is enabled', async () => {
    const sb = pagedSandbox();
    await sb.api.toggleContactsBook();
    sb.api.contactsBookNext();
    await new Promise((r) => setImmediate(r));
    sb.api.contactsBookNext();
    await new Promise((r) => setImmediate(r));

    const book = sb.el('contacts-book').innerHTML;
    expect(book).toContain('Page 3 of 3');
    const nextBtn = book.slice(book.indexOf('contactsBookNext()'));
    expect(nextBtn.slice(0, 120)).toContain('disabled');
    const prevBtn = book.slice(book.indexOf('contactsBookPrev()'));
    expect(prevBtn.slice(0, 120)).not.toContain('disabled');
  });

  test('an empty contact book renders the honest empty state, not an empty table', async () => {
    const sb = makeSandbox();
    sb.state.respond = () => jsonRes({ contacts: [], total: 0, total_pages: 1 });
    await sb.api.toggleContactsBook();

    const html_ = sb.el('contacts-book').innerHTML;
    expect(html_).toContain('No contacts yet.');
    expect(html_).not.toContain('<table');
    expect(sb.api.getContactsBookPage()).toBe(1);
  });

  test('gap: a failed page load shows Retry and never renders a phantom table', async () => {
    const sb = pagedSandbox();
    await sb.api.toggleContactsBook();
    sb.state.respond = () => errRes(500, { error: 'contacts unavailable' });
    sb.api.contactsBookNext();
    await new Promise((r) => setImmediate(r));

    const html_ = sb.el('contacts-book').innerHTML;
    expect(html_).toContain('Could not load the contact book.');
    expect(html_).toContain('Retry');
    expect(html_).not.toContain('<table');
    // Documented divergence from the ticket's "keep already-loaded rows":
    // the shipped renderer replaces the pane. Pinned here so the follow-up can
    // flip this assertion deliberately instead of silently.
    expect(sb.api.getContactsBookPage()).toBe(2);
  });
});

// ── Contacts: rendering ─────────────────────────────────────────────────────
describe('portal.html contacts row rendering', () => {
  test('all four columns render from the payload', () => {
    const sb = makeSandbox();
    const out = sb.api.renderContactsTable(CLIENT_A_CONTACTS);
    for (const c of CLIENT_A_CONTACTS) {
      expect(out).toContain(c.name);
      expect(out).toContain(c.phone);
      expect(out).toContain(c.email);
      expect(out).toContain(c.company);
    }
    for (const head of ['Name', 'Phone', 'Email', 'Company']) expect(out).toContain(`<th>${head}</th>`);
  });

  test('missing fields render an em dash rather than the string "undefined"', () => {
    const sb = makeSandbox();
    const out = sb.api.renderContactsTable([{ name: 'No Email', phone: '5125550199' }]);
    expect(out).toContain('No Email');
    expect(out).not.toContain('undefined');
    expect(out).toContain('—');
  });

  test('contact fields are HTML-escaped — a crafted name cannot inject markup', () => {
    const sb = makeSandbox();
    const out = sb.api.renderContactsTable([{
      name: '<img src=x onerror=alert(1)>',
      phone: '5125550100',
      email: 'x@example.test',
      company: '<script>alert(1)</script>',
    }]);
    expect(out).not.toContain('<img src=x');
    expect(out).not.toContain('<script>');
    expect(out).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });
});

// ── Activity feed pagination ────────────────────────────────────────────────
describe('portal.html activity feed pagination', () => {
  const LOGS = Array.from({ length: 12 }, (_, i) => ({
    timestamp: `2026-10-2${(i % 9) + 1}T10:00:00Z`,
    status: i % 3 === 0 ? 'success' : 'info',
    event_type: `event_${String(i + 1).padStart(2, '0')}`,
    workflow_id: 'wf_alpha',
    lead_id: `lead_${String(i + 1).padStart(4, '0')}`,
    details: { n: i + 1 },
  }));

  const activityCalls = (sb) => sb.calls.filter((c) => c.url.includes('/portal/activity'));

  function feedSandbox(logs = LOGS) {
    const sb = makeSandbox();
    sb.state.respond = () => jsonRes({ logs });
    return sb;
  }

  test('opening Analytics issues exactly one feed request and renders the newest 5', async () => {
    const sb = feedSandbox();
    await sb.api.loadActivity();

    expect(activityCalls(sb)).toHaveLength(1);
    const params = q(activityCalls(sb)[0].url);
    expect(params.get('limit')).toBe('200');
    expect(activityCalls(sb)[0].init.headers['X-Portal-Token']).toBe('token-client-A');

    const feed = sb.el('activity-feed').innerHTML;
    expect(feed).toContain('event 01');
    expect(feed).toContain('event 05');
    expect(feed).not.toContain('event 06');
    expect(sb.el('activity-pager-label').textContent).toBe('1\u20135 of 12');
    expect(sb.el('activity-prev-btn').disabled).toBe(true);
    expect(sb.el('activity-next-btn').disabled).toBe(false);
    expect(sb.el('activity-pager').style.display).toBe('flex');
  });

  test('Next pages older items in place: no refetch, no duplicates, no dropped rows', async () => {
    const sb = feedSandbox();
    await sb.api.loadActivity();
    const requestsAfterLoad = sb.calls.length;

    const seen = [];
    const collect = () => [...sb.el('activity-feed').innerHTML.matchAll(/event (\d\d)/g)].map((m) => m[1]);

    seen.push(...collect());
    sb.api.activityNextPage();
    seen.push(...collect());
    expect(sb.el('activity-pager-label').textContent).toBe('6\u201310 of 12');

    sb.api.activityNextPage();
    seen.push(...collect());
    expect(sb.el('activity-pager-label').textContent).toBe('11\u201312 of 12');

    // Paging is in-place over the already-fetched window.
    expect(sb.calls.length).toBe(requestsAfterLoad);
    expect(seen).toHaveLength(12);
    expect(new Set(seen).size).toBe(12);
    expect(seen).toEqual(['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12']);
  });

  test('the last page has no cursor: Next disabled, Back enabled, Back returns the previous slice', async () => {
    const sb = feedSandbox();
    await sb.api.loadActivity();
    sb.api.activityNextPage();
    sb.api.activityNextPage();

    expect(sb.el('activity-next-btn').disabled).toBe(true);
    expect(sb.el('activity-prev-btn').disabled).toBe(false);
    expect(sb.api.getActivityPage()).toBe(2);

    // Clicking Next on the last page is a no-op even if the guard is bypassed.
    sb.api.activityNextPage();
    expect(sb.api.getActivityPage()).toBe(2);

    sb.api.activityPrevPage();
    expect(sb.api.getActivityPage()).toBe(1);
    expect(sb.el('activity-pager-label').textContent).toBe('6\u201310 of 12');
  });

  test('an empty feed renders the honest empty state and hides the pager', async () => {
    const sb = feedSandbox([]);
    await sb.api.loadActivity();

    expect(sb.el('activity-feed').innerHTML).toContain('No activity yet.');
    expect(sb.el('activity-pager').style.display).toBe('none');
  });

  test('gap: a 304 is not treated as an error, but the pane is left on the loading placeholder', async () => {
    const sb = feedSandbox();
    await sb.api.loadActivity();
    expect(sb.el('activity-feed').innerHTML).toContain('event 01');

    sb.state.respond = () => ({ status: 304, body: {} });
    await sb.api.loadActivity();

    const feed = sb.el('activity-feed').innerHTML;
    // A 304 must never surface as "Could not load activity" (that was the
    // original 304 bug), and it must not throw.
    expect(feed).not.toContain('Could not load activity.');
    expect(feed).not.toContain('session expired');
    // KNOWN GAP: loadActivity repaints the loading placeholder before the
    // fetch, so the "keep what's already rendered" comment is not true in
    // practice — the feed is left on "Loading activity...". Pinned as current
    // behaviour; the follow-up should render from activityAll instead.
    expect(feed).toContain('Loading activity...');
    // The already-fetched window is untouched, so an in-place repaint is one
    // renderActivity() away and no data was lost.
    expect(sb.api.getActivityAll()).toHaveLength(LOGS.length);
  });

  test('gap: an API failure shows Retry, keeps the pager consistent, never a half-page', async () => {
    const sb = feedSandbox();
    sb.state.respond = () => errRes(500, { error: 'activity unavailable' });
    await sb.api.loadActivity();

    const feed = sb.el('activity-feed').innerHTML;
    expect(feed).toContain('Could not load activity.');
    expect(feed).toContain('Retry');
    // Page index is reset so a retry cannot land the user on a stale window.
    expect(sb.api.getActivityPage()).toBe(0);
    expect(sb.el('activity-pager').style.display).toBe('none');
  });

  test('an expired session is distinguished from a transient failure', async () => {
    const sb = feedSandbox();
    sb.state.respond = () => errRes(401, { error: 'unauthorized' });
    await sb.api.loadActivity();

    const feed = sb.el('activity-feed').innerHTML;
    expect(feed).toContain('Your session expired.');
    expect(feed).not.toContain('Retry');
  });
});
