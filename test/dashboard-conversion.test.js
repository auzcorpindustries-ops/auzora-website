// test/dashboard-conversion.test.js — unit tests for the D6 module
// (js/dashboard-conversion.js). Pure-function coverage: PII masking, funnel
// math/degraded states, intent grouping, relative time, lead row mapping,
// and the HTML builders (aria labels + masked PII + empty states).

const DC = require('../js/dashboard-conversion');

// ── maskPhone (PII-safe) ─────────────────────────────────────────────────────
describe('maskPhone', () => {
  test('keeps only the last 4 digits', () => {
    expect(DC.maskPhone('+11234567891')).toBe('•••• 7891');
    expect(DC.maskPhone('(415) 555-0132')).toBe('•••• 0132');
  });

  test('never renders a full number — short input also masked', () => {
    expect(DC.maskPhone('7891')).toBe('•••• 7891');
    expect(DC.maskPhone('12')).toBe('•••• 12');
  });

  test('empty/null → empty string', () => {
    expect(DC.maskPhone('')).toBe('');
    expect(DC.maskPhone(null)).toBe('');
    expect(DC.maskPhone(undefined)).toBe('');
  });

  test('already-masked input stays masked', () => {
    expect(DC.maskPhone('+155****4567')).toBe('•••• 4567');
  });
});

// ── pct ──────────────────────────────────────────────────────────────────────
describe('pct', () => {
  test('basic ratios round to integer percent', () => {
    expect(DC.pct(3, 9)).toBe(33);
    expect(DC.pct(1, 3)).toBe(33);
    expect(DC.pct(6, 6)).toBe(100);
  });

  test('zero denominator → 0 (no NaN leaks)', () => {
    expect(DC.pct(5, 0)).toBe(0);
    expect(DC.pct(0, 0)).toBe(0);
    expect(DC.pct(5, undefined)).toBe(0);
  });

  test('clamped to 100', () => {
    expect(DC.pct(9, 3)).toBe(100);
  });
});

// ── relTime ──────────────────────────────────────────────────────────────────
describe('relTime', () => {
  const NOW = Date.UTC(2026, 8, 2, 18, 0, 0); // Sep 2 2026 18:00 UTC

  test('buckets: just now / minutes / hours / days', () => {
    expect(DC.relTime(new Date(NOW - 20 * 1000).toISOString(), NOW)).toBe('just now');
    expect(DC.relTime(new Date(NOW - 5 * 60000).toISOString(), NOW)).toBe('5m ago');
    expect(DC.relTime(new Date(NOW - 3 * 3600000).toISOString(), NOW)).toBe('3h ago');
    expect(DC.relTime(new Date(NOW - 2 * 86400000).toISOString(), NOW)).toBe('2d ago');
  });

  test('older than a week → month-day label; other year shows year', () => {
    expect(DC.relTime(new Date(Date.UTC(2026, 7, 23)).toISOString(), NOW)).toBe('Aug 23');
    expect(DC.relTime(new Date(Date.UTC(2025, 7, 23)).toISOString(), NOW)).toBe('Aug 23, 2025');
  });

  test('invalid/missing → empty string', () => {
    expect(DC.relTime('')).toBe('');
    expect(DC.relTime(null)).toBe('');
    expect(DC.relTime('not-a-date')).toBe('');
  });
});

// ── buildTopIntents ──────────────────────────────────────────────────────────
describe('buildTopIntents', () => {
  test('top 5 sorted desc by count', () => {
    const by = {
      a: 2, b: 8, c: 5, d: 1, e: 3, f: 7, g: 4,
    };
    const top = DC.buildTopIntents(by, 5);
    expect(top.map(r => r.key)).toEqual(['b', 'f', 'c', 'g', 'e']);
    expect(top).toHaveLength(5);
  });

  test('groups case-insensitively, keeps first-seen spelling', () => {
    const by = {
      'book an appointment': 4,
      'Book an appointment': 1,
      'cancel an appointment': 1,
    };
    const top = DC.buildTopIntents(by);
    expect(top).toHaveLength(2);
    expect(top[0].label).toBe('book an appointment');
    expect(top[0].count).toBe(5);
    expect(top[1].label).toBe('cancel an appointment');
  });

  test('ignores zero/negative/garbage counts; caps at max', () => {
    const by = { a: 0, b: -3, c: NaN, d: '9', e: 2 };
    const top = DC.buildTopIntents(by, 3);
    expect(top.map(r => r.key)).toEqual(['d', 'e']);
  });

  test('non-object input → empty array', () => {
    expect(DC.buildTopIntents(null)).toEqual([]);
    expect(DC.buildTopIntents([1, 2])).toEqual([]);
    expect(DC.buildTopIntents({})).toEqual([]);
  });
});

