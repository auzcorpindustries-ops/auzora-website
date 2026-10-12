// test/admin-voice-flags.test.js — VOICE-FLAGS
// (ticket zeus_1791757385758_04d6dc05).
//
// The US flag for the five US-English shared Realtime voices (alloy, marin,
// shimmer, cedar, echo — the globe before) is a REGION-MAP change on the
// backend (voiceCatalog.js), and both portal surfaces render it from the shared
// /api/voices payload. portal.html already maps region -> cameraCase and renders
// the badge via js/voice-grid.js; admin.html must do the same, so this file
// pins the admin side:
//   - the page loads the SAME shared helper the client portal uses;
//   - loadVoices() carries region/regionLabel/regionFlag off the payload;
//   - renderAdminVoiceGrid() renders the badge next to the voice label;
//   - the whole inline script still parses as valid JavaScript.
//
// Static-markup assertions following the convention of
// admin-sms-approvals.test.js (jsdom is not a dependency of this repo) plus a
// vm.Script syntax pass over every inline script block.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const repoRoot = path.join(__dirname, '..');
const adminHtml = fs.readFileSync(path.join(repoRoot, 'admin.html'), 'utf8');
const portalHtml = fs.readFileSync(path.join(repoRoot, 'portal.html'), 'utf8');

const scripts = [];
const scriptRe = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
let m;
while ((m = scriptRe.exec(adminHtml)) !== null) scripts.push(m[1]);
const code = scripts.join('\n');

function fnBody(name) {
  const start = code.indexOf(`function ${name}`);
  expect(start).toBeGreaterThan(-1);
  const rest = code.slice(start + 1);
  const end = rest.indexOf('\nfunction ');
  return rest.slice(0, end === -1 ? rest.length : end);
}

describe('VOICE-FLAGS: admin portal renders the region flag from the shared payload', () => {
  test('admin.html loads the SAME shared helper as the client portal', () => {
    expect(adminHtml).toContain('<script src="js/voice-grid.js"></script>');
    // both surfaces drive one helper, not two divergent implementations
    expect(portalHtml).toContain('<script src="js/voice-grid.js"></script>');
  });

  test('the region flag has a style rule (parity with portal.html)', () => {
    expect(adminHtml).toMatch(/\.voice-region\s*\{[^}]*cursor:\s*help/);
    expect(portalHtml).toMatch(/\.voice-region\s*\{[^}]*cursor:\s*help/);
  });

  test('loadVoices() carries the region fields off /api/voices (snake_case on the wire)', () => {
    const body = fnBody('loadVoices');
    expect(body).toContain('region: v.region || null');
    expect(body).toContain("regionLabel: v.region_label || v.regionLabel || ''");
    expect(body).toContain("regionFlag: v.region_flag || v.regionFlag || ''");
  });

  test('renderAdminVoiceGrid() renders the badge next to the voice label', () => {
    const body = fnBody('renderAdminVoiceGrid');
    expect(body).toContain('${adminRegionBadge(v)}');
    // inside the name wrap, before the Default voice badge
    const nameWrap = body.slice(body.indexOf('voice-name-wrap'));
    expect(nameWrap).toContain('adminRegionBadge(v)');
    expect(nameWrap.indexOf('adminRegionBadge(v)')).toBeLessThan(nameWrap.indexOf('Default voice'));
  });

  test('adminRegionBadge() prefers the shared helper and falls back to the payload flag', () => {
    const body = fnBody('adminRegionBadge');
    expect(body).toContain('window.VoiceGrid');
    expect(body).toContain('window.VoiceGrid.regionBadgeHtml(v)');
    // the fallback still renders the flag from the payload, escaped tooltip
    expect(body).toContain('v.regionFlag || v.region_flag');
    expect(body).toContain('&quot;');
  });
});

// The helper renders the badge for the 5 US voices (region_flag '🇺🇸') and the
// globe for the locale-neutral ones — the shape /api/voices actually serves.
describe('VOICE-FLAGS: shared helper renders the US flag for the 5 US voices', () => {
  const VG = require('../js/voice-grid.js');
  const US = { region: 'us', region_label: 'English (U.S.)', region_flag: '🇺🇸' };
  const GLOBAL = { region: 'global', region_label: 'Global', region_flag: '🌐' };

  test('alloy/marin/shimmer/cedar/echo render the US flag on both surfaces', () => {
    for (const id of ['alloy', 'marin', 'shimmer', 'cedar', 'echo']) {
      const v = Object.assign({ id, label: id }, US);
      const html = VG.regionBadgeHtml(v);
      expect(html).toContain('🇺🇸');
      expect(html).toContain('title="English (U.S.)"');
      expect(html).toContain('class="voice-region"');
    }
  });

  test('locale-neutral Realtime voices keep the globe', () => {
    for (const id of ['ash', 'ballad', 'coral', 'sage', 'verse']) {
      const v = Object.assign({ id, label: id }, GLOBAL);
      expect(VG.regionBadgeHtml(v)).toContain('🌐');
    }
  });

  test('the configured-voice summary shows the US flag', () => {
    const voices = [Object.assign({ id: 'alloy', label: 'Alloy' }, US)];
    expect(VG.configuredVoiceSummary(voices, 'alloy')).toBe('Configured voice: 🇺🇸 Alloy');
  });
});

describe('admin.html — syntax', () => {
  test('the inline scripts still parse as valid JavaScript', () => {
    for (const [i, s] of scripts.entries()) {
      expect(() => new vm.Script(s, { filename: `admin.html#${i}` })).not.toThrow();
    }
  });
});
