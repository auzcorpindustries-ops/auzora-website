// test/portal-embed-api-wiring.test.js — node-level guard for SE-0 (ticket
// zeus_1793945624991_6d952292): the Embed modal's snippet origin must be wired
// to the portal's hostname-derived API const, never hardcoded.
//
// The browser suite (portal-embed-snippet-hostname-browser.test.js) proves the
// behavior in a real Chromium; this file proves the WIRING so a regression is
// caught even where Chromium is not installed:
//   1. the whole inline portal script still compiles (syntax guard), and the
//      hostname→API rule still routes netlify/develop-- hosts to staging;
//   2. openEmbedModal derives the snippet baseUrl from that same API const and
//      contains no hardcoded backend origin;
//   3. both snippet templates (JS + iframe) interpolate that baseUrl.

'use strict';

const fs = require('fs');
const path = require('path');

const repoRoot = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(repoRoot, 'portal.html'), 'utf8');

// Main inline app script: first bare <script> … its matching </script>.
function mainInlineScript() {
  const openTags = [];
  let idx = html.indexOf('<script>');
  while (idx !== -1) { openTags.push(idx); idx = html.indexOf('<script>', idx + 1); }
  const closes = [];
  let c = html.indexOf('</script>');
  while (c !== -1) { closes.push(c); c = html.indexOf('</script>', c + 1); }
  const open = openTags[0];
  const close = closes.find(cl => cl > open);
  return html.slice(open + 8, close);
}

const script = mainInlineScript();

// Extract a top-level function's full source. The function body is indented, so
// the first column-0 "}" after the signature is its closing brace.
function extractFn(src, name) {
  const start = src.indexOf('async function ' + name + '(');
  if (start === -1) throw new Error('function not found: ' + name);
  // LF + "}" + LF — built without escape literals on purpose.
  const CLOSE = String.fromCharCode(10) + '}' + String.fromCharCode(10);
  const end = src.indexOf(CLOSE, start);
  if (end === -1) throw new Error('function end not found: ' + name);
  return src.slice(start, end + 2);
}

const STAGING = 'https://atlas-staging.6845165.xyz';
const PROD = 'https://atlas.6845165.xyz';

describe('SE-0: Embed modal snippet origin wiring', () => {
  test('inline portal script still compiles (syntax guard)', () => {
    expect(() => new Function(script)).not.toThrow();
  });

  test('hostname→API rule routes netlify/develop-- hosts to staging, everything else to prod', () => {
    const m = script.match(/const API = (.*?);\n/);
    expect(m).not.toBeNull();
    const derive = new Function('location', 'return (' + m[1] + ');');
    const at = (hostname) => derive({ hostname });
    expect(at('sonello.netlify.app')).toBe(STAGING);
    expect(at('develop--sonello.netlify.app')).toBe(STAGING);
    expect(at('forms.uzora.com')).toBe(PROD); // custom domain → prod
    expect(at('127.0.0.1')).toBe(PROD);
  });

  test('openEmbedModal derives baseUrl from API and contains no hardcoded origin', () => {
    const fn = extractFn(script, 'openEmbedModal');
    expect(fn).toContain('const baseUrl = API;');
    expect(fn).not.toContain('atlas.6845165.xyz');
    // Both snippet templates interpolate the environment-correct origin.
    expect(fn).toContain('${baseUrl}/js/form-widget.js');
    expect(fn).toContain('src="${baseUrl}/forms/${formId}/embed?token=${embedToken}"');
  });
});
