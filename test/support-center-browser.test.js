// test/support-center-browser.test.js — BROWSER-LEVEL coverage for the Client
// Support Center (SUP-12, board zeus_1795334282291_ed19d98b).
//
// WHY THIS FILE EXISTS
// portal.html gained a Support page that talks to /portal/support/* (atlas-ai
// supportRouter.js, SUP-11). Everything on that page is wiring: a nav entry, a
// showPage loader, a 401 teardown, a poll, and a render path whose ONLY safety
// property is that server strings go to textContent instead of innerHTML. None
// of that is observable from a string-matching test — a renamed id, an
// unbound handler, or one innerHTML in the wrong place ships green.
//
// So this suite drives a real Chromium (Playwright) against the real portal.html
// served off the working tree, with the support API mocked at the network layer
// (page.route) so it is offline, deterministic and spends zero model tokens.
// It pins the four things the ticket asks for:
//   1. login -> open support -> send a message -> the assistant reply renders ->
//      escalate -> the ticket appears in the list -> reply to the ticket;
//   2. a message (and a reply) containing HTML/script is displayed LITERALLY;
//   3. a fixture client cannot see another client's conversations or tickets;
//   4. an expired token (401) bounces to login instead of failing silently.
// Plus the two list behaviours the page promises: cursor pagination on the
// ticket list, and the new-ticket dialog round trip.
//
// The tenant boundary itself is server-side and pinned in atlas-ai; what is
// pinned here is that this page never crosses it on its own — it sends only the
// portal token, never a client id, and it renders whatever 404s.

const fs = require('fs');
const http = require('http');
const path = require('path');

// Chromium + page load is well over jest's 5s default.
jest.setTimeout(120000);

const repoRoot = path.join(__dirname, '..');

// ── Playwright resolution (same harness the other browser suites use) ────────
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
    '\n[support-center-browser] SKIPPING the support center browser suite — ' +
    (chromium ? 'Playwright is installed but its Chromium build is not.\n' : 'Playwright is not installed.\n') +
    '  Install with:  npm i -D playwright && npx playwright install chromium\n' +
    '  (or point PLAYWRIGHT_PKG at an existing playwright install).\n'
  );
}

const describeBrowser = browserReady ? describe : describe.skip;

// ── Fixtures ────────────────────────────────────────────────────────────────
const TOKEN_A = 'support-browser-token-a';
const TOKEN_B = 'support-browser-token-b';

const CLIENT = {
  business_name: 'Acme Support Smoke Co',
  tutorial_completed: true, // suppress the first-run tutorial overlay
  webhook_url: '',
};

const B_SECRET_SUBJECT = 'TENANT-B-SECRET-SUBJECT';
const B_SECRET_BODY = 'TENANT-B-SECRET-BODY';

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