// ── buildFunnel ──────────────────────────────────────────────────────────────
describe('buildFunnel', () => {
  test('uses D1 funnel counts and computes between-stage conversions', () => {
    const f = DC.buildFunnel({
      funnel: { calls: 20, leads: 9, appointments: 4 },
    });
    expect(f.calls).toBe(20);
    expect(f.leads).toBe(9);
    expect(f.appointments).toBe(4);
    expect(f.callToLeadPct).toBe(45);
    expect(f.leadToApptPct).toBe(44);
    expect(f.endToEndPct).toBe(20);
  });

  test('falls back to kpis.*.current when funnel missing', () => {
    const f = DC.buildFunnel({
      kpis: {
        calls_answered: { current: 10 },
        leads_captured: { current: 5 },
        appointments_booked: { current: 2 },
      },
    });
    expect(f.calls).toBe(10);
    expect(f.leads).toBe(5);
    expect(f.appointments).toBe(2);
  });

  test('null/empty summary → all zeros, no NaN', () => {
    const f = DC.buildFunnel(null);
    expect(f.calls).toBe(0);
    expect(f.leads).toBe(0);
    expect(f.appointments).toBe(0);
    expect(f.callToLeadPct).toBe(0);
    expect(f.leadToApptPct).toBe(0);
  });

  test('passes through D2 call_outcomes when present (defensive hook)', () => {
    const f = DC.buildFunnel({
      funnel: { calls: 10, leads: 4, appointments: 2 },
      call_outcomes: { booked: 3, lead: 1, info: 6 },
    });
    expect(f.outcomes).toEqual({ booked: 3, lead: 1, info: 6 });
  });

  test('zero funnel → outcomes null, conversions 0', () => {
    const f = DC.buildFunnel({ funnel: {} });
    expect(f.calls + f.leads + f.appointments).toBe(0);
    expect(f.outcomes).toBeNull();
  });
});

// ── leadRowData ──────────────────────────────────────────────────────────────
describe('leadRowData', () => {
  test('maps a full lead record; phone masked, name fallbacks', () => {
    const r = DC.leadRowData({
      lead_id: 'l1',
      name: 'Dana Reyes',
      phone: '+11234567891',
      email: 'dana@example.com',
      source: 'inbound_call',
      intent: 'book an appointment',
      score: 82,
      captured_at: '2026-09-01T15:00:00Z',
      status: 'new',
      needs_agent_attention: true,
      next_action_display: 'SMS follow-up in 2h',
    });
    expect(r.name).toBe('Dana Reyes');
    expect(r.phoneMasked).toBe('•••• 7891');
    expect(r.source).toBe('Voice call');
    expect(r.intent).toBe('book an appointment');
    expect(r.score).toBe('82');
    expect(r.needsAttention).toBe(true);
    expect(r.nextAction).toBe('SMS follow-up in 2h');
    // Captured near "now" in test data → must land in a sane relative bucket.
    expect(r.rel).toMatch(/^(just now|\d+[mhd] ago)$/);
  });

  test('name falls back email → masked phone → Unknown', () => {
    expect(DC.leadRowData({ email: 'x@y.com' }).name).toBe('x@y.com');
    expect(DC.leadRowData({ phone: '+15551230000' }).name).toBe('•••• 0000');
    expect(DC.leadRowData({}).name).toBe('Unknown');
  });

  test('missing score → em dash; missing source → Unknown label', () => {
    const r = DC.leadRowData({});
    expect(r.score).toBe('—');
    expect(r.source).toBe('Unknown');
    expect(r.intent).toBe('—');
  });

  test('score of 0 renders (not the em-dash fallback)', () => {
    expect(DC.leadRowData({ score: 0 }).score).toBe('0');
  });
});

