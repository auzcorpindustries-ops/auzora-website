// test/portal-objective-wiring.test.js
// CLOSING-TASKS-OBJECTIVE (board zeus_1791761303026_e6fc5e52).
//
// portal.html is a single-file app with no module boundary, so this file pins
// the WIRING of the per-automation Objective field in the Customize panel:
//   * the Objective section lives in EACH automation's Customize block (the
//     wfp params editor) — label, helper text and the 120-char cap all come
//     from the params catalog (`data.objective`), never hard-coded;
//   * the input is single-line, mirrors the server cap via maxlength, and its
//     live counter renders as <len>/<max>;
//   * the value round-trips to PUT /portal/workflows/:id/params as `objective`
//     in the same customize block, and is collected ONLY when the field
//     actually rendered (so an older backend can't have it wiped by an
//     unrelated save).
//
// The server-side catalog entry, cap validation and (both engines) prompt
// assembly are pinned in atlas-ai:
//   test/unit/closingTasksObjective.test.js  (catalog + legacy prompt + portal API)
//   test/unit/openaiLive.test.js             (GPT-Live outbound instructions)

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

describe('the Customize panel renders the per-automation Objective field', () => {
  test('renderWorkflowParams mounts the objective section for this automation', () => {
    const region = fnBody('renderWorkflowParams');
    expect(region).toContain('wfObjectiveSection(templateId, data)');
    const helper = fnBody('wfObjectiveSection');
    // keyed on the automation's own DOM id, like the rest of the panel
    expect(helper).toContain('id="wfp-${templateId}-objective"');
    expect(helper).toContain('id="wfp-${templateId}-objective-input"');
  });

  test('label, helper text and cap all come from the params catalog — never hard-coded', () => {
    const helper = fnBody('wfObjectiveSection');
    expect(helper).toContain('data.objective');
    expect(helper).toContain('obj.label');
    expect(helper).toContain('obj.help');
    expect(helper).toContain('obj.maxLength');
    expect(helper).toContain('obj.value');
    // the exact helper string lives server-side (workflowParamCatalog), not here
    expect(helper).not.toContain('Guide the conversation toward this outcome.');
    // no hard-coded 120 either — the cap is read from the catalog
    expect(helper).toContain('Number(obj.maxLength)');
  });

  test('single-line input mirrors the server cap via maxlength', () => {
    const helper = fnBody('wfObjectiveSection');
    expect(helper).toContain('type="text"');
    expect(helper).toContain('maxlength="${max}"');
    expect(helper).toContain('oninput="updateObjectiveCount(');
  });

  test('the live counter mirrors the 120-char ceiling', () => {
    const counter = fnBody('updateObjectiveCount');
    expect(counter).toContain('maxlength');
    expect(counter).toContain('/${max}');
    // initialised on render, like the wait/template counters
    expect(fnBody('renderWorkflowParams')).toContain('updateObjectiveCount(templateId)');
  });

  test('native theme-variable styling (no bespoke palette)', () => {
    const helper = fnBody('wfObjectiveSection');
    expect(helper).toContain('var(--field-border)');
    expect(helper).toContain('var(--field)');
    expect(helper).toContain('var(--text)');
    expect(helper).toContain('var(--muted)');
  });

  test('saving collects this automation\'s objective into the params body', () => {
    const body = fnBody('collectWorkflowParams');
    expect(body).toContain('body.objective');
    expect(body).toContain('`#wfp-${templateId}-objective`');
    expect(body).toContain('`wfp-${templateId}-objective-input`');
    // only collected when the field rendered
    expect(body).toMatch(/if \(panel && panel\.querySelector\(`#wfp-\$\{templateId\}-objective`\)\)/);
    // the existing per-automation PUT path carries the collected body unchanged
    const save = fnBody('saveWorkflowParams');
    expect(save).toContain('collectWorkflowParams(templateId)');
    expect(save).toContain('/portal/workflows/${templateId}/params');
    expect(save).toContain("method: 'PUT'");
    // reset still drops the whole override block (clear semantics)
    const reset = fnBody('resetWorkflowParams');
    expect(reset).toContain("body: JSON.stringify({})");
  });
});

describe('non-goals are respected in the UI', () => {
  test('the objective introduces no termination controls', () => {
    const helper = fnBody('wfObjectiveSection');
    // closing-task checkboxes remain the SOLE end mechanism — the objective
    // section adds no checkbox, hangup or transfer control.
    expect(helper).not.toContain('checkbox');
    expect(helper).not.toContain('closing-task');
    expect(helper).not.toContain('hangup');
    expect(helper).not.toContain('transfer');
  });
});
