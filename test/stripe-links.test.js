// test/stripe-links.test.js — BILL-1: develop-deploy TEST-mode payment links.
//
// Guards the index.html pricing block:
//   - every tier row carries a LIVE payment link (prod default)
//   - AZ_STRIPE_TEST_LINKS carries a TEST link for every tier key
//   - test links match atlas-ai scripts/stripe-links-test.json (when the
//     sibling repo is present locally — skipped in website CI)
//   - netlify.toml wires STRIPE_LINK_MODE: live default, test on develop
//   - the Netlify plugin injects/updates window.STRIPE_LINK_MODE correctly

const fs = require('fs');
const path = require('path');
const os = require('os');

const repoRoot = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(repoRoot, 'index.html'), 'utf8');

function extractBlock(startMarker, endMarker) {
  const s = html.indexOf(startMarker);
  const e = html.indexOf(endMarker, s);
  if (s === -1 || e === -1) return null;
  return html.slice(s, e);
}

// ── index.html: PRICING_TIERS live links ─────────────────────────────────────
describe('index.html PRICING_TIERS (live links, prod default)', () => {
  const block = extractBlock('const PRICING_TIERS = {', '// BILL-1: on the develop deploy');

  test('pricing block exists', () => {
    expect(block).not.toBeNull();
  });

  test('carries all 7 tier keys with live payment links', () => {
    const pairs = [...block.matchAll(/key:\s*'([a-z_]+)'[\s\S]*?paymentLinkUrl:\s*'(https:\/\/buy\.stripe\.com\/[^']+)'/g)];
    const keys = pairs.map((m) => m[1]);
    expect(keys.sort()).toEqual([
      'premium_basic', 'premium_enterprise', 'premium_standard',
      'pro_basic', 'pro_enterprise', 'pro_standard', 'starter',
    ]);
    for (const [, , url] of pairs) {
      expect(url).toMatch(/^https:\/\/buy\.stripe\.com\/(?!test_)[A-Za-z0-9]+$/);
    }
  });

  test('linksEnabled stays false until the activation flip', () => {
    expect(block).toMatch(/linksEnabled:\s*false/);
  });
});

// ── index.html: AZ_STRIPE_TEST_LINKS ─────────────────────────────────────────
describe('index.html AZ_STRIPE_TEST_LINKS (develop deploy)', () => {
  const block = extractBlock('const AZ_STRIPE_TEST_LINKS = {', 'const PRICING_TIERS');

  test('test-links map exists', () => {
    expect(block).not.toBeNull();
  });

  test('carries a buy.stripe.com/test_ link for every tier key', () => {
    const entries = [...block.matchAll(/([a-z_]+):\s*'(https:\/\/buy\.stripe\.com\/test_[^']+)'/g)];
    const keys = entries.map((m) => m[1]);
    expect(keys.sort()).toEqual([
      'premium_basic', 'premium_enterprise', 'premium_standard',
      'pro_basic', 'pro_enterprise', 'pro_standard', 'starter',
    ]);
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
    const tiersMap = JSON.parse(fs.readFileSync(linksPath, 'utf8')).tiers;
    const entries = [...block.matchAll(/([a-z_]+):\s*'(https:\/\/buy\.stripe\.com\/test_[^']+)'/g)];
    const testLinks = Object.fromEntries(entries.map((m) => [m[1], m[2]]));
    for (const [sku, info] of Object.entries(tiersMap)) {
      expect(testLinks[sku]).toBe(info.payment_link_url);
    }
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
    '    const PRICING_TIERS = { plans: {} };',
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
    expect(out.indexOf("window.STRIPE_LINK_MODE")).toBeLessThan(out.indexOf('PRICING_TIERS'));
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
