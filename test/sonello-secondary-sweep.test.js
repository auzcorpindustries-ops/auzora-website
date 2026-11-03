// test/sonello-secondary-sweep.test.js — Sonello RB-4 secondary pages brand
// sweep (ticket zeus_1793686465279_feaa69e1).
//
// Guards the customer-visible brand rename (Auzora / Atlas -> Sonello) on the
// secondary surfaces the sweep covered: demo, checkout, payment-success,
// contact, legal titles/footers, and the docs microsite (HTML shells + the
// docs-md/*.md runtime content sources + their docs/ and public/docs/ mirrors).
//
// KEEP LIST honored (things this test asserts STAY, not regress):
//   - docs page slugs containing 'atlas' (shared links: /docs/using-your-
//     atlas-phone-number/, /docs/forwarding-personal-phone-to-atlas/) and the
//     lowercase `const slug` values that drive the /docs-md/<slug>.md fetch;
//   - mailbox addresses (@auzora.io: support@, hello@, ahoward@) — no
//     @sonello mailboxes provisioned yet (audit P1-8/P3-5; RB-3 precedent);
//   - payment-success.html line 167 quotes the LIVE email sender + subject
//     still sent by atlas-ai src/services/email.js (From 'Auzora
//     <noreply@auzora.io>', subject 'Payment Confirmed — Complete Your Auzora
//     Setup') — the page copy must keep matching reality until the Phase 3
//     email flip (P3-1/P3-3), so its two capitalized 'Auzora' occurrences are
//     intentional and asserted here;
//   - internal hosts (atlas.6845165.xyz / atlas-staging.6845165.xyz API bases).

const fs = require('fs');
const path = require('path');

const repoRoot = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(repoRoot, p), 'utf8');

// Capitalized brand words. Case-sensitive on purpose: the lowercase 'atlas'
// inside slugs/hrefs/slug-consts and internal hosts is keep-listed.
const BRAND = /\b(Atlas AI|Atlas|Auzora)\b/g;

function brandMatches(text) {
  return text.match(BRAND) || [];
}

