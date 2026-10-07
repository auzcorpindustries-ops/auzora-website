// test/release-path.test.js — PROD-4: the production release path is
// documented in-repo and actually enforced.
//
// Before PROD-4, "deploy to production" was tribal knowledge: nothing in the
// repo said how main moved or what production was supposed to look like after.
// These tests pin the release contract so it cannot quietly disappear:
//
//   - docs/RELEASE.md exists and names the real mechanism (release PR,
//     workflow_dispatch, verify-prod)
//   - .github/workflows/release.yml exists, triggers on push to main and on
//     workflow_dispatch, and never targets anything but `main` as a release base
//   - the workflow checks every public page the release ticket called out
//     (portal / checkout / payment-success), not just the landing page
//   - the workflow FAILS if production ever serves linksEnabled: true
//     (the activation flip must be its own reviewed release, per PRICING
//     doctrine and the PRICING-7 gate)
//   - production must be in `live` Stripe link mode, never `test`
//   - the auto-merge workflow still only targets `develop` (never auto-merges
//     into production)

const fs = require('fs');
const path = require('path');

const repoRoot = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

const releasePath = path.join(repoRoot, '.github/workflows/release.yml');
const releaseDocPath = path.join(repoRoot, 'docs/RELEASE.md');
const hasReleaseWorkflow = fs.existsSync(releasePath);
const hasReleaseDoc = fs.existsSync(releaseDocPath);

describe('PROD-4: documented release runbook (docs/RELEASE.md)', () => {
  test('docs/RELEASE.md exists', () => {
    expect(hasReleaseDoc).toBe(true);
  });

  test('documents the branch model: develop never ships, only main does', () => {
    const doc = read('docs/RELEASE.md');
    expect(doc).toContain('develop');
    expect(doc).toContain('main');
    expect(doc.toLowerCase()).toContain('netlify');
    // The core rule of this ticket: main moves only via a release PR.
    expect(doc).toMatch(/only.*merg|merg.*only/i);
  });

  test('documents the release procedure, not just the philosophy', () => {
    const doc = read('docs/RELEASE.md');
    expect(doc).toMatch(/Run workflow|workflow_dispatch/);
    expect(doc).toContain('gh pr create');
    // The four pages the PROD-4 acceptance criteria named.
    for (const page of ['portal', 'checkout', 'payment-success']) {
      expect(doc).toContain(page);
    }
  });

  test('documents the activation-flip rule for pricing links', () => {
    const doc = read('docs/RELEASE.md');
    expect(doc).toContain('linksEnabled');
    expect(doc).toMatch(/activation/i);
    expect(doc.toLowerCase()).toContain('rollback');
  });
});

