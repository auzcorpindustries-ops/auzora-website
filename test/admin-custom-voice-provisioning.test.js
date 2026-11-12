// test/admin-custom-voice-provisioning.test.js — CV-3
// (ticket zeus_1794504207719_52a3cee0)
//
// Pins the admin.html operator surfaces re-enabled/added for custom voice:
//   • the ElevenLabs Live Costs card is uncommented and live again
//     (retired under ELE-4; costDashboard.js still serves data.elevenlabs);
//   • the edit-modal ElevenLabs add-on override toggle is live again (the
//     $49/mo entitlement gate for the portal's Custom Voice section);
//   • per-client key provisioning: MASKED input, its own PUT endpoint,
//     independent of "Save Changes", Reveal shows the full key (admin-only),
//     and the key NEVER rides the client PATCH or any other surface;
//   • the client portal must not carry any of these key surfaces.
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

describe('CV-3: ElevenLabs Live Costs card is re-enabled', () => {
  test('loadLiveCosts() reads data.elevenlabs with no ELE-4 comment wrapper', () => {
    const body = fnBody('loadLiveCosts');
    expect(body).toContain('const el = data.elevenlabs;');
    // the ELE-4 block comment wrapper is gone
    expect(body).not.toContain('DISABLED (ELE-4)');
    expect(body).toContain('el.enabled');
    expect(body).toContain("disabledCard('🔊', 'ElevenLabs', el.reason)");
  });

  test('the usage card renders tier/character fields off the cost payload', () => {
    const body = fnBody('loadLiveCosts');
    expect(body).toContain('${el.tier}');
    expect(body).toContain('${el.characterCount?.toLocaleString() || 0}');
    expect(body).toContain('${usedPct}% used');
  });
});

describe('CV-3: the edit-modal add-on override toggle is re-enabled', () => {
  test('the checkbox HTML is live (not commented out)', () => {
    // the input exists as real markup, exactly once (the old ELE-4 block kept a
    // commented-out copy; other ELE-4 markers elsewhere in the file are
    // unrelated retirements, e.g. the admin voice grid)
    expect(adminHtml).toMatch(/<input type="checkbox" id="edit-voice-addon-elevenlabs"[^>]*\/>/);
    expect((adminHtml.match(/id="edit-voice-addon-elevenlabs"/g) || []).length).toBe(1);
    // the re-enable comment replaced the retirement comment in the modal
    expect(adminHtml).toContain('RE-ENABLED (CV-3');
  });

  test('saveClientEdit() still carries voice_addon_elevenlabs on the PATCH', () => {
    const body = fnBody('saveClientEdit');
    expect(body).toContain("document.getElementById('edit-voice-addon-elevenlabs')");
    expect(body).toContain('updates.voice_addon_elevenlabs = addonToggle.checked');
  });

  test('loadVoiceAddonState() hydrates the toggle from the client record', () => {
    const body = fnBody('loadVoiceAddonState');
    expect(body).toContain('client.voice_addon_elevenlabs === true');
  });
});

describe('CV-3: per-client key provisioning (operator-only)', () => {
  test('the provisioning block exists in the edit modal with masked input', () => {
    const blockStart = adminHtml.indexOf('id="edit-cv-key"');
    expect(blockStart).toBeGreaterThan(-1);
    // masked entry: type=password + autocomplete=new-password
    expect(adminHtml).toMatch(/<input type="password" id="edit-cv-key"[^>]*autocomplete="new-password"/);
    for (const id of ['edit-cv-key-eye', 'edit-cv-key-save', 'edit-cv-key-reveal',
      'edit-cv-key-status', 'edit-cv-key-revealed']) {
      expect(adminHtml).toContain(`id="${id}"`);
    }
  });

  test('openDetail() loads the key state when the modal opens', () => {
    const body = fnBody('openDetail');
    expect(body).toContain('loadCustomVoiceKeyState(clientId)');
  });

  test('loadCustomVoiceKeyState() GETs the custom-voice-key endpoint with admin auth', () => {
    const body = fnBody('loadCustomVoiceKeyState');
    expect(body).toContain('/custom-voice-key`');
    expect(body).toContain("x-api-key");
    // status line shows a MASKED key, never the raw value
    expect(body).toContain('maskCvKey(data.key)');
    expect(body).toContain('Not provisioned');
  });

  test('maskCvKey() never returns the full value', () => {
    const body = fnBody('maskCvKey');
    expect(body).toContain('••••••');
    expect(body).toContain('slice(-4)'); // only the last 4 chars survive
  });

  test('saveCustomVoiceKey() PUTs {provider, api_key} to its own endpoint', () => {
    const body = fnBody('saveCustomVoiceKey');
    expect(body).toContain("'PUT'");
    expect(body).toContain('/custom-voice-key`');
    expect(body).toContain("provider: 'elevenlabs', api_key: apiKey");
    // length validation before any network write
    expect(body).toContain('apiKey.length < 20 || apiKey.length > 200');
    // input is cleared after a successful save (no plaintext lingering)
    expect(body).toContain("inputEl.value = ''");
  });

  test('revealCustomVoiceKey() shows the FULL key on this admin-only surface', () => {
    const body = fnBody('revealCustomVoiceKey');
    expect(body).toContain('revealedEl.textContent = data.key');
    expect(body).toContain('data.configured');
  });

  test('the key NEVER rides the "Save Changes" client PATCH', () => {
    const body = fnBody('saveClientEdit');
    // no reference to the key input or the provisioning endpoint
    expect(body).not.toContain('edit-cv-key');
    expect(body).not.toContain('custom-voice-key');
    // the PATCH body is the updates object — no api_key field is ever added
    // to it (the x-api-key AUTH header on the fetch is expected and separate)
    expect(body).toContain('body: JSON.stringify(updates)');
    expect(body).not.toContain("api_key:");
  });

  test('the provisioning endpoints are absent from the client portal', () => {
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
