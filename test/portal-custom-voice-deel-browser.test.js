// test/portal-custom-voice-deel-browser.test.js — CVX-3 BROWSER-LEVEL E2E
// (ticket zeus_1794610532814_36f2c999)
//
// Drives the REAL client portal UI (working-tree portal.html served over
// local http; API mocked at the network layer with stateful page.route
// handlers — the pattern proven in test/portal-billing-browser.test.js and
// test/portal-auth-browser.test.js) through both CVX-3 acceptance scenarios:
//
//   1. A client with an OpenAI custom voice:
//      the section hydrates from the saved record (provider dropdown displays
//      the admin-assigned OpenAI GPT-Live assignment, disabled/display-only;
//      voice id hydrated; Active status), the native grid dims with the
//      "Custom voice active" note NAMING OpenAI, a section save PATCHes
//      enabled/provider/voice_id, and a RELOAD in the same session re-hydrates
//      from the persisted record.
//
//   2. A stored provider='elevenlabs' client:
//      the section renders the explicit unsupported state with the EXACT
//      banner wording and the stored voice id visible READ-ONLY; no broken
//      controls (enable box unchecked, no prefilled input, controls and
//      locked hint both hidden); the native voice grid stays LIVE (not dimmed,
//      no active note) — mirroring the server resolver that treats the stored
//      record inactive; and saving a Tone & Style sibling (tone) PATCHes
//      WITHOUT a custom_voice key — the stored EL record is neither resurrected
//      nor deleted. No request ever hits the removed custom-voice preview
//      route.
//
// ZERO EXTERNAL EGRESS: every request the pages make is intercepted by
// page.route('**/*'); only the local static server is continued.

'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const { URL } = require('url');

const repoRoot = path.join(__dirname, '..');

// Two full portal loads + a save round-trip per scenario — Chromium + page
// load is well over jest's 5s default (billing-suite convention).
jest.setTimeout(120000);

function resolvePlaywright() {
  if (process.env.PLAYWRIGHT_PKG) {
    try { return require(process.env.PLAYWRIGHT_PKG); } catch (e) { /* fall through */ }
  }
  try { return require('playwright'); } catch (e) { return null; }
}

const playwright = resolvePlaywright();
const chromium = playwright && playwright.chromium ? playwright.chromium : null;

function chromiumInstalled() {
  if (!chromium) return false;
  try {
    const exe = chromium.executablePath();
    return !!exe && fs.existsSync(exe);
  } catch (e) {
    return false;
  }
}

const browserReady = chromiumInstalled();

if (!browserReady) {
  // eslint-disable-next-line no-console
  console.warn(
    '\n[portal-custom-voice-deel-browser] SKIPPING the CVX-3 browser E2E — ' +
    (chromium ? 'Playwright is installed but its Chromium build is not.\n' : 'Playwright is not installed.\n') +
    '  Install with:  npm i -D playwright && npx playwright install chromium\n' +
    '  (or point PLAYWRIGHT_PKG at an existing playwright install).\n'
  );
}

const describeBrowser = browserReady ? describe : describe.skip;

// ── Shared fixtures (the existing e2e client shape) ──────────────────────────
const ORIGIN_TOKEN = 'cvx3-browser-portal-token';

const USAGE = {
  voiceMinutes: 120,
  smsMessages: 10,
  limits: { voiceMinutes: 2500, smsMessages: 0 },
  percentUsed: { voice: 5, sms: 0 },
  period: '2026-11',
  unlimited: false,
  included: { voice: 1250, sms: 0 },
  overage: { voice: 0, sms: 0 },
};

function baseClient(extra) {
  return Object.assign({
    business_name: 'Acme CVX3 Browser Co',
    tutorial_completed: true, // suppress the first-run tutorial overlay
    webhook_url: '',
    config_rev: 7,
    voice_id: 'alloy',
    tone: 'friendly',
    speaking_pace: 'normal',
    lang: 'en',
  }, extra);
}

// Scenario 1: an entitled client with a SAVED OpenAI custom voice.
const OPENAI_CV_CLIENT = baseClient({
  custom_voice: { provider: 'openai', voice_id: 'my-openai-custom-voice', enabled: true, has_api_key: false },
});

