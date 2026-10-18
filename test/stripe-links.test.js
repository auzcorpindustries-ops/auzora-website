// test/stripe-links.test.js — BILL-1 + PRICING-4: develop-deploy TEST-mode
// payment links for the Q4 pricing model.
//
// Guards the rebuilt index.html pricing section:
//   - shared "Every plan includes" panel renders ABOVE the 3 plan cards
//   - 3 plan cards (Basic/Standard/Enterprise), differing only by price +
//     included minutes, each with a single real <a> CTA carrying a payment link
//   - exactly ONE <select> on the page: the SMS add-on dropdown (3 options),
//     with an "Add SMS" button carrying the selected SKU's payment link
//   - PLANS + SMS_ADDONS replace the old PRICING_TIERS 7-SKU block (no tier
//     accordions, no per-plan feature lists)
//   - AZ_STRIPE_TEST_LINKS carries a TEST link for all 6 SKUs (3 plans + 3
//     SMS add-ons); test links match atlas-ai scripts/stripe-links-test.json
//     (when the sibling repo is present locally — skipped in website CI)
//   - linksEnabled: true since the 2026-10-14 activation flip (gating
//     wiring retained as the documented rollback mechanism)
//   - netlify.toml wires STRIPE_LINK_MODE: live default, test on develop
//   - the Netlify plugin injects/updates window.STRIPE_LINK_MODE correctly

const fs = require('fs');
const path = require('path');
const os = require('os');

const repoRoot = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(repoRoot, 'index.html'), 'utf8');
const checkout = fs.readFileSync(path.join(repoRoot, 'checkout.html'), 'utf8');

function extractBlock(startMarker, endMarker) {
  const s = html.indexOf(startMarker);
  const e = html.indexOf(endMarker, s);
  if (s === -1 || e === -1) return null;
  return html.slice(s, e);
}

const PLAN_KEYS = ['basic', 'standard', 'enterprise'];
const SMS_KEYS = ['sms_2500', 'sms_5000', 'sms_10000'];
const ALL_KEYS = [...PLAN_KEYS, ...SMS_KEYS];

