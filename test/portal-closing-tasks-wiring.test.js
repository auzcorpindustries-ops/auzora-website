// test/portal-closing-tasks-wiring.test.js
// CLOSING-TASKS-CATEGORIES (board zeus_1791760575295_ba17804e).
//
// portal.html is a single-file app with no module boundary, so this file pins
// the WIRING of the per-automation Closing Tasks editor:
//   * closing-task config lives in EACH automation's Customize panel on the
//     Automations page — the Leads & CRM page carries no closing-task UI any
//     more (the pre-split card was removed);
//   * the checklist renders TWO grouped sections (positive / negative) from the
//     closing-task catalog the params endpoint returns — categories, labels,
//     descriptions and the documented defaults are never hard-coded;
//   * the selected set round-trips to PUT /portal/workflows/:id/params as
//     `closing_tasks`, i.e. that automation's customize block.
//
// The server-side split, consent semantics and per-automation scoping are
// pinned in atlas-ai:
//   test/unit/closingTasksCategories.test.js (catalog + split semantics)
//   test/unit/closingTasksPerAuto*.test.js    (per-automation write/scope)

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

describe('Leads & CRM no longer carries closing-task UI', () => {
  test('the pre-split Closing Tasks card, list and save path are gone', () => {
    expect(html).not.toContain('id="closing-tasks-card"');
    expect(html).not.toContain('id="closing-tasks-list"');
    expect(html).not.toContain('id="closing-tasks-save"');
    expect(html).not.toContain('saveClosingTasks');
    expect(html).not.toContain('loadClosingTasks');
    expect(html).not.toContain('CLOSING_TASKS_FALLBACK');
  });

  test('opening the Leads page no longer loads a closing-task section', () => {
    expect(html).toMatch(/if \(name === 'leads'\)[^\n]*loadOutbound\(\)/);
    expect(html).not.toMatch(/if \(name === 'leads'\)[^\n]*Closing/i);
  });
});

describe('the Automations Customize panel renders the per-automation checklist', () => {
  test('renderWorkflowParams mounts the closing-tasks section for this automation', () => {
    const region = fnBody('renderWorkflowParams');
    expect(region).toContain('wfClosingTasksSection(templateId, data)');
    // the section is keyed on the automation's own DOM id, like the rest of the panel
    const helper = fnBody('wfClosingTasksSection');
    expect(helper).toContain('id="wfp-${templateId}-closing"');
    expect(helper).toContain('class="wf-closing-task-cb"');
  });

  test('the option list + categories come from the params catalog, never hard-coded', () => {
    const helper = fnBody('wfClosingTasksSection');
    expect(helper).toContain('data.closing_tasks');
    expect(helper).toContain('cat.options');
    expect(helper).toContain('cat.categories');
    expect(helper).toContain('o.category');
    expect(helper).toContain('opt.label');
    expect(helper).toContain('opt.description');
    // the removed / renamed task ids must not be baked into the portal
    expect(helper).not.toContain('lead_captured');
    expect(helper).not.toContain('opt_out_all');
    expect(helper).not.toContain('sms_opt_in');
  });

  test('the checklist renders the two grouped sections', () => {
    expect(html).toContain("positive: 'Positive outcomes'");
    expect(html).toContain("negative: 'Negative outcomes'");
    const helper = fnBody('wfClosingTasksSection');
    expect(helper).toContain('WFP_CLOSING_CATEGORY_TITLES');
    // groups follow the catalog order (positives then negatives)
    expect(helper).toContain('groupHtml');
  });

  test('an unconfigured automation shows the catalog defaults', () => {
    const helper = fnBody('wfClosingTasksSection');
    expect(helper).toContain('cat.configured');
    expect(helper).toContain('cat.defaults');
    expect(helper).toContain('selected.includes(opt.id)');
  });

  test('saving collects this automation\'s closing_tasks into the params body', () => {
    const body = fnBody('collectWorkflowParams');
    expect(body).toContain('closing_tasks');
    expect(body).toContain("panel.querySelectorAll('.wf-closing-task-cb:checked')");
    expect(body).toContain('`#wfp-${templateId}-closing`');
    // the existing per-automation PUT path carries the collected body unchanged
    const save = fnBody('saveWorkflowParams');
    expect(save).toContain('collectWorkflowParams(templateId)');
    expect(save).toContain('/portal/workflows/${templateId}/params');
    expect(save).toContain("method: 'PUT'");
    // reset still drops the whole override block (defaults then apply)
    const reset = fnBody('resetWorkflowParams');
    expect(reset).toContain("body: JSON.stringify({})");
  });
});
