// test/payment-success.test.js — PRICING-3: SMS add-on handoff on the
// payment-success page.
//
// Guards the page's two checkout paths:
//   - the add-on detection branch exists and shows "SMS add-on activated"
//     with the "up to N messages/mo" shape (ticket copy), keyed off the
//     /api/checkout-session `type: 'addon'` payload atlas-ai returns;
//   - the plan-checkout onboarding path is UNTOUCHED (h2/setup-link copy and
//     the next-steps block still present, default-hidden banner);
//   - no regression of the session_id → checkout-session fetch wiring.

const fs = require('fs');
const path = require('path');

const repoRoot = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(repoRoot, 'payment-success.html'), 'utf8');

describe('payment-success.html SMS add-on handoff (PRICING-3)', () => {
  test('add-on banner markup exists, hidden by default (plan checkouts unaffected)', () => {
    expect(html).toContain('id="addon-banner"');
    expect(html).toMatch(/\.addon-banner\s*{[^}]*display:\s*none/s);
    expect(html).toContain('SMS add-on activated');
  });

  test('add-on branch keys off type=addon and shows the N messages/mo copy', () => {
    const script = html.slice(html.indexOf('<script>'), html.indexOf('</script>'));
    expect(script).toContain("data.type === 'addon'");
    expect(script).toContain("messagesPerMonth");
    expect(script).toContain("messages/mo");
    // Banner + addon h2 flip on; onboarding surfaces flip off.
    expect(script).toContain("banner.style.display = 'block'");
    expect(script).toContain("getElementById('success-h2')");
    expect(script).toContain("'.next-steps'");
  });

  test('plan-checkout onboarding path is preserved', () => {
    expect(html).toContain('Your setup link is on its way');
    expect(html).toContain('What happens next');
    expect(html).toContain('A setup link has been sent to <strong>Auzora</strong> at:');
  });

  test('checkout-session wiring unchanged (session_id param → /api/checkout-session)', () => {
    expect(html).toContain("params.get('session_id')");
    expect(html).toContain('/api/checkout-session?session_id=');
  });
});
