// test/portal-overage-contract.test.js — OVERAGE-QA (series 5/5), UI side
//
// The dashboard is the 4/5 UI on top of the atlas-ai backend. This test PINS the
// cross-repo data contract between the two repos:
//
//   GET /portal/entitlements (atlas-ai)  →  portal.html render (auzora-website)
//     usage.included.{voice,sms}    ──►  per-section "Included N" tally
//     usage.overage.{voice,sms}     ──►  per-section "Overage N" tally
//     allow_overage.{voice,sms}     ──►  per-kind "Allow overages" checkbox
//
// If the backend renames/reshapes those fields, the atlas-ai QA suite
// (test/integration/overageLifecycle.e2e.test.js) and this test fail together —
// the UI can never silently drift from the tracking/enforcement surface it
// renders. renderUsageOverageControls is executed for real against a payload
// shaped exactly like the backend's response, not regex-matched.

const fs = require('fs');
const path = require('path');

const repoRoot = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(repoRoot, 'portal.html'), 'utf8');

function mainInlineScript() {
  const openTags = [];
  let idx = html.indexOf('<script>');
  while (idx !== -1) { openTags.push(idx); idx = html.indexOf('<script>', idx + 1); }
  const closes = [];
  let c = html.indexOf('</script>');
  while (c !== -1) { closes.push(c); c = html.indexOf('</script>', c + 1); }
  const open = openTags[0];
  const close = closes.find((cl) => cl > open);
  return html.slice(open + 8, close);
}

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

// The module-level OVERAGE_KINDS array (kind ⇄ tally/checkbox element ids).
function overageKinds() {
  const m = script.match(/const OVERAGE_KINDS = (\[[\s\S]*?\]);/);
  if (!m) throw new Error('OVERAGE_KINDS not found in portal.html');
  return new Function('return ' + m[1])();
}

// Build the real renderUsageOverageControls with a minimal document stub.
function buildRenderer(elements) {
  const documentStub = { getElementById: (id) => elements[id] || null };
  const factory = new Function(
    'document',
    'OVERAGE_KINDS',
    'overageTallyLabel',
    extractFunction(script, 'overageTallyLabel') + '\n' +
    extractFunction(script, 'renderUsageOverageControls') + '\n' +
    'return renderUsageOverageControls;'
  );
  return factory(documentStub, overageKinds(), new Function(
    'return (' + extractFunction(script, 'overageTallyLabel') + ')'
  )());
}

// A payload shaped EXACTLY like GET /portal/entitlements returns, using the
// values the atlas-ai lifecycle suite produced for its portal client
// (Basic + voice override 2, 4 min metered → 2 included / 2 overage).
function backendPayload(overrides = {}) {
  return {
    plan: 'Basic',
    tier: 'Basic',
    entitlements: {},
    usage: {
      voiceMinutes: 4,
      smsMessages: 0,
      limits: { voiceMinutes: 2, smsMessages: 0, tierKey: 'basic' },
      percentUsed: { voice: 200, sms: 0 },
      period: '2026-08',
      unlimited: false,
      included: { voice: 2, sms: 0 },
      overage: { voice: 2, sms: 0 },
      allowance: { voice: 2, sms: 0 },
      allowOverage: { voice: false, sms: false },
    },
    allow_overage: { voice: true, sms: false },
    ...overrides,
  };
}

function elementsFor() {
  const el = (id) => ({ id, textContent: '', checked: false });
  return {
    'usage-voice-tally': el('usage-voice-tally'),
    'usage-sms-tally': el('usage-sms-tally'),
    'usage-voice-overage': el('usage-voice-overage'),
    'usage-sms-overage': el('usage-sms-overage'),
  };
}

describe('dashboard ⇄ backend overage contract (OVERAGE-QA 5/5)', () => {
  test('OVERAGE_KINDS covers exactly voice + sms with their element ids', () => {
    expect(overageKinds().map((k) => k.kind).sort()).toEqual(['sms', 'voice']);
    const voice = overageKinds().find((k) => k.kind === 'voice');
    expect(voice).toEqual({ kind: 'voice', tallyId: 'usage-voice-tally', boxId: 'usage-voice-overage' });
  });

  test('renders the backend included/overage split into the section tallies', () => {
    const elements = elementsFor();
    buildRenderer(elements)(backendPayload());

    expect(elements['usage-voice-tally'].textContent).toBe('Included 2 · Overage 2');
    expect(elements['usage-sms-tally'].textContent).toBe('Included 0 · Overage 0');
  });

  test('checkbox state mirrors allow_overage per kind (kinds independent)', () => {
    const elements = elementsFor();
    buildRenderer(elements)(backendPayload({ allow_overage: { voice: true, sms: false } }));
    expect(elements['usage-voice-overage'].checked).toBe(true);
    expect(elements['usage-sms-overage'].checked).toBe(false);

    // Only the literal boolean true counts as opted-in (mirrors the backend
    // normalizeAllowOverage) — junk falls back to the firm-cap unchecked state.
    buildRenderer(elements)(backendPayload({ allow_overage: { voice: 'true', sms: 1 } }));
    expect(elements['usage-voice-overage'].checked).toBe(false);
    expect(elements['usage-sms-overage'].checked).toBe(false);
  });

  test('falls back to usage.allowOverage when the top-level pref is absent', () => {
    const elements = elementsFor();
    const payload = backendPayload({ allow_overage: undefined });
    payload.usage.allowOverage = { voice: true, sms: true };
    buildRenderer(elements)(payload);
    expect(elements['usage-voice-overage'].checked).toBe(true);
    expect(elements['usage-sms-overage'].checked).toBe(true);
  });

  test('is total-safe for an over-cap split (included + overage === total)', () => {
    const elements = elementsFor();
    buildRenderer(elements)(backendPayload());
    // The tally the dashboard shows for voice: 2 included + 2 overage = 4 total.
    expect(elements['usage-voice-tally'].textContent).toBe('Included 2 · Overage 2');
  });

  test('pins the exact payload field names the render reads (drift guard)', () => {
    // These identifiers are the cross-repo contract — the atlas-ai
    // GET /portal/entitlements handler emits each one.
    expect(script).toContain('usage.included');
    expect(script).toContain('usage.overage');
    expect(script).toContain('entitlementsPayload.allow_overage');
    expect(script).toContain('usage.allowOverage');
  });
});
