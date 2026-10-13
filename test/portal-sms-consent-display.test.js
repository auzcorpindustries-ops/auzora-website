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
// FIX: one shared predicate, `isSmsEnabled`, mirroring the backend send gate
// (sms_consent === true AND NOT sms_opt_out AND NOT opt_out) across the whole
// phone group. It is used by the row badge, the interaction-detail status line
// and the opt-in/out button state, so the CRM and the sender can never
// disagree. This is also what makes the SMS-CONSENT-LOOP "flip" visible: a lead
// with no consent record now reads "SMS Off" until the verified opt-in writes
// sms_consent=true.

const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'portal.html'), 'utf8');

function fnBody(name) {
  const start = html.indexOf('function ' + name + '(');
  expect(start).toBeGreaterThan(-1);
  const rest = html.slice(start + 1);
  const m = rest.search(/\n(async )?function /);
  return m === -1 ? rest : rest.slice(0, m);
}

/** Eval the real isSmsEnabled() out of portal.html and return it. */
function loadIsSmsEnabled() {
  const start = html.indexOf('function isSmsEnabled(');
  expect(start).toBeGreaterThan(-1);
  const rest = html.slice(start);
  const end = rest.indexOf('\n}\n');
  expect(end).toBeGreaterThan(-1);
  const src = rest.slice(0, end + 2); // include the closing brace
  // eslint-disable-next-line no-new-func
  return new Function(src + '\nreturn isSmsEnabled;')();
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

describe('the Captured Leads SMS field is wired to isSmsEnabled', () => {
  test('the row badge derives from the whole group via isSmsEnabled', () => {
    const body = fnBody('renderObLeads');
    expect(body).toContain('const smsConsent = isSmsEnabled(group);');
    // the old fail-open single-row read is gone
    expect(body).not.toContain('sms_consent !== false');
  });

  test('the row badge still renders both SMS On / SMS Off states', () => {
    const body = fnBody('renderObLeads');
    expect(body).toContain('SMS On');
    expect(body).toContain('SMS Off');
    expect(body).toContain('toggleSmsConsent');
  });

  test('no stale fail-open sms_consent read survives anywhere in portal.html', () => {
    expect(html).not.toContain('sms_consent !== false');
    expect(html).not.toContain("sms_consent === false ? 'SMS Off' : 'SMS On'");
  });

  test('the interaction-detail status line uses isSmsEnabled(lead)', () => {
    const body = fnBody('showLeadTimeline');
    expect(body).toContain("const smsStatus = isSmsEnabled(lead) ? 'SMS On' : 'SMS Off';");
  });

  test('the interaction-detail opt-in/out button state uses isSmsEnabled(lead)', () => {
    const body = fnBody('showLeadTimeline');
    expect(body).toContain('const smsConsent = isSmsEnabled(lead);');
  });

  test('the definition itself is the documented gate (consent AND NOT suppression)', () => {
    const body = fnBody('isSmsEnabled');
    expect(body).toContain('r.sms_consent === true');
    expect(body).toContain('r.sms_opt_out === true');
    expect(body).toContain('r.opt_out === true');
    expect(body).toContain('granted && !suppressed');
  });
});
