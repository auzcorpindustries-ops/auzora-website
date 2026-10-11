// test/portal-overage-ui.test.js — OVERAGE-UI (4/5): the dashboard Plan & Usage
// card's per-section included-vs-overage tallies and the independent per-kind
// "Allow overages" checkboxes (voice and SMS).
//
// This is the UI layer on top of two merged backend pieces:
//   - OVERAGE-ENFORCE (1/5): per-kind allow_overage client pref + the
//     PATCH /portal/usage/overage writer (boolean-validated, partial-merge).
//   - OVERAGE-TRACK   (2/5): the per-period usage.included / usage.overage split
//     (invariant: included + overage === total).
//
// These tests pin: each section owns its own toggle + tally; the toggles are
// wired to the persisted per-kind preference; the PATCH payload carries exactly
// ONE kind (independence); a failed write reverts the checkbox; and the control
// uses the native dashboard checkbox styling (no new framework/custom control).

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

// Extract a named top-level function's source (brace-matched) so pure helpers
// can be exercised for real, not merely regex-matched.
function extractFunction(src, name) {
  const start = src.indexOf('function ' + name + '(');
  if (start === -1) return null;
  const braceStart = src.indexOf('{', start);
  let depth = 0;
  for (let i = braceStart; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  return null;
}

const script = mainInlineScript();

describe('portal.html overage controls markup (OVERAGE-UI 4/5)', () => {
  test('each usage section carries its OWN toggle and tally', () => {
    expect(html).toContain('id="usage-voice-overage"');
    expect(html).toContain('id="usage-sms-overage"');
    expect(html).toContain('id="usage-voice-tally"');
    expect(html).toContain('id="usage-sms-tally"');
    // Two independent "Allow overages" labels — one per section, not a shared one.
    expect((html.match(/Allow overages\s*<\/label>/g) || []).length).toBe(2);
    expect((html.match(/<label class="usage-overage-toggle"/g) || []).length).toBe(2);
  });

  test('controls live inside #usage-bars, voice section before SMS section', () => {
    const barsStart = html.indexOf('id="usage-bars"');
    const barsEnd = html.indexOf('id="usage-sms-addon"'); // renders after the bars
    const voiceBox = html.indexOf('id="usage-voice-overage"');
    const smsBox = html.indexOf('id="usage-sms-overage"');
    expect(barsStart).toBeGreaterThan(-1);
    expect(voiceBox).toBeGreaterThan(barsStart);
    expect(smsBox).toBeGreaterThan(voiceBox);
    expect(smsBox).toBeLessThan(barsEnd);
  });

  test('each checkbox is bound to its own kind via onchange', () => {
    expect(html).toContain("onchange=\"toggleAllowOverage('voice', this.checked)\"");
    expect(html).toContain("onchange=\"toggleAllowOverage('sms', this.checked)\"");
  });

  test('labels are associated with the checkbox (accessible native control)', () => {
    expect(html).toContain('<label class="usage-overage-toggle" for="usage-voice-overage">');
    expect(html).toContain('<label class="usage-overage-toggle" for="usage-sms-overage">');
  });
});

describe('portal.html overage render wiring (OVERAGE-UI 4/5)', () => {
  test('renderUsageCard invokes renderUsageOverageControls with the payload', () => {
    expect(script).toContain('function renderUsageOverageControls(entitlementsPayload)');
    expect(script).toMatch(/anyOver\) card\.classList\.add\('over'\);[^]*?renderUsageOverageControls\(entitlementsPayload\);/);
  });

  test('tallies read the 2/5 included/overage split (not a recomputed guess)', () => {
    expect(script).toMatch(/usage\.included \|\| \{\}/);
    expect(script).toMatch(/usage\.overage \|\| \{\}/);
    expect(script).toMatch(/overageTallyLabel\(included\[k\.kind\], overage\[k\.kind\]\)/);
  });

  test('checkbox state comes from the persisted per-kind pref (with usage fallback)', () => {
    expect(script).toMatch(/entitlementsPayload\.allow_overage\) \|\| usage\.allowOverage/);
    // only the literal boolean true counts as opted-in (mirrors normalizeAllowOverage)
    expect(script).toMatch(/allow\[k\.kind\] === true/);
  });
});

describe('portal.html allow-overage persistence (OVERAGE-UI 4/5 → 1/5 route)', () => {
  test('toggleAllowOverage PATCHes the per-kind endpoint with the portal token', () => {
    expect(script).toContain('async function toggleAllowOverage(kind, checked)');
    expect(script).toMatch(/fetch\(`\$\{API\}\/portal\/usage\/overage`/);
    expect(script).toMatch(/method: 'PATCH'/);
    expect(script).toMatch(/'X-Portal-Token': portalToken/);
  });

  test('payload carries EXACTLY ONE kind (toggles are independent)', () => {
    expect(script).toMatch(/JSON\.stringify\(\{ \[kind\]: desired \}\)/);
    // nothing co-writes the other kind
    expect(script).not.toMatch(/JSON\.stringify\(\{ voice: desired, sms: desired \}\)/);
  });

  test('a failed write reverts the checkbox (UI never misreports enforcement)', () => {
    expect(script).toMatch(/catch \(e\) \{\s*if \(boxEl\) boxEl\.checked = !desired;/);
  });

  test('a successful write reflects the server-normalized value', () => {
    expect(script).toMatch(/typeof stored\[kind\] === 'boolean'\) boxEl\.checked = stored\[kind\]/);
  });
});

describe('portal.html overage styling is native (no new framework/control)', () => {
  test('checkbox reuses the dashboard native checkbox style (accent-color, 16px)', () => {
    expect(html).toMatch(/id="usage-voice-overage" onchange="toggleAllowOverage\('voice', this\.checked\)" style="accent-color:var\(--accent\);width:16px;height:16px;"/);
    expect(html).toMatch(/id="usage-sms-overage" onchange="toggleAllowOverage\('sms', this\.checked\)" style="accent-color:var\(--accent\);width:16px;height:16px;"/);
  });

  test('new CSS extends the existing .usage-card scope only', () => {
    expect(html).toContain('.usage-row-meta {');
    expect(html).toContain('.usage-overage-tally {');
    expect(html).toContain('.usage-overage-toggle {');
    // no custom switch widget / framework classes introduced
    expect(html).not.toContain('usage-overage-switch');
  });
});

describe('overageTallyLabel (pure logic)', () => {
  const src = extractFunction(script, 'overageTallyLabel');
  const fn = new Function('return (' + src + ')')();

  test('renders the included vs overage amounts for a section', () => {
    expect(fn(1250, 30)).toBe('Included 1,250 · Overage 30');
    expect(fn(2500, 0)).toBe('Included 2,500 · Overage 0');
  });

  test('is total-safe for empty / missing values', () => {
    expect(fn(0, 0)).toBe('Included 0 · Overage 0');
    expect(fn(undefined, undefined)).toBe('Included 0 · Overage 0');
  });

  test('coerces numeric strings', () => {
    expect(fn('2500', '5')).toBe('Included 2,500 · Overage 5');
  });
});

describe('portal.html inline script integrity (OVERAGE-UI 4/5)', () => {
  test('main inline script still compiles', () => {
    expect(() => { new Function(script); }).not.toThrow();
  });
});
