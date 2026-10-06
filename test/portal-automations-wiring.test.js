// test/portal-automations-wiring.test.js
// Ticket zeus_1791325526552_7232e5bf.
//
// portal.html is a single-file app with no module boundary, so the *behaviour*
// of the extracted pure helpers (workflowToggle / pendingAge / csv_import copy)
// is covered in test/workflow-grid.test.js. This file asserts the WIRING inside
// portal.html so a regression can't quietly revert the stuck-pending fix or the
// consent opt-in — the old buggy patterns must be gone and the new seams present.

const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'portal.html'), 'utf8');

// Body of a top-level function: from its declaration to the next top-level
// `function`/`async function` declaration.
function fnBody(name) {
  const start = html.indexOf('function ' + name + '(');
  expect(start).toBeGreaterThan(-1);
  const rest = html.slice(start + 1);
  const m = rest.search(/\n(async )?function /);
  return m === -1 ? rest : rest.slice(0, m);
}

describe('portal.html automations wiring', () => {
  test('workflowCardHtml delegates the toggle to WorkflowGrid.workflowToggle', () => {
    const body = fnBody('workflowCardHtml');
    expect(body).toContain('WorkflowGrid.workflowToggle(status)');
    // The buggy "Pending is a dead, disabled toggle" pattern is gone.
    expect(body).not.toMatch(/toggleDisabled\s*=\s*status\s*===\s*'requested'/);
    expect(body).not.toMatch(/status\s*===\s*'requested'\s*\?\s*''/);
  });

  test('workflowCardHtml renders the pending age on requested cards', () => {
    const body = fnBody('workflowCardHtml');
    expect(body).toContain("status === 'requested' ? WorkflowGrid.pendingAge(requestedAt)");
    expect(body).toContain('ageText');
  });

  test('loadWorkflows passes requestedAt for both offering and legacy rows', () => {
    const body = fnBody('loadWorkflows');
    expect(body).toContain('requestedAt: of.requested_at');
    expect(body).toContain('requestedAt: w.requested_at');
  });

  test('import posts the import-level sms_consent flag (from the checkbox)', () => {
    const body = fnBody('executeLeadImport');
    expect(body).toContain("getElementById('li-sms-consent')");
    expect(body).toContain('sms_consent: smsConsent');
  });

  test('the consent checkbox exists and is NOT pre-checked', () => {
    const m = html.match(/<input[^>]*id="li-sms-consent"[^>]*>/);
    expect(m).toBeTruthy();
    expect(m[0]).not.toMatch(/\bchecked\b/);
  });

  test('per-row consent is parsed explicitly, never inferred', () => {
    expect(fnBody('parseConsentValue')).toContain("'opted_in'");
    expect(fnBody('getImportedLeads')).toContain("field === 'sms_consent'");
  });

  test('clearLeadImport resets the consent checkbox', () => {
    expect(fnBody('clearLeadImport')).toContain("getElementById('li-sms-consent')");
  });
});
