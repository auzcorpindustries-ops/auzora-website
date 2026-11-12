// test/portal-custom-voice-wiring.test.js — CV-3
// (ticket zeus_1794504207719_52a3cee0)
//
// Pins the portal.html Custom Voice section (Tone & Style) on its BINDING
// owner decisions:
//   • entitlement gate — voice_addon_elevenlabs ($49/mo) via
//     portalTierVoices.elevenlabsAddon; non-entitled clients get the locked
//     hint, never the controls;
//   • NO client-side API key entry anywhere in the section (operator-only
//     provisioning, CV-1/CV-3 binding decision);
//   • save/load round-trip: voice_id + enabled (+provider label) only, loaded
//     back from a has_api_key-projected custom_voice read;
//   • native voice grid untouched while custom voice is off; dimmed + guarded
//     while it is active;
//   • test-voice rides POST /portal/custom-voice-preview (server-side synth).
//
// Static-markup assertions following the convention of admin-voice-flags.test.js
// (jsdom is not a dependency of this repo) plus a vm.Script syntax pass over
// every inline script block.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const repoRoot = path.join(__dirname, '..');
const portalHtml = fs.readFileSync(path.join(repoRoot, 'portal.html'), 'utf8');

const scripts = [];
const scriptRe = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
let m;
while ((m = scriptRe.exec(portalHtml)) !== null) scripts.push(m[1]);
const code = scripts.join('\n');

function fnBody(name) {
  const start = code.indexOf(`function ${name}`);
  expect(start).toBeGreaterThan(-1);
  const rest = code.slice(start + 1);
  // boundary: the next function declaration (plain OR async)
  const endPlain = rest.indexOf('\nfunction ');
  const endAsync = rest.indexOf('\nasync function ');
  const ends = [endPlain, endAsync].filter(i => i !== -1);
  const end = ends.length ? Math.min(...ends) : -1;
  return rest.slice(0, end === -1 ? rest.length : end);
}

// The Custom Voice section markup (from its comment to the Call Script card).
function cvSectionHtml() {
  const start = portalHtml.indexOf('id="s-cv-block"');
  expect(start).toBeGreaterThan(-1);
  const sectionStart = portalHtml.lastIndexOf('<!-- ── Custom Voice', start);
  const end = portalHtml.indexOf('<!-- Call Script -->', start);
  return portalHtml.slice(sectionStart === -1 ? start : sectionStart, end);
}

