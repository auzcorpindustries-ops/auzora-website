// test/portal-embed-snippet-hostname-browser.test.js — BROWSER-LEVEL proof for
// SE-0 (ticket zeus_1793945624991_6d952292): the Forms "Embed" modal must
// generate environment-correct embed snippets.
//
// DEFECT THIS LOCKS IN
// openEmbedModal() used to hardcode `const baseUrl = 'https://atlas.6845165.xyz'`
// into the generated snippet, while the portal's own API const (hostname-
// derived) sends staging portals to atlas-staging. A form created through a
// staging / netlify-preview portal therefore handed out a PROD snippet whose
// form id/token do not exist in prod — the embedded widget could not render
// or submit. The fix reuses the same API selection for the snippet's baseUrl.
//
// WHAT THIS SUITE PROVES, WITH A REAL CHROMIUM
//   1. Loading portal.html from a *.netlify.app host and opening the Embed
//      modal generates a JS snippet whose script src points at
//      https://atlas-staging.6845165.xyz (staging), and an iframe snippet with
//      the same staging origin.
//   2. Loading the same page from a non-netlify host (the custom-domain /
//      prod rule) keeps the prod origin — the prod snippet is asserted
//      BYTE-IDENTICAL to the pre-fix hardcode output.
//   3. The clipboard payload (window._embedCodes, what the Copy buttons hand
//      out) carries the same environment-correct origin.
//
// Playwright is declared in devDependencies. Where it (or its Chromium build)
// is not installed the suite SKIPS with a loud message rather than failing —
// auzora-website has no CI job that would install it.

'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const { URL } = require('url');

// Chromium launch + two full page loads are well over jest's 5s default.
jest.setTimeout(120000);

const repoRoot = path.join(__dirname, '..');

// ── Playwright resolution ────────────────────────────────────────────────────
function resolvePlaywright() {
  const candidates = [
    process.env.PLAYWRIGHT_PKG,
    'playwright',
    '@playwright/test',
    process.env.HOME ? path.join(process.env.HOME, 'Projects/atlas-ai/node_modules/playwright') : null,
  ].filter(Boolean);
  for (const c of candidates) {
    try { return require(c); } catch (e) { /* next candidate */ }
  }
  return null;
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
    '\n[portal-embed-snippet-hostname-browser] SKIPPING the embed-snippet browser suite — ' +
    (chromium ? 'Playwright is installed but its Chromium build is not.\n' : 'Playwright is not installed.\n') +
    '  Install with:  npm i -D playwright && npx playwright install chromium\n' +
    '  (or point PLAYWRIGHT_PKG at an existing playwright install).\n'
  );
}

const describeBrowser = browserReady ? describe : describe.skip;

// ── Fixtures ─────────────────────────────────────────────────────────────────
const ORIGIN_TOKEN = 'embed-snippet-browser-token';

const CLIENT = {
  business_name: 'Embed Probe Co',
  tutorial_completed: true, // suppress the first-run tutorial overlay
  webhook_url: '',
  outbound_window: { mode: '247' },
};

const FORM = {
  form_id: 'form_se0_probe',
  name: 'SE0 Embed Probe',
  embed_token: 'tok_se0_probe_123',
  status: 'active',
};

const STAGING_ORIGIN = 'https://atlas-staging.6845165.xyz';
const PROD_ORIGIN = 'https://atlas.6845165.xyz';

// The byte-exact snippet the prod (custom-domain) case must keep producing —
// this is the pre-fix hardcode output, reproduced verbatim (AC: prod stays
// byte-identical).
function expectedJsSnippet(origin) {
  return `<!-- Sonello Form: ${FORM.name} -->
<div id="atlas-form-${FORM.form_id}"></div>
<script src="${origin}/js/form-widget.js"
        data-form-id="${FORM.form_id}"
        data-token="${FORM.embed_token}"
        async></script>`;
}

function expectedIframeSnippet(origin) {
  return `<iframe
  src="${origin}/forms/${FORM.form_id}/embed?token=${FORM.embed_token}"
  width="100%"
  height="600"
  frameborder="0"
  title="${FORM.name}"></iframe>`;
}

// ── Static file server (serves the working tree) ──────────────────────────────
function startStaticServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      let pathname;
      try { pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname); }
      catch (e) { res.writeHead(400); res.end('bad url'); return; }
      const rel = pathname === '/' ? '/portal.html' : pathname;
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

// ── Mock portal API ──────────────────────────────────────────────────────────
// Answered by PATH so both environments work: a netlify-host page fetches
// ${staging}/portal/forms while a localhost page fetches ${prod}/portal/forms.
function createMockApi() {
  return {
    formsRequests: [],
    dispatch(method, pathname) {
      if (method === 'GET' && pathname === '/portal/forms') {
        this.formsRequests.push(1);
        return { status: 200, body: { forms: [FORM] } };
      }
      // Everything else the portal boot fans out to — empty but valid JSON.
      return { status: 200, body: {} };
    },
  };
}