// ── Mock /portal/support API (stateful, tenant-scoped, cursor-paginated) ─────
// Two tenants keyed by portal token: A is the fixture client under test, B owns
// data A must never see. Nothing is keyed by a client id in the request, which
// mirrors the real router: the tenant comes from the signed token alone.
function createMockApi(opts) {
  const o = opts || {};
  const now = Date.now();
  const iso = (minsAgo) => new Date(now - minsAgo * 60000).toISOString();
  const pageSize = o.pageSize || 10;
  const assistantEcho = !!o.assistantEcho; // reply echoes the user's text verbatim

  const tenants = {};

  tenants[TOKEN_A] = {
    conversations: [
      {
        conversation_id: 'conv-a-1',
        channel: 'portal',
        status: 'open',
        started_at: iso(60),
        last_message_at: iso(5),
        message_count: 2,
        ticket_id: null,
      },
    ],
    messages: {
      'conv-a-1': [
        { message_id: '0000000000001#a', role: 'user', content: 'My phone number stopped ringing yesterday.', created_at: iso(60) },
        { message_id: '0000000000002#b', role: 'assistant', content: 'I can help with that. Is the number still listed as active in Settings?', created_at: iso(59) },
      ],
    },
    tickets: [],
    events: {},
    seq: 0,
    ticketSeq: 0,
  };

  tenants[TOKEN_B] = {
    conversations: [
      {
        conversation_id: 'conv-b-1',
        channel: 'portal',
        status: 'open',
        started_at: iso(90),
        last_message_at: iso(80),
        message_count: 1,
        ticket_id: null,
      },
    ],
    messages: {
      'conv-b-1': [
        { message_id: '0000000000003#c', role: 'user', content: 'B only conversation body', created_at: iso(90) },
      ],
    },
    tickets: [
      {
        ticket_id: 't-b-1',
        ticket_number: 'SUP-000099',
        subject: B_SECRET_SUBJECT,
        status: 'open',
        priority: 'P1',
        category: 'other',
        created_at: iso(30),
      },
    ],
    events: {
      't-b-1': [
        { event_id: 'e-b-1', type: 'created', actor: 'customer', visibility: 'customer', body: B_SECRET_BODY, created_at: iso(30) },
      ],
    },
    seq: 0,
    ticketSeq: 0,
  };

  // Seed extra tickets for tenant A when a test needs a second page.
  for (let i = 0; i < (o.seedTickets || 0); i++) {
    const id = 't-a-seed-' + (i + 1);
    tenants[TOKEN_A].tickets.push({
      ticket_id: id,
      ticket_number: 'SUP-00010' + (i + 1),
      subject: 'Seeded ticket ' + (i + 1),
      status: i === 0 ? 'in_progress' : 'open',
      priority: i === 0 ? 'P1' : 'P3',
      category: 'other',
      created_at: iso(10 + i * 10), // seed 1 is the newest
    });
    tenants[TOKEN_A].events[id] = [
      { event_id: 'e-' + id, type: 'created', actor: 'customer', visibility: 'customer', body: 'Seeded ticket ' + (i + 1) + ' body', created_at: iso(10 + i * 10) },
    ];
  }

  return {
    tenants,
    requests: [],
    revoked: false,

    setOrigin() {},

    supportRequests() {
      return this.requests.filter(r => r.pathname.indexOf('/portal/support') === 0);
    },

    dispatch(method, pathname, search, headers, rawBody) {
      let body = null;
      if (rawBody) { try { body = JSON.parse(rawBody); } catch (e) { body = rawBody; } }
      const lower = {};
      Object.keys(headers || {}).forEach(k => { lower[k.toLowerCase()] = headers[k]; });
      const record = { method, pathname, search: search || '', headers: lower, body };
      this.requests.push(record);

      // Login is the only route outside the support surface this suite needs.
      if (method === 'POST' && pathname === '/portal/auth') {
        return { status: 200, body: { token: TOKEN_A, client: CLIENT } };
      }

      if (pathname.indexOf('/portal/support') !== 0) {
        // Everything else the dashboard boot fans out to — empty but valid JSON.
        return { status: 200, body: {} };
      }

      if (this.revoked) {
        return { status: 401, body: { error: 'invalid or expired portal token' } };
      }

      const tenant = tenants[lower['x-portal-token']];
      if (!tenant) {
        return { status: 401, body: { error: 'invalid or expired portal token' } };
      }

      const sub = pathname.slice('/portal/support'.length);
      const parts = sub.split('/').filter(Boolean);
      const resource = parts[0];

      // GET /conversations — newest activity first, cursor = offset.
      if (resource === 'conversations' && parts.length === 1 && method === 'GET') {
        const sorted = tenant.conversations.slice().sort((a, b) => Date.parse(b.last_message_at) - Date.parse(a.last_message_at));
        const offset = Number((new URLSearchParams(search || '').get('cursor') || '').replace(/^o:/, '')) || 0;
        const slice = sorted.slice(offset, offset + pageSize);
        const next = offset + pageSize < sorted.length ? 'o:' + (offset + pageSize) : null;
        return { status: 200, body: { conversations: slice, next_cursor: next } };
      }

      // POST /conversations — start a thread.
      if (resource === 'conversations' && parts.length === 1 && method === 'POST') {
        const id = 'conv-a-new-' + (tenant.seq + 1);
        const conversation = {
          conversation_id: id,
          channel: 'portal',
          status: 'open',
          started_at: new Date().toISOString(),
          last_message_at: new Date().toISOString(),
          message_count: 0,
          ticket_id: null,
        };
        tenant.conversations.push(conversation);
        tenant.messages[id] = [];
        return { status: 201, body: { conversation_id: id, conversation } };
      }

      // GET /conversations/:id
      if (resource === 'conversations' && parts.length === 2 && method === 'GET') {
        const conv = tenant.conversations.filter(c => c.conversation_id === parts[1])[0];
        if (!conv) return { status: 404, body: { error: 'conversation not found' } };
        return { status: 200, body: { conversation: conv, messages: tenant.messages[conv.conversation_id] || [], next_cursor: null } };
      }

      // POST /conversations/:id/messages — append + canned assistant reply.
      if (resource === 'conversations' && parts.length === 3 && parts[2] === 'messages' && method === 'POST') {
        const conv = tenant.conversations.filter(c => c.conversation_id === parts[1])[0];
        if (!conv) return { status: 404, body: { error: 'conversation not found' } };
        const content = body && typeof body.content === 'string' ? body.content : '';
        if (!content.trim()) return { status: 400, body: { error: 'content is required' } };
        tenant.seq += 1;
        const stamp = Date.now();
        const userMessage = {
          message_id: String(stamp) + '#u' + tenant.seq,
          role: 'user',
          content,
          created_at: new Date(stamp).toISOString(),
        };
        const replyText = assistantEcho
          ? 'Echo: ' + content
          : 'Thanks — I logged that. A specialist will follow up if the checklist does not fix it.';
        const assistantMessage = {
          message_id: String(stamp + 1) + '#a' + tenant.seq,
          role: 'assistant',
          content: replyText,
          created_at: new Date(stamp + 1).toISOString(),
        };
        tenant.messages[conv.conversation_id] = (tenant.messages[conv.conversation_id] || []).concat([userMessage, assistantMessage]);
        conv.message_count = tenant.messages[conv.conversation_id].length;
        conv.last_message_at = assistantMessage.created_at;
        return {
          status: 201,
          body: {
            user_message: userMessage,
            assistant_message: assistantMessage,
            escalated: false,
            ticket_id: null,
            tier: 'T1',
            model: 'mock-model',
          },
        };
      }

      // POST /conversations/:id/escalate — open a ticket and link it.
      if (resource === 'conversations' && parts.length === 3 && parts[2] === 'escalate' && method === 'POST') {
        const conv = tenant.conversations.filter(c => c.conversation_id === parts[1])[0];
        if (!conv) return { status: 404, body: { error: 'conversation not found' } };
        if (conv.ticket_id) {
          return { status: 200, body: { escalated: true, created: false, reason: 'already_escalated', ticket_id: conv.ticket_id, ticket: null, trigger: 'manual' } };
        }
        tenant.seq += 1;
        const ticketSeq = tenant.ticketSeq + 1;
        tenant.ticketSeq = ticketSeq;
        const ticketId = 't-a-' + ticketSeq;
        const ticket = {
          ticket_id: ticketId,
          ticket_number: 'SUP-0002' + String(ticketSeq).padStart(2, '0'),
          subject: 'Escalated from support chat',
          status: 'open',
          priority: 'P3',
          category: 'other',
          conversation_id: conv.conversation_id,
          created_at: new Date().toISOString(),
        };
        tenant.tickets.push(ticket);
        tenant.events[ticketId] = [
          { event_id: 'e-' + ticketId, type: 'created', actor: 'customer', visibility: 'customer', body: 'Escalated from support chat', created_at: ticket.created_at },
        ];
        conv.ticket_id = ticketId;
        conv.status = 'escalated';
        return { status: 201, body: { escalated: true, created: true, reason: 'customer_request', ticket_id: ticketId, ticket, trigger: 'manual' } };
      }

      // GET /tickets — newest first, cursor = offset, honouring the page size.
      if (resource === 'tickets' && parts.length === 1 && method === 'GET') {
        const sorted = tenant.tickets.slice().sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
        const offset = Number((new URLSearchParams(search || '').get('cursor') || '').replace(/^o:/, '')) || 0;
        const slice = sorted.slice(offset, offset + pageSize);
        const next = offset + pageSize < sorted.length ? 'o:' + (offset + pageSize) : null;
        return { status: 200, body: { tickets: slice, next_cursor: next } };
      }

      // POST /tickets — create one directly.
      if (resource === 'tickets' && parts.length === 1 && method === 'POST') {
        tenant.seq += 1;
        const ticketSeq = tenant.ticketSeq + 1;
        tenant.ticketSeq = ticketSeq;
        const ticketId = 't-a-' + ticketSeq;
        const ticket = {
          ticket_id: ticketId,
          ticket_number: 'SUP-0002' + String(ticketSeq).padStart(2, '0'),
          subject: body && body.subject ? body.subject : 'Untitled',
          status: 'open',
          priority: (body && body.priority) || 'P3',
          category: (body && body.category) || 'other',
          created_at: new Date().toISOString(),
        };
        tenant.tickets.push(ticket);
        tenant.events[ticketId] = [
          { event_id: 'e-' + ticketId, type: 'created', actor: 'customer', visibility: 'customer', body: (body && body.body) || ticket.subject, created_at: ticket.created_at },
        ];
        return { status: 201, body: { ticket } };
      }

      // GET /tickets/:id
      if (resource === 'tickets' && parts.length === 2 && method === 'GET') {
        const ticket = tenant.tickets.filter(t => t.ticket_id === parts[1])[0];
        if (!ticket) return { status: 404, body: { error: 'ticket not found' } };
        return { status: 200, body: { ticket, events: tenant.events[ticket.ticket_id] || [], next_cursor: null } };
      }

      // POST /tickets/:id/replies
      if (resource === 'tickets' && parts.length === 3 && parts[2] === 'replies' && method === 'POST') {
        const ticket = tenant.tickets.filter(t => t.ticket_id === parts[1])[0];
        if (!ticket) return { status: 404, body: { error: 'ticket not found' } };
        const content = body && typeof body.content === 'string' ? body.content : '';
        if (!content.trim()) return { status: 400, body: { error: 'content is required' } };
        const event = {
          event_id: 'e-' + ticket.ticket_id + '-' + ((tenant.events[ticket.ticket_id] || []).length + 1),
          type: 'reply',
          actor: 'customer',
          visibility: 'customer',
          body: content,
          created_at: new Date().toISOString(),
        };
        tenant.events[ticket.ticket_id] = (tenant.events[ticket.ticket_id] || []).concat([event]);
        return { status: 201, body: { event } };
      }

      return { status: 404, body: { error: 'not found' } };
    },
  };
}