describe('PROD-4: release workflow (.github/workflows/release.yml)', () => {
  test('exists', () => {
    expect(hasReleaseWorkflow).toBe(true);
  });

  test('runs on every push to main AND on manual dispatch', () => {
    const yml = read('.github/workflows/release.yml');
    // push: main -> verification after every actual release
    expect(yml).toMatch(/^\s*push:/m);
    expect(yml).toMatch(/branches:\s*\[main\]/);
    // workflow_dispatch -> open the release PR on demand
    expect(yml).toMatch(/^\s*workflow_dispatch:/m);
  });

  test('opens the release PR with base main and head develop', () => {
    const yml = read('.github/workflows/release.yml');
    expect(yml).toMatch(/base:\s*'main'/);
    expect(yml).toMatch(/head:\s*'develop'/);
  });

  test('guards against main containing commits develop does not', () => {
    const yml = read('.github/workflows/release.yml');
    // Fails closed rather than silently merging a diverged main.
    expect(yml).toContain('behind_by');
    expect(yml).toContain('compareCommitsWithBasehead');
  });

  test('never pushes or force-pushes to main directly', () => {
    const yml = read('.github/workflows/release.yml');
    expect(yml).not.toMatch(/git push[^\n]*\bmain\b/);
    expect(yml).not.toContain('push --force');
  });

  test('verifies every public page named in the release criteria', () => {
    const yml = read('.github/workflows/release.yml');
    for (const page of ['portal', 'checkout', 'payment-success']) {
      expect(yml).toContain(page);
    }
    // ...and actually asserts on the status code rather than logging it.
    expect(yml).toContain('%{http_code}');
  });

  test('FAILS the build if production ever serves linksEnabled: true', () => {
    const yml = read('.github/workflows/release.yml');
    const idx = yml.indexOf('linksEnabled: true');
    expect(idx).toBeGreaterThan(-1);
    // Scope the assertions to THIS step only. A loose window around the match
    // passes even after the guard is downgraded to ::warning:: — verified by
    // mutation test, so match the guarded branch itself.
    const stepStart = yml.lastIndexOf('- name:', idx);
    const stepEnd = yml.indexOf('\n      - name:', idx);
    const step = yml.slice(stepStart, stepEnd === -1 ? undefined : stepEnd);

    expect(step).toContain('linksEnabled: true');
    // It must be an ERROR that aborts the job, not a warning.
    expect(step).toMatch(/::error::[^\n]*linksEnabled/);
    expect(step).toMatch(/exit 1/);
    // And nothing in the step may downgrade it to a non-fatal annotation.
    expect(step).not.toContain('::warning::');
  });

  test('requires production to be in live Stripe link mode, not test', () => {
    const yml = read('.github/workflows/release.yml');
    expect(yml).toContain('STRIPE_LINK_MODE');
    expect(yml).toMatch(/::error::[^\n]*live Stripe link mode/);
  });

  test('compares live index.html against main to catch silent drift', () => {
    const yml = read('.github/workflows/release.yml');
    expect(yml).toContain('window\\.STRIPE_LINK_MODE');
    expect(yml).toMatch(/diff -q/);
    // The pretty-URL rewrite must be normalized away or this fires constantly.
    expect(yml).toContain('.html');
  });
});

describe('PROD-4: production auto-merge stays disabled', () => {
  test('auto-merge only ever targets develop, never main', () => {
    const yml = read('.github/workflows/auto-merge.yml');
    expect(yml).toMatch(/branches:\s*\[develop\]/);
    // The trigger list must not include main — production merges are manual.
    expect(yml).not.toMatch(/branches:\s*\[[^\]]*\bmain\b[^\]]*\]/);
    expect(yml).toMatch(/NOT main/);
  });
});

describe('PROD-4: production deploy config keeps test links scoped to develop', () => {
  const netlifyToml = read('netlify.toml');

  test('site-wide default is live', () => {
    expect(netlifyToml).toMatch(/\[build\.environment\][\s\S]*?STRIPE_LINK_MODE\s*=\s*"live"/);
  });

  test('test links are scoped to develop and deploy-preview contexts only', () => {
    expect(netlifyToml).toMatch(/\[context\.develop\.environment\][\s\S]*?STRIPE_LINK_MODE\s*=\s*"test"/);
    expect(netlifyToml).toMatch(/\[context\.deploy-preview\.environment\][\s\S]*?STRIPE_LINK_MODE\s*=\s*"test"/);
    // No production context may override to test.
    expect(netlifyToml).not.toMatch(/\[context\.production\.environment\][\s\S]*?test/);
  });

  test('index.html ships with sandbox-gated purchase links (inactive on prod, live on test-mode deploys)', () => {
    const html = read('index.html');
    // 2026-10-06 (Auzi): sandbox activation — linksEnabled is mode-gated.
    // Prod (STRIPE_LINK_MODE 'live') still evaluates to false → CTAs disabled.
    expect(html).toMatch(/const PLANS = \{[\s\S]*?linksEnabled: AZ_STRIPE_LINK_MODE === 'test'/);
    expect(html).toMatch(/const SMS_ADDONS = \{[\s\S]*?linksEnabled: AZ_STRIPE_LINK_MODE === 'test'/);
  });
});