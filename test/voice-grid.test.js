// test/voice-grid.test.js — unit tests for js/voice-grid.js (PORTAL-VOICE,
// ticket zeus_1791392349706_48365890).
//
// The portal voice grid is pruned to a curated set (portal_display) while always
// keeping the client's configured voice visible, renders a region flag per
// voice, and surfaces a configured-voice identifier. These helpers are DOM-free
// so the behavior is pinned without a browser.

const VG = require('../js/voice-grid.js');

// ── fixtures ────────────────────────────────────────────────────────────────
function voice(id, over = {}) {
  return {
    id,
    label: id.charAt(0).toUpperCase() + id.slice(1),
    provider: 'openai',
    gender: 'female',
    region: 'global',
    regionLabel: 'Global',
    regionFlag: '🌐',
    portalDisplay: true,
    ...over,
  };
}

// A catalog shaped like /api/voices: 10 curated + 12 hidden, with regions.
const CURATED = ['alloy', 'marin', 'cedar', 'shimmer', 'echo', 'gleam', 'meridian', 'quartz', 'vesper', 'willow'];
const HIDDEN = ['ash', 'ballad', 'beacon', 'bossa', 'cinder', 'coral', 'delta', 'ripple', 'sage', 'stone', 'tempo', 'verse'];
const CATALOG = [
  ...CURATED.map(id => voice(id)),
  ...HIDDEN.map(id => voice(id, { portalDisplay: false })),
];

// ── grid pruning ────────────────────────────────────────────────────────────
describe('gridVoices: curated grid', () => {
  test('shows exactly the curated voices (portal_display)', () => {
    const out = VG.gridVoices(CATALOG, null);
    expect(out).toHaveLength(10);
    expect(new Set(out.map(v => v.id))).toEqual(new Set(CURATED));
  });

  test('keeps the configured voice visible even when outside the curated set', () => {
    const out = VG.gridVoices(CATALOG, 'beacon'); // beacon is hidden
    expect(out).toHaveLength(11);
    expect(out.map(v => v.id)).toContain('beacon');
  });

  test('does not duplicate the configured voice when it is already curated', () => {
    const out = VG.gridVoices(CATALOG, 'marin');
    expect(out).toHaveLength(10);
    expect(out.filter(v => v.id === 'marin')).toHaveLength(1);
  });

  test('falls back to every voice when the API sends no portal_display flag', () => {
    const unflagged = CATALOG.map(v => ({ ...v, portalDisplay: false, portal_display: false }));
    const out = VG.gridVoices(unflagged, null);
    expect(out).toHaveLength(22);
  });

  test('understands the raw snake_case portal_display field', () => {
    const raw = [
      { id: 'alloy', portal_display: true },
      { id: 'ash', portal_display: false },
    ];
    expect(VG.gridVoices(raw, null).map(v => v.id)).toEqual(['alloy']);
  });

  test('handles a missing/empty voice list', () => {
    expect(VG.gridVoices(null, null)).toEqual([]);
    expect(VG.gridVoices([], 'alloy')).toEqual([]);
  });
});

// ── region indicator ────────────────────────────────────────────────────────
describe('voiceRegion / regionBadgeHtml', () => {
  test('normalizes camelCase region fields', () => {
    expect(VG.voiceRegion(voice('vesper', { region: 'gb', regionLabel: 'English (British)', regionFlag: '🇬🇧' })))
      .toEqual({ code: 'gb', label: 'English (British)', flag: '🇬🇧' });
  });

  test('normalizes snake_case region fields', () => {
    const v = { id: 'quartz', region: 'au', region_label: 'English (Australian)', region_flag: '🇦🇺' };
    expect(VG.voiceRegion(v)).toEqual({ code: 'au', label: 'English (Australian)', flag: '🇦🇺' });
  });

  test('returns null for a voice with no region metadata', () => {
    expect(VG.voiceRegion({ id: 'x', label: 'X' })).toBeNull();
    expect(VG.voiceRegion(null)).toBeNull();
  });

  test('renders the flag with the region label as a tooltip', () => {
    const html = VG.regionBadgeHtml(voice('vesper', { region: 'gb', regionLabel: 'English (British)', regionFlag: '🇬🇧' }));
    expect(html).toContain('🇬🇧');
    expect(html).toContain('title="English (British)"');
    expect(html).toContain('class="voice-region"');
  });

  test('falls back to an upper-cased region code when no flag is present', () => {
    const html = VG.regionBadgeHtml({ id: 'x', region: 'us', region_label: 'US', region_flag: '' });
    expect(html).toContain('US');
  });

  test('returns empty string when the voice has no region', () => {
    expect(VG.regionBadgeHtml({ id: 'x', label: 'X' })).toBe('');
  });

  test('escapes the region label in the tooltip', () => {
    const html = VG.regionBadgeHtml({ id: 'x', region: 'us', region_label: 'A "quote"', region_flag: '🇺🇸' });
    expect(html).not.toContain('"A "quote""');
    expect(html).toContain('&quot;');
  });
});

// ── configured-voice identifier ─────────────────────────────────────────────
describe('configuredVoiceSummary', () => {
  test('names the configured voice with its region flag', () => {
    const s = VG.configuredVoiceSummary(CATALOG, 'gleam');
    expect(s).toContain('Configured voice:');
    expect(s).toContain('🌐'); // gleam fixture carries the global region
    expect(s).toContain('Gleam');
  });

  test('reflects a region flag from the voice', () => {
    const voices = [voice('vesper', { region: 'gb', regionLabel: 'English (British)', regionFlag: '🇬🇧' })];
    expect(VG.configuredVoiceSummary(voices, 'vesper')).toBe('Configured voice: 🇬🇧 Vesper');
  });

  test('returns empty string when no voice is configured', () => {
    expect(VG.configuredVoiceSummary(CATALOG, null)).toBe('');
    expect(VG.configuredVoiceSummary(CATALOG, 'nope')).toBe('');
  });
});

describe('escapeHtml', () => {
  test('escapes the five common characters', () => {
    expect(VG.escapeHtml(`<a href="x">&'</a>`))
      .toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
  });
  test('null/undefined become empty', () => {
    expect(VG.escapeHtml(null)).toBe('');
    expect(VG.escapeHtml(undefined)).toBe('');
  });
});
