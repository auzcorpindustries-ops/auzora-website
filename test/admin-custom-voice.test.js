// test/admin-custom-voice.test.js — CVX-2 (ticket zeus_1794610530060_59116dba)
//
// Pins the de-ElevenLabs admin surface (owner directive 2026-11-13: refocus
// Custom Voice on OpenAI; the per-client key route was removed server-side
// in the core-removal ticket CVX-1):
//   • the ElevenLabs usage card is gone from loadLiveCosts();
//   • the per-client edit modal: provider dropdown lists OpenAI only; the
//     ElevenLabs API key manager UI is REMOVED and no surface calls the
//     removed /custom-voice-key route (would 404);
//   • stored provider='elevenlabs' clients render the explicit unsupported
//     state — exact owner wording, stored config shown read-only, never
//     deleted, and a save without an OpenAI assignment never overwrites the
//     preserved record;
//   • the entitlement toggle keeps the stored field voice_addon_elevenlabs
//     (NOT renamed or migrated) while the visible label reads
//     'Custom Voice add-on';
//   • the client portal must not carry any admin key surface (unchanged).
//
// Static-markup assertions following the convention of admin-voice-flags.test.js
// (jsdom is not a dependency of this repo) plus a vm.Script syntax pass over
// every inline script block.

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
  // boundary: the next function declaration (plain OR async)
  const endPlain = rest.indexOf('\nfunction ');
  const endAsync = rest.indexOf('\nasync function ');
  const ends = [endPlain, endAsync].filter(i => i !== -1);
  const end = ends.length ? Math.min(...ends) : -1;
  return rest.slice(0, end === -1 ? rest.length : end);
}

// The owner-worded unsupported state, as it appears in the admin source
// (JS string escapes kept literal).
const UNSUPPORTED_STATE =
  'ElevenLabs is no longer supported \\u2014 this client\\u2019s calls use the native voice. Assign an OpenAI custom voice to re-enable custom voice.';

describe('CVX-2: the ElevenLabs usage card is removed', () => {
  test('loadLiveCosts() no longer reads data.elevenlabs or renders the card', () => {
    const body = fnBody('loadLiveCosts');
    expect(body).not.toContain('data.elevenlabs');
    expect(body).not.toContain("'ElevenLabs'");
    // the OpenAI and AWS cards stay
    expect(body).toContain('data.openai');
    expect(body).toContain('data.aws');
  });
});

