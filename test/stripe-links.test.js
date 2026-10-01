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
//   - linksEnabled stays false until the activation flip: disabled style +
//     aria-disabled + preventDefault on every payment link
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
  const cardsBlock = extractBlock('<div class="az-pricing">', '<div class="az-sms-addon">');
  const smsBlock = extractBlock('<div class="az-sms-addon">', '<p class="az-pricing-note">');

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
    const cards = cardsBlock.match(/<div class="az-pricing-card starter">/g) || [];
    expect(cards.length).toBe(3);
    // No per-plan feature lists — the suite lives in the shared panel.
    expect(cardsBlock).not.toContain('az-pricing-features');
    const ctas = [...cardsBlock.matchAll(/<a id="az-plan-cta-(basic|standard|enterprise)" class="az-pricing-btn starter" data-plan="\1" href="(https:\/\/buy\.stripe\.com\/[A-Za-z0-9_]+)"/g)];
    expect(ctas.map((m) => m[1])).toEqual(PLAN_KEYS);
    const prices = [...cardsBlock.matchAll(/<span class="price">(\$299|\$499|\$899)<\/span><span class="period">\/ month<\/span>/g)].map((m) => m[1]);
    expect(prices).toEqual(['$299', '$499', '$899']);
    const minutes = [...cardsBlock.matchAll(/(2,500|5,000|10,000) voice minutes included · Cancel anytime/g)].map((m) => m[1]);
    expect(minutes).toEqual(['2,500', '5,000', '10,000']);
    // Every card carries the add-on note instead of per-plan features.
    expect((cardsBlock.match(/SMS available as add-on\./g) || []).length).toBe(3);
  });

  test('exactly ONE dropdown on the page — the SMS add-on select with 3 options', () => {
    expect((html.match(/<select\b/g) || []).length).toBe(1);
    expect(smsBlock).not.toBeNull();
    const options = [...smsBlock.matchAll(/<option value="(sms_2500|sms_5000|sms_10000)"[^>]*>([^<]+)<\/option>/g)];
    expect(options.map((m) => m[1])).toEqual(SMS_KEYS);
    expect(options.map((m) => m[2])).toEqual([
      '2,500 messages — $25/mo', '5,000 messages — $50/mo', '10,000 messages — $100/mo',
    ]);
    expect(smsBlock).toContain('>Add SMS</a>');
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
  const addonsBlock = extractBlock('const SMS_ADDONS = {', '// BILL-1: on the develop deploy');

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

  test('both blocks keep linksEnabled false until the activation flip', () => {
    expect(plansBlock).toMatch(/linksEnabled:\s*false/);
    expect(addonsBlock).toMatch(/linksEnabled:\s*false/);
  });

  // Gating mechanics (BILL-1 contract): while linksEnabled is false every
  // payment link renders disabled — same pattern the old tier rows used.
  test('gating wiring: disabled style + aria-disabled + preventDefault while linksEnabled=false', () => {
    expect(html).toMatch(/function applyLinkMode\(\)/);
    expect(html).toMatch(/classList\.add\('disabled'\)/);
    expect(html).toMatch(/setAttribute\('aria-disabled',\s*'true'\)/);
    expect(html).toMatch(/addEventListener\('click',\s*e => e\.preventDefault\(\)\)/);
  });

  test('SMS add-on select is wired to the Add SMS button (SKU + href sync)', () => {
    expect(html).toMatch(/getElementById\('az-sms-select'\)/);
    expect(html).toMatch(/azSmsSelect\.addEventListener\('change'/);
    expect(html).toMatch(/azSmsBtn\.dataset\.sku = azSmsSelect\.value/);
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
