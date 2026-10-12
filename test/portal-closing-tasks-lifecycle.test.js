// test/portal-closing-tasks-lifecycle.test.js
// CLOSING-TASKS-LIFECYCLE (board zeus_1791829493407_e891fd84) — the portal side.
//
// portal.html is a single-file app with no module boundary, so this file pins
// the WIRING of the per-target status chips in the Captured Leads interaction
// detail (`showLeadTimeline`, the modal opened from a lead row):
//   * each POSITIVE closing task is rendered from the `closing_tasks.tasks`
//     payload the backend serves (GET /portal/leads/:id/timeline) — labels are
//     never hard-coded client-side;
//   * pending = neutral, accepted = green, rejected = rejected-red, and an
//     absent/unknown status renders as pending (the conservative default);
//   * the chips appear in BOTH render paths (the empty-timeline path and the
//     timeline path) so they can never silently disappear;
//   * the chip CSS uses THEME VARIABLES only (light/dark stay automatic).
//
// The status model + the server payload are pinned in atlas-ai:
//   test/unit/closingTasksLifecycle.test.js     (statuses, transitions, end condition)
//   test/unit/closingTasksLifecycleApi.test.js  (the timeline payload)

const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'portal.html'), 'utf8');

function fnBody(name) {
  const start = html.indexOf('function ' + name + '(');
  expect(start).toBeGreaterThan(-1);
  const rest = html.slice(start + 1);
  const m = rest.search(/\n(async )?function /);
  return m === -1 ? rest : rest.slice(0, m);
}

describe('interaction detail renders a status chip per positive closing task', () => {
  test('showLeadTimeline reads the closing_tasks payload from the timeline response', () => {
    const body = fnBody('showLeadTimeline');
    expect(body).toContain('data.closing_tasks');
    expect(body).toContain('closing_tasks.tasks');
    // the set comes from the server — no client-side task list
    expect(body).not.toContain('appointment_booked');
    expect(body).not.toContain('callback_agreed');
  });

  test('the three statuses map to their chip classes, unknown → pending', () => {
    const body = fnBody('showLeadTimeline');
    expect(body).toContain('ctStatusLabel');
    expect(body).toMatch(/ctStatusLabel = \{ pending: 'Pending', accepted: 'Accepted', rejected: 'Rejected' \}/);
    // unknown/absent status falls back to pending before the class is built
    expect(body).toContain('hasOwnProperty.call(ctStatusLabel, t.status)');
    expect(body).toContain('class="ct-chip ct-chip-${status}"');
  });

  test('the chips render in BOTH paths (empty timeline and timeline)', () => {
    const body = fnBody('showLeadTimeline');
    const occurrences = body.split('actionsHtml + closingTasksHtml').length - 1;
    expect(occurrences).toBe(2);
    // …and the empty-state path still returns the empty notice
    expect(body).toContain("No activity recorded for this lead yet.");
  });

  test('labels are escaped before they reach innerHTML', () => {
    const body = fnBody('showLeadTimeline');
    expect(body).toContain('function ctEscape');
    expect(body).toContain('ctEscape(t.label || t.id');
    expect(body).toContain("replace(/&/g, '&amp;')");
  });
});

describe('the chip styling is theme-variable only', () => {
  test('every .ct- rule uses theme variables and no hard-coded colours', () => {
    const start = html.indexOf('.ct-targets {');
    expect(start).toBeGreaterThan(-1);
    const block = html.slice(start, html.indexOf('tr.row-unconfirmed td', start));
    for (const rule of ['.ct-chip {', '.ct-chip-accepted {', '.ct-chip-rejected {', '.ct-chip-pending {']) {
      expect(block).toContain(rule);
    }
    expect(block).toContain('var(--green)');
    expect(block).toContain('var(--red)');
    expect(block).toContain('var(--muted)');
    expect(block).toContain('var(--border)');
    expect(block).toContain('var(--tint)');
    // no hard-coded hex / rgba colours in the new block
    expect(block).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
    expect(block).not.toMatch(/rgba?\(/);
  });
});