describe('CVX-2: provider dropdown lists OpenAI only', () => {
  test('the ElevenLabs option is gone; OpenAI GPT-Live remains', () => {
    const selectStart = adminHtml.indexOf('id="edit-cv-provider"');
    expect(selectStart).toBeGreaterThan(-1);
    const selectEnd = adminHtml.indexOf('</select>', selectStart);
    const selectMarkup = adminHtml.slice(selectStart, selectEnd);
    expect(selectMarkup).not.toContain('value="elevenlabs"');
    expect(selectMarkup).toContain('<option value="openai">OpenAI GPT-Live</option>');
  });

  test('hydration forces the OpenAI option (the only implemented provider)', () => {
    const body = fnBody('loadVoiceAddonState');
    expect(body).toContain("providerEl.value = 'openai'");
    expect(body).not.toContain("|| 'elevenlabs'");
  });

  test('the voice-id regex map carries no elevenlabs entry', () => {
    expect(code).not.toMatch(/ADMIN_CV_VOICE_ID_RE\s*=\s*\{\s*elevenlabs/);
    expect(code).not.toContain('/^[a-zA-Z0-9]{10,40}$/');
  });
});

describe('CVX-2: unsupported state for stored ElevenLabs clients', () => {
  test('the exact owner-worded state is rendered (textContent, not HTML interpolation)', () => {
    expect(adminHtml).toContain(UNSUPPORTED_STATE);
    const body = fnBody('renderAdminCvUnsupportedState');
    // stored values are injected via textContent — never into an HTML string
    expect(body).toContain('notice.textContent');
    expect(body).toContain('stored.textContent');
    expect(body).not.toMatch(/innerHTML/);
  });

  test('hydration flags stored elevenlabs records and NEVER prefills the legacy voice id', () => {
    const body = fnBody('loadVoiceAddonState');
    expect(body).toContain("adminCvStored.provider === 'elevenlabs'");
    // guarded prefill: the editable input stays empty for unsupported records
    expect(body).toContain("(!adminCvUnsupported && adminCvStored && adminCvStored.voice_id) || ''");
    expect(body).toContain('renderAdminCvUnsupportedState()');
  });

  test('a save without an OpenAI assignment never overwrites the preserved record', () => {
    const body = fnBody('saveClientEdit');
    // custom_voice PATCH is skipped while unsupported && voice id empty
    expect(body).toContain("if (!adminCvUnsupported || cvVoiceId !== '')");
    // the provider fallback is OpenAI now
    expect(body).toContain("provider: cvProviderEl ? cvProviderEl.value : 'openai'");
  });

  test('the unsupported banner container exists in the modal markup', () => {
    expect(adminHtml).toContain('id="edit-cv-unsupported"');
    expect((adminHtml.match(/id="edit-cv-unsupported"/g) || []).length).toBe(1);
  });
});

describe('CVX-2: the per-client key manager UI is removed (route gone server-side)', () => {
  test('no key-provisioning markup remains in the edit modal', () => {
    for (const id of ['edit-cv-key', 'edit-cv-key-eye', 'edit-cv-key-save',
      'edit-cv-key-reveal', 'edit-cv-key-status', 'edit-cv-key-revealed']) {
      expect(adminHtml).not.toContain(`id="${id}"`);
    }
  });

  test('no surface calls the removed /custom-voice-key route', () => {
    expect(adminHtml).not.toContain('custom-voice-key');
  });

  test('the key-provisioning functions are gone', () => {
    for (const fn of ['maskCvKey', 'toggleCvKeyVisibility', 'loadCustomVoiceKeyState',
      'saveCustomVoiceKey', 'revealCustomVoiceKey']) {
      expect(code).not.toContain(`function ${fn}`);
    }
  });

  test('openDetail() no longer loads key state', () => {
    const body = fnBody('openDetail');
    expect(body).not.toContain('loadCustomVoiceKeyState');
  });
});

describe('CVX-2: entitlement toggle keeps the stored field, drops the EL framing', () => {
  test('the checkbox is live under the neutral id, exactly once', () => {
    expect(adminHtml).toMatch(/<input type="checkbox" id="edit-voice-addon"[^>]*\/>/);
    expect((adminHtml.match(/id="edit-voice-addon"/g) || []).length).toBe(1);
    expect(adminHtml).not.toContain('edit-voice-addon-elevenlabs');
  });

  test('the visible label reads Custom Voice add-on (no ElevenLabs/premium framing)', () => {
    expect(adminHtml).toContain('<strong>Custom Voice add-on</strong> — unlocks Custom Voice for this client');
    const helperStart = adminHtml.indexOf('Admin override: turns on the Custom Voice section');
    expect(helperStart).toBeGreaterThan(-1);
    const helper = adminHtml.slice(helperStart, adminHtml.indexOf('</span>', helperStart));
    expect(helper).not.toMatch(/ElevenLabs|premium/i);
  });

  test('saveClientEdit() still carries voice_addon_elevenlabs on the PATCH', () => {
    const body = fnBody('saveClientEdit');
    expect(body).toContain("document.getElementById('edit-voice-addon')");
    expect(body).toContain('updates.voice_addon_elevenlabs = addonToggle.checked');
  });

  test('loadVoiceAddonState() hydrates the toggle from the client record', () => {
    const body = fnBody('loadVoiceAddonState');
    expect(body).toContain('client.voice_addon_elevenlabs === true');
  });
});

describe('admin key surfaces stay absent from the client portal', () => {
  test('the provisioning endpoints and key inputs are not in portal.html', () => {
    expect(portalHtml).not.toContain('custom-voice-key');
    expect(portalHtml).not.toContain('type="password" id="edit-cv-key"');
  });
});

describe('admin.html — syntax', () => {
  test('the inline scripts still parse as valid JavaScript', () => {
    for (const [i, s] of scripts.entries()) {
      expect(() => new vm.Script(s, { filename: `admin.html#${i}` })).not.toThrow();
    }
  });
});
