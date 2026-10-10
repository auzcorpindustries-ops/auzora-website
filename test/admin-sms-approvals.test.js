// test/admin-sms-approvals.test.js — SMS-APPROVAL-WORKFLOW
// (ticket zeus_1791607705780_039f7f1d).
//
// The admin queue for the SMS add-on approval workflow: a completed Stripe
// checkout records a request (sms_addon.status 'pending_approval') and does
// NOT enable SMS; an admin opens the SMS Approvals page and clicks Activate,
// which is the ONE place the SMS cap moves.
//
// Static-markup assertions following the convention of
// admin-csv-automations.test.js (jsdom is not a dependency of this repo) plus
// a vm.Script syntax pass over every inline script block.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const repoRoot = path.join(__dirname, '..');
const adminHtml = fs.readFileSync(path.join(repoRoot, 'admin.html'), 'utf8');

const scripts = [];
const scriptRe = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
let m;
while ((m = scriptRe.exec(adminHtml)) !== null) scripts.push(m[1]);
const code = scripts.join('\n');

function fnBody(name) {
  const start = code.indexOf(`function ${name}`);
  expect(start).toBeGreaterThan(-1);
  const rest = code.slice(start + 1);
  const end = rest.indexOf('\nfunction ');
  return rest.slice(0, end === -1 ? rest.length : end);
}

describe('admin.html — SMS Approvals queue exists and is reachable', () => {
  test('a nav item opens the sms-approvals page', () => {
    expect(adminHtml).toMatch(/id="nav-sms-approvals"/);
    expect(adminHtml).toContain("showPage('sms-approvals')");
  });

  test('the page container + list render', () => {
    expect(adminHtml).toMatch(/id="page-sms-approvals"/);
    expect(adminHtml).toMatch(/id="sms-approvals-list"/);
    expect(adminHtml).toContain('SMS Approvals');
  });

  test('showPage() loads the queue when the page opens', () => {
    const body = fnBody('showPage');
    expect(body).toContain("if (name === 'sms-approvals') loadSmsApprovals();");
  });
});

describe('admin.html — the queue is driven by the admin SMS-approval API', () => {
  test('loadSmsApprovals reads GET /admin/sms-approvals with the admin key', () => {
    const body = fnBody('loadSmsApprovals');
    expect(body).toContain('/sms-approvals`');
    expect(body).toMatch(/fetch\(`\$\{API\}\/sms-approvals`/);
    expect(body).toContain("'x-api-key': apiKey");
  });

  test('rows quote the client id for the inline handler (JS-literal rule)', () => {
    const body = fnBody('loadSmsApprovals');
    expect(body).toContain('const clientLit = adminJsLiteral(r.client_id)');
    expect(body).toContain('activateSmsApproval(${clientLit})');
    expect(body).toContain('rejectSmsApproval(${clientLit})');
    // never the raw unquoted interpolation
    expect(body).not.toContain('activateSmsApproval(${r.client_id})');
  });

  test('activateSmsApproval PATCHes the activate endpoint', () => {
    const body = fnBody('activateSmsApproval');
    expect(body).toMatch(/\/sms-approvals\/\$\{encodeURIComponent\(clientId\)\}\/activate/);
    expect(body).toContain("method: 'PATCH'");
    expect(body).toContain("'x-api-key': apiKey");
  });

  test('rejectSmsApproval PATCHes the reject endpoint with a reason', () => {
    const body = fnBody('rejectSmsApproval');
    expect(body).toMatch(/\/sms-approvals\/\$\{encodeURIComponent\(clientId\)\}\/reject/);
    expect(body).toContain("method: 'PATCH'");
    expect(body).toContain('reason');
  });
});

describe('admin.html — syntax', () => {
  test('the inline scripts still parse as valid JavaScript', () => {
    for (const [i, s] of scripts.entries()) {
      expect(() => new vm.Script(s, { filename: `admin.html#${i}` })).not.toThrow();
    }
  });
});
