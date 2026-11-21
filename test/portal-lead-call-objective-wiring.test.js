// test/portal-lead-call-objective-wiring.test.js — OBJ-2 (board
// zeus_1793928216002_917eb18d).
//
// portal.html is a single-file app with no module boundary, so this file pins
// the WIRING of the per-lead Call Objective modal on the Leads & CRM page:
//   * the per-lead Call button opens the modal (the bare confirm() is gone);
//   * the modal renders the labeled OPTIONAL textarea, the live 0/120
//     counter, and Cancel + "Start call" buttons;
//   * Start call posts {lead_id, objective?} to /outbound/call — the key is
//     sent ONLY when the trimmed objective is non-empty (legacy payload);
//   * an over-cap objective is blocked client-side with guidance and no
//     fetch, and the field is never silently truncated;
//   * Esc/Cancel/backdrop close without dialing.
//
// The backend accepts `objective` on POST /outbound/call per OBJ-1
// (atlas-ai zeus_1793928213217_0564135b, DONE) — contract only, no backend
// edits in this repo. The browser-level behaviour (modal opens from the real
// Call button, real request bodies, mobile widths) is pinned by the sibling
// Playwright suite test/portal-lead-call-modal-browser.test.js.

const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'portal.html'), 'utf8');

// Body of a top-level function: from its declaration to the next top-level
// `function`/`async function` declaration (same harness as
// test/portal-objective-wiring.test.js).
function fnBody(name) {
  const start = html.indexOf('function ' + name + '(');
  expect(start).toBeGreaterThan(-1);
  const rest = html.slice(start + 1);
  const m = rest.search(/\n(async )?function /);
  return m === -1 ? rest : rest.slice(0, m);
}

describe('the per-lead Call button opens the Call Objective modal', () => {
  test('confirm() is gone from callLead — it opens the modal instead', () => {
    const body = fnBody('callLead');
    expect(body).not.toContain('confirm(');
    expect(body).toContain('openLeadCallModal(leadId, btn)');
  });

  test('the modal uses the existing portal modal family (overlay + surface card)', () => {
    const open = fnBody('openLeadCallModal');
    expect(open).toContain("overlay.id = 'lead-call-modal-overlay'");
    // same overlay cssText family as the analytics/embed modals
    expect(open).toContain('position:fixed;inset:0;background:rgba(0,0,0,0.5)');
    expect(open).toContain('z-index:9999');
    // same card family: surface variable, rounded, shadow
    expect(open).toContain('background:var(--surface)');
    expect(open).toContain('box-shadow:0 20px 60px rgba(0,0,0,0.3)');
    expect(open).toContain('role="dialog"');
  });

  test('the modal renders the labeled optional textarea with the objective placeholder', () => {
    const open = fnBody('openLeadCallModal');
    expect(open).toContain('>Call Objective</label>');
    expect(open).toContain('<textarea');
    expect(open).toContain('Describe what you want the AI receptionist to accomplish during this call.');
    // multiline is allowed and the sub-hint says newlines get collapsed
    expect(open).toContain('newlines are collapsed to single spaces');
    expect(open).toContain('Optional.');
  });

  test('the textarea has NO maxlength — the guard is on submit, not silent truncation', () => {
    const open = fnBody('openLeadCallModal');
    const s = open.indexOf('<textarea');
    const tag = open.slice(s, open.indexOf('>', s));
    expect(tag).not.toContain('maxlength');
    expect(tag).toContain('oninput="updateLeadCallObjectiveCount()"');
  });

  test('Cancel + Start call buttons are wired (Start call keyed to the lead)', () => {
    const open = fnBody('openLeadCallModal');
    expect(open).toContain('>Cancel</button>');
    expect(open).toContain('>Start call</button>');
    expect(open).toContain("id=\"lead-call-start-btn\"");
    expect(open).toContain("onclick=\"confirmLeadCall('${leadId}')\"");
    expect(open).toContain('closeLeadCallModal()');
  });

  test('Esc closes the modal (listener added on open, removed on close)', () => {
    const open = fnBody('openLeadCallModal');
    expect(open).toContain("e.key === 'Escape'");
    expect(open).toContain("document.addEventListener('keydown', leadCallEscHandler)");
    const close = fnBody('closeLeadCallModal');
    expect(close).toContain("document.removeEventListener('keydown', leadCallEscHandler)");
    // closing must never dial
    expect(close).not.toContain('fetch(');
  });
});