describe('CV-3: the Custom Voice section exists inside Tone & Style', () => {
  test('section block + all control ids are present', () => {
    for (const id of ['s-cv-block', 's-cv-controls', 's-cv-locked', 's-cv-enabled',
      's-cv-provider', 's-cv-voice-id', 's-cv-voice-id-hint',
      's-cv-preview-btn', 's-cv-save-btn', 's-cv-status', 's-cv-grid-note']) {
      expect(portalHtml).toContain(`id="${id}"`);
    }
  });

  test('the section lives inside the Tone & Style card (before Call Script)', () => {
    const toneIdx = portalHtml.indexOf('data-collapse-key="agent-tone-style"');
    const cvIdx = portalHtml.indexOf('id="s-cv-block"');
    const callScriptIdx = portalHtml.indexOf('data-collapse-key="agent-call-script"');
    expect(toneIdx).toBeGreaterThan(-1);
    expect(cvIdx).toBeGreaterThan(toneIdx);
    expect(cvIdx).toBeLessThan(callScriptIdx);
  });

  test('provider dropdown offers exactly ElevenLabs for now', () => {
    const section = cvSectionHtml();
    expect(section).toContain('<option value="elevenlabs">ElevenLabs</option>');
    expect(section).not.toMatch(/<option value="(?!elevenlabs)/);
  });
});

describe('CV-3: NO client-side API key entry (operator-only, binding)', () => {
  test('the section markup has no password/credential input', () => {
    const section = cvSectionHtml();
    expect(section).not.toMatch(/type="password"/i);
    expect(section).not.toMatch(/api[_-]?key/i);
  });

  test('buildCustomVoicePayload() carries enabled/provider/voice_id — and nothing secret', () => {
    const body = fnBody('buildCustomVoicePayload');
    expect(body).toContain("document.getElementById('s-cv-enabled').checked");
    expect(body).toContain("document.getElementById('s-cv-provider').value");
    expect(body).toContain("document.getElementById('s-cv-voice-id').value.trim()");
    expect(body).not.toMatch(/api[_-]?key/i);
    expect(body).not.toMatch(/password/i);
  });

  test('playCustomVoicePreview() posts only { voice_id? } — never a key', () => {
    const body = fnBody('playCustomVoicePreview');
    expect(body).toContain('/portal/custom-voice-preview');
    expect(body).toContain('voiceId ? { voice_id: voiceId } : {}');
    expect(body).not.toMatch(/api[_-]?key/i);
  });

  test('the status line renders the has_api_key projection as text, never a key value', () => {
    const body = fnBody('updateCustomVoiceStatus');
    expect(body).toContain('has_api_key');
    expect(body).toContain('key configured');
    expect(body).toContain('awaiting operator key');
  });
});

describe('CV-3: entitlement gate (voice_addon_elevenlabs)', () => {
  test('isCustomVoiceEntitled() reads portalTierVoices.elevenlabsAddon', () => {
    const body = fnBody('isCustomVoiceEntitled');
    expect(body).toContain('portalTierVoices');
    expect(body).toContain('elevenlabsAddon === true');
  });

  test('applyCustomVoiceEntitlementGate() flips controls vs locked hint', () => {
    const body = fnBody('applyCustomVoiceEntitlementGate');
    expect(body).toContain('s-cv-controls');
    expect(body).toContain('s-cv-locked');
    expect(body).toContain('entitled');
  });

  test('the locked hint carries the $49/mo copy + upgrade CTA (Call-a-Lead pattern)', () => {
    const section = cvSectionHtml();
    expect(section).toContain('$49/mo add-on');
    expect(section).toContain('mailto:ahoward@auzora.io');
  });

  test('the gate re-applies on entitlements fetch AND on session-cache restore', () => {
    const fetchBody = fnBody('fetchEntitlements');
    expect(fetchBody).toContain('applyCustomVoiceEntitlementGate()');
    // init restore path: the savedTierVoices hydration calls it too
    const restoreIdx = code.indexOf("sessionStorage.getItem('atlas_tier_voices')");
    expect(restoreIdx).toBeGreaterThan(-1);
    const after = code.slice(restoreIdx, restoreIdx + 800);
    expect(after).toContain('applyCustomVoiceEntitlementGate()');
  });
});

describe('CV-3: save/load round-trip', () => {
  test('loadSettings() hydrates the section from the saved record', () => {
    const body = fnBody('loadSettings');
    expect(body).toContain('hydrateCustomVoiceControls()');
  });

  test('hydrateCustomVoiceControls() reads provider/voice_id/enabled from custom_voice', () => {
    const body = fnBody('hydrateCustomVoiceControls');
    expect(body).toContain('portalClient');
    expect(body).toContain('custom_voice');
    expect(body).toContain("enabledEl.checked = !!(cv && cv.enabled === true)");
    expect(body).toContain("(cv && cv.voice_id) || ''");
    expect(body).toContain("(cv && cv.provider) || 'elevenlabs'");
  });

  test('saveCustomVoice() PATCHes ONLY custom_voice to /portal/settings', () => {
    const body = fnBody('saveCustomVoice');
    expect(body).toContain('/portal/settings');
    expect(body).toContain("'PATCH'");
    expect(body).toContain("JSON.stringify({ custom_voice: buildCustomVoicePayload() })");
    // shape gate before save: enabling without a valid voice id is blocked
    expect(body).toContain('CV_VOICE_ID_RE.test(voiceId)');
  });

  test('the global Save and Apply carries custom_voice only for entitled clients', () => {
    const body = fnBody('saveSettings');
    expect(body).toContain('custom_voice:');
    expect(body).toContain('isCustomVoiceEntitled() ? buildCustomVoicePayload() : undefined');
  });

  test('the client-side voice-id shape gate mirrors the server (10-40 alnum)', () => {
    expect(code).toContain('/^[a-zA-Z0-9]{10,40}$/');
  });
});

describe('CV-3: native voice grid dimming + guard', () => {
  test('the dim CSS class exists and the note sits above the grid', () => {
    expect(portalHtml).toContain('.voice-grid.cv-dim');
    expect(portalHtml).toMatch(/opacity:\s*\.45[^}]*pointer-events:\s*none/s);
    const noteIdx = portalHtml.indexOf('id="s-cv-grid-note"');
    const gridIdx = portalHtml.indexOf('id="portal-voice-grid"');
    expect(noteIdx).toBeGreaterThan(-1);
    expect(noteIdx).toBeLessThan(gridIdx);
  });

  test('syncCustomVoiceGridState() toggles the class from the SAVED state', () => {
    const body = fnBody('syncCustomVoiceGridState');
    expect(body).toContain("grid.classList.toggle('cv-dim', active)");
    expect(body).toContain('s-cv-grid-note');
  });

  test('isCustomVoiceActive() reads enabled off the saved record', () => {
    const body = fnBody('isCustomVoiceActive');
    expect(body).toContain('portalClient');
    expect(body).toContain('enabled === true');
  });

  test('selectPortalVoice() is guarded while custom voice is active', () => {
    const body = fnBody('selectPortalVoice');
    expect(body).toContain('if (isCustomVoiceActive()) return;');
  });
});

describe('portal.html — syntax', () => {
  test('the inline scripts still parse as valid JavaScript', () => {
    for (const [i, s] of scripts.entries()) {
      expect(() => new vm.Script(s, { filename: `portal.html#${i}` })).not.toThrow();
    }
  });
});
