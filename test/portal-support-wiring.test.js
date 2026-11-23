// test/portal-support-wiring.test.js
// CLIENT SUPPORT CENTER (SUP-12, board zeus_1795334282291_ed19d98b).
//
// portal.html is a single-file app with no module boundary, so this file pins
// the WIRING of the Support page — the parts that are invisible to a
// screenshot but expensive to get wrong:
//   * the page exists, has a nav entry and a showPage loader (a page wired into
//     showPage without #nav-<name>/#page-<name> throws at click time);
//   * the thread is plain text: every server string goes through textContent,
//     message bodies are white-space:pre-wrap, and the block contains no
//     innerHTML / insertAdjacentHTML / outerHTML / document.write;
//   * identity is the portal session token (X-Portal-Token) and nothing else —
//     no API key, no client id in a request body;
//   * the global 401 interceptor tears the page down instead of leaving a pane
//     that silently fails behind the login screen;
//   * refresh is pull-only (interval + focus), no websocket, no SSE;
//   * the ticket form offers exactly the closed category/priority sets from
//     SUPPORT-DESK-SCOPE §12.3.
//
// The rendered behaviour (send -> reply -> escalate -> reply, the XSS literal,
// cross-tenant isolation, 401 bounce, cursor pagination) is driven in a real
// browser by test/support-center-browser.test.js. The server contract itself is
// pinned in atlas-ai (src/handlers/supportRouter.js, SUP-11).

const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'portal.html'), 'utf8');

// The SUP-12 support block: from its banner comment to the end of that script.
// Scoping matters — `innerHTML` legitimately appears elsewhere in this file.
const blockStart = html.indexOf('// ── SUPPORT CENTER (SUP-12)');
const blockEnd = html.indexOf('</script>', blockStart);
const block = blockStart === -1 ? '' : html.slice(blockStart, blockEnd);

// A top-level function body: declaration to the next top-level function.
function fnBody(source, name) {
  const start = source.indexOf('function ' + name + '(');
  expect(start).toBeGreaterThan(-1);
  const rest = source.slice(start + 1);
  const m = rest.search(/\n(async )?function /);
  return m === -1 ? rest : rest.slice(0, m);
}

describe('the Support page is wired into the portal shell', () => {
  test('there is an explicit nav entry and a #page-support container', () => {
    expect(html).toContain('id="nav-support"');
    expect(html).toContain("onclick=\"showPage('support')\"");
    expect(html).toMatch(/<div class="page" id="page-support">/);
    // showPage needs both halves; a missing one throws on click
    expect(html.indexOf('id="page-support"')).toBeGreaterThan(
      html.indexOf('id="nav-support"')
    );
  });

  test('showPage carries the header copy and dispatches to the loader', () => {
    expect(html).toContain("support: { title: 'Support Center'");
    expect(html).toContain("if (name === 'support') loadSupport(); else supportStopPoll();");
    // leaving the page must stop the poll — that is the only teardown path
    // besides the 401 interceptor
    expect(fnBody(html, 'supportStopPoll')).toContain('clearInterval(supportState.pollTimer)');
  });

  test('the two-pane layout is the documented 320px list + thread grid', () => {
    expect(html).toContain('.support-shell { display: grid; grid-template-columns: 320px 1fr;');
    expect(html).toContain('@media (max-width: 900px) { .support-shell { grid-template-columns: 1fr; } }');
  });

  test('the page reuses the shell classes instead of introducing a framework', () => {
    expect(html).toContain('<div class="table-card">');
    expect(html).toContain('class="modal-overlay" id="support-ticket-modal"');
    expect(html).toContain('<div class="modal-body">');
    expect(html).toContain('<div class="modal-footer">');
    // no UI framework, no build step, and the support CSS lives in the ONE
    // inline stylesheet this single-file app already ships — not a new one.
    // (The head already links Google Fonts families; counting <link> tags here
    // would measure pre-existing markup, not this feature.)
    expect(html).not.toMatch(/<script[^>]+src="[^"]*(react|vue|alpine|htmx|jquery)[^"]*"/i);
    const supportCss = html.indexOf('.support-shell { display: grid;');
    const firstStyleClose = html.indexOf('</style>');
    expect(supportCss).toBeGreaterThan(-1);
    expect(supportCss).toBeLessThan(firstStyleClose);
    // the stylesheet the support block lives in is the main document one
    const styleOpenBefore = html.lastIndexOf('<style', supportCss);
    expect(styleOpenBefore).toBeGreaterThan(-1);
    expect(styleOpenBefore).toBeLessThan(supportCss);
  });
});

