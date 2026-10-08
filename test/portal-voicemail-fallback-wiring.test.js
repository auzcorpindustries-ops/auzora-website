// test/portal-voicemail-fallback-wiring.test.js
// Ticket zeus_1791426284453_de548226.
//
// portal.html is a single-file app with no module boundary, so this file
// asserts the WIRING of the authored voicemail fallback into the settings
// screen: the toggle ships OFF by default, load/save round-trip both fields
// to the portal API, and the 20s script cap is surfaced to the client. A
// regression that quietly defaulted the toggle ON, dropped a field from the
// save payload, or removed the cap hint would fail here.
//
// The *behaviour* of the cap (estimate + word-boundary cut) and the dedup
// window live server-side and are covered by:
//   atlas-ai: test/unit/voicemailFallbackService.test.js
//   atlas-ai: test/unit/twilioHandler.test.js
//   atlas-ai: test/unit/amdVoicemail.test.js

const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'portal.html'), 'utf8');

// Body of a top-level function: from its declaration to the next top-level
// `function`/`async function` declaration.
function fnBody(name) {
  const start = html.indexOf('function ' + name + '(');
  expect(start).toBeGreaterThan(-1);
  const rest = html.slice(start + 1);
  const m = rest.search(/\n(async )?function /);
  return m === -1 ? rest : rest.slice(0, m);
}

describe('portal.html voicemail-fallback wiring', () => {
  test('the toggle exists and ships UNCHECKED (default off)', () => {
    const m = html.match(/<input[^>]*id="s-vm-fallback"[^>]*>/);
    expect(m).toBeTruthy();
    // Default-off is a hard requirement: no `checked` attribute in the markup.
    expect(m[0]).not.toMatch(/\bchecked\b/);
    // And the toggle drives the body show/hide.
    expect(m[0]).toContain('togglePortalVmFallback');
  });

  test('the authored-script textarea exists with a 1200-char input limit', () => {
    const m = html.match(/<textarea[^>]*id="s-vm-fallback-script"[^>]*>/);
    expect(m).toBeTruthy();
    expect(m[0]).toMatch(/maxLength="1200"/);
    expect(m[0]).toContain('updateVmFallbackEstimate');
  });

  test('loadSettings reads both fallback fields off the client record', () => {
    const body = fnBody('loadSettings');
    expect(body).toContain('c.voicemail_fallback_enabled === true');
    expect(body).toContain("getElementById('s-vm-fallback')");
    expect(body).toContain('c.voicemail_fallback_script');
  });

  test('saveSettings posts both fallback fields, enabled as a strict boolean', () => {
    const body = fnBody('saveSettings');
    // enabled must be `=== true` — never a truthy string that the backend's
    // strict opt-in gate (isFallbackArmed) would reject.
    expect(body).toMatch(/voicemail_fallback_enabled:\s*document\.getElementById\('s-vm-fallback'\)\?\.checked === true/);
    expect(body).toMatch(/voicemail_fallback_script:\s*document\.getElementById\('s-vm-fallback-script'\)\?\.value/);
  });

  test('togglePortalVmFallback shows the body only when enabled', () => {
    const body = fnBody('togglePortalVmFallback');
    expect(body).toContain("getElementById('s-vm-fallback').checked");
    expect(body).toContain("getElementById('s-vm-fallback-body')");
    expect(body).toContain("getElementById('s-vm-fallback-off')");
  });

  test('updateVmFallbackEstimate mirrors the server 20s cap and warns when over', () => {
    const body = fnBody('updateVmFallbackEstimate');
    // Same conservative rate + digit penalty as the backend service.
    expect(body).toContain('2.6');
    expect(body).toContain('digits * 0.35');
    // Over-cap scripts warn the client they will be trimmed at 20s.
    expect(body).toContain('seconds > 20');
    expect(body).toContain('trimmed to 20s');
  });
});
