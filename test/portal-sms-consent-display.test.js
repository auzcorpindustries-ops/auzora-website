// test/portal-sms-consent-display.test.js
// SMS-CONSENT-LOOP (board zeus_1791838750519_b0edb6e4) — the portal/CRM half.
//
// portal.html is a single-file app with no module boundary, so this file pins
// the WIRING *and* the BEHAVIOUR of the Captured Leads SMS-consent field.
//
// AUDIT (what was wrong): the field was `latest.sms_consent !== false` — a
// fail-OPEN read of ONE flag off ONE row. Because the STOP handler
// (smsCampaignService.optOutLead) writes sms_opt_out/opt_out WITHOUT clearing
// sms_consent, and saveLead defaults sms_consent to true (#356), the CRM could
// render "SMS On" for a lead every send path suppresses. It also missed a flag
// written on an older interaction of the same phone group.
//
// FIX (SMS-CONSENT-LOOP): one shared predicate, `isSmsEnabled`, mirroring the
// backend send gate (sms_consent === true AND NOT sms_opt_out AND NOT opt_out)
// across the whole phone group. It is used by the row badge, the
// interaction-detail status line and the opt-in/out button state, so the CRM
// and the sender can never disagree. This is also what makes the
// SMS-CONSENT-LOOP "flip" visible: a lead with no consent record now reads
// "SMS Off" until the verified opt-in writes sms_consent=true.
//
// ── SUPERSEDED BY SMS-CONSENT-SOT (zeus_1791923573031_c22f9baf) ────────────
// That ticket moved the rule to the BACKEND: consent is resolved once per
// CONTACT server-side and shipped on every lead row (sms_consent_status /
// sms_can_send / sms_consent_label), because keeping a second implementation
// in the browser left two copies of one rule free to drift. `isSmsEnabled` is
// now a thin wrapper over `smsConsentOf`, which prefers the backend verdict
// and falls back to THIS rule only during deploy skew.
//
// Every BEHAVIOURAL expectation below is unchanged and still passing — that is
// the proof SMS-CONSENT-SOT did not regress the #413 fix. Only the two
// extraction helpers and the wiring assertions were updated to the new shape.
// The new architecture's own assertions live in
// test/portal-sms-consent-sot.test.js.

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

function fnBody(name) {
  return fnSource(name);
}

/**
 * Eval the real isSmsEnabled() out of portal.html and return it.
 * SMS-CONSENT-SOT: isSmsEnabled now delegates to smsConsentOf, so both must
 * be loaded together for the predicate to be callable.
 */
function loadIsSmsEnabled() {
  // eslint-disable-next-line no-new-func
  return new Function(
    `${fnSource('smsConsentOf')}\n${fnSource('isSmsEnabled')}\nreturn isSmsEnabled;`
  )();
}

describe('isSmsEnabled mirrors the backend SMS send gate', () => {
  const isSmsEnabled = loadIsSmsEnabled();

  test('consent granted and no suppression -> enabled', () => {
    expect(isSmsEnabled({ sms_consent: true })).toBe(true);
  });

  test('an ABSENT consent record is NOT enabled (fail-closed, flips visible)', () => {
    expect(isSmsEnabled({})).toBe(false);
    expect(isSmsEnabled({ sms_consent: undefined })).toBe(false);
    expect(isSmsEnabled({ sms_consent: false })).toBe(false);
    expect(isSmsEnabled(null)).toBe(false);
  });

  test('sms_opt_out vetoes consent (the STOP-ed-lead fix)', () => {
    expect(isSmsEnabled({ sms_consent: true, sms_opt_out: true })).toBe(false);
    expect(isSmsEnabled({ sms_consent: true, opt_out: true })).toBe(false);
  });

  test('aggregates across a phone group — any consent grants, any suppression vetoes', () => {
    expect(isSmsEnabled([{ sms_consent: true }, { sms_consent: undefined }])).toBe(true);
    expect(isSmsEnabled([{ sms_consent: true }, { sms_opt_out: true }])).toBe(false);
    expect(isSmsEnabled([{}, { sms_consent: true, opt_out: true }])).toBe(false);
    expect(isSmsEnabled([])).toBe(false);
  });
});

describe('the Captured Leads SMS field is wired to one shared verdict', () => {
  // SMS-CONSENT-SOT: the wiring target moved from `isSmsEnabled(group)` to
  // `smsConsentOf(group)` (which returns status + canSend + label, so the
  // badge can render the third "Pending" state). The INVARIANT is unchanged:
  // every consent surface in the CRM reads ONE value.
  test('the row badge derives from the whole group via the shared resolver', () => {
    const body = fnBody('renderObLeads');
    expect(body).toContain('const smsState = smsConsentOf(group);');
    // the old fail-open single-row read is gone
    expect(body).not.toContain('sms_consent !== false');
  });

  test('the row badge still renders the consent state and the toggle', () => {
    const body = fnBody('renderObLeads');
    // SMS-CONSENT-SOT: the literal "SMS On"/"SMS Off" strings moved to the
    // backend label (smsState.label) / the smsConsentOf fallback, so the badge
    // renders the served text rather than hard-coding a binary pair. Pin what
    // actually matters: the badge shows the resolved label and the toggle is
    // still wired.
    expect(body).toContain('escapeHtmlAttr(smsState.label)');
    expect(body).toContain('toggleSmsConsent');
    // The three labels are still produced, from the one resolver.
    const resolver = fnBody('smsConsentOf');
    expect(resolver).toContain('SMS On');
    expect(resolver).toContain('SMS Off');
    expect(resolver).toContain('SMS Pending');
  });

  test('no stale fail-open sms_consent read survives anywhere in portal.html', () => {
    expect(html).not.toContain('sms_consent !== false');
    expect(html).not.toContain("sms_consent === false ? 'SMS Off' : 'SMS On'");
  });

  test('the interaction-detail status line uses the shared verdict', () => {
    const body = fnBody('showLeadTimeline');
    expect(body).toContain('const leadSmsState = smsConsentOf(lead);');
    expect(body).toContain('const smsStatus = leadSmsState.label;');
  });

  test('the interaction-detail opt-in/out button state uses the shared verdict', () => {
    const body = fnBody('showLeadTimeline');
    expect(body).toContain('const smsConsent = leadSmsState.canSend;');
  });

  test('the definition itself is the documented gate (consent AND NOT suppression)', () => {
    // SMS-CONSENT-SOT: the rule now lives in smsConsentOf's fallback branch —
    // isSmsEnabled delegates to it. The gate's SHAPE is pinned here exactly as
    // #413 pinned it, just at its new home.
    const body = fnBody('smsConsentOf');
    expect(body).toContain('r.sms_consent === true');
    expect(body).toContain('r.sms_opt_out === true');
    expect(body).toContain('r.opt_out === true');
    expect(body).toContain("status === 'opted_in'");
    // ...and the backend verdict takes precedence over that fallback.
    expect(body).toContain('sms_consent_status');
    expect(fnBody('isSmsEnabled')).toContain('smsConsentOf(rows).canSend');
  });
});