describe('Sonello RB-4: secondary pages brand sweep', () => {
  test('demo.html is fully Sonello (title, nav logo, hero copy, copyright)', () => {
    const html = read('demo.html');
    expect(html).toContain('<title>Sonello — Live Demo</title>');
    expect(html).toContain('class="nav-logo">Sonello</a>');
    expect(html).toContain('What Sonello Can Do');
    expect(html).toContain('© 2026 Sonello');
    expect(brandMatches(html)).toEqual([]);
  });

  test('checkout.html title is Sonello (page is a redirect shim, no other refs)', () => {
    const html = read('checkout.html');
    expect(html).toContain('<title>Checkout — Sonello</title>');
    expect(brandMatches(html)).toEqual([]);
  });

  test('payment-success.html title + copy are Sonello; email-subject quote + mailbox intentionally kept', () => {
    const html = read('payment-success.html');
    expect(html).toContain('<title>Payment Confirmed — Sonello</title>');
    expect(html).toContain('class="nav-logo">Sonello<span>.</span>');
    expect(html).toContain('Back to sonello.ai');
    expect(html).toContain('attached to <strong>Sonello</strong> account:');
    expect(html).toContain('sent to <strong>Sonello</strong> at:');
    // KEEP: must keep matching the email atlas-ai actually sends today.
    expect(html).toContain('Look for an email from <strong>Auzora</strong>');
    expect(html).toContain('Payment Confirmed — Complete Your Auzora Setup');
    expect(html).toContain('support@auzora.io');
    // Exactly the two intentional 'Auzora' occurrences in the subject quote.
    expect(brandMatches(html)).toEqual(['Auzora', 'Auzora']);
    // KEEP LIST: API-base hosts unchanged.
    expect(html).toContain('atlas-staging.6845165.xyz');
    expect(html).toContain('atlas.6845165.xyz');
  });

  test('contact.html title + logo + lead source are Sonello; hello@ mailbox kept', () => {
    const html = read('contact.html');
    expect(html).toContain('<title>Get a Free Automation Audit · Sonello</title>');
    expect(html).toContain('<span class="logo-text">Sonello</span>');
    expect(html).toContain("'Sonello Website'");
    expect(html).toContain('hello@auzora.io');
    expect(brandMatches(html)).toEqual([]);
    // KEEP LIST: webhook host untouched.
    expect(html).toContain('automation.6845165.xyz');
  });

  test('legal pages: titles + footers are Sonello; legal-entity body copy untouched pending sign-off', () => {
    expect(read('legal/privacy.html')).toContain('<title>Privacy Policy — Sonello</title>');
    expect(read('legal/terms.html')).toContain('<title>Terms of Service — Sonello</title>');
    expect(read('legal/ai-policy.html')).toContain('<title>AI & Telephony Policy — Sonello</title>');
    for (const f of ['legal/privacy.html', 'legal/terms.html', 'legal/ai-policy.html']) {
      expect(read(f)).toContain('© 2026 Sonello');
    }
    // Entity-defining line keeps the legal name (flagged for owner confirmation
    // in the PR body — do not guess).
    expect(read('legal/privacy.html')).toContain('Auzora ("we," "us," or "our")');
  });

  const docsPages = [
    ['docs/index.html', '<title>Sonello Docs</title>'],
    ['docs/account-tiers/index.html', '<title>Sonello Docs — Account tiers &amp; plans</title>'],
    ['docs/google-calendar-setup/index.html', '<title>Sonello Docs — Google Calendar setup</title>'],
    ['docs/outbound-sms-and-callbacks/index.html', '<title>Sonello Docs — SMS campaigns & AI callbacks</title>'],
    ['docs/forwarding-personal-phone-to-atlas/index.html', '<title>Sonello Docs — Forward your personal phone to Sonello</title>'],
    ['docs/using-your-atlas-phone-number/index.html', '<title>Sonello Docs — Using your Sonello phone number</title>'],
    ['public/docs/forwarding-personal-phone-to-atlas/index.html', '<title>Sonello — AI Phone Agent for Local Business</title>'],
    ['public/docs/google-calendar-setup/index.html', '<title>Sonello Docs — Connect Google Calendar to Sonello</title>'],
    ['public/docs/using-your-atlas-phone-number/index.html', '<title>Sonello Docs — Using your Sonello phone number</title>'],
  ];

  test.each(docsPages)('%s title is Sonello and no capitalized brand words remain', (file, title) => {
    const html = read(file);
    expect(html).toContain(title);
    expect(brandMatches(html)).toEqual([]);
  });

  test('docs slugs containing "atlas" are preserved (shared links — KEEP list)', () => {
    const index = read('docs/index.html');
    expect(index).toContain('href="/docs/using-your-atlas-phone-number/"');
    expect(index).toContain('href="/docs/forwarding-personal-phone-to-atlas/"');
    const using = read('docs/using-your-atlas-phone-number/index.html');
    const forwarding = read('docs/forwarding-personal-phone-to-atlas/index.html');
    expect(using).toContain("const slug = 'using-your-atlas-phone-number'");
    expect(forwarding).toContain("const slug = 'forwarding-personal-phone-to-atlas'");
  });

  test('docs-md content sources (runtime-rendered) are brand-clean; mailboxes + portal links correct', () => {
    const sources = [
      'docs-md/account-tiers.md',
      'docs-md/forwarding-personal-phone-to-atlas.md',
      'docs-md/google-calendar-setup.md',
      'docs-md/outbound-sms-and-callbacks.md',
      'docs-md/using-your-atlas-phone-number.md',
      'docs/forwarding-personal-phone-to-atlas.md',
      'docs/google-calendar-setup.md',
      'docs/using-your-atlas-phone-number.md',
      'public/docs/forwarding-personal-phone-to-atlas.md',
      'public/docs/google-calendar-setup.md',
      'public/docs/using-your-atlas-phone-number.md',
    ];
    for (const f of sources) {
      const md = read(f);
      expect(brandMatches(md)).toEqual([]);
      // Mailboxes keep their auzora.io addresses (no @sonello mailboxes yet).
      if (f === 'docs-md/account-tiers.md' || f === 'docs-md/outbound-sms-and-callbacks.md') {
        expect(md).toContain('support@auzora.io');
      }
    }
    // Portal links point at the live primary domain (RB-1 canonical target).
    const gcal = read('docs-md/google-calendar-setup.md');
    expect(gcal).toContain('https://sonello.ai/portal');
    expect(gcal).toContain('ahoward@auzora.io');
  });

  test('portal-embedded config guide copy is Sonello (rendered in portal Docs tab)', () => {
    const html = read('docs/portal-config-guide.html');
    expect(html).toContain('Sonello Configuration Docs');
    expect(html).toContain('dials your Sonello number');
    expect(html).toContain('support@auzora.io');
    expect(brandMatches(html)).toEqual([]);
  });

  test('regression: no swept page lost its Sonello nav/copy while slugs stayed', () => {
    // The sweep is a pure copy swap: total diff must stay balanced. Spot-check
    // that structural keep-list anchors survived alongside the rename.
    const using = read('docs/using-your-atlas-phone-number/index.html');
    expect(using).toContain('Using your Sonello phone number');
    expect(using).not.toContain('Using your Atlas phone number');
    const forwardingMd = read('docs-md/forwarding-personal-phone-to-atlas.md');
    expect(forwardingMd).toContain('# Forward your personal phone to Sonello');
    expect(forwardingMd).not.toMatch(/\bAtlas\b/);
  });
});