// ── index.html: pricing section structure (PRICING-4 rebuild) ────────────────
describe('index.html pricing section structure (PRICING-4 rebuild)', () => {
  const includedBlock = extractBlock('<div class="az-included">', '<div class="az-pricing">');
  const cardsBlock = extractBlock('<div class="az-pricing">', '<p class="az-pricing-note">');

  test('shared "Every plan includes" panel renders ABOVE the plan cards', () => {
    expect(includedBlock).not.toBeNull();
    expect(includedBlock).toContain('Every plan includes');
    // Full feature suite (Premium list + tier.js entitlements) — identical on
    // every plan, listed once above the cards.
    const fullSuite = [
      'Dedicated AI phone line', '24/7 AI call answering', 'Calendar appointment booking',
      'Custom greeting &amp; FAQs', 'Client portal access', 'External CRM integration',
      'Internal lead-capture CRM', 'AI follow-up calls', 'AI follow-up SMS',
      'Bulk SMS campaigns', 'Bulk call campaigns', 'Manual outbound calls',
      'Post-call actions', 'Priority support',
    ];
    for (const item of fullSuite) {
      expect(includedBlock).toContain(item);
    }
  });

  test('exactly 3 plan cards differing only by price, minutes, and CTA', () => {
    expect(cardsBlock).not.toBeNull();
    const cards = cardsBlock.match(/<div class="az-pricing-card starter" data-plan="(?:basic|standard|enterprise)"/g) || [];
    expect(cards.length).toBe(3);
    // No per-plan feature lists — the suite lives in the shared panel.
    expect(cardsBlock).not.toContain('az-pricing-features');
    // SIGNUP-BUNDLE: the plan CTA is a button (it mints a composed session
    // through the API) — the retired Payment-Link hrefs are gone entirely.
    const ctas = [...cardsBlock.matchAll(/<button type="button" id="az-plan-cta-(basic|standard|enterprise)" class="az-pricing-btn starter" data-plan="\1">/g)];
    expect(ctas.map((m) => m[1])).toEqual(PLAN_KEYS);
    expect(cardsBlock).not.toMatch(/id="az-plan-cta-[a-z]+"[^>]*href=/);
    const prices = [...cardsBlock.matchAll(/<span class="price">(\$299|\$499|\$899)<\/span><span class="period">\/ month<\/span>/g)].map((m) => m[1]);
    expect(prices).toEqual(['$299', '$499', '$899']);
    const minutes = [...cardsBlock.matchAll(/(2,500|5,000|10,000) voice minutes included · Cancel anytime/g)].map((m) => m[1]);
    expect(minutes).toEqual(['2,500', '5,000', '10,000']);
    // Every card carries the add-on note instead of per-plan features.
    expect((cardsBlock.match(/SMS available as add-on\./g) || []).length).toBe(3);
  });

  test('PRICING-7: no standalone SMS block — one contextual dropdown per plan card', () => {
    // The old standalone .az-sms-addon panel below the grid is gone entirely.
    expect(html).not.toContain('class="az-sms-addon"');
    expect(html).not.toContain('az-sms-addon-title');
    expect(html).not.toContain('id="az-sms-select"');
    expect(html).not.toContain('id="az-sms-btn"');
    // Exactly one <select> per plan card (3 total).
    expect((html.match(/<select\b/g) || []).length).toBe(3);
    const options = [...cardsBlock.matchAll(/<option value="(sms_2500|sms_5000|sms_10000)"[^>]*>([^<]+)<\/option>/g)];
    expect(options.map((m) => m[1])).toEqual([...SMS_KEYS, ...SMS_KEYS, ...SMS_KEYS]);
    expect(options.map((m) => m[2])).toEqual([
      '2,500 messages — $25/mo', '5,000 messages — $50/mo', '10,000 messages — $100/mo',
      '2,500 messages — $25/mo', '5,000 messages — $50/mo', '10,000 messages — $100/mo',
      '2,500 messages — $25/mo', '5,000 messages — $50/mo', '10,000 messages — $100/mo',
    ]);
    // SIGNUP-BUNDLE: every trace of the standalone SMS PURCHASE is gone — no
    // "Add SMS" button, no per-row "Coming Soon" badge, and the shared
    // SMS-only payment link survives only as rollback DATA in SMS_ADDONS,
    // never as a clickable href. SMS-only signup is impossible from this page.
    expect(cardsBlock).not.toContain('az-sms-btn');
    expect(cardsBlock).not.toContain('>Add SMS<');
    expect(html).not.toContain('az-sms-coming');
    expect(
      (html.match(/href="https:\/\/buy\.stripe\.com\/14A14fdwI86Cenuf8I1ZS0f"/g) || []).length
    ).toBe(0);
  });

  test('NO minutes-tier accordion remains', () => {
    expect(html).not.toContain('PRICING_TIERS');
    expect(html).not.toContain('az-tier-panel');
    expect(html).not.toContain('az-tier-row');
    expect(html).not.toContain('renderTierPanel');
    expect(html).not.toContain('togglePricingPanel');
  });
});