// Scenario 2: a stored LEGACY-provider record (entitled — the unsupported
// state must take precedence over the entitlement gate).
const EL_CV_CLIENT = baseClient({
  business_name: 'Acme CVX3 Legacy Co',
  custom_voice: { provider: 'elevenlabs', voice_id: 'uMM5TEnpKKgD758knVJO', enabled: true, has_api_key: true },
});

// OpenAI-only catalog (CVX-1 removed the legacy provider from the catalog).
const VOICES_PAYLOAD = {
  default_voice_id: 'alloy',
  providers: { openai: { label: 'OpenAI', is_default: true } },
  legacy_voice_map: {},
  voices: [
    { id: 'alloy', label: 'Alloy', description: 'GPT-Live voice', gender: 'female', provider: 'openai', is_default: true, portal_display: true },
    { id: 'echo', label: 'Echo', description: 'GPT-Live voice', gender: 'male', provider: 'openai', portal_display: true },
    { id: 'shimmer', label: 'Shimmer', description: 'GPT-Live voice', gender: 'female', provider: 'openai', portal_display: true },
  ],
};

const BANNER = 'ElevenLabs is no longer supported — your calls use the native AI voice. Your saved configuration has not been deleted.';

// ── Static file server (serves the working tree) ─────────────────────────────
function startStaticServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      let pathname;
      try { pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname); }
      catch (e) { res.writeHead(400); res.end('bad url'); return; }
      const rel = pathname === '/' || pathname === '/portal' ? '/portal.html' : pathname;
      const file = path.resolve(repoRoot, '.' + rel);
      if (!file.startsWith(repoRoot) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404); res.end('not found'); return;
      }
      const ct = {
        '.html': 'text/html; charset=utf-8',
        '.js': 'text/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.json': 'application/json; charset=utf-8',
        '.png': 'image/png',
        '.svg': 'image/svg+xml',
      }[path.extname(file)] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': ct });
      fs.createReadStream(file).pipe(res);
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

// ── Mock portal API (stateful; drives the network layer) ─────────────────────
function createMockApi(seedClient) {
  let origin = null;
  const state = {
    client: JSON.parse(JSON.stringify(seedClient)), // the persisted record the server holds
    requests: [],
    deadPreviewHits: 0,
  };
  return {
    setOrigin(v) { origin = v; },
    state,

    settingsPatchBodies() {
      return state.requests.filter(r => r.method === 'PATCH' && r.pathname === '/portal/settings');
    },
    deadPreviewHits() { return state.deadPreviewHits; },

    isStatic(url) {
      return origin && url.origin === origin;
    },

    dispatch(method, pathname, headers, rawBody) {
      let body = null;
      if (rawBody) { try { body = JSON.parse(rawBody); } catch (e) { body = rawBody; } }
      state.requests.push({ method, pathname, body });

      if (method === 'GET' && pathname === '/portal/entitlements') {
        return {
          status: 200,
          body: {
            plan: 'Standard',
            tier: '',
            usage: JSON.parse(JSON.stringify(USAGE)),
            allow_overage: { voice: false, sms: false },
            tierVoices: { access: 'all', defaultVoiceId: 'alloy', elevenlabsAddon: true },
          },
        };
      }
      if (method === 'GET' && pathname === '/api/voices') {
        return { status: 200, body: JSON.parse(JSON.stringify(VOICES_PAYLOAD)) };
      }
      if (method === 'GET' && pathname === '/portal/billing/addons') {
        return { status: 200, body: { addons: [], current: null } };
      }
      // GET /portal/settings — refreshClientSnapshot() reads the persisted
      // record from here before every Tone & Style render.
      if (method === 'GET' && pathname === '/portal/settings') {
        return { status: 200, body: { client: state.client } };
      }
      // PATCH /portal/settings — shallow-merge the allowed keys (the real
      // server allowlist-writes each top-level field; custom_voice arrives as
      // one object and is stored as one object).
      if ((method === 'PATCH' || method === 'POST') && pathname === '/portal/settings') {
        if (body && typeof body === 'object') {
          Object.keys(body).forEach(k => {
            if (k === 'base_config_rev') return;
            state.client[k] = body[k];
          });
          state.client.config_rev = (state.client.config_rev || 0) + 1;
        }
        return { status: 200, body: { client: state.client } };
      }
      // CVX-1 removed POST /portal/custom-voice-preview — it 404s. Track any
      // hit so the suite can assert the portal NEVER calls the dead route.
      if (pathname.indexOf('custom-voice-preview') !== -1) {
        state.deadPreviewHits += 1;
        return { status: 404, body: { error: 'not found' } };
      }
      // Everything else the boot fans out to — empty but valid JSON.
      return { status: 200, body: {} };
    },
  };
}

