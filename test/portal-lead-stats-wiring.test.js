// test/portal-lead-stats-wiring.test.js
// Ticket zeus_1791504339622_27d7d702 — CRM-METRICS.
//
// portal.html is a single-file app with no module boundary, so this test loads
// the REAL Leads & CRM stat-card logic (NOT_CONTACTED_OUTBOUND_STATUSES +
// isLeadOptedOut + updateLeadStats) straight out of portal.html and runs it
// against fixtures, asserting that each tile reflects the lead lifecycle states
// the backend actually writes. A regression that drops 'pending'/'deferred'
// from the New tile, or that reads the sticky opt-out / needs-attention signals
// off only the newest interaction row, must fail here.

const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'portal.html'), 'utf8');

// Slice the stat-card block out of portal.html: from the status constant up to
// the next top-level function that follows updateLeadStats.
function statBlockSource() {
  const start = html.indexOf('const NOT_CONTACTED_OUTBOUND_STATUSES');
  expect(start).toBeGreaterThan(-1);
  const end = html.indexOf('\nfunction formatTimeSinceLabel(', start);
  expect(end).toBeGreaterThan(start);
  return html.slice(start, end);
}

// Run the real updateLeadStats() against a stubbed document and return the tile
// text values that were written.
function updateStats(grouped) {
  const src = statBlockSource() + '\nreturn { updateLeadStats, isLeadOptedOut };';
  const els = {};
  const document = {
    getElementById(id) {
      if (!els[id]) els[id] = { textContent: null };
      return els[id];
    },
  };
  const api = new Function('document', src)(document);
  api.updateLeadStats(grouped);
  const read = (id) => (els[id] ? els[id].textContent : undefined);
  return {
    total: read('stat-leads-total'),
    isNew: read('stat-leads-new'),
    reached: read('stat-leads-reached'),
    opted: read('stat-leads-opted'),
    attention: read('stat-leads-attention'),
  };
}

// One person = one group (array of interaction rows, newest first).
const lead = (over = {}) => Object.assign(
  { lead_id: 'l', outbound_status: 'new', captured_at: '2026-10-09T00:00:00Z' },
  over
);

describe('portal.html Leads & CRM stat tiles', () => {
  test('New counts not-yet-contacted leads: missing / new / pending / deferred', () => {
    const r = updateStats([
      [lead({ outbound_status: undefined })], // fresh inbound capture
      [lead({ outbound_status: 'new' })],
      [lead({ outbound_status: 'pending' })],   // queued follow-up call
      [lead({ outbound_status: 'deferred' })],  // parked outside calling window
    ]);
    expect(r.isNew).toBe(4);
    expect(r.reached).toBe(0);
    expect(r.opted).toBe(0);
  });

  test('New excludes every status that means the lead HAS been contacted', () => {
    const r = updateStats([
      [lead({ outbound_status: 'called' })],
      [lead({ outbound_status: 'no-answer' })],
      [lead({ outbound_status: 'voicemail' })],
      [lead({ outbound_status: 'max-attempts' })],
      [lead({ outbound_status: 'failed' })],
    ]);
    expect(r.isNew).toBe(0);
    expect(r.total).toBe(5);
  });

  test('Reached counts leads whose newest state is reached', () => {
    const r = updateStats([
      [lead({ outbound_status: 'reached' })],
      [lead({ outbound_status: 'reached' })],
      [lead({ outbound_status: 'new' })],
    ]);
    expect(r.reached).toBe(2);
  });

  test('Opted Out counts any opt-out signal (status, call flag, or portal flag)', () => {
    const r = updateStats([
      [lead({ outbound_status: 'opted-out' })],
      [lead({ outbound_opted_out: true })],
      [lead({ opt_out: true })],
    ]);
    expect(r.opted).toBe(3);
  });

  test('Opted Out is sticky across the group, not just the newest row', () => {
    // The person opted out on an earlier interaction; a later inbound call left a
    // fresh row with no flags. They must still count as Opted Out (never dialed).
    const r = updateStats([
      [lead({ outbound_status: 'new' }), lead({ outbound_status: 'opted-out' })],
    ]);
    expect(r.opted).toBe(1);
    expect(r.isNew).toBe(0);
  });

  test('Opted Out wins over Reached for a person who opted out after answering', () => {
    const r = updateStats([
      [lead({ outbound_status: 'reached' }), lead({ outbound_opted_out: true })],
    ]);
    expect(r.opted).toBe(1);
    expect(r.reached).toBe(0);
  });

  test('Needs Attention reads the flag across the whole group', () => {
    const r = updateStats([
      [lead({ outbound_status: 'new' }), lead({ needs_agent_attention: true })],
      [lead({ needs_agent_attention: true })],
      [lead({ needs_agent_attention: false })],
    ]);
    expect(r.attention).toBe(2);
  });

  test('Needs Attention is independent of opt-out (an escalation still needs a human)', () => {
    const r = updateStats([
      [lead({ outbound_opted_out: true, needs_agent_attention: true })],
    ]);
    expect(r.opted).toBe(1);
    expect(r.attention).toBe(1);
  });

  test('Total equals the number of people (groups), not raw interactions', () => {
    const r = updateStats([
      [lead(), lead()], // one person, two interactions
      [lead({ outbound_status: 'reached' })],
    ]);
    expect(r.total).toBe(2);
  });

  test('accepts an ungrouped single lead (defensive)', () => {
    const r = updateStats([lead({ outbound_status: 'reached' })]);
    expect(r.total).toBe(1);
    expect(r.reached).toBe(1);
  });

  test('empty input yields real zeros on every tile (no em-dashes)', () => {
    const r = updateStats([]);
    expect(r.total).toBe(0);
    expect(r.isNew).toBe(0);
    expect(r.reached).toBe(0);
    expect(r.opted).toBe(0);
    expect(r.attention).toBe(0);
  });

  test('the row badge and the Opted Out tile share one opted-out predicate', () => {
    // Guard against drift: renderObLeads must use isLeadOptedOut, not an inline
    // copy, or the table badge and the tile can disagree.
    const start = html.indexOf('function renderObLeads(');
    expect(start).toBeGreaterThan(-1);
    const body = html.slice(start, html.indexOf('\nfunction ', start + 1));
    expect(body).toContain('group.some(isLeadOptedOut)');
  });
});
