// test/admin-resend-setup-email.test.js — PROD-2 (ticket zeus_1790914972726_f2524146)
// "add an admin-panel 'resend setup email' action for manual recovery".
//
// The atlas-ai side ships POST /admin/clients/:id/resend-setup-email. This suite
// pins the panel wiring that makes it reachable by an operator, following the
// same static-markup convention as payment-success.test.js (no DOM: jsdom is not
// a dependency of this repo).
//
// What is actually asserted:
//   - the button renders in the client detail modal for every client, and is
//     bound to resendSetupEmail(clientId);
//   - the never-sent state (pending_setup + no setup_email_sent_at) surfaces the
//     "paid but never received" copy — the case this ticket exists for;
//   - it calls the right URL with the admin api key and force:true;
//   - failures are surfaced, never swallowed into a success toast. A 502 means
//     Resend rejected the send, so reporting success would be a lie.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const repoRoot = path.join(__dirname, '..');
const adminHtml = fs.readFileSync(path.join(repoRoot, 'admin.html'), 'utf8');

// Pull the inline <script> bodies out (the admin page ships one big script).
const scripts = [];
const scriptRe = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
let m;
while ((m = scriptRe.exec(adminHtml)) !== null) scripts.push(m[1]);
const code = scripts.join('\n');

describe('admin.html resend setup email (PROD-2)', () => {
  test('the page has inline script blocks to assert against', () => {
    expect(scripts.length).toBeGreaterThan(0);
  });

  describe('detail modal', () => {
    test('renders the setup-email action bound to the client id', () => {
      expect(adminHtml).toMatch(/id="resend-setup-email-btn"/);
      expect(adminHtml).toMatch(/onclick="resendSetupEmail\('\$\{clientId\}'\)"/);
    });

    test('surfaces the never-sent state for a pending_setup client', () => {
      expect(code).toMatch(/c\.status\s*===\s*'pending_setup'\s*&&\s*!c\.setup_email_sent_at/);
      expect(adminHtml).toContain('Not sent yet');
      expect(adminHtml).toContain('never received their setup link');
    });

    test('shows the last-sent stamp when the marker is present', () => {
      expect(code).toContain('c.setup_email_sent_at');
      expect(adminHtml).toContain('Last sent ${formatDate(c.setup_email_sent_at)}');
    });
  });

  describe('resendSetupEmail()', () => {
    test('posts to the atlas-ai recovery endpoint with the admin api key', () => {
      expect(code).toMatch(/async function resendSetupEmail\(clientId\)/);
      expect(code).toContain('/resend-setup-email`');
      expect(code).toMatch(/clients\/\$\{encodeURIComponent\(clientId\)\}\/resend-setup-email/);
      expect(code).toContain("'x-api-key': apiKey");
    });

    test('sends force:true so an already-onboarded client can still be recovered', () => {
      expect(code).toMatch(/JSON\.stringify\(\{\s*force:\s*true\s*\}\)/);
    });

    test('confirms before sending so a mis-click cannot email a customer', () => {
      const fn = code.slice(code.indexOf('async function resendSetupEmail'));
      const body = fn.slice(0, fn.indexOf('\nfunction '));
      expect(body).toContain('confirm(');
      expect(body.indexOf('confirm(')).toBeLessThan(body.indexOf('fetch('));
    });

    test('surfaces a 502 send failure instead of reporting success', () => {
      const fn = code.slice(code.indexOf('async function resendSetupEmail'));
      const body = fn.slice(0, fn.indexOf('\nfunction '));
      // The failure branch must toast an error, never 'success'.
      const idx502 = body.indexOf('res.status === 404');
      expect(idx502).toBeGreaterThan(-1);
      expect(body.slice(idx502)).toContain("'error'");
      expect(body).toContain('Resend failed');
    });

    test('disables the button while in flight and restores it afterwards', () => {
      const fn = code.slice(code.indexOf('async function resendSetupEmail'));
      const body = fn.slice(0, fn.indexOf('\nfunction '));
      expect(body).toContain('btn.disabled = true');
      expect(body).toContain('finally');
      expect(body).toContain('btn.disabled = false');
    });

    test('refreshes the modal after a successful resend so state stays truthful', () => {
      const fn = code.slice(code.indexOf('async function resendSetupEmail'));
      const body = fn.slice(0, fn.indexOf('\nfunction '));
      expect(body).toContain('await loadAll()');
      expect(body).toContain('openDetail(clientId)');
    });
  });

  describe('syntax', () => {
    test('the inline scripts still parse as valid JavaScript', () => {
      for (const [i, s] of scripts.entries()) {
        expect(() => new vm.Script(s, { filename: `admin.html#${i}` })).not.toThrow();
      }
    });
  });
});