// ── HTML builders ────────────────────────────────────────────────────────────
describe('funnelHTML', () => {
  test('three stage bars + between-stage conversion arrows', () => {
    const html = DC.funnelHTML(DC.buildFunnel({ funnel: { calls: 20, leads: 9, appointments: 4 } }));
    expect(html).toContain('Calls');
    expect(html).toContain('Leads');
    expect(html).toContain('Appointments');
    expect(html).toContain('45% became leads');
    expect(html).toContain('44% booked');
    expect(html.match(/dconv-stage-fill/g)).toHaveLength(3);
    expect(html).toContain('aria-label="Booking funnel');
  });

  test('all-zero → degraded empty state, no bars', () => {
    const html = DC.funnelHTML(DC.buildFunnel({ funnel: { calls: 0, leads: 0, appointments: 0 } }));
    expect(html).toContain('dconv-empty');
    expect(html).toContain('No activity yet');
    expect(html).not.toContain('dconv-stage-fill');
  });

  test('zero calls but leads → degraded hint, funnel still renders', () => {
    const html = DC.funnelHTML(DC.buildFunnel({ funnel: { calls: 0, leads: 6, appointments: 4 } }));
    expect(html).toContain('dconv-stage-fill');
    expect(html).toContain('No calls in this period');
  });

  test('D2 outcomes hook renders outcome-verified hint when present', () => {
    const html = DC.funnelHTML({
      calls: 10, leads: 4, appointments: 2,
      callToLeadPct: 40, leadToApptPct: 50, endToEndPct: 20,
      outcomes: { booked: 3 },
    });
    expect(html).toContain('3 of 10 calls ended in a booking');
  });
});

describe('intentChipsHTML', () => {
  const rows = DC.buildTopIntents({
    'book an appointment': 5, 'pricing question': 3, 'hours': 1,
  });

  test('renders 3 chips with dot, label, count, and Analytics routing', () => {
    const html = DC.intentChipsHTML(rows);
    expect(html.match(/dconv-chip"/g)).toHaveLength(3);
    expect(html).toContain('book an appointment');
    expect(html).toContain('dconv-chip-count');
    expect(html.match(/showPage\('analytics'\)/g)).toHaveLength(3);
    expect(html).toContain('aria-label="book an appointment: 5 leads');
  });

  test('empty → degraded empty state, no chips', () => {
    const html = DC.intentChipsHTML([]);
    expect(html).toContain('dconv-empty');
    expect(html).toContain('No intents yet');
    expect(html).not.toContain('dconv-chip"');
  });

  test('HTML-special intents are escaped', () => {
    const html = DC.intentChipsHTML([{ key: 'x', label: '<b>evil</b>', count: 1 }]);
    expect(html).toContain('&lt;b&gt;evil&lt;/b&gt;');
    expect(html).not.toContain('<b>evil</b>');
  });
});

describe('leadTableHTML', () => {
  const rows = [
    DC.leadRowData({
      lead_id: 'l1', name: 'Dana Reyes', phone: '+11234567891', source: 'inbound_call',
      intent: 'book an appointment', score: 82, captured_at: '2026-09-01T15:00:00Z',
    }),
    DC.leadRowData({ lead_id: 'l2', phone: '+15551230000', captured_at: '2026-08-20T10:00:00Z', needs_agent_attention: true }),
  ];

  test('renders header columns + one row per lead, phones masked', () => {
    const html = DC.leadTableHTML(rows);
    expect(html).toContain('<th scope="col">Phone</th>');
    expect(html).toContain('Dana Reyes');
    expect(html).toContain('•••• 7891');
    expect(html).toContain('•••• 0000');
    expect(html.match(/dconv-lead-row/g)).toHaveLength(2);
    expect(html.match(/dconv-source-badge/g)).toHaveLength(2);
  });

  test('rows are accessible toggles: tabindex, role, aria-expanded, aria-controls', () => {
    const html = DC.leadTableHTML(rows);
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('role="button"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-controls="dconv-lead-detail-0"');
  });

  test('detail rows exist and are hidden; detail never shows unmasked phone', () => {
    const html = DC.leadTableHTML(rows);
    expect(html).toContain('id="dconv-lead-detail-0" hidden');
    expect(html.match(/hidden>/g)).toHaveLength(2);
    expect(html).toContain('Leads &amp; CRM');
    // PII check: no unmasked 10+ digit sequence anywhere in the table HTML
    expect(html).not.toMatch(/\d{7,}/);
  });

  test('needs-attention flag renders in detail', () => {
    const html = DC.leadTableHTML(rows);
    expect(html).toContain('needs attention');
  });

  test('empty → degraded empty state, no table', () => {
    const html = DC.leadTableHTML([]);
    expect(html).toContain('dconv-empty');
    expect(html).toContain('No leads captured yet');
    expect(html).not.toContain('<table');
  });

  test('caps at 10 rows', () => {
    const many = [];
    for (let i = 0; i < 14; i++) {
      many.push(DC.leadRowData({ lead_id: 'l' + i, name: 'Lead ' + i }));
    }
    const html = DC.leadTableHTML(many);
    expect(html.match(/dconv-lead-row/g)).toHaveLength(10);
  });
});
