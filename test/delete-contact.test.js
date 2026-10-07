// test/delete-contact.test.js — bulk "Delete Contact" action in portal.html.
//
// Two layers:
//   1. Source assertions on the lead-timeline modal (button present under the
//      internalCrm gate, next to Delete Lead, danger-outline styled) and the
//      inline-script integrity guard for the ~750KB portal app.
//   2. Execution tests: the real deleteContact() body is extracted from the
//      inline script and run with stubbed page globals, covering the
//      confirm-cancel path, the confirm-accept + fetch path, and the error path.

const fs = require('fs');
const path = require('path');

const repoRoot = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(repoRoot, 'portal.html'), 'utf8');

// Main inline app script: first bare <script> … its matching </script>.
function mainInlineScript() {
  const openTags = [];
  let idx = html.indexOf('<script>');
  while (idx !== -1) { openTags.push(idx); idx = html.indexOf('<script>', idx + 1); }
  const closes = [];
  let c = html.indexOf('</script>');
  while (c !== -1) { closes.push(c); c = html.indexOf('</script>', c + 1); }
  const open = openTags[0];
  const close = closes.find(cl => cl > open);
  return html.slice(open + 8, close);
}

const script = mainInlineScript();

// Extract a top-level function's full source. The function body is indented, so
// the first column-0 "}" after the signature is its closing brace.
function extractFn(src, name) {
  const start = src.indexOf('async function ' + name + '(');
  if (start === -1) throw new Error('function not found: ' + name);
  const end = src.indexOf('\n}\n', start);
  if (end === -1) throw new Error('function end not found: ' + name);
  return src.slice(start, end + 2);
}

// Compile the extracted function with injectable page globals.
function buildDeleteContact(deps) {
  const src = extractFn(script, 'deleteContact');
  const names = Object.keys(deps);
  const factory = new Function(...names, src + '\nreturn deleteContact;');
  return factory(...names.map(n => deps[n]));
}

const ANCHOR = { lead_id: 'lead-a', phone: '+15125550111' };
const SAME_1 = { lead_id: 'lead-b', phone: '+15125550111' };
const SAME_2 = { lead_id: 'lead-c', phone: '+1 (512) 555-0111' };
const OTHER = { lead_id: 'lead-z', phone: '+15125550999' };

function makeDeps(obLeadsAll) {
  return {
    confirm: jest.fn(),
    fetch: jest.fn(),
    showToast: jest.fn(),
    closeLeadTimeline: jest.fn(),
    loadOutbound: jest.fn(),
    obLeadsAll,
    API: '',
    portalToken: 'tok_test',
    console: { error: jest.fn() },
  };
}

describe('portal.html Delete Contact — modal wiring', () => {
  test('button is rendered in the lead-timeline actions row, gated on internalCrm', () => {
    expect(script).toContain("onclick=\"deleteContact('${lead.lead_id}')\"");
    // Sits inside the same canInternalCrm block as Delete Lead.
    const gate = script.indexOf('if (canInternalCrm) {');
    const delLead = script.indexOf("deleteLead('${lead.lead_id}')");
    const delContact = script.indexOf("deleteContact('${lead.lead_id}')");
    expect(delLead).toBeGreaterThan(gate);
    expect(delContact).toBeGreaterThan(delLead);
  });

  test('Delete Contact uses the existing red-outline danger style', () => {
    const idx = script.indexOf("deleteContact('${lead.lead_id}')");
    const line = script.slice(idx, idx + 220);
    expect(line).toContain('border:1px solid #ef444440');
    expect(line).toContain('color:#ef4444');
  });

  test('deleteContact is defined and its route targets /portal/leads/contact/:id', () => {
    expect(script).toMatch(/async function deleteContact\(leadId\)/);
    expect(script).toContain('${API}/portal/leads/contact/${leadId}');
    expect(script).toMatch(/method: 'DELETE'/);
    expect(script).toMatch(/headers: \{ 'X-Portal-Token': portalToken \}/);
  });

  test('main inline script still compiles (syntax guard)', () => {
    expect(() => { new Function(script); }).not.toThrow();
  });
});

