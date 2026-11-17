# gitleaks baseline — auzora-website (SEC-3)

Source scan: full history (`gitleaks detect --log-opts="--all"`).
Raw JSON (SEC-6 input): `~/Projects/audits/sec3-history-scan/auzora-website.json`.

Enforcement: commit+path-pinned allowlists in `.gitleaks.toml` — secret
values are deliberately NOT listed in this repo. A new secret introduced
in these files in a NEW commit is still flagged.

Findings (4):

- `generic-api-key` index.html:692 (commit d21ca0ab) — Widget config key in the historical embeddable-widget index.html; widget since removed from the page and the key rotated. Historical-only finding.
- `generic-api-key` index.html:692 (commit cd5f8675) — Widget config key in the historical embeddable-widget index.html; widget since removed from the page and the key rotated. Historical-only finding.
- `generic-api-key` test/portal-embed-snippet-hostname-browser.test.js:94 (commit e123d865) — Placeholder API key in browser test fixture for embed-snippet generation; not a live secret.
- `generic-api-key` test/portal-embed-snippet-hostname-browser.test.js:94 (commit d8cf1f4b) — Placeholder API key in browser test fixture for embed-snippet generation; not a live secret.
