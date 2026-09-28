// Netlify build plugin — BILL-1 Stripe link-mode injection.
//
// Injects the resolved STRIPE_LINK_MODE ("test" | "live") into index.html as
// window.STRIPE_LINK_MODE before the deploy is published. The env var itself
// is set per Netlify context in netlify.toml (develop/deploy-preview = "test",
// everything else = "live").
//
// Index.html reads `window.STRIPE_LINK_MODE` and swaps PRICING_TIERS links to
// the ACTIVE test-mode payment links when it equals "test".
const fs = require('fs');
const path = require('path');

module.exports = function ({ constants }) {
  return {
    onPreBuild: () => {
      const publishDir = constants.PUBLISH_DIR;
      const indexHtml = path.join(publishDir, 'index.html');
      const mode = (process.env.STRIPE_LINK_MODE || 'live').trim().toLowerCase();
      const safe = mode === 'test' ? 'test' : 'live';

      if (!fs.existsSync(indexHtml)) {
        console.warn(`[stripe-link-mode] index.html not found in publish dir (${publishDir}) — nothing injected`);
        return;
      }

      let html = fs.readFileSync(indexHtml, 'utf8');
      const marker = 'window.STRIPE_LINK_MODE';
      if (html.includes(`${marker} = `)) {
        html = html.replace(
          new RegExp(`${marker}\\s*=\\s*['"](?:test|live)['"];?`),
          `${marker} = '${safe}';`
        );
      } else {
        html = html.replace(
          '<script>',
          `<script>\n    window.STRIPE_LINK_MODE = '${safe}';`
        );
      }
      fs.writeFileSync(indexHtml, html);
      console.log(`[stripe-link-mode] window.STRIPE_LINK_MODE = '${safe}' injected into index.html`);
    },
  };
};