// Intercept every request the page makes: let the local static server through,
// answer /portal|/api with the mock, stub the third-party CDNs.
async function installNetwork(page, api) {
  await page.route('**/*', (route) => {
    const req = route.request();
    const url = new URL(req.url());

    if (url.hostname === '127.0.0.1') return route.continue();

    if (url.pathname.startsWith('/portal/') || url.pathname.startsWith('/api/')) {
      const r = api.dispatch(req.method(), url.pathname, url.search, req.headers(), req.postData());
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

async function waitFor(fn, timeoutMs = 15000) {
  const start = Date.now();
  for (;;) {
    if (await fn()) return undefined;
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise(r => setTimeout(r, 60));
  }
}

async function seedAuth(page, token) {
  await page.addInitScript((args) => {
    try {
      window.sessionStorage.setItem('atlas_token', args.token);
      window.sessionStorage.setItem('atlas_client', JSON.stringify(args.client));
    } catch (e) { /* about:blank frame */ }
  }, { token: token || TOKEN_A, client: CLIENT });
}

// Load the portal with a seeded session and land on the Support page.
async function openSupport(page, baseUrl, token) {
  await page.goto(baseUrl + '/portal.html', { waitUntil: 'domcontentloaded' });
  await waitFor(async () => page.evaluate(() => {
    const app = document.getElementById('app');
    return !!app && app.style.display === 'block';
  }));
  await page.click('#nav-support');
  await waitFor(async () => page.evaluate(() => {
    const page = document.getElementById('page-support');
    return !!page && page.classList.contains('active');
  }));
}

function messagesText(page) {
  return page.evaluate(() => {
    const box = document.getElementById('support-messages');
    return Array.prototype.map.call(box.querySelectorAll('.conv-bubble'), b => b.textContent);
  });
}

// ── Suite ────────────────────────────────────────────────────────────────────
describeBrowser('client support center — browser-level smoke', () => {
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

  async function withPage(api, fn, opts) {
    const o = opts || {};
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    try {
      await installNetwork(page, api);
      if (o.seed !== false) await seedAuth(page, o.token);
      return await fn(page);
    } finally {
      await page.close();
    }
  }

  test('1. login -> support -> send -> reply renders -> escalate -> ticket listed -> reply to ticket', async () => {
    const api = createMockApi();

    // seed:false — this test drives the REAL login form, so the page must start
    // with no session in storage.
    await withPage(api, async (page) => {
      // A REAL login through the form: the support page must work for a session
      // that was created the way a client creates one.
      await page.goto(baseUrl + '/portal.html', { waitUntil: 'domcontentloaded' });
      await page.fill('#login-email', 'owner@acme.test');
      await page.fill('#login-code', 'ABCD1234');
      await page.click('#login-btn');
      await waitFor(async () => page.evaluate(() => {
        const app = document.getElementById('app');
        return !!app && app.style.display === 'block';
      }));

      const auth = api.requests.filter(r => r.pathname === '/portal/auth');
      expect(auth.length).toBe(1);

      // Open the page from the nav — the nav entry is part of the contract.
      await page.click('#nav-support');
      await waitFor(async () => page.evaluate(() => !!document.getElementById('support-conv-conv-a-1')));

      // The thread for the newest conversation painted with the stored messages.
      await waitFor(async () => (await messagesText(page)).length === 2);
      expect(await messagesText(page)).toEqual([
        'My phone number stopped ringing yesterday.',
        'I can help with that. Is the number still listed as active in Settings?',
      ]);

      // Send a message; the assistant's reply comes back from the API and must
      // render — no optimistic echo, so this proves the render path.
      await page.fill('#support-message-input', 'The number is still listed as active.');
      await page.click('#support-send-btn');
      await waitFor(async () => (await messagesText(page)).length === 4);
      const afterSend = await messagesText(page);
      expect(afterSend[2]).toBe('The number is still listed as active.');
      expect(afterSend[3]).toBe('Thanks — I logged that. A specialist will follow up if the checklist does not fix it.');

      const sent = api.supportRequests().filter(r => r.method === 'POST' && /\/conversations\/conv-a-1\/messages$/.test(r.pathname));
      expect(sent.length).toBe(1);
      expect(sent[0].body).toEqual({ content: 'The number is still listed as active.' });
      expect(sent[0].headers['x-portal-token']).toBe(TOKEN_A);

      // Escalate to a human -> a ticket is created and appears in the list.
      await page.click('#support-escalate-btn');
      await waitFor(async () => page.evaluate(() => !!document.getElementById('support-ticket-t-a-1')));
      const listed = await page.evaluate(() => {
        const row = document.getElementById('support-ticket-t-a-1');
        return { text: row.textContent, badges: row.querySelectorAll('.badge').length };
      });
      expect(listed.text).toContain('Escalated from support chat');
      expect(listed.badges).toBe(2); // status + priority

      // The ticket detail opened, with its customer-visible timeline.
      await waitFor(async () => page.evaluate(() => {
        const card = document.getElementById('support-ticket-card');
        return card.style.display === 'block' &&
          document.getElementById('support-ticket-title').textContent === 'Escalated from support chat';
      }));

      // Reply on the ticket.
      await page.fill('#support-ticket-reply', 'Any update on this?');
      await page.click('#support-ticket-reply-btn');
      await waitFor(async () => page.evaluate(() => {
        const box = document.getElementById('support-ticket-events');
        return box.textContent.indexOf('Any update on this?') !== -1;
      }));

      const replies = api.supportRequests().filter(r => r.method === 'POST' && /\/tickets\/t-a-1\/replies$/.test(r.pathname));
      expect(replies.length).toBe(1);
      expect(replies[0].body).toEqual({ content: 'Any update on this?' });

      // Nothing the page sent ever carried a client id — identity is the token.
      const leaked = api.supportRequests().filter(r => {
        const raw = JSON.stringify(r.body || {});
        return /client_?id|tenant/i.test(raw);
      });
      expect(leaked).toEqual([]);
    }, { seed: false });
  });

  test('2. markup in a message and in the reply is displayed literally, never executed', async () => {
    const api = createMockApi({ assistantEcho: true });
    const payload = '<img src=x onerror="window.__supXss=1"><script>window.__supXss=2</script>';

    await withPage(api, async (page) => {
      await openSupport(page, baseUrl);
      await waitFor(async () => (await messagesText(page)).length === 2);

      await page.fill('#support-message-input', payload);
      await page.click('#support-send-btn');
      await waitFor(async () => (await messagesText(page)).length === 4);

      const rendered = await page.evaluate(() => {
        const box = document.getElementById('support-messages');
        const bubbles = Array.prototype.map.call(box.querySelectorAll('.conv-bubble'), b => b.textContent);
        return {
          bubbles,
          xssFlag: window.__supXss,
          imgs: box.querySelectorAll('img').length,
          scripts: box.querySelectorAll('script').length,
          innerHtmlHasTag: /<img|<script/i.test(box.innerHTML),
          escaped: box.innerHTML.indexOf('&lt;img') !== -1,
          bubbleCount: bubbles.length,
        };
      });

      // The payload round-trips as TEXT — both the echo of what the client sent
      // and the server's own reply string.
      expect(rendered.bubbles[2]).toBe(payload);
      expect(rendered.bubbles[3]).toBe('Echo: ' + payload);
      expect(rendered.bubbleCount).toBe(4);

      // Nothing parsed, nothing executed.
      expect(rendered.xssFlag).toBeUndefined();
      expect(rendered.imgs).toBe(0);
      expect(rendered.scripts).toBe(0);
      expect(rendered.innerHtmlHasTag).toBe(false);
      expect(rendered.escaped).toBe(true);
    });
  });

  test('3. no cross-tenant visibility: another client\'s conversation and ticket are unreachable', async () => {
    const api = createMockApi();

    await withPage(api, async (page) => {
      await openSupport(page, baseUrl);
      await waitFor(async () => (await messagesText(page)).length === 2);

      // The lists hold tenant A only.
      const lists = await page.evaluate(() => ({
        conv: document.getElementById('support-conv-list').textContent,
        tickets: document.getElementById('support-ticket-list').textContent,
        convIds: Array.prototype.map.call(
          document.getElementById('support-conv-list').querySelectorAll('[data-conversation-id]'),
          el => el.getAttribute('data-conversation-id')
        ),
        ticketIds: Array.prototype.map.call(
          document.getElementById('support-ticket-list').querySelectorAll('[data-ticket-id]'),
          el => el.getAttribute('data-ticket-id')
        ),
      }));
      expect(lists.conv).not.toContain('B only conversation body');
      expect(lists.convIds).toEqual(['conv-a-1']);
      expect(lists.tickets).not.toContain(B_SECRET_SUBJECT);
      expect(lists.ticketIds).toEqual([]);

      // A direct read of tenant B's ticket id 404s on the server and the page
      // renders nothing from it — no detail card, no leaked subject.
      const before = await page.evaluate(() => document.getElementById('support-ticket-card').style.display);
      await page.evaluate(() => window.supportOpenTicket('t-b-1'));
      await waitFor(async () => page.evaluate(() => {
        const t = document.getElementById('toast');
        return !!t && t.textContent.indexOf('Could not open the ticket') !== -1;
      }));
      const after = await page.evaluate(() => ({
        display: document.getElementById('support-ticket-card').style.display,
        title: document.getElementById('support-ticket-title').textContent,
        bodyText: document.body.textContent,
      }));
      expect(before).toBe('none');
      expect(after.display).toBe('none');
      expect(after.title).not.toContain(B_SECRET_SUBJECT);
      expect(after.bodyText).not.toContain(B_SECRET_SUBJECT);
      expect(after.bodyText).not.toContain(B_SECRET_BODY);

      // Every support call carried tenant A's token and nothing else.
      const tokens = Array.from(new Set(api.supportRequests().map(r => r.headers['x-portal-token'])));
      expect(tokens).toEqual([TOKEN_A]);
    });
  });

  test('4. an expired token (401) bounces to login and stops the support poll', async () => {
    const api = createMockApi();

    await withPage(api, async (page) => {
      await openSupport(page, baseUrl);
      await waitFor(async () => (await messagesText(page)).length === 2);

      const polling = await page.evaluate(() => typeof supportState !== 'undefined' && !!supportState.pollTimer);
      expect(polling).toBe(true);

      // The session dies server-side; the next support read 401s.
      api.revoked = true;
      await page.evaluate(() => window.supportLoadTickets(false, { silent: true }));

      await waitFor(async () => page.evaluate(() => {
        const app = document.getElementById('app');
        return !!app && app.style.display === 'none';
      }));

      const state = await page.evaluate(() => ({
        loginDisplay: getComputedStyle(document.getElementById('login-screen')).display,
        loginError: document.getElementById('login-error').textContent,
        pollStopped: supportState.pollTimer === null,
        cachedTickets: supportState.tickets.length,
        cachedConversations: supportState.conversations.length,
      }));
      expect(state.loginDisplay).not.toBe('none');
      expect(state.loginError).toBe('Your session expired. Please sign in again.');
      expect(state.pollStopped).toBe(true);
      expect(state.cachedTickets).toBe(0);
      expect(state.cachedConversations).toBe(0);
    });
  });

  test('5. the ticket list paginates with a real cursor and renders status + priority badges', async () => {
    const api = createMockApi({ seedTickets: 3, pageSize: 2 });

    await withPage(api, async (page) => {
      await openSupport(page, baseUrl);
      await waitFor(async () => page.evaluate(() =>
        document.querySelectorAll('#support-ticket-list [data-ticket-id]').length === 2));

      const firstPage = await page.evaluate(() => ({
        count: document.getElementById('support-ticket-count').textContent,
        pagerDisplay: getComputedStyle(document.getElementById('support-ticket-pager')).display,
        badges: Array.prototype.map.call(
          document.querySelectorAll('#support-ticket-list .support-list-item'),
          row => Array.prototype.map.call(row.querySelectorAll('.badge'), b => b.textContent)
        ),
      }));
      expect(firstPage.count).toBe('2+ tickets');
      expect(firstPage.pagerDisplay).not.toBe('none');
      // Newest first: the in-progress P1 seed, then an open P3 seed.
      expect(firstPage.badges[0]).toEqual(['In progress', 'P1']);
      expect(firstPage.badges[1]).toEqual(['Open', 'P3']);

      await page.click('#support-ticket-more');
      await waitFor(async () => page.evaluate(() =>
        document.querySelectorAll('#support-ticket-list [data-ticket-id]').length === 3));

      const secondPage = await page.evaluate(() => ({
        count: document.getElementById('support-ticket-count').textContent,
        pagerDisplay: getComputedStyle(document.getElementById('support-ticket-pager')).display,
      }));
      expect(secondPage.count).toBe('3 tickets');
      expect(secondPage.pagerDisplay).toBe('none');

      // The second page was fetched with the cursor the first page returned.
      const paged = api.supportRequests().filter(r => r.method === 'GET' && r.pathname === '/portal/support/tickets');
      expect(paged.length).toBeGreaterThanOrEqual(2);
      expect(paged.some(r => r.search.indexOf('cursor=o%3A2') !== -1 || r.search.indexOf('cursor=o:2') !== -1)).toBe(true);
    });
  });

  test('6. the new-ticket dialog creates a ticket and opens it', async () => {
    const api = createMockApi();

    await withPage(api, async (page) => {
      await openSupport(page, baseUrl);
      await waitFor(async () => (await messagesText(page)).length === 2);

      expect(await page.evaluate(() => getComputedStyle(document.getElementById('support-ticket-modal')).display)).toBe('none');
      await page.click('#support-new-ticket');
      expect(await page.evaluate(() => getComputedStyle(document.getElementById('support-ticket-modal')).display)).not.toBe('none');

      // The category select is populated from the closed §12.3 set, not free text.
      const options = await page.evaluate(() => Array.prototype.map.call(
        document.getElementById('support-ticket-category').options, o => o.value));
      expect(options).toEqual(['phone_number', 'voice_agent', 'booking_calendar', 'integrations', 'billing', 'account_access', 'data_leads', 'other']);

      await page.fill('#support-ticket-subject', 'Callback number is wrong');
      await page.selectOption('#support-ticket-category', 'phone_number');
      await page.selectOption('#support-ticket-priority', 'P2');
      await page.fill('#support-ticket-body', 'The number in Settings is off by one digit.');
      await page.click('#support-ticket-create-btn');

      await waitFor(async () => page.evaluate(() =>
        document.getElementById('support-ticket-modal').style.display === 'none'));
      await waitFor(async () => page.evaluate(() => {
        const card = document.getElementById('support-ticket-card');
        return card.style.display === 'block' &&
          document.getElementById('support-ticket-title').textContent === 'Callback number is wrong';
      }));

      const created = api.supportRequests().filter(r => r.method === 'POST' && r.pathname === '/portal/support/tickets');
      expect(created.length).toBe(1);
      expect(created[0].body).toEqual({
        subject: 'Callback number is wrong',
        category: 'phone_number',
        priority: 'P2',
        body: 'The number in Settings is off by one digit.',
      });

      // And it is in the list with both badges.
      const row = await page.evaluate(() => {
        const el = document.querySelector('#support-ticket-list [data-ticket-id]');
        return { text: el.textContent, badges: Array.prototype.map.call(el.querySelectorAll('.badge'), b => b.textContent) };
      });
      expect(row.text).toContain('Callback number is wrong');
      expect(row.badges).toEqual(['Open', 'P2']);
    });
  });
});
