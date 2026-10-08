// test/admin-csv-automations.test.js — ADMIN-WF (ticket zeus_1791419030234_3101813a)
//
// Two admin-portal defects:
//   1. approve/reject broken for OFFERING requests. Pending rows carry
//      offering_key and template_id=null, but the buttons interpolated
//      template_id → PATCH /workflows/<client>/null/approve → 404. Rows must
//      resolve `offering_key || template_id`, render the backend-supplied name
//      and quote string refs.
//   2. CSV-import automations had no admin panel. The two flag-provisioned
//      variants (imported_leads_voice / imported_leads_sms) need a per-client
//      enable/disable surface, wired to the existing approve/reject routes.
//
// Static-markup assertions (jsdom is not a dependency of this repo), following
// the convention of admin-resend-setup-email.test.js + a vm.Script syntax pass.

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

describe('admin.html — offering requests are approvable (ADMIN-WF defect 1)', () => {
  test('pending rows resolve offering_key before template_id', () => {
    const body = fnBody('loadWorkflowRequests');
    expect(body).toMatch(/const\s+ref\s*=\s*r\.offering_key\s*\|\|\s*r\.template_id/);
  });

  test('pending rows render the backend name, not "Unknown" for offerings', () => {
    const body = fnBody('loadWorkflowRequests');
    expect(body).toMatch(/r\.name\s*\|\|\s*WF_NAMES\[r\.template_id\]/);
  });

  test('approve/reject are called with the resolved ref, not raw template_id', () => {
    const body = fnBody('loadWorkflowRequests');
    expect(body).toContain('approveWorkflow(${clientLit}, ${refLit})');
    expect(body).toContain('rejectWorkflow(${clientLit}, ${refLit})');
    // the broken form must be gone
    expect(adminHtml).not.toContain("approveWorkflow('${r.client_id}', ${r.template_id})");
    expect(adminHtml).not.toContain("rejectWorkflow('${r.client_id}', ${r.template_id})");
  });

  test('string offering keys are quoted for the inline handler; numbers stay bare', () => {
    const body = fnBody('adminJsLiteral');
    expect(body).toMatch(/typeof\s+v\s*===\s*'number'/);
    expect(body).toContain("replace(/'/g");
  });
});

describe('admin.html — CSV-import automation panel (ADMIN-WF defect 2)', () => {
  test('the panel markup renders on the Workflow Requests page', () => {
    expect(adminHtml).toMatch(/id="csv-automation-client"/);
    expect(adminHtml).toMatch(/id="csv-automation-list"/);
    expect(adminHtml).toMatch(/onchange="loadCsvAutomations\(\)"/);
    expect(adminHtml).toContain('CSV Import Automations');
  });

  test('it covers both flag-provisioned variants', () => {
    expect(code).toMatch(/imported_leads_voice/);
    expect(code).toMatch(/imported_leads_sms/);
    expect(code).toMatch(/CSV_IMPORT_AUTOMATIONS/);
  });

  test('the client list loads from the admin clients endpoint', () => {
    const body = fnBody('loadCsvAutomationClients');
    expect(body).toContain('/clients`');
    expect(body).toContain('adminAuthHeaders()');
  });

  test('state comes from the per-client workflows endpoint and drives the button', () => {
    const body = fnBody('loadCsvAutomations');
    expect(body).toMatch(/\/workflows\/\$\{encodeURIComponent\(clientId\)\}/);
    expect(body).toContain("status === 'active'");
    expect(body).toContain('setCsvAutomation(${clientLit}, ${keyLit},');
  });

  test('setCsvAutomation drives the EXISTING approve (enable) / reject (disable) routes', () => {
    const body = fnBody('setCsvAutomation');
    expect(body).toContain("const action = enable ? 'approve' : 'reject'");
    expect(body).toMatch(/\/\$\{action\}`/);
    expect(body).toContain("method: 'PATCH'");
    expect(body).toContain("'x-api-key': apiKey");
  });

  test('the workflows page wires the panel to load on open', () => {
    const body = fnBody('showPage');
    expect(body).toContain('loadCsvAutomationClients()');
  });
});

describe('admin.html — syntax', () => {
  test('the inline scripts still parse as valid JavaScript', () => {
    for (const [i, s] of scripts.entries()) {
      expect(() => new vm.Script(s, { filename: `admin.html#${i}` })).not.toThrow();
    }
  });
});
