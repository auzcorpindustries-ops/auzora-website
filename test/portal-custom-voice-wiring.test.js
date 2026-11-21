// test/portal-custom-voice-wiring.test.js — CV-3
// (ticket zeus_1794504207719_52a3cee0; de-ElevenLabs CVX-3,
// zeus_1794610532814_36f2c999)
//
// Pins the portal.html Custom Voice section (Tone & Style) on its BINDING
// owner decisions:
//   • entitlement gate — the stored field voice_addon_elevenlabs ($49/mo,
//     NOT renamed/migrated) via portalTierVoices.elevenlabsAddon;
//     non-entitled clients get the locked hint, never the controls;
//   • CVX-3: Custom Voice is OpenAI-only on this surface — the provider
//     dropdown lists OpenAI ONLY and stays admin-assigned/display-only;
//   • CVX-3: a stored provider='elevenlabs' record renders the explicit
//     unsupported state (exact banner wording + stored voice id read-only);
//     the stored record is NEVER deleted or overwritten by a portal save —
//     every save path omits custom_voice while unsupported;
//   • CVX-3: no custom-voice preview surface remains (the server route was
//     removed in the core-removal ticket — the voice is heard on a live call);
//   • NO client-side API key entry anywhere in the section;
//   • save/load round-trip: voice_id + enabled (+ display-only provider)
//     only, loaded back from a has_api_key-projected custom_voice read;
//   • native voice grid untouched while custom voice is off; dimmed + guarded
//     while it is active (an ACTIVE custom voice is always an OpenAI one);
//   • grep gate: the only elevenlabs references left in portal.html are the
//     unsupported-state string, necessary stored-field reads, and comments.
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
    for (const id of ['s-cv-block', 's-cv-controls', 's-cv-locked', 's-cv-unsupported',
      's-cv-enabled', 's-cv-provider', 's-cv-voice-id', 's-cv-voice-id-hint',
      's-cv-save-btn', 's-cv-status', 's-cv-grid-note']) {
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

  test('provider dropdown lists OpenAI ONLY and stays disabled/display-only (CVX-3)', () => {
    // The provider is ADMIN-ASSIGNED: the select must remain disabled on the
    // portal surface, and OpenAI is the only assignable provider (CVX-3) —
    // no legacy-provider option remains in the list.
    const section = cvSectionHtml();
    expect(section).toContain('<option value="openai">OpenAI GPT-Live</option>');
    expect(section).not.toContain('<option value="elevenlabs">');
    const selectTag = section.match(/<select id="s-cv-provider"[^>]*>/)[0];
    expect(selectTag).toMatch(/\bdisabled\b/);
  });

  test('the voice-id input + hint carry the OpenAI wording (CVX-3)', () => {
    const section = cvSectionHtml();
    // No legacy example/placeholder remains.
    expect(section).not.toContain('uMM5TEnpKKgD758knVJO');
    expect(section).toContain('placeholder="e.g. my-openai-custom-voice"');
    expect(section).toContain('Your custom Voice ID from OpenAI GPT-Live (1-200 printable characters).');
  });

  test('the entitlement upsell block frames Custom Voice, not a provider name (CVX-3)', () => {
    const section = cvSectionHtml();
    expect(section).toContain('$49/mo add-on');
    expect(section).toContain('Bring your own custom voice');
    expect(section).not.toContain('Bring your own ElevenLabs voice');
    expect(section).toContain('mailto:ahoward@auzora.io');
  });

  test('no Test-voice control remains (CVX-3 — the server route was removed)', () => {
    const section = cvSectionHtml();
    expect(section).not.toContain('s-cv-preview-btn');
    expect(section).toContain('place a test call to hear it');
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

  test('the status line renders the has_api_key projection as text, never a key value', () => {
    const body = fnBody('updateCustomVoiceStatus');
    expect(body).toContain('has_api_key');
    expect(body).toContain('key configured');
    expect(body).toContain('awaiting operator key');
    // CVX-3: unsupported records render the banner, not a status line.
    expect(body).toContain('isCustomVoiceUnsupported()');
  });
});

describe('CV-3: entitlement gate (stored field voice_addon_elevenlabs — NOT renamed)', () => {
  test('isCustomVoiceEntitled() reads portalTierVoices.elevenlabsAddon', () => {
    const body = fnBody('isCustomVoiceEntitled');
    expect(body).toContain('portalTierVoices');
    expect(body).toContain('elevenlabsAddon === true');
  });

  test('applyCustomVoiceEntitlementGate() flips between the THREE states (CVX-3)', () => {
    const body = fnBody('applyCustomVoiceEntitlementGate');
    expect(body).toContain('s-cv-controls');
    expect(body).toContain('s-cv-locked');
    expect(body).toContain('s-cv-unsupported');
    expect(body).toContain('entitled');
    // Unsupported takes precedence over entitlement.
    expect(body).toContain('isCustomVoiceUnsupported()');
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

describe('CVX-3: stored legacy-provider records render the unsupported state', () => {
  test('isCustomVoiceUnsupported() detects the stored record — read-only detection', () => {
    const body = fnBody('isCustomVoiceUnsupported');
    expect(body).toContain("=== 'elevenlabs'");
    // Detection only: no write/delete of the record from this function.
    expect(body).not.toMatch(/delete|save|patch/i);
  });

  test('the banner carries the EXACT unsupported-state wording', () => {
    const body = fnBody('renderCustomVoiceUnsupportedState');
    expect(body).toContain('no longer supported');
    expect(body).toContain('your calls use the native AI voice');
    expect(body).toContain('Your saved configuration has not been deleted.');
  });

  test('the stored voice id is shown READ-ONLY (textContent, never prefilled/deleted)', () => {
    const body = fnBody('renderCustomVoiceUnsupportedState');
    expect(body).toContain('Stored voice ID (read-only)');
    // textContent — never interpolated into HTML.
    expect(body).toContain('stored.textContent');
    expect(body).not.toMatch(/stored\.innerHTML/);
    // Hydration must NOT prefill the stored id into the editable input.
    const hydrate = fnBody('hydrateCustomVoiceControls');
    expect(hydrate).toContain("(!unsupported && cv && cv.voice_id) || ''");
    // …and must not check the enable box for an unsupported record.
    expect(hydrate).toContain('enabledEl.checked = !!(cv && cv.enabled === true && !unsupported)');
  });

  test('saveCustomVoice() refuses to touch an unsupported record', () => {
    const body = fnBody('saveCustomVoice');
    expect(body).toContain('if (isCustomVoiceUnsupported()) return;');
  });

  test('the global Save and Apply omits custom_voice for unsupported records', () => {
    const body = fnBody('saveSettings');
    expect(body).toContain('custom_voice:');
    // entitled AND supported — a stored legacy record is never overwritten.
    expect(body).toContain('(isCustomVoiceEntitled() && !isCustomVoiceUnsupported()) ? buildCustomVoicePayload() : undefined');
  });

  test('isCustomVoiceActive() mirrors the server resolver: enabled AND provider openai', () => {
    const body = fnBody('isCustomVoiceActive');
    expect(body).toContain('portalClient');
    expect(body).toContain('enabled === true');
    expect(body).toContain("'openai'");
  });

  test('the active-grid note names OpenAI (no provider ternary left)', () => {
    const body = fnBody('syncCustomVoiceGridState');
    expect(body).toContain("grid.classList.toggle('cv-dim', active)");
    expect(body).toContain('s-cv-grid-note');
    expect(body).toContain('OpenAI GPT-Live');
    expect(body).not.toContain("'ElevenLabs'");
  });
});

describe('CV-3: save/load round-trip', () => {
  test('loadSettings() hydrates the section from the saved record', () => {
    const body = fnBody('loadSettings');
    expect(body).toContain('hydrateCustomVoiceControls()');
  });

  test('hydrateCustomVoiceControls() reads the record and re-applies the gate', () => {
    const body = fnBody('hydrateCustomVoiceControls');
    expect(body).toContain('portalClient');
    expect(body).toContain('custom_voice');
    // CVX-3: provider display is pinned to the only supported value.
    expect(body).toContain("providerEl.value = 'openai'");
    expect(body).toContain('applyCustomVoiceEntitlementGate()');
  });

  test('saveCustomVoice() PATCHes ONLY custom_voice to /portal/settings', () => {
    const body = fnBody('saveCustomVoice');
    expect(body).toContain('/portal/settings');
    expect(body).toContain("'PATCH'");
    // custom_voice stays the ONLY config field in the payload (single-field
    // saves cannot clobber sibling sections). base_config_rev is the
    // conflict-guard envelope key (zeus_1794558702500_c68613eb), not config.
    expect(body).toContain('custom_voice: buildCustomVoicePayload()');
    expect(body).toContain('base_config_rev: portalClient?.config_rev');
    // shape gate before save: enabling without a valid voice id is blocked.
    // CVX-3: OpenAI is the only assignable provider — the openai rule
    // (1-200 printable characters) is THE validation toast.
    expect(body).toContain('cvVoiceIdValidForProvider(provider, voiceId)');
    expect(body).toContain('Enter a valid OpenAI GPT-Live custom Voice ID (1-200 printable characters) before saving.');
    expect(body).not.toContain('10-40');
  });

  test('the client-side voice-id shape gate mirrors the server openai rule (1-200 printable)', () => {
    expect(code).toContain('/^[!-~]{1,200}$/');
    // The legacy 10-40 alphanumeric gate is gone.
    expect(code).not.toContain('{10,40}');
    expect(code).not.toContain('CV_VOICE_ID_RE_BY_PROVIDER');
    // …and no provider fallback can silently reintroduce the legacy default.
    expect(code).not.toContain("|| 'elevenlabs'");
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

  test('selectPortalVoice() is guarded while custom voice is active', () => {
    const body = fnBody('selectPortalVoice');
    expect(body).toContain('if (isCustomVoiceActive()) return;');
  });

  test('the native grid renders the OpenAI catalog only (CVX-3)', () => {
    const body = fnBody('renderPortalVoiceGrid');
    expect(body).toContain("VOICES.filter(v => v.provider === 'openai')");
    // The legacy-provider grid section is dead code — catalog is OpenAI-only.
    expect(body).not.toContain('legacyElevenLabsVoices');
    expect(body).not.toContain('Legacy Voices');
  });

  test('no reference to the removed custom-voice preview route remains anywhere', () => {
    // CVX-1 removed POST /portal/custom-voice-preview (it 404s now); the
    // portal must not call a dead route.
    expect(portalHtml).not.toContain('custom-voice-preview');
    expect(code).not.toContain('playCustomVoicePreview');
  });
});

describe('CVX-3: grep gate', () => {
  test('the only elevenlabs references left are the banner string, necessary stored-field reads, and comments', () => {
    const lines = portalHtml.split('\n');
    const hits = [];
    let inHtmlComment = false;
    lines.forEach((line, i) => {
      const wasInComment = inHtmlComment;
      if (line.includes('<!--')) inHtmlComment = true;
      if (line.includes('-->')) inHtmlComment = false;
      const isComment = wasInComment || inHtmlComment
        || line.includes('<!--') || line.includes('-->')
        || /(^|[^:])\/\/|\/\*|^\s*\*/.test(line); // JS comment
      if (/elevenlabs/i.test(line)) hits.push({ line: i + 1, text: line, isComment });
    });
    expect(hits.length).toBeGreaterThan(0);
    const offenders = hits.filter(h => !h.isComment
      && !/no longer supported|has not been deleted/.test(h.text) // the unsupported-state string
      && !/voice_addon_elevenlabs/.test(h.text)                   // stored entitlement field (NOT renamed)
      && !/elevenlabsAddon/.test(h.text)                          // entitlements payload field
      && !/=== 'elevenlabs'/.test(h.text));                       // stored-record detection (data-level)
    expect(offenders).toEqual([]);
  });
});

describe('portal.html — syntax', () => {
  test('the inline scripts still parse as valid JavaScript', () => {
    for (const [i, s] of scripts.entries()) {
      expect(() => new vm.Script(s, { filename: `portal.html#${i}` })).not.toThrow();
    }
  });
});
