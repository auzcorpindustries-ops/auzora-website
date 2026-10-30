// jest.config.js — auzora-website (static site, no build step)
//
// Coverage notes (ticket zeus_1793167128820_117e00c3, audit gap F8):
// The bulk of this repo's logic lives in portal.html / admin.html as INLINE
// <script> blocks. Istanbul cannot instrument inline HTML scripts, so those
// lines will never appear in a coverage report — that is a known, documented
// limitation, NOT a suite gap. The structural suites (test/portal-*-wiring
// brace-match functions out of the HTML and execute them) and the Playwright
// browser suites are the coverage mechanism for that surface. Line coverage
// of the inline scripts is not claimable, by design.
//
// collectCoverageFrom therefore targets only the real extracted JS modules
// (js/*.js, the netlify plugin). Two things are deliberately NOT claimable
// here and must not be "added" to the report with fake plumbing:
//   - portal.html / admin.html inline scripts (Istanbul cannot see them);
//   - root-level script.js (browser-only marketing-site code; it is never
//     `require()`d by the node suite, so jest has nothing to report on it —
//     a coverage entry would only exist if a test loaded it, which would
//     require an application-code export change, out of scope for a
//     test-only ticket).
// coverageThreshold is set just BELOW the measured baseline so it can only
// ratchet up; run it with
//   npm run test:coverage
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/test/**/*.test.js'],
  clearMocks: true,
  collectCoverageFrom: [
    'js/**/*.js',
    'netlify/plugins/**/*.js',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text-summary', 'text', 'json-summary', 'lcov'],
  coverageThreshold: {
    global: {
      statements: 77,
      branches: 71,
      functions: 78,
      lines: 78,
    },
  },
};
