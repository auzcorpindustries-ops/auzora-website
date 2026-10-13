// test/portal-sms-consent-sot.test.js
//
// SMS-CONSENT-SOT (board zeus_1791923573031_c22f9baf) — the portal half.
//
// portal.html is a single-file app with no module boundary, so this file
// extracts the real functions out of the HTML and exercises them, pinning
// both the WIRING and the BEHAVIOUR.
//
// WHAT CHANGED AND WHY
// --------------------
// SMS-CONSENT-LOOP (#413) fixed the consent badge by REIMPLEMENTING the
// sender's rule in the browser. Correct at the time, but it left two
// implementations of one rule free to drift. The backend now resolves consent
// per CONTACT and ships the verdict on every lead row (GET /portal/leads:
// sms_consent_status / sms_can_send / sms_consent_label), so the portal
// CONSUMES it. The local rule survives only as a deploy-skew fallback.
//
// The bug this closes: a contact opts in, but the Captured Leads "SMS
// Consent" column still reads Disabled/Pending because the column, the badge
// and the sender each computed their own answer off a different lead row.

const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'portal.html'), 'utf8');

/** Extract a top-level function source by name, brace-balanced. */
function fnSource(name) {
  const start = html.indexOf('function ' + name + '(');
  expect(start).toBeGreaterThan(-1);
  let depth = 0;
  let seen = false;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (c === '{') { depth++; seen = true; }
    else if (c === '}') {
      depth--;
      if (seen && depth === 0) return html.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced braces extracting ${name}`);
}

/** Eval the real helpers out of portal.html. */
function loadHelpers() {
  // eslint-disable-next-line no-new-func
  return new Function(
    `${fnSource('smsConsentOf')}\n${fnSource('isSmsEnabled')}\nreturn { smsConsentOf, isSmsEnabled };`
  )();
}

const { smsConsentOf, isSmsEnabled } = loadHelpers();

// ═════════════════════════════════════════════════════════════════════════
describe('the portal consumes the backend verdict', () => {
  it('prefers sms_consent_status over any local recomputation', () => {
    // Deliberately contradictory: the raw flags say "enabled", the backend
    // says "opted out". The backend wins — it is the one that sends.
    const row = {
      sms_consent: true, sms_opt_out: false, opt_out: false,
      sms_consent_status: 'opted_out', sms_can_send: false, sms_consent_label: 'SMS Off',
    };
    expect(smsConsentOf(row).status).toBe('opted_out');
    expect(isSmsEnabled(row)).toBe(false);
  });

  it('reports the backend label verbatim', () => {
    const row = { sms_consent_status: 'unknown', sms_can_send: false, sms_consent_label: 'SMS Pending' };
    expect(smsConsentOf(row).label).toBe('SMS Pending');
  });

  it('can_send mirrors the backend boolean exactly', () => {
    const on = { sms_consent_status: 'opted_in', sms_can_send: true };
    const off = { sms_consent_status: 'opted_out', sms_can_send: false };
    expect(isSmsEnabled(on)).toBe(true);
    expect(isSmsEnabled(off)).toBe(false);
  });

  it('reads the verdict off any row of the phone group', () => {
    // The backend writes the same projection to every row of the contact.
    const group = [
      { lead_id: 'a' }, // older row served before the projection existed
      { lead_id: 'b', sms_consent_status: 'opted_in', sms_can_send: true, sms_consent_label: 'SMS On' },
    ];
    expect(smsConsentOf(group).status).toBe('opted_in');
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('pending is a real third state, not a disguised "off"', () => {
  it('a contact with no consent record reads Pending', () => {
    expect(smsConsentOf({ sms_consent_status: 'unknown', sms_can_send: false }).label).toBe('SMS Pending');
  });

  it('pending is distinguishable from an explicit opt-out', () => {
    const pending = smsConsentOf({ sms_consent_status: 'unknown', sms_can_send: false });
    const optedOut = smsConsentOf({ sms_consent_status: 'opted_out', sms_can_send: false });
    expect(pending.status).not.toBe(optedOut.status);
    expect(pending.label).not.toBe(optedOut.label);
    // ...but BOTH withhold the send. Fail-closed either way.
    expect(pending.canSend).toBe(false);
    expect(optedOut.canSend).toBe(false);
  });

  it('the Captured Leads consent COLUMN renders all three states', () => {
    // The column named in the bug report. It must not collapse to a binary.
    const body = html.slice(html.indexOf('SMS-CONSENT-SOT: the Captured Leads'));
    const cell = body.slice(0, body.indexOf('</td>'));
    expect(cell).toContain("'Enabled'");
    expect(cell).toContain("'Disabled'");
    expect(cell).toContain("'Pending'");
    // ...and it keys off the SAME state object as the row badge.
    expect(cell).toContain('smsState.status');
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('one truth across badge, column, toggle and detail modal', () => {
  it('the row badge renders from smsState (the backend verdict)', () => {
    expect(html).toContain('const smsState = smsConsentOf(group);');
    expect(html).toContain('escapeHtmlAttr(smsState.label)');
  });

  it('the opt-in/opt-out toggle keys off the same verdict', () => {
    expect(html).toContain('const smsToggleBtn = smsState.canSend');
  });

  it('the interaction-detail modal keys off the same verdict', () => {
    expect(html).toContain('const leadSmsState = smsConsentOf(lead);');
    expect(html).toContain('const smsConsent = leadSmsState.canSend;');
  });

  it('no stale fail-open `sms_consent !== false` read survives in the CRM', () => {
    // The original defect. It must not come back anywhere in the lead UI.
    expect(html).not.toContain('latest.sms_consent !== false');
    expect(html).not.toContain('lead.sms_consent === false');
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('deploy-skew fallback (backend without the projection)', () => {
  it('falls back to the sender rule, not to fail-open', () => {
    // No projection fields at all — an older backend.
    expect(smsConsentOf({ sms_consent: true }).status).toBe('opted_in');
    expect(smsConsentOf({}).status).toBe('unknown'); // NOT opted_in
    expect(isSmsEnabled({})).toBe(false);
  });

  it('suppression still wins in the fallback path', () => {
    expect(isSmsEnabled({ sms_consent: true, sms_opt_out: true })).toBe(false);
    expect(isSmsEnabled({ sms_consent: true, opt_out: true })).toBe(false);
    expect(isSmsEnabled({ sms_consent: true, outbound_opted_out: true })).toBe(false);
    expect(isSmsEnabled({ sms_consent: true, sms_status: 'opted-out' })).toBe(false);
  });

  it('suppression on ANY row of the group vetoes the whole contact', () => {
    expect(isSmsEnabled([{ sms_consent: true }, { sms_opt_out: true }])).toBe(false);
  });

  it('a grant on ANY row of the group enables when nothing suppresses', () => {
    expect(isSmsEnabled([{}, { sms_consent: true }])).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('scoped automation catalog — "not yet available" cards', () => {
  it('workflowCardHtml accepts the unavailable flags', () => {
    const src = fnSource('workflowCardHtml');
    expect(src).toContain('unavailable');
    expect(src).toContain('unavailableReason');
  });

  it('the unavailable branch is checked BEFORE the tier-gate branch', () => {
    // An automation type we do not offer is not an upsell — it must never
    // render as "Upgrade required".
    const src = fnSource('workflowCardHtml');
    expect(src.indexOf('if (unavailable)')).toBeGreaterThan(-1);
    expect(src.indexOf('if (unavailable)')).toBeLessThan(src.indexOf("if (locked && status !== 'active')"));
  });

  it('an unavailable card has no actionable control', () => {
    const src = fnSource('workflowCardHtml');
    const branch = src.slice(src.indexOf('if (unavailable)'), src.indexOf("// ── Locked rendering"));
    expect(branch).toContain('disabled');
    expect(branch).toContain('cursor:not-allowed');
    // No request/cancel wiring on a card the backend would 409.
    expect(branch).not.toContain('toggleWorkflow(');
  });

  it('availability comes from the backend, defaulting to AVAILABLE on older backends', () => {
    // `available === false` (not `!available`) so a backend that omits the
    // field entirely does not blank every card.
    expect(html).toContain('unavailable: of.available === false');
  });

  it('an already-active or pending offering is never greyed out', () => {
    expect(html).toContain("of.status !== 'active' && of.status !== 'requested'");
  });
});
