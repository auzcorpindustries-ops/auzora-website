// test/portal-usage-sms-addon.test.js — PRICING-6: client portal Plan & Usage
// SMS add-on state in portal.html.
//
// Guards the card's three record shapes against regression:
//   - legacy unlimited (usage.unlimited) → add-on block HIDDEN (the
//     grandfathered "Unlimited voice & SMS" state stays exactly as gated by
//     PRICING-5);
//   - new base plan, no add-on (limits.smsMessages === 0) → "SMS not
//     included" story + add-on options row fed by GET /portal/billing/addons
//     (PRICING-3), purchase CTA minting a server-side Checkout Session
//     (SMS-CHECKOUT-FIX);
//   - new plan + active add-on (payload.sms_addon) → "SMS add-on: N messages/
//     mo" + usage bar against the effective cap.
// Plus the PRICING-4 disabled-CTA doctrine (no provisioned link → Coming
// Soon, never a dead URL) and the inline script's syntax integrity.

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

describe('portal.html SMS add-on block markup (PRICING-6)', () => {
  test('add-on container exists in the Plan & Usage card, hidden by default', () => {
    expect(html).toContain('id="usage-sms-addon"');
    expect(html).toMatch(/id="usage-sms-addon" style="display:none;"/);
  });

  test('block sits inside the usage card, after the bars container', () => {
    const cardStart = html.indexOf('id="usage-card"');
    const barsStart = html.indexOf('id="usage-bars"');
    const addonStart = html.indexOf('id="usage-sms-addon"');
    const cardEnd = html.indexOf('id="dash-agent-card"');
    expect(cardStart).toBeGreaterThan(-1);
    expect(barsStart).toBeGreaterThan(cardStart);
    expect(addonStart).toBeGreaterThan(barsStart);
    expect(addonStart).toBeLessThan(cardEnd);
  });

  test('options row carries the PRICING-4 component contract (select + CTA + Coming Soon)', () => {
    expect(html).toContain('id="usage-sms-select"');
    expect(html).toContain('id="usage-sms-btn"');
    expect(html).toContain('id="usage-sms-coming"');
    expect(html).toContain('Coming Soon');
  });
});

