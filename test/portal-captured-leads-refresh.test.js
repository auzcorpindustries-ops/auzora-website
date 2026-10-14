// test/portal-captured-leads-refresh.test.js
// Ticket zeus_1791950322866_c0b6d4a1 — Add a refresh button to the Captured Leads table.
//
// portal.html is a single-file app with no module boundary, so this file asserts
// the WIRING: a manual refresh control exists in the Captured Leads table header,
// it refetches GET /portal/leads, and it re-renders IN PLACE — no full page
// reload, no reset of the table's current page/filter/sort state, and nothing
// outside the table touched. A regression that silently turns the button into a
// `location.reload()` (or into the page-level loadOutbound()) must fail here.
//
// Behavioural coverage of the same feature lives in
// test/portal-captured-leads-refresh-browser.test.js (real Chromium).

'use strict';

const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'portal.html'), 'utf8');

// Body of a top-level function: from its declaration to the next top-level
// `function`/`async function` declaration.
function fnBody(name) {
  const start = html.indexOf('function ' + name + '(');
  expect(start).toBeGreaterThan(-1);
  const rest = html.slice(start + 1);
  const m = rest.search(/\n(async )?function /);
  return m === -1 ? rest : rest.slice(0, m);
}

// The Captured Leads card's header block.
function capturedLeadsHeader() {
  const start = html.indexOf('<h2>Captured Leads</h2>');
  expect(start).toBeGreaterThan(-1);
  return html.slice(start, start + 1600);
}

describe('portal.html Captured Leads refresh control', () => {
  test('a Refresh control exists in the Captured Leads table header', () => {
    const header = capturedLeadsHeader();
    expect(header).toContain('id="ob-leads-refresh-btn"');
    expect(header).toContain('onclick="refreshCapturedLeads()"');
    // A label the client can read, matching the portal's other Refresh buttons.
    expect(header).toMatch(/>Refresh<\/button>/);
    // The pre-existing header contents are untouched (no regression).
    expect(header).toContain('id="ob-lead-count"');
    expect(header).toContain('id="ob-export-csv-btn"');
    expect(header).toContain('id="ob-export-json-btn"');
  });

  test('refreshCapturedLeads is declared exactly once', () => {
    const decls = html.match(/function refreshCapturedLeads\s*\(/g) || [];
    expect(decls).toHaveLength(1);
    expect(html).toContain('async function refreshCapturedLeads()');
  });

  test('it refetches GET /portal/leads with the portal token', () => {
    const body = fnBody('refreshCapturedLeads');
    expect(body).toContain('${API}/portal/leads');
    expect(body).toContain("'X-Portal-Token': portalToken");
  });

  test('it re-renders the table in place via renderObLeads()', () => {
    const body = fnBody('refreshCapturedLeads');
    expect(body).toContain('renderObLeads()');
    // The new rows are what gets rendered — otherwise the table would repaint
    // the OLD payload and the refresh would look like it worked while showing
    // stale badges.
    expect(body).toContain('obLeadsAll = Array.isArray(data) ? data : (data.leads || [])');
  });

  test('it never reloads the page or navigates away from the section', () => {
    const body = fnBody('refreshCapturedLeads');
    expect(body).not.toContain('location.reload');
    expect(body).not.toContain('location.href');
    expect(body).not.toContain('location.assign');
    expect(body).not.toContain('showPage(');
  });

  test('it does not use the page-level loadOutbound() path (which resets to page 1)', () => {
    const body = fnBody('refreshCapturedLeads');
    expect(body).not.toContain('loadOutbound(');
    // loadOutbound() zeroes the pagination cursor — the refresh must keep it.
    expect(fnBody('loadOutbound')).toContain('obLeadsPage = 0');
    const refresh = fnBody('refreshCapturedLeads');
    expect(refresh).toContain('const prevPage = obLeadsPage');
    expect(refresh).toContain('obLeadsPage = prevPage');
  });

  test('it keeps the client looking at the same spot on the page', () => {
    const body = fnBody('refreshCapturedLeads');
    expect(body).toContain('window.scrollY');
    expect(body).toContain('window.scrollTo(0, prevScrollY)');
  });

  test('a re-entrant click cannot double-fire the refresh', () => {
    const body = fnBody('refreshCapturedLeads');
    expect(body).toContain('if (btn && btn.disabled) return;');
    expect(body).toContain('btn.disabled = true');
    expect(body).toContain('btn.disabled = false');
  });

  test('a failed refresh leaves the table the client is reading in place', () => {
    const body = fnBody('refreshCapturedLeads');
    // Reporter is a status span, not a table wipe.
    expect(body).toContain("Could not refresh");
    expect(body).not.toContain('ob-lead-list\').innerHTML');
  });

  test('the header exposes the refresh status span', () => {
    expect(html).toContain('id="ob-leads-refresh-status"');
  });

  test('portal.html still parses — every inline script compiles', () => {
    const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
    let m;
    let seen = 0;
    while ((m = re.exec(html))) {
      const attrs = m[1] || '';
      if (/\bsrc\s*=/.test(attrs)) continue;
      if (/type\s*=\s*["'](application\/json|text\/template|text\/x-template)/i.test(attrs)) continue;
      seen++;
      // eslint-disable-next-line no-new-func
      new Function(m[2]); // throws on an orphaned body / TDZ-style syntax break
    }
    expect(seen).toBeGreaterThan(0);
  });
});