// Intercept every request the page makes: any-host file loads are fulfilled
// from disk (this is what lets a fake *.netlify.app origin load the real
// portal.html), /portal|/api is answered by the mock, CDNs are stubbed so the
// offline page still paints.
async function installNetwork(page, api) {
  await page.route('**/*', (route) => {
    const req = route.request();
    const url = new URL(req.url());

    if (url.pathname.startsWith('/portal/') || url.pathname.startsWith('/api/')) {
      const r = api.dispatch(req.method(), url.pathname);
      return route.fulfill({ status: r.status, contentType: 'application/json', body: JSON.stringify(r.body) });
    }

    // Static file: serve the working tree from disk for ANY host so the
    // netlify-app hostname renders the same portal.html.
    let pathname;
    try { pathname = decodeURIComponent(url.pathname); } catch (e) { /* fall through */ }
    if (pathname) {
      const rel = pathname === '/' ? '/portal.html' : pathname;
      const file = path.resolve(repoRoot, '.' + rel);
      if (file.startsWith(repoRoot) && fs.existsSync(file) && fs.statSync(file).isFile()) {
        const ct = {
          '.html': 'text/html; charset=utf-8',
          '.js': 'text/javascript; charset=utf-8',
          '.css': 'text/css; charset=utf-8',
        }[path.extname(file)] || 'application/octet-stream';
        return route.fulfill({ status: 200, contentType: ct, body: fs.readFileSync(file, 'utf8') });
      }
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

async function seedAuth(page) {
  await page.addInitScript((args) => {
    try {
      window.sessionStorage.setItem('atlas_token', args.token);
      window.sessionStorage.setItem('atlas_client', JSON.stringify(args.client));
    } catch (e) { /* about:blank frame */ }
  }, { token: ORIGIN_TOKEN, client: CLIENT });
}

async function waitFor(fn, timeoutMs = 15000) {
  const start = Date.now();
  for (;;) {
    if (await fn()) return undefined;
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise(r => setTimeout(r, 60));
  }
}

// Load portal.html at `targetUrl`, open the Embed modal for the fixture form,
// and read back what the modal displays + what the Copy buttons would hand out.
async function loadPortalAndOpenEmbed(browser, api, targetUrl) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(String(err)));

  await seedAuth(page);
  await installNetwork(page, api);
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });

  // The boot must have restored the session (portalToken set) before the
  // modal can be opened directly.
  await waitFor(async () => page.evaluate(() => typeof portalToken !== 'undefined' && portalToken !== null));

  await page.evaluate((formId) => openEmbedModal(formId), FORM.form_id);
  await waitFor(async () => page.evaluate(() => {
    const el = document.getElementById('embed-code-js');
    return !!el && el.textContent.indexOf('form-widget.js') !== -1;
  }));

  const out = await page.evaluate(() => ({
    js: document.getElementById('embed-code-js').textContent,
    iframe: document.getElementById('embed-code-iframe').textContent,
    clipboardJs: window._embedCodes ? window._embedCodes.js : null,
    clipboardIframe: window._embedCodes ? window._embedCodes.iframe : null,
  }));
  out.pageErrors = pageErrors;
  await context.close();
  return out;
}

function scriptSrcOrigin(jsSnippet) {
  const m = jsSnippet.match(/src="(https:\/\/[^/]+)\/js\/form-widget\.js"/);
  return m ? m[1] : null;
}

describeBrowser('portal Embed modal generates environment-correct snippets (SE-0)', () => {
  let server;
  let serverPort;
  let browser;

  beforeAll(async () => {
    server = await startStaticServer();
    serverPort = server.address().port;
    browser = await chromium.launch({ headless: true });
  });

  afterAll(async () => {
    if (browser) { try { await browser.close(); } catch (e) { /* already down */ } }
    if (server) { try { server.close(); } catch (e) { /* already down */ } }
  });

  test('a *.netlify.app portal hands out STAGING snippet origins', async () => {
    const api = createMockApi();
    const out = await loadPortalAndOpenEmbed(browser, api, 'https://se0-preview.netlify.app/portal.html');

    expect(out.pageErrors).toEqual([]);
    expect(api.formsRequests.length).toBeGreaterThan(0);

    const jsOrigin = scriptSrcOrigin(out.js);
    expect(jsOrigin).toBe(STAGING_ORIGIN);
    expect(out.iframe).toContain(`src="${STAGING_ORIGIN}/forms/${FORM.form_id}/embed?token=${FORM.embed_token}"`);
    // Clipboard path (Copy buttons) carries the same staging origin.
    expect(scriptSrcOrigin(out.clipboardJs)).toBe(STAGING_ORIGIN);
    expect(out.clipboardIframe).toContain(`${STAGING_ORIGIN}/forms/${FORM.form_id}/embed`);
    // The form identity the staging backend issued is preserved verbatim.
    expect(out.js).toContain(`data-form-id="${FORM.form_id}"`);
    expect(out.js).toContain(`data-token="${FORM.embed_token}"`);
    // And the full staging snippet is exactly the prod template with the
    // staging origin swapped in (no other drift).
    expect(out.js).toBe(expectedJsSnippet(STAGING_ORIGIN));
    expect(out.iframe).toBe(expectedIframeSnippet(STAGING_ORIGIN));
  });

  test('a custom-domain portal keeps the PROD snippet byte-identical to the old hardcode', async () => {
    const api = createMockApi();
    const out = await loadPortalAndOpenEmbed(browser, api, `http://127.0.0.1:${serverPort}/portal.html`);

    expect(out.pageErrors).toEqual([]);
    expect(api.formsRequests.length).toBeGreaterThan(0);

    const jsOrigin = scriptSrcOrigin(out.js);
    expect(jsOrigin).toBe(PROD_ORIGIN);

    // BYTE-IDENTICAL AC: the prod JS snippet equals the pre-fix hardcode
    // output character for character.
    expect(out.js).toBe(expectedJsSnippet(PROD_ORIGIN));
    expect(out.iframe).toBe(expectedIframeSnippet(PROD_ORIGIN));
    expect(scriptSrcOrigin(out.clipboardJs)).toBe(PROD_ORIGIN);
  });
});
