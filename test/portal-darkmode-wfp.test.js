// test/portal-darkmode-wfp.test.js
// Ticket zeus_1791614562822_69348b48 — AUTOMATIONS-DARKMODE.
//
// The Automations "Customize" panel (the workflow-parameter editor rendered by
// renderWorkflowParams in portal.html) used to hardcode light-theme hexes on
// its cards, selects, number/time inputs and textarea, so in dark mode the
// panel showed dark text on dark fields and the native <select>/<input>
// pickers popped up white. This suite pins the fix:
//   * every field/dropdown in the editor resolves a THEME variable,
//   * the tokens the editor reads are actually DEFINED in :root and :root.dark,
//   * the light values stay byte-identical to the hexes it replaced, and
//   * each theme declares color-scheme so native pickers follow the theme.
//
// portal.html is a single-file app with no jsdom in this repo, so these are
// source assertions against the exact region/behaviour, matching the pattern
// already used by test/portal-automations-wiring.test.js.

const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'portal.html'), 'utf8');

// ── helpers ─────────────────────────────────────────────────────────────────
// Body of the Customize-panel renderer: its declaration to the next top-level
// section marker.
function wfpRegion() {
  const start = html.indexOf('function renderWorkflowParams(');
  expect(start).toBeGreaterThan(-1);
  const end = html.indexOf("// \u2500\u2500 Toggle a single timeline step's expand/collapse", start);
  expect(end).toBeGreaterThan(start);
  return html.slice(start, end);
}

// The `:root { ... }` block (light, default).
function rootBlock() {
  const start = html.indexOf(':root {');
  return html.slice(start, html.indexOf('}', start));
}

// The `:root.dark { ... }` block.
function darkBlock() {
  const start = html.indexOf(':root.dark {');
  return html.slice(start, html.indexOf('}', start));
}

// Custom properties DEFINED in a block (--name: value).
function definedVars(block) {
  const out = {};
  const re = /(--[a-z0-9-]+)\s*:\s*([^;]+);/gi;
  let m;
  while ((m = re.exec(block))) out[m[1]] = m[2].trim();
  return out;
}

// ── 1. theme tokens the editor depends on ───────────────────────────────────
describe('portal theme tokens for the Customize panel', () => {
  const FIELD_TOKENS = ['--field', '--field-border', '--border-strong'];

  test(':root defines the field + strong-border tokens', () => {
    const vars = definedVars(rootBlock());
    for (const t of FIELD_TOKENS) expect(vars[t]).toBeTruthy();
  });

  test(':root.dark overrides them so the panel is not light-on-dark', () => {
    const vars = definedVars(darkBlock());
    for (const t of FIELD_TOKENS) expect(vars[t]).toBeTruthy();
    // Dark fills are dark, dark borders are light-on-dark — never the light hexes.
    expect(vars['--field']).not.toMatch(/#f7f8fa|#fff/i);
    expect(vars['--field-border']).toMatch(/rgba\(255,\s*255,\s*255/);
    expect(vars['--border-strong']).toMatch(/rgba\(255,\s*255,\s*255/);
  });

  test('light mode is unchanged: tokens carry the exact hexes they replaced', () => {
    const vars = definedVars(rootBlock());
    expect(vars['--field']).toBe('#f7f8fa');
    expect(vars['--field-border']).toBe('rgba(16,24,38,0.14)');
    expect(vars['--border-strong']).toBe('rgba(16,24,38,0.18)');
  });

  test('every var(--token) the editor reads is defined by the theme', () => {
    const region = wfpRegion();
    const defined = { ...definedVars(rootBlock()), ...definedVars(darkBlock()) };
    const used = new Set();
    const re = /var\((--[a-z0-9-]+)\)/gi;
    let m;
    while ((m = re.exec(region))) used.add(m[1]);
    expect(used.size).toBeGreaterThan(0);
    for (const v of used) {
      expect({ token: v, defined: Boolean(defined[v]) }).toEqual({ token: v, defined: true });
    }
    // The panel really does use the field tokens (guards against a silent revert).
    expect(used.has('--field')).toBe(true);
    expect(used.has('--field-border')).toBe(true);
  });
});

// ── 2. native pickers follow the theme ──────────────────────────────────────
describe('color-scheme drives native select/time/number pickers', () => {
  test(':root declares light, :root.dark declares dark', () => {
    expect(rootBlock()).toMatch(/color-scheme:\s*light\s*;/);
    expect(darkBlock()).toMatch(/color-scheme:\s*dark\s*;/);
  });

  test('the dark class is what the toggle flips (color-scheme follows it)', () => {
    const start = html.indexOf('function applyTheme(');
    const body = html.slice(start, html.indexOf('\nfunction toggleTheme', start));
    expect(body).toContain("classList.toggle('dark', isDark)");
  });
});

// ── 3. the editor itself has no hardcoded light values left ─────────────────
describe('Customize panel renders no hardcoded light theme values', () => {
  const FORBIDDEN = [
    '#101826',            // --text (light)
    '#5f687a',            // --muted (light)
    '#9aa3b2',            // --faint (light)
    '#f7f8fa',            // field fill (light)
    '#fbfbfc',            // --panel (light)
    'background:#fff;',   // card / node fill (light)
    'rgba(16,24,38',      // every light border/tint it used
  ];

  test('no light hex survives in the panel renderer', () => {
    const region = wfpRegion();
    for (const bad of FORBIDDEN) {
      expect({ value: bad, present: region.includes(bad) }).toEqual({ value: bad, present: false });
    }
  });

  test('the time-of-day control uses themed field styling', () => {
    const region = wfpRegion();
    const timeInput = region.match(/<input type="time"[^>]*>/);
    expect(timeInput).toBeTruthy();
    expect(timeInput[0]).toContain('background:var(--field)');
    expect(timeInput[0]).toContain('border:1px solid var(--field-border)');
    expect(timeInput[0]).toContain('color:var(--text)');
  });

  test('the unit dropdown uses themed field styling', () => {
    const region = wfpRegion();
    const unitSelect = region.match(/<select id="[^"]*-unit"[^>]*>/);
    expect(unitSelect).toBeTruthy();
    expect(unitSelect[0]).toContain('background:var(--field)');
    expect(unitSelect[0]).toContain('color:var(--text)');
  });

  test('the message textarea + its counter are themed', () => {
    const region = wfpRegion();
    const textarea = region.match(/<textarea[^>]*>/);
    expect(textarea).toBeTruthy();
    expect(textarea[0]).toContain('background:var(--field)');
    expect(textarea[0]).toContain('color:var(--text)');
    const counter = region.match(/id="[^"]*-count"[^>]*>/);
    expect(counter).toBeTruthy();
    expect(counter[0]).toContain('color:var(--muted)');
  });

  test('step cards, timeline and preview use themed surfaces + borders', () => {
    const region = wfpRegion();
    expect(region).toContain('background:var(--panel)');            // step card
    expect(region).toContain('background:var(--surface)');          // inner card + node
    expect(region).toContain('border:1px solid var(--border)');     // card + chips
    expect(region).toContain('border-left:1px dashed var(--border-strong)'); // timeline
    expect(region).toContain('background:var(--tint)');             // merge-field chips
  });

  test('interactive state swaps use theme vars, not hexes', () => {
    const region = wfpRegion();
    expect(region).toContain("this.style.background='var(--tint)'");
    expect(region).toContain("this.style.color='var(--accent2)'");
    expect(region).toContain("this.style.color='var(--muted)'");
    expect(region).not.toMatch(/this\.style\.(color|background)='#/);
  });
});
