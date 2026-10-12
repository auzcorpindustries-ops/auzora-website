// test/portal-sms-tier-change.test.js — SMS-PLAN-UPDATE
// (zeus_1791676782857_c2af750b).
//
// The client portal's 'Update SMS Plan' affordance for an EXISTING SMS add-on
// holder: the active-add-on branch of the Plan & Usage card gains a LIVE tier
// dropdown whose submission records a tier-change REQUEST (POST
// /portal/billing/addons/change-tier) for admin approval. Nothing is swapped
// at request time — the request is rendered as "awaiting approval".
//
// Static-markup assertions over the main inline app script (the convention of
// portal-usage-sms-addon.test.js — jsdom is not a dependency of this repo).

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

// Body of ONE top-level function inside the inline script — cut at the next
// top-level declaration so a neighbouring function's text never leaks in.
function fnBody(script, decl) {
  const start = script.indexOf(decl);
  if (start === -1) return '';
  const rest = script.slice(start);
  const next = rest.slice(1).search(/\nasync function |\nfunction /);
  return next === -1 ? rest : rest.slice(0, next + 1);
}

const script = mainInlineScript();

describe('portal.html — Update SMS Plan affordance for existing holders', () => {
  test('the active-add-on branch renders the change row and fills its dropdown', () => {
    expect(script).toContain('function renderUsageSmsChangeRow(smsAddOn)');
    expect(script).toContain('renderUsageSmsChangeRow(smsAddOn)');
    expect(script).toContain('renderSmsChangeOptions(smsAddonOptions, smsAddOn)');
    // still behind the same active-add-on gate
    expect(script).toMatch(/if\s*\(smsAddOn \|\| smsCap > 0\)/);
  });

  test('the change row carries the dropdown, CTA and Coming Soon component contract', () => {
    const body = fnBody(script, 'function renderUsageSmsChangeRow');
    expect(body).toContain('id="usage-sms-change-select"');
    expect(body).toContain('id="usage-sms-change-btn"');
    expect(body).toContain('id="usage-sms-change-coming"');
    expect(body).toContain('Update SMS Plan');
    expect(body).toContain('Change SMS add-on tier');
    expect(body).toContain('startSmsTierChange()');
  });

  test('the dropdown is live (not disabled) and preselection follows the current tier', () => {
    const body = fnBody(script, 'function renderSmsChangeOptions');
    expect(body).toContain('select.disabled = false;');
    expect(body).toMatch(/a\.sku === currentSku \? ' selected' : ''/);
  });

  test('the CTA disables for the current tier, an unpurchasable SKU, or a pending request', () => {
    const body = fnBody(script, 'function renderSmsChangeOptions');
    expect(body).toMatch(/setSmsCtaDisabled\(btn, coming, !\(addon && addon\.purchasable\) \|\| sku === currentSku \|\| pending\)/);
    expect(body).toContain("const pending = btn.dataset.pending === '1'");
  });

  test('a pending request renders an "awaiting approval" note and disables the CTA', () => {
    const body = fnBody(script, 'function renderUsageSmsChangeRow');
    expect(body).toContain('awaiting approval');
    expect(body).toContain('tier_change_request');
    expect(body).toContain('data-pending="1"');
  });

  test('submitting POSTs the selected SKU to the change-tier endpoint with the portal token', () => {
    const body = fnBody(script, 'async function startSmsTierChange');
    expect(body).toContain('/portal/billing/addons/change-tier');
    expect(body).toContain("method: 'POST'");
    expect(body).toContain('JSON.stringify({ sku })');
    expect(body).toContain("'X-Portal-Token': portalToken");
    // The request is a REQUEST — no Stripe redirect here.
    expect(body).not.toContain('window.location.href');
    expect(body).toContain('pending approval');
  });

  test('loadSmsAddons fills the change row from the same catalog', () => {
    const body = fnBody(script, 'async function loadSmsAddons');
    expect(body).toContain('renderSmsChangeOptions(smsAddonOptions, smsAddonOptions.current || null)');
  });
});

describe('portal.html inline script integrity (SMS-PLAN-UPDATE)', () => {
  test('main inline script still compiles', () => {
    expect(() => { new Function(mainInlineScript()); }).not.toThrow();
  });
});