describe('the objective field mirrors the Automations objective contract', () => {
  test('the 120-char ceiling is a named constant matching validateObjective', () => {
    expect(html).toContain('const LEAD_CALL_OBJECTIVE_MAX = 120;');
  });

  test('the live counter renders len/120 with the same tone ladder as updateObjectiveCount', () => {
    const counter = fnBody('updateLeadCallObjectiveCount');
    expect(counter).toContain('`${len}/${LEAD_CALL_OBJECTIVE_MAX}`');
    // red at/over the ceiling, amber approaching it — same colors as the
    // Automations counter
    expect(counter).toContain("'#ef4444'");
    expect(counter).toContain("'#f59e0b'");
    // the counter is initialised when the modal opens
    expect(fnBody('openLeadCallModal')).toContain('updateLeadCallObjectiveCount()');
  });
});

describe('Start call fires the existing endpoint with the optional objective', () => {
  test('trim first, then guard: over-cap shows guidance and returns BEFORE any fetch', () => {
    const body = fnBody('confirmLeadCall');
    expect(body).toContain("''\).trim()");
    const guardIdx = body.indexOf('if (objective.length > LEAD_CALL_OBJECTIVE_MAX)');
    const fetchIdx = body.indexOf('fetch(');
    expect(guardIdx).toBeGreaterThan(-1);
    expect(fetchIdx).toBeGreaterThan(-1);
    expect(guardIdx).toBeLessThan(fetchIdx);
    // guidance element is shown, message names the ceiling
    expect(body).toContain('lead-call-objective-error');
    expect(body).toContain('errEl.style.display = \'block\'');
    // no silent truncation anywhere in the submit path
    expect(body).not.toMatch(/slice\(0,\s*LEAD_CALL_OBJECTIVE_MAX/);
    expect(body).not.toMatch(/substring\(0/);
  });

  test('the objective key is sent ONLY when non-empty — legacy body preserved', () => {
    const body = fnBody('confirmLeadCall');
    expect(body).toContain('const body = { lead_id: leadId };');
    expect(body).toContain('if (objective) body.objective = objective;');
  });

  test('posts to /outbound/call with the same success toast + refresh as before', () => {
    const body = fnBody('confirmLeadCall');
    expect(body).toContain('/outbound/call');
    expect(body).toContain("'X-Portal-Token': portalToken");
    expect(body).toContain('AI call started — your agent is dialing the lead ✓');
    expect(body).toContain('setTimeout(loadOutbound, 1500)');
    // the invoking button is disabled for the dial and RESTORED afterwards
    expect(body).toContain("btn.textContent = 'Calling…'");
    expect(body).toContain('btn.textContent = orig');
    expect(body).toContain('btn.disabled = false');
  });

  test('an empty objective never blocks the call — the guard is length-only', () => {
    const body = fnBody('confirmLeadCall');
    const guard = body.slice(body.indexOf('if (objective.length > LEAD_CALL_OBJECTIVE_MAX)'), body.indexOf('closeLeadCallModal();', body.indexOf('if (objective.length > LEAD_CALL_OBJECTIVE_MAX)')));
    // nothing in the guard inspects emptiness — only the over-cap length
    expect(guard).not.toContain('!objective');
    expect(guard).not.toContain('objective === \'\'');
  });
});

describe('non-goals are respected', () => {
  test('the Outbound card lead_context flow is untouched', () => {
    const outbound = fnBody('startOutboundCall');
    expect(outbound).toContain('lead_context');
    expect(outbound).not.toContain('objective');
  });

  test('the opted-out Call-button branch still short-circuits to Do not call', () => {
    expect(html).toContain("'<span style=\"font-size:11px;color:var(--muted);\">Do not call</span>'");
    // the (vestigial) row-level branch is byte-for-byte unchanged — scope guard
    expect(html).toContain("onclick=\"callLead('${latest.lead_id}', this)\"");
  });

  test('the LIVE per-lead Call trigger (lead timeline modal) routes through callLead', () => {
    // The Captured Leads row's Call cell was folded into the lead timeline
    // modal (showLeadTimeline) — THAT button is the live manual-call trigger,
    // and it must keep routing through callLead so it gets the modal.
    expect(html).toContain("onclick=\"callLead('${lead.lead_id}', this)\"");
  });
});