describe('portal.html deleteContact — behavior', () => {
  test('confirm-cancel path: no delete, no fetch, no refresh', async () => {
    const deps = makeDeps([ANCHOR, SAME_1, SAME_2, OTHER]);
    deps.confirm.mockReturnValue(false);
    const deleteContact = buildDeleteContact(deps);

    await deleteContact('lead-a');

    expect(deps.confirm).toHaveBeenCalledTimes(1);
    expect(deps.fetch).not.toHaveBeenCalled();
    expect(deps.closeLeadTimeline).not.toHaveBeenCalled();
    expect(deps.loadOutbound).not.toHaveBeenCalled();
  });

  test('confirm dialog states the blast radius (N interactions)', async () => {
    const deps = makeDeps([ANCHOR, SAME_1, SAME_2, OTHER]);
    deps.confirm.mockReturnValue(false);
    const deleteContact = buildDeleteContact(deps);

    await deleteContact('lead-a');

    const msg = deps.confirm.mock.calls[0][0];
    expect(msg).toContain('all 3 interactions');
    expect(msg).toMatch(/cannot be undone/i);
  });

  test('confirm-accept path: DELETE /portal/leads/contact/:id then close + refresh', async () => {
    const deps = makeDeps([ANCHOR, SAME_1, SAME_2, OTHER]);
    deps.confirm.mockReturnValue(true);
    deps.fetch.mockResolvedValue({ ok: true, json: async () => ({ success: true, deleted_count: 3 }) });
    const deleteContact = buildDeleteContact(deps);

    await deleteContact('lead-a');

    expect(deps.fetch).toHaveBeenCalledTimes(1);
    const [url, opts] = deps.fetch.mock.calls[0];
    expect(url).toBe('/portal/leads/contact/lead-a');
    expect(opts.method).toBe('DELETE');
    expect(opts.headers).toEqual({ 'X-Portal-Token': 'tok_test' });

    expect(deps.showToast).toHaveBeenCalledWith('Contact deleted permanently', 'success');
    expect(deps.closeLeadTimeline).toHaveBeenCalledTimes(1);
    expect(deps.loadOutbound).toHaveBeenCalledTimes(1);
  });

  test('error path: server error text surfaces as an error toast, modal stays open', async () => {
    const deps = makeDeps([ANCHOR, SAME_1, SAME_2, OTHER]);
    deps.confirm.mockReturnValue(true);
    deps.fetch.mockResolvedValue({ ok: false, status: 404, json: async () => ({ error: 'Lead not found' }) });
    const deleteContact = buildDeleteContact(deps);

    await deleteContact('lead-a');

    expect(deps.showToast).toHaveBeenCalledWith('Could not delete contact: Lead not found', 'error');
    expect(deps.closeLeadTimeline).not.toHaveBeenCalled();
    expect(deps.loadOutbound).not.toHaveBeenCalled();
  });

  test('error path: non-JSON error body falls back to HTTP <status>', async () => {
    const deps = makeDeps([ANCHOR]);
    deps.confirm.mockReturnValue(true);
    deps.fetch.mockResolvedValue({ ok: false, status: 500, json: async () => { throw new Error('bad json'); } });
    const deleteContact = buildDeleteContact(deps);

    await deleteContact('lead-a');

    expect(deps.showToast).toHaveBeenCalledWith('Could not delete contact: HTTP 500', 'error');
    expect(deps.closeLeadTimeline).not.toHaveBeenCalled();
  });

  test('a lone interaction reads "all 1 interaction" (singular)', async () => {
    const deps = makeDeps([ANCHOR, OTHER]);
    deps.confirm.mockReturnValue(false);
    const deleteContact = buildDeleteContact(deps);

    await deleteContact('lead-a');

    expect(deps.confirm.mock.calls[0][0]).toContain('all 1 interaction?');
  });
});