// ── index.html: PLANS + SMS_ADDONS (real payment links, prod default) ────────
describe('index.html PLANS / SMS_ADDONS (Q4 catalog, real payment links)', () => {
  const plansBlock = extractBlock('const PLANS = {', 'const SMS_ADDONS');
  const addonsBlock = extractBlock('const SMS_ADDONS = {', '// BILL-1 rollback machinery');

  test('PLANS block exists with the 3 plan SKUs carrying real payment links', () => {
    expect(plansBlock).not.toBeNull();
    const pairs = [...plansBlock.matchAll(/(basic|standard|enterprise): \{ name: '[^']+', priceLabel: '[^']+', minutes: '[^']+', paymentLinkUrl: '(https:\/\/buy\.stripe\.com\/[A-Za-z0-9_]+)'/g)];
    expect(pairs.map((m) => m[1])).toEqual(PLAN_KEYS);
    for (const [, , url] of pairs) {
      expect(url).toMatch(/^https:\/\/buy\.stripe\.com\/[A-Za-z0-9_]+$/);
    }
  });

  test('SMS_ADDONS block exists with the 3 add-on SKUs carrying real payment links', () => {
    expect(addonsBlock).not.toBeNull();
    const pairs = [...addonsBlock.matchAll(/(sms_2500|sms_5000|sms_10000): \{ label: '[^']+', paymentLinkUrl: '(https:\/\/buy\.stripe\.com\/[A-Za-z0-9_]+)'/g)];
    expect(pairs.map((m) => m[1])).toEqual(SMS_KEYS);
    for (const [, , url] of pairs) {
      expect(url).toMatch(/^https:\/\/buy\.stripe\.com\/[A-Za-z0-9_]+$/);
    }
  });

  test('both blocks ship linksEnabled: true (2026-10-14 activation flip)', () => {
    // 2026-10-14: FULL activation — Auzi flipped the real-money switch and
    // all 6 PROD Payment Links were activated in Stripe live mode. CTAs are
    // enabled in every mode; the test-link swap below still applies on
    // test-mode deploys.
    expect(plansBlock).toMatch(/linksEnabled: true/);
    expect(addonsBlock).toMatch(/linksEnabled: true/);
  });

  // Gating mechanics (BILL-1 contract): while linksEnabled is false every
  // payment link renders disabled — same pattern the old tier rows used.
  test('gating wiring: disabled style + aria-disabled + click guard while linksEnabled=false', () => {
    expect(html).toMatch(/function applyLinkMode\(\)/);
    expect(html).toMatch(/classList\.add\('disabled'\)/);
    expect(html).toMatch(/setAttribute\('aria-disabled',\s*'true'\)/);
    // SIGNUP-BUNDLE: the CTA is no longer an anchor, so the guard is the
    // delegated document-level click check on aria-disabled (the CTA's own
    // handler also refuses when aria-disabled is set).
    expect(html).toMatch(/document\.addEventListener\('click',\s*\(e\) => \{/);
    expect(html).toMatch(/link\.getAttribute\('aria-disabled'\) === 'true'/);
  });

  test('SIGNUP-BUNDLE: the dropdown feeds the plan CTA and the CTA mints the session', () => {
    // The dropdown is the ONLY add-on control (a bundle option, not a purchase).
    expect(html).toMatch(/\.az-sms-select\[data-plan\]/);
    expect(html).toMatch(/select\.addEventListener\('change'/);
    expect(html).toMatch(/updateSmsTotal\(planKey\)/);
    // The CTA POSTs { plan, sms_sku } to the signup-checkout endpoint...
    expect(html).toMatch(/const AZ_SIGNUP_ENDPOINT = AZ_SIGNUP_API_BASE \+ '\/api\/billing\/signup-checkout'/);
    expect(html).toMatch(/sms_sku: sku/);
    // ...and hands the browser to the returned session URL.
    expect(html).toMatch(/window\.location\.assign\(data\.url\)/);
  });

  test('SIGNUP-BUNDLE: the API base follows the injected Stripe mode', () => {
    // STRIPE_LINK_MODE=test (develop + deploy previews) ⇒ the staging API,
    // which holds the sk_test key (test-price sessions). Prod ⇒ prod API.
    expect(html).toMatch(/const AZ_SIGNUP_API_BASE = AZ_STRIPE_LINK_MODE === 'test'/);
    expect(html).toMatch(/'https:\/\/atlas-staging\.6845165\.xyz'/);
    expect(html).toMatch(/'https:\/\/atlas\.6845165\.xyz'/);
  });
});

// ── index.html: AZ_STRIPE_TEST_LINKS (develop deploy) ────────────────────────
describe('index.html AZ_STRIPE_TEST_LINKS (develop deploy)', () => {
  const block = extractBlock('const AZ_STRIPE_TEST_LINKS = {', 'const PLANS');

  test('test-links map exists with exactly the 6 Q4 SKUs', () => {
    expect(block).not.toBeNull();
    const entries = [...block.matchAll(/([a-z_0-9]+):\s*'(https:\/\/buy\.stripe\.com\/test_[^']+)'/g)];
    expect(entries.map((m) => m[1])).toEqual([...PLAN_KEYS, ...SMS_KEYS]);
    for (const [, , url] of entries) {
      expect(url).toMatch(/^https:\/\/buy\.stripe\.com\/test_[A-Za-z0-9]+$/);
    }
  });

  test('mode gate reads window.STRIPE_LINK_MODE and defaults to live', () => {
    expect(html).toMatch(/'STRIPE_LINK_MODE' in window/);
    expect(html).toMatch(/:\s*'live';/);
    expect(html).toMatch(/AZ_STRIPE_LINK_MODE === 'test'/);
  });

  test('test links match atlas-ai scripts/stripe-links-test.json (when present)', () => {
    const linksPath = path.join(repoRoot, '..', 'atlas-ai', 'scripts', 'stripe-links-test.json');
    if (!fs.existsSync(linksPath)) {
      // Website CI has no atlas-ai sibling — sync is guarded on the atlas-ai
      // side (test/unit/tiersCatalog.test.js drift guard) instead.
      console.warn('[stripe-links] atlas-ai sibling not present — cross-repo sync check skipped');
      return;
    }
    const catalog = JSON.parse(fs.readFileSync(linksPath, 'utf8'));
    const skus = { ...catalog.tiers, ...catalog.sms_addons };
    const entries = [...block.matchAll(/([a-z_0-9]+):\s*'(https:\/\/buy\.stripe\.com\/test_[^']+)'/g)];
    const testLinks = Object.fromEntries(entries.map((m) => [m[1], m[2]]));
    // Key parity: the 6 map keys are exactly the 3 plans + 3 SMS add-ons.
    expect(Object.keys(testLinks).sort()).toEqual([...ALL_KEYS].sort());
    for (const [sku, info] of Object.entries(skus)) {
      expect(testLinks[sku]).toBe(info.payment_link_url);
    }
  });
});

// ── checkout.html ?plan= shim (deep-link mapping) ────────────────────────────
describe('checkout.html ?plan= shim (deep-link mapping)', () => {
  test('maps plan=basic|standard|enterprise onto the pricing deep link', () => {
    expect(checkout).toMatch(/\['basic',\s*'standard',\s*'enterprise'\]\.indexOf\(plan\)/);
    expect(checkout).toContain("target = '/index.html#pricing?plan=' + plan;");
    expect(checkout).not.toContain("'starter'");
    expect(checkout).not.toContain("'premium'");
  });
});

// ── netlify.toml wiring ──────────────────────────────────────────────────────
describe('netlify.toml STRIPE_LINK_MODE wiring', () => {
  const toml = fs.readFileSync(path.join(repoRoot, 'netlify.toml'), 'utf8');

  test('site-wide default is live', () => {
    expect(toml).toMatch(/\[build\.environment\][^\[]*STRIPE_LINK_MODE\s*=\s*"live"/s);
  });

  test('develop context overrides to test', () => {
    expect(toml).toMatch(/\[context\.develop\.environment\][^\[]*STRIPE_LINK_MODE\s*=\s*"test"/s);
  });

  test('plugin is registered from ./netlify/plugins/stripe-link-mode', () => {
    expect(toml).toMatch(/\[\[plugins\]\]\s*\n\s*package\s*=\s*"\.\/netlify\/plugins\/stripe-link-mode"/);
  });
});

// ── Netlify plugin behavior ──────────────────────────────────────────────────
describe('netlify plugin stripe-link-mode', () => {
  const pluginFactory = require('../netlify/plugins/stripe-link-mode');
  const FIXTURE = [
    '<html><body>',
    '  <script>',
    '    const PLANS = { linksEnabled: false };',
    '  </script>',
    '</body></html>',
  ].join('\n');

  function runPlugin(mode, initialHtml) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bill1-plugin-'));
    const file = path.join(dir, 'index.html');
    fs.writeFileSync(file, initialHtml ?? FIXTURE);
    const saved = process.env.STRIPE_LINK_MODE;
    process.env.STRIPE_LINK_MODE = mode;
    try {
      // Real @netlify/build contract: the plugin factory receives NO
      // constants — only the event handler does (plus netlifyConfig).
      pluginFactory().onPreBuild({
        constants: { PUBLISH_DIR: dir },
        netlifyConfig: { build: { publish: dir } },
      });
    } finally {
      if (saved === undefined) delete process.env.STRIPE_LINK_MODE;
      else process.env.STRIPE_LINK_MODE = saved;
    }
    return fs.readFileSync(file, 'utf8');
  }

  // Simulates a Netlify build where the handler gets no usable constants —
  // the publish dir must resolve from netlifyConfig.build.publish instead.
  function runPluginViaNetlifyConfigOnly(mode, initialHtml) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bill1-plugin-'));
    const file = path.join(dir, 'index.html');
    fs.writeFileSync(file, initialHtml ?? FIXTURE);
    const saved = process.env.STRIPE_LINK_MODE;
    process.env.STRIPE_LINK_MODE = mode;
    try {
      pluginFactory().onPreBuild({
        constants: {},
        netlifyConfig: { build: { publish: dir } },
      });
    } finally {
      if (saved === undefined) delete process.env.STRIPE_LINK_MODE;
      else process.env.STRIPE_LINK_MODE = saved;
    }
    return fs.readFileSync(file, 'utf8');
  }

  test('injects test mode into a fresh index.html', () => {
    const out = runPlugin('test');
    expect(out).toContain("window.STRIPE_LINK_MODE = 'test';");
    expect(out.indexOf("window.STRIPE_LINK_MODE")).toBeLessThan(out.indexOf('const PLANS'));
  });

  test('injects live mode by default (no env var)', () => {
    const out = runPlugin(undefined);
    expect(out).toContain("window.STRIPE_LINK_MODE = 'live';");
  });

  test('replaces an existing injection in place', () => {
    const pre = FIXTURE.replace('<script>', "<script>\n    window.STRIPE_LINK_MODE = 'live';");
    const out = runPlugin('test', pre);
    expect(out).toContain("window.STRIPE_LINK_MODE = 'test';");
    expect(out).not.toContain("window.STRIPE_LINK_MODE = 'live';");
  });

  test('unknown mode values are coerced to live', () => {
    const out = runPlugin('hooligan');
    expect(out).toContain("window.STRIPE_LINK_MODE = 'live';");
  });

  test('missing index.html does not throw', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bill1-plugin-'));
    const saved = process.env.STRIPE_LINK_MODE;
    process.env.STRIPE_LINK_MODE = 'test';
    try {
      expect(() =>
        pluginFactory().onPreBuild({
          constants: { PUBLISH_DIR: dir },
          netlifyConfig: { build: { publish: dir } },
        })
      ).not.toThrow();
    } finally {
      if (saved === undefined) delete process.env.STRIPE_LINK_MODE;
      else process.env.STRIPE_LINK_MODE = saved;
    }
  });

  // Regression for the 2026-09-28 deploy-preview failure (PRs #362/#363,
  // build exit code 3): @netlify/build calls the factory WITHOUT constants,
  // so reading constants.PUBLISH_DIR in the factory scope crashed the build.
  test('factory takes no arguments — reading constants there must not be required (exit-3 regression)', () => {
    expect(() => pluginFactory()).not.toThrow();
    expect(() => pluginFactory({})).not.toThrow();
  });

  test('falls back to netlifyConfig.build.publish when constants has no PUBLISH_DIR', () => {
    const out = runPluginViaNetlifyConfigOnly('test');
    expect(out).toContain("window.STRIPE_LINK_MODE = 'test';");
  });
});


// ── PRICING-7: contextual, plan-gated SMS add-on + radio-style selection ─────
describe('PRICING-7 plan selection and contextual SMS add-on', () => {
  const cardsBlock = extractBlock('<div class="az-pricing">', '<p class="az-pricing-note">');

  test('AC1: no SMS dropdown is revealed until a plan is selected', () => {
    // Every per-card add-on row ships hidden; no card starts selected.
    const rows = cardsBlock.match(/<div class="az-card-sms" data-sms-row="(?:basic|standard|enterprise)" hidden>/g) || [];
    expect(rows.length).toBe(3);
    expect((cardsBlock.match(/class="az-pricing-card starter" data-plan="[a-z]+" aria-selected="false"/g) || []).length).toBe(3);
    // No card is marked selected in the static markup.
    expect(cardsBlock).not.toMatch(/az-pricing-card[^"]*selected/);
  });

  test('AC2: each card has its own Select control + hidden add-on row', () => {
    for (const key of PLAN_KEYS) {
      expect(cardsBlock).toContain(`<button type="button" class="az-plan-select" data-plan="${key}" aria-pressed="false">Select</button>`);
      expect(cardsBlock).toContain(`<div class="az-card-sms" data-sms-row="${key}" hidden>`);
      // SIGNUP-BUNDLE: the add-on row carries a dropdown + the combined total,
      // NOT a standalone SMS purchase button.
      expect(cardsBlock).toContain(`id="az-sms-select-${key}"`);
      expect(cardsBlock).toContain(`id="az-sms-total-${key}"`);
      expect(cardsBlock).not.toContain(`id="az-sms-btn-${key}"`);
    }
  });

  test('AC2: exactly-one-selected radio logic is wired', () => {
    expect(html).toMatch(/function selectPlan\(planKey\)/);
    expect(html).toMatch(/function refreshPlanSelection\(\)/);
    // Selection toggles a single card and reveals only that card's row.
    expect(html).toMatch(/classList\.toggle\('selected', card\.dataset\.plan === planKey\)/);
    expect(html).toMatch(/row\.hidden = !on/);
    // Visibility is derived from the ONE selected card (never two rows open).
    expect(html).toMatch(/const selected = document\.querySelector\('\.az-pricing-card\[data-plan\]\.selected'\)/);
  });

  test('AC3: the plan CTA sends { plan, sms_sku } and redirects to the session url', () => {
    // Plan-only is the default (the untouched dropdown = "no add-on"), so the
    // plan-only path stays reachable without touching any control.
    expect(html).toMatch(/<option value="" selected>No SMS add-on — plan only<\/option>/);
    expect(html).toMatch(/const sku = select && select\.value \? select\.value : null;/);
    expect(html).toMatch(/body: JSON\.stringify\(sku \? \{ plan: planKey, sms_sku: sku \} : \{ plan: planKey \}\)/);
    // The request ALWAYS carries a plan — there is no SMS-only request shape.
    expect(html).not.toMatch(/client_reference_id/);
    // The combined monthly total is derived client-side for display; the API
    // is the source of truth for the actual line items.
    expect(html).toMatch(/function updateSmsTotal\(planKey\)/);
  });

  test('AC4: no analytics/event plumbing introduced', () => {
    expect(html).not.toContain('gtag(');
    expect(html).not.toContain('dataLayer');
    expect(html).not.toContain('trackEvent');
  });

  test('AC5(e): mode gating still applies to the checkout CTAs', () => {
    // The gate covers the session-mint CTA; the retired SMS button is gone.
    expect(html).toMatch(/if \(disabled\) setLinkDisabled\(btn, true\)/);
    expect(html).not.toMatch(/az-sms-btn/);
    expect(html).not.toMatch(/az-sms-coming/);
    // Plan CTA is de-emphasised until its card is selected.
    expect(html).toMatch(/setLinkDisabled\(cta, !on \|\| linkModeDisabled\(\)\)/);
  });

  test('AC: deep link pre-selects the named plan (not just scroll)', () => {
    expect(html).toMatch(/if \(document\.querySelector\('\.az-pricing-card\[data-plan="' \+ key \+ '"\]'\)\) selectPlan\(key\)/);
  });
});