// Intercept every request the page makes: let the local static server through,
// answer /portal|/api with the mock, and stub third-party CDNs.
async function installNetwork(page, api) {
  await page.route('**/*', (route) => {
    const req = route.request();
    const url = new URL(req.url());

    if (api.isStatic(url)) return route.continue();

    if (url.pathname.startsWith('/portal/') || url.pathname.startsWith('/api/')) {
      const r = api.dispatch(req.method(), url.pathname, req.headers(), req.postData());
      return route.fulfill({
        status: r.status,
        contentType: 'application/json',
        body: JSON.stringify(r.body),
      });
    }
    if (/(^|\.)unpkg\.com$/.test(url.hostname)) {
      return route.fulfill({
        status: 200,
        contentType: 'text/javascript',
        body: 'window.lucide = { createIcons: function () {} };',
      });
    }
    if (/(^|\.)googleapis\.com$/.test(url.hostname) || /(^|\.)gstatic\.com$/.test(url.hostname)) {
      return route.fulfill({ status: 200, contentType: 'text/css', body: '' });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
}

function makeSeeder(client) {
  return async (page) => {
    await page.addInitScript((a) => {
      try {
        window.sessionStorage.setItem('atlas_token', a.token);
        window.sessionStorage.setItem('atlas_client', JSON.stringify(a.client));
      } catch (e) { /* about:blank frame */ }
    }, { token: ORIGIN_TOKEN, client });
  };
}

async function waitFor(fn, timeoutMs = 15000) {
  const start = Date.now();
  for (;;) {
    if (await fn()) return undefined;
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise(r => setTimeout(r, 60));
  }
}

// Load the portal and open the Tone & Style (AI Agent) page — the Custom
// Voice section hydrates when the settings page renders.
async function openToneAndStyle(page, api, baseUrl, seeder) {
  if (seeder) await seeder(page);
  await installNetwork(page, api);
  await page.goto(baseUrl + '/portal.html', { waitUntil: 'domcontentloaded' });
  await waitFor(async () => page.evaluate(() =>
    !!document.getElementById('nav-settings') && !!document.getElementById('s-cv-block')));
  await page.click('#nav-settings');
  await waitFor(async () => page.evaluate(() => {
    const block = document.getElementById('s-cv-block');
    if (!block || block.style.display === 'none') return false;
    // Hydration signal: the supported path fills the voice-id input, the
    // unsupported path fills the banner.
    const vid = document.getElementById('s-cv-voice-id');
    const banner = document.getElementById('s-cv-unsupported');
    const hydrated = (vid && vid.value !== '') || (!!banner && banner.textContent !== '');
    // The native grid render is async off the same hydration path.
    const gridRendered = document.querySelectorAll('#portal-voice-grid .voice-card').length > 0;
    return hydrated && gridRendered;
  }));
}

// ── Suite ────────────────────────────────────────────────────────────────────
describeBrowser('CVX-3 portal Custom Voice — browser-level E2E', () => {
  let server;
  let baseUrl;
  let browser;

  beforeAll(async () => {
    server = await startStaticServer();
    baseUrl = 'http://127.0.0.1:' + server.address().port;
    browser = await chromium.launch({ headless: true });
  });

  afterAll(async () => {
    if (browser) await browser.close();
    if (server) await new Promise(r => server.close(r));
  });

  test('an OpenAI custom-voice client: hydrate, active note names OpenAI, save round-trip, reload re-hydrates', async () => {
    const api = createMockApi(OPENAI_CV_CLIENT);
    api.setOrigin(baseUrl);
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    try {
      const page = await context.newPage();
      await openToneAndStyle(page, api, baseUrl, makeSeeder(OPENAI_CV_CLIENT));

      // ── Hydrated section state ──
      const state = await page.evaluate(() => {
        const vis = id => {
          const el = document.getElementById(id);
          return !!el && el.style.display !== 'none';
        };
        const provider = document.getElementById('s-cv-provider');
        return {
          controls: vis('s-cv-controls'),
          locked: vis('s-cv-locked'),
          unsupported: vis('s-cv-unsupported'),
          enabledChecked: document.getElementById('s-cv-enabled').checked,
          providerDisabled: provider.disabled,
          providerValue: provider.value,
          providerOptions: Array.from(provider.options).map(o => ({ v: o.value, t: o.textContent })),
          voiceId: document.getElementById('s-cv-voice-id').value,
          status: document.getElementById('s-cv-status').textContent,
          noteVisible: vis('s-cv-grid-note'),
          noteText: document.getElementById('s-cv-grid-note').textContent,
          gridDimmed: document.getElementById('portal-voice-grid').classList.contains('cv-dim'),
        };
      });
      expect(state.controls).toBe(true);
      expect(state.locked).toBe(false);
      expect(state.unsupported).toBe(false);
      expect(state.enabledChecked).toBe(true);
      // Provider dropdown: admin-assigned, display-only, OpenAI only.
      expect(state.providerDisabled).toBe(true);
      expect(state.providerValue).toBe('openai');
      expect(state.providerOptions).toEqual([{ v: 'openai', t: 'OpenAI GPT-Live' }]);
      expect(state.voiceId).toBe('my-openai-custom-voice');
      expect(state.status).toContain('Active');
      // The active note names OpenAI and the native grid is dimmed.
      expect(state.noteVisible).toBe(true);
      expect(state.noteText).toContain('custom OpenAI GPT-Live voice');
      expect(state.gridDimmed).toBe(true);

      // ── Section save: toggle off, save ──
      await page.evaluate(() => {
        const el = document.getElementById('s-cv-enabled');
        el.checked = false;
        el.dispatchEvent(new Event('change'));
      });
      await page.click('#s-cv-save-btn');
      await waitFor(async () => api.settingsPatchBodies().length > 0);

      const patch = api.settingsPatchBodies()[0];
      expect(patch.body.custom_voice).toEqual({ enabled: false, provider: 'openai', voice_id: 'my-openai-custom-voice' });
      expect(patch.body.base_config_rev).toBe(7);
      expect(api.deadPreviewHits()).toBe(0);

      // ── Post-save state from the persisted record ──
      await waitFor(async () => page.evaluate(() =>
        document.getElementById('s-cv-status').textContent.indexOf('Saved (off)') !== -1));
      const afterSave = await page.evaluate(() => ({
        enabledChecked: document.getElementById('s-cv-enabled').checked,
        noteVisible: document.getElementById('s-cv-grid-note').style.display !== 'none',
        gridDimmed: document.getElementById('portal-voice-grid').classList.contains('cv-dim'),
        stored: JSON.parse(window.sessionStorage.getItem('atlas_client')).custom_voice,
      }));
      expect(afterSave.enabledChecked).toBe(false);
      expect(afterSave.noteVisible).toBe(false);
      expect(afterSave.gridDimmed).toBe(false);
      expect(afterSave.stored).toEqual({ provider: 'openai', voice_id: 'my-openai-custom-voice', enabled: false });

      // ── Reload in the SAME page: the init script re-seeds a STALE session
      //    (enabled:true snapshot), and showPage('settings') must hydrate from
      //    the LATEST persisted record via the settings GET — hydration after
      //    refresh/navigation comes from the SAVED record, not the cache. ──
      await page.reload({ waitUntil: 'domcontentloaded' });
      await waitFor(async () => page.evaluate(() =>
        !!document.getElementById('nav-settings') && !!document.getElementById('s-cv-block')));
      await page.click('#nav-settings');
      await waitFor(async () => page.evaluate(() => {
        const vid = document.getElementById('s-cv-voice-id');
        const gridRendered = document.querySelectorAll('#portal-voice-grid .voice-card').length > 0;
        return !!vid && vid.value !== '' && gridRendered;
      }));
      const rehydrated = await page.evaluate(() => ({
        voiceId: document.getElementById('s-cv-voice-id').value,
        enabledChecked: document.getElementById('s-cv-enabled').checked,
        providerValue: document.getElementById('s-cv-provider').value,
        status: document.getElementById('s-cv-status').textContent,
      }));
      expect(rehydrated.voiceId).toBe('my-openai-custom-voice');
      expect(rehydrated.enabledChecked).toBe(false);
      expect(rehydrated.providerValue).toBe('openai');
      expect(rehydrated.status).toContain('Saved (off)');
    } finally {
      await context.close();
    }
  });

  test('a stored legacy-provider client: unsupported state, live native grid, sibling save never touches the record', async () => {
    const api = createMockApi(EL_CV_CLIENT);
    api.setOrigin(baseUrl);
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    try {
      const page = await context.newPage();
      await openToneAndStyle(page, api, baseUrl, makeSeeder(EL_CV_CLIENT));

      // ── Unsupported state (entitled client — precedence over the gate) ──
      const state = await page.evaluate(() => {
        const vis = id => {
          const el = document.getElementById(id);
          return !!el && el.style.display !== 'none';
        };
        const box = document.getElementById('s-cv-unsupported');
        return {
          unsupported: vis('s-cv-unsupported'),
          bannerText: box.textContent,
          controls: vis('s-cv-controls'),
          locked: vis('s-cv-locked'),
          enabledChecked: document.getElementById('s-cv-enabled').checked,
          voiceIdInput: document.getElementById('s-cv-voice-id').value,
          noteVisible: vis('s-cv-grid-note'),
          gridDimmed: document.getElementById('portal-voice-grid').classList.contains('cv-dim'),
          openaiCards: document.querySelectorAll('#portal-voice-grid .voice-card').length,
        };
      });
      expect(state.unsupported).toBe(true);
      // EXACT banner wording (em dash included) + read-only stored voice id.
      expect(state.bannerText).toContain(BANNER);
      expect(state.bannerText).toContain('Stored voice ID (read-only): uMM5TEnpKKgD758knVJO');
      expect(state.controls).toBe(false);
      expect(state.locked).toBe(false);
      // No broken controls: enable box NOT checked, stored id NOT prefilled.
      expect(state.enabledChecked).toBe(false);
      expect(state.voiceIdInput).toBe('');
      // Native voice grid stays LIVE (server resolves the EL record inactive).
      expect(state.noteVisible).toBe(false);
      expect(state.gridDimmed).toBe(false);
      expect(state.openaiCards).toBeGreaterThan(0);

      // ── Save a Tone & Style SIBLING (tone) via the global Save and Apply ──
      await page.selectOption('#s-tone', 'formal');
      await waitFor(async () => page.evaluate(() =>
        document.getElementById('floating-save-footer').style.display === 'block'));
      await page.click('#floating-save-btn');
      await waitFor(async () => api.settingsPatchBodies().length > 0);

      const patch = api.settingsPatchBodies()[0];
      expect(patch.body.tone).toBe('formal');
      // THE core pin: no custom_voice key in the payload — the stored legacy
      // record can be neither resurrected nor deleted by a sibling save.
      expect(patch.body).not.toHaveProperty('custom_voice');
      expect(patch.body.base_config_rev).toBe(7);

      // The persisted record is untouched; the banner still shows after the
      // save re-hydrates from the response.
      await waitFor(async () => page.evaluate(() =>
        document.getElementById('s-cv-unsupported').style.display !== 'none'));
      const record = api.state.client.custom_voice;
      expect(record).toEqual({ provider: 'elevenlabs', voice_id: 'uMM5TEnpKKgD758knVJO', enabled: true, has_api_key: true });
      const storedAfter = await page.evaluate(() =>
        JSON.parse(window.sessionStorage.getItem('atlas_client')).custom_voice);
      expect(storedAfter).toEqual({ provider: 'elevenlabs', voice_id: 'uMM5TEnpKKgD758knVJO', enabled: true, has_api_key: true });

      // No request ever hit the removed custom-voice preview route.
      expect(api.deadPreviewHits()).toBe(0);
      expect(api.state.requests.some(r => r.pathname.indexOf('custom-voice-preview') !== -1)).toBe(false);
    } finally {
      await context.close();
    }
  });
});
