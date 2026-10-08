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

  // ── Customize gating (zeus_1791430190387_7ad7a48a) ──────────────────────
  test('workflowCardHtml gates the Customize button + params panel on the flag', () => {
    const body = fnBody('workflowCardHtml');
    expect(body).toContain('const showCustomize = customizable === true;');
    // button + panel now render only when showCustomize is true...
    expect(body).toContain('${showCustomize ? `<button onclick="toggleWorkflowParams(${ref})"');
    expect(body).toContain('${showCustomize ? `<div id="wf-params-${domId}"');
    // ...and the old unconditional controls (each starting its own line) are gone.
    expect(body).not.toMatch(/\n\s*<button onclick="toggleWorkflowParams\(\$\{ref\}\)" id="wf-cfg-btn-/);
    expect(body).not.toMatch(/\n\s*<div id="wf-params-\$\{domId\}"/);
  });

  test('loadWorkflows passes customizable for offering and legacy rows', () => {
    const body = fnBody('loadWorkflows');
    expect(body).toContain('customizable: WorkflowGrid.isCustomizable(of),');
    expect(body).toContain('customizable: WorkflowGrid.isCustomizable(w),');
  });

  // ── CSV-CUSTOMIZE-FIX ──────────────────────────────────────────────────
  // Offering keys are strings; the params panel was emitting
  // onclick="toggleWfpStep(imported_leads_voice, …)" (an unquoted identifier →
  // ReferenceError), so every step toggle + button on an offering panel was
  // dead. Every inline handler must use the JS-literal form of the ref.
  test('renderWorkflowParams quotes the workflow ref in every inline handler', () => {
    const body = fnBody('renderWorkflowParams');
    expect(body).toContain('const ref = wfRefLiteral(templateId);');
    for (const call of [
      'toggleWfpStep', 'updateWaitHint', 'updateTemplateCount', 'insertMergeField',
      'collapseAllWfpSteps', 'saveWorkflowParams', 'previewWorkflowParams', 'resetWorkflowParams',
    ]) {
      expect(body).toContain(`${call}(\${ref}`);
      // the old, dead unquoted form is gone
      expect(body).not.toContain(`${call}(\${templateId}`);
    }
    // DOM ids stay keyed on the raw reference (valid either way).
    expect(body).toContain('id="wfp-${templateId}-wait-${w.key}-value"');
  });

  // The step order must come from the API's IR-derived `steps`, not from
  // parsing WORKFLOW_META[id].desc (which has no entry for an offering key, so
  // the old fallback showed every wait before every message).
  test('buildWorkflowSteps renders the IR-derived order when the API supplies steps', () => {
    const body = fnBody('buildWorkflowSteps');
    expect(body).toContain('Array.isArray(data.steps)');
    expect(body).toContain('for (const s of data.steps)');
    // still falls back to the desc parse when steps is absent
    expect(body).toContain("const desc = meta.desc || '';");
  });
});