describe('server-supplied text reaches the DOM as text, never as HTML', () => {
  test('message bodies are plain text with white-space: pre-wrap', () => {
    expect(html).toContain('.support-msg-text { white-space: pre-wrap;');
    const row = fnBody(block, 'supportMessageRow');
    expect(row).toContain("'support-msg-text'");
    expect(row).toContain('supportEl(');
  });

  test('the ONLY way a server string is painted is textContent', () => {
    const el = fnBody(block, 'supportEl');
    expect(el).toContain('el.textContent = String(text)');
    // no HTML sinks anywhere in the support block
    expect(block).not.toMatch(/\.innerHTML\s*=/);
    expect(block).not.toMatch(/insertAdjacentHTML/);
    expect(block).not.toMatch(/outerHTML/);
    expect(block).not.toMatch(/document\.write/);
  });

  test('the thread, ticket list and timeline are all built from nodes', () => {
    const thread = fnBody(block, 'supportRenderThread');
    expect(thread).toContain('supportReplace(box, rows)');
    const tickets = fnBody(block, 'supportRenderTickets');
    expect(tickets).toContain("item.setAttribute('data-ticket-id'");
    expect(tickets).toContain('supportBadge(');
    const detail = fnBody(block, 'supportRenderTicketDetail');
    expect(detail).toContain('title.textContent = ticket.subject');
    // internal notes are not this surface's data
    expect(detail).toContain("ev.visibility === 'customer'");
  });
});

describe('identity is the portal token, never an API key', () => {
  test('every support call carries X-Portal-Token', () => {
    const api = fnBody(block, 'supportApi');
    expect(api).toContain("'X-Portal-Token': portalToken");
    expect(api).toContain("fetch(API + '/portal/support' + path");
  });

  test('the page never holds, reads or sends an API key or a client id', () => {
    expect(block).not.toMatch(/x-api-key/i);
    expect(block).not.toMatch(/apiKey|api_key|API_KEY/);
    expect(block).not.toMatch(/client_id|clientId/);
    // the token lives in the existing session, not in a new storage key
    expect(block).not.toMatch(/localStorage|sessionStorage/);
  });
});

describe('an expired token tears the support page down', () => {
  test('the global 401 interceptor calls supportOnSessionExpired', () => {
    const interceptor = html.slice(
      html.indexOf('if (res.status === 401 && portalToken)'),
      html.indexOf('return res;', html.indexOf('if (res.status === 401 && portalToken)'))
    );
    expect(interceptor).toContain('try { supportOnSessionExpired(); } catch (e) {}');
    expect(interceptor).toContain("errEl.textContent = 'Your session expired. Please sign in again.'");
  });

  test('the teardown drops the poll, the caches and the open ticket', () => {
    const teardown = fnBody(block, 'supportOnSessionExpired');
    expect(teardown).toContain('supportStopPoll()');
    expect(teardown).toContain('supportState.conversations = []');
    expect(teardown).toContain('supportState.tickets = []');
    expect(teardown).toContain('supportState.messages = []');
    expect(teardown).toContain("card.style.display = 'none'");
  });

  test('a 401 from supportApi stops rendering instead of throwing', () => {
    const api = fnBody(block, 'supportApi');
    expect(api).toContain('if (res.status === 401)');
    expect(api).toContain('return null');
  });
});

describe('refresh is pull-only in v1', () => {
  test('a 30s poll runs only while the page is active and the tab is visible', () => {
    expect(html).toContain('const SUPPORT_POLL_MS = 30000;');
    expect(html).toContain('supportState.pollTimer = setInterval(supportPollTick, SUPPORT_POLL_MS)');
    expect(fnBody(block, 'supportPollTick')).toContain('document.hidden');
    expect(fnBody(block, 'supportPageActive')).toContain("page.classList.contains('active')");
  });

  test('window focus refreshes, debounced', () => {
    expect(block).toContain("window.addEventListener('focus'");
    expect(fnBody(block, 'supportRefresh')).toContain('now - supportState.lastRefresh < 2000');
  });

  test('no websockets and no SSE', () => {
    expect(block).not.toMatch(/new WebSocket|EventSource/);
  });
});

describe('the ticket form offers exactly the server closed sets', () => {
  test('categories are the §12.3 slugs, rendered from one table', () => {
    const cats = [
      'phone_number',
      'voice_agent',
      'booking_calendar',
      'integrations',
      'billing',
      'account_access',
      'data_leads',
      'other',
    ];
    cats.forEach((c) => expect(block).toContain("['" + c + "'"));
    expect(fnBody(block, 'supportOpenNewTicket')).toContain('SUPPORT_CATEGORIES.forEach');
    // populated from the table, not hand-written options
    expect(html).not.toContain('id="support-ticket-category">\n');
  });

  test('priorities are the four-point set', () => {
    ['P1', 'P2', 'P3', 'P4'].forEach((p) => {
      expect(html).toContain('<option value="' + p + '"');
    });
    expect(block).toContain("const SUPPORT_PRIORITY_CLASS = { P1: 'badge-p1'");
  });

  test('status badges cover the ticket state machine', () => {
    ['open', 'in_progress', 'waiting_on_customer', 'resolved', 'closed'].forEach((s) => {
      expect(block).toContain(s + ': { label:');
    });
  });
});

describe('list pagination is cursor-based, not offset-guessed', () => {
  test('the ticket list follows next_cursor and only offers "Load older" when one exists', () => {
    const load = fnBody(block, 'supportLoadTickets');
    expect(load).toContain('data.next_cursor');
    expect(load).toContain("'&cursor=' + encodeURIComponent(cursor)");
    const render = fnBody(block, 'supportRenderTickets');
    expect(render).toContain("pager.style.display = supportState.ticketCursor ? 'flex' : 'none'");
    // "Load older" asks for the next page
    expect(html).toContain('id="support-ticket-more" onclick="supportLoadTickets(true)"');
  });
});