describe('portal.html SMS add-on render branches (PRICING-6)', () => {
  const script = mainInlineScript();

  test('renderUsageSmsAddon is defined and wired into fetchEntitlements', () => {
    expect(script).toContain('function renderUsageSmsAddon(entitlementsPayload)');
    expect(script).toMatch(/renderUsageCard\(data\);[^]*?renderUsageSmsAddon\(data\);/);
    expect(script).toContain('loadSmsAddons()');
  });

  test('legacy unlimited plans hide the add-on block (PRICING-5 grandfathering)', () => {
    expect(script).toMatch(/if\s*\(usage\.unlimited\)\s*{\s*box\.style\.display\s*=\s*'none';/);
  });

  test('active add-on renders "SMS add-on: N messages/mo" with a usage bar', () => {
    expect(script).toContain('SMS add-on: <strong>');
    expect(script).toContain('messages/mo</strong>');
    // Usage bar reuses the shared fill classes incl. warn/over thresholds.
    expect(script).toMatch(/usage-bar-fill \$\{fillClass\}/);
    expect(script).toMatch(/pct > 100 \? 'over' : \(pct >= 80 \? 'warn' : ''\)/);
  });

  test('base plan with no add-on renders the "not included" state + options', () => {
    expect(script).toContain('SMS is not included in your plan');
    expect(script).toContain('add it as a monthly add-on');
    expect(script).toContain('id="usage-sms-select"');
    expect(script).toContain('id="usage-sms-btn"');
  });

  test('active-add-on branch keys off payload.sms_addon OR a raised SMS cap', () => {
    expect(script).toMatch(/entitlementsPayload\.sms_addon \|\| null/);
    expect(script).toMatch(/if\s*\(smsAddOn \|\| smsCap > 0\)/);
  });

  test('bar label for a 0 SMS cap says "not included", not the broken cap text', () => {
    expect(script).toContain('used · not included');
  });

  test('degraded entitlements state hides the add-on block (no stale state)', () => {
    expect(script).toMatch(/showUsageCardUnavailable[\s\S]*?usage-sms-addon[\s\S]*?smsAddon\.innerHTML = ''/);
  });
});

describe('portal.html add-on catalog wiring (PRICING-6 consumes PRICING-3)', () => {
  const script = mainInlineScript();

  test('catalog fetch hits GET /portal/billing/addons with the portal token', () => {
    expect(script).toContain('/portal/billing/addons');
    expect(script).toMatch(/fetch\(`\$\{API\}\/portal\/billing\/addons`, \{\s*headers: \{ 'X-Portal-Token': portalToken \}\s*\}\)/);
  });

  test('catalog failure leaves an honest degraded row (no fake options, no dead CTA)', () => {
    expect(script).toContain('Add-on options unavailable right now.');
    expect(script).toMatch(/select\.innerHTML = '<option value="">Unavailable<\/option>'/);
    expect(script).toMatch(/btn\.removeAttribute\('href'\)/);
  });

  test('CTA starts a SERVER-CREATED Checkout Session per SKU (SMS-CHECKOUT-FIX)', () => {
    // The old CTA carried a pre-minted (dead) payment link (addon.purchase_url).
    // It now POSTs the selected SKU to /portal/billing/addons/checkout, which
    // mints a recurring, account-tied Stripe Checkout Session server-side.
    expect(script).toContain('/portal/billing/addons/checkout');
    expect(script).toMatch(/method: 'POST'/);
    expect(script).toMatch(/JSON\.stringify\(\{ sku \}\)/);
    expect(script).toMatch(/window\.location\.href = data\.url/);
    expect(script).not.toContain('purchase_url');
    expect(script).toMatch(/addons\.find\(a => a\.sku === sku\)/);
  });

  test('CTA enables only when the SKU is purchasable (no dead CTA)', () => {
    expect(script).toMatch(/setSmsCtaDisabled\(btn, coming, !\(addon && addon\.purchasable\)\)/);
  });

  test('returning from checkout toasts success (pending approval) or cancellation', () => {
    expect(script).toContain('function handleSmsCheckoutReturn()');
    expect(script).toMatch(/params\.get\('checkout'\)/);
    expect(script).toContain('pending approval');
    expect(script).toMatch(/handleSmsCheckoutReturn\(\);/);
  });

  test('no provisioned link → PRICING-4 disabled pattern (Coming Soon + aria-disabled)', () => {
    expect(script).toMatch(/coming\.hidden = false/);
    expect(script).toMatch(/btn\.setAttribute\('aria-disabled', 'true'\)/);
    expect(script).toMatch(/btn\.classList\.add\('disabled'\)/);
  });

  test('option label uses the shared pricing copy shape "N messages — $X/mo"', () => {
    expect(script).toMatch(/messages — \$\$\{a\.monthlyUsd\}\/mo/);
  });

  test('current add-on SKU is preselected in the options row', () => {
    expect(script).toMatch(/a\.current \? ' selected' : ''/);
  });
});

describe('portal.html doctrine: no redesign, reuse existing components', () => {
  const script = mainInlineScript();

  test('options select reuses the dashboard select styling', () => {
    expect(html).toMatch(/class="dash-select" aria-label="SMS add-on volume"/);
  });

  test('add-on bar reuses the shared usage-bar components', () => {
    expect(script).toMatch(/class="usage-bar" role="progressbar"/);
    expect(script).toMatch(/class="usage-bar-fill \$\{fillClass\}"/);
  });

  test('add-on styles extend .usage-card scope, no new card chrome', () => {
    expect(html).toContain('.usage-sms-addon {');
    expect(html).toContain('.usage-sms-btn.disabled');
    expect(html).toContain('.usage-sms-coming');
  });
});

describe('portal.html inline script integrity (PRICING-6)', () => {
  test('main inline script still compiles (syntax guard for the 500KB inline app)', () => {
    expect(() => { new Function(mainInlineScript()); }).not.toThrow();
  });
});
