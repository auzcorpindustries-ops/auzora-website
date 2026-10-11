// test/portal-closing-tasks-wiring.test.js
// CLOSING-TASKS-CONFIG (board zeus_1791744768507_f995a09e).
//
// portal.html is a single-file app with no module boundary, so this file pins
// the WIRING of the Leads/CRM "Closing Tasks" section: the card + list + save
// button ship in the Leads page, the section loads its option list from the
// closing-task catalog (GET /portal/automations — never hard-coded), the
// selected set round-trips to the settings API as `closing_tasks`, and an
// unconfigured client falls back to the catalog defaults. That saved config is
// what the backend's CLOSING-TASK-DETECT reads to terminate an automation.
//
// The behaviour of the write path + catalog payload (allowlist, normalization,
// expose, end-to-end drive) lives server-side and is covered by:
//   atlas-ai: test/unit/closingTaskConfig.test.js
//   atlas-ai: test/unit/closingTaskDetect.test.js

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

describe('portal.html Closing Tasks section (Leads & CRM)', () => {
  test('the section ships inside the Leads page with list + save + status', () => {
    expect(html).toContain('id="closing-tasks-card"');
    expect(html).toContain('id="closing-tasks-list"');
    expect(html).toContain('id="closing-tasks-save"');
    expect(html).toContain('id="closing-tasks-status"');
    expect(html).toContain('onclick="saveClosingTasks()"');
    expect(html).toContain('Closing Tasks');
  });

  test('opening the Leads page loads the section', () => {
    expect(html).toMatch(/if \(name === 'leads'\)[^\n]*loadClosingTasks\(\)/);
  });

  test('loadClosingTasks pulls the option list from the automation catalog', () => {
    const body = fnBody('loadClosingTasks');
    expect(body).toContain('/portal/automations');
    expect(body).toContain('data.closing_tasks');
    expect(body).toContain('options');
    // a fallback keeps the section usable if the catalog fetch fails
    expect(body).toContain('CLOSING_TASKS_FALLBACK');
    expect(body).toContain('renderClosingTasks()');
  });

  test('renderClosingTasks renders one checkbox per catalog option, checked when selected', () => {
    const body = fnBody('renderClosingTasks');
    expect(body).toContain('catalog.options');
    expect(body).toContain('class="closing-task-cb"');
    expect(body).toContain('selected.includes(opt.id)');
    expect(body).toContain('checked');
  });

  test('selectedClosingTasks falls back to the catalog defaults when unset', () => {
    const body = fnBody('selectedClosingTasks');
    expect(body).toContain('portalClient?.closing_tasks');
    expect(body).toContain('catalog.defaults');
  });

  test('saveClosingTasks PATCHes closing_tasks to the settings API', () => {
    const body = fnBody('saveClosingTasks');
    expect(body).toContain('/portal/settings');
    expect(body).toContain("method: 'PATCH'");
    expect(body).toContain('closing_tasks: selected');
    expect(body).toContain("querySelectorAll('.closing-task-cb:checked')");
  });
});
