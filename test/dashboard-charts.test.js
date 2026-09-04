// test/dashboard-charts.test.js — unit tests for the pure chart helpers
// (ticket zeus_1788322144030_f0832d2b, dashboard wave D4).
//
// Everything under test is a pure function: data in → SVG string / geometry
// out. No DOM (jsdom not needed — the DOM wiring layer is deliberately thin
// and exercised by the atlas-ai Playwright E2E suite).

const C = require('../js/dashboard-charts.js');

// ── fixtures ────────────────────────────────────────────────────────────────
function makeDaily(n, startISO) {
  const out = [];
  const t0 = Date.parse(`${startISO}T00:00:00.000Z`);
  for (let i = 0; i < n; i++) {
    const iso = new Date(t0 + i * 86400000).toISOString().slice(0, 10);
    out.push({
      date: iso,
      minutes: (i * 7) % 23,
      calls: i % 5,
      sms: 0,
      leads: i % 3,
    });
  }
  return out;
}

const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  .map(day => ({ day, calls: 0 }));
WEEKDAY[3].calls = 12; // Wednesday
WEEKDAY[1].calls = 7;  // Monday
WEEKDAY[5].calls = 3;  // Friday

const BY_SOURCE = { inbound_call: 6, web_form: 3, sms_campaign: 1 };

function makeUsageTrend() {
  const rows = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(Date.UTC(2026, 8 - i, 1));
    rows.push({ period: d.toISOString().slice(0, 7), minutes: (i * 11) % 40, sms: (i * 3) % 9 });
  }
  return rows;
}

// ── date/number helpers ─────────────────────────────────────────────────────
describe('shortDate', () => {
  test('formats ISO day keys as "Mon D"', () => {
    expect(C.shortDate('2026-08-27')).toBe('Aug 27');
    expect(C.shortDate('2026-01-01')).toBe('Jan 1');
    expect(C.shortDate('2026-12-31')).toBe('Dec 31');
  });
  test('passes through non-date strings', () => {
    expect(C.shortDate('nonsense')).toBe('nonsense');
    expect(C.shortDate('')).toBe('');
    expect(C.shortDate(null)).toBe('');
  });
});

describe('shortMonth', () => {
  test('formats YYYY-MM periods', () => {
    expect(C.shortMonth('2026-04')).toBe('Apr');
    expect(C.shortMonth('2026-09')).toBe('Sep');
  });
  test('passes through non-period strings', () => {
    expect(C.shortMonth('x')).toBe('x');
  });
});

describe('num', () => {
  test('trims trailing zeros', () => {
    expect(C.num(1.5)).toBe('1.5');
    expect(C.num(2)).toBe('2');
    expect(C.num(2.25)).toBe('2.25');
  });
  test('rounds to 2 decimals', () => {
    expect(C.num(3.14159)).toBe('3.14');
    expect(C.num(10.005)).toBe('10.01');
  });
});

describe('clamp', () => {
  test('clamps into range', () => {
    expect(C.clamp(5, 0, 10)).toBe(5);
    expect(C.clamp(-1, 0, 10)).toBe(0);
    expect(C.clamp(11, 0, 10)).toBe(10);
  });
});

describe('esc', () => {
  test('escapes XML special characters', () => {
    expect(C.esc('<script>&"\'')).toBe('&lt;script&gt;&amp;&quot;&#39;');
  });
  test('leaves plain text alone', () => {
    expect(C.esc('Aug 27')).toBe('Aug 27');
  });
});

// ── scale + path helpers ────────────────────────────────────────────────────
describe('linearScale', () => {
  test('maps domain onto range', () => {
    const s = C.linearScale(0, 10, 100, 200);
    expect(s.map(0)).toBe(100);
    expect(s.map(10)).toBe(200);
    expect(s.map(5)).toBeCloseTo(150);
  });
  test('handles inverted range (y axis)', () => {
    const s = C.linearScale(0, 10, 200, 100);
    expect(s.map(0)).toBe(200);
    expect(s.map(10)).toBe(100);
    expect(s.map(5)).toBeCloseTo(150);
  });
  test('degenerate domain collapses to range midpoint', () => {
    const s = C.linearScale(5, 5, 0, 100);
    expect(s.map(5)).toBe(50);
    expect(s.map(999)).toBe(50);
  });
});

describe('chartMaxY', () => {
  test('zero max yields a non-zero axis', () => {
    expect(C.chartMaxY(0, 4)).toBeGreaterThan(0);
  });
  test('covers the data maximum', () => {
    for (const v of [1, 3, 7, 19, 23, 100, 101, 999, 1234]) {
      expect(C.chartMaxY(v, 4)).toBeGreaterThanOrEqual(v);
    }
  });
  test('divides into 4 evenly-spaced steps with clean labels', () => {
    for (const v of [1, 7, 23, 100, 101, 1234]) {
      const y = C.chartMaxY(v, 4);
      const step = y / 4;
      for (let t = 0; t <= 4; t++) {
        const tick = step * t;
        // Every gridline value must render as a clean short label (no float
        // dust like 0.30000000000000004) — this is what appears on the y axis.
        expect(C.num(tick)).toMatch(/^\d+(\.\d{1,2})?$/);
        expect(tick).toBeLessThanOrEqual(y);
      }
      expect(step).toBeGreaterThan(0);
    }
  });
  test('uses nice steps (1/2/2.5/5 × 10^k)', () => {
    expect(C.chartMaxY(8, 4)).toBe(8);   // step 2
    expect(C.chartMaxY(10, 4)).toBe(10); // step 2.5
    expect(C.chartMaxY(16, 4)).toBe(20); // step 5
    expect(C.chartMaxY(40, 4)).toBe(40); // step 10
  });
});

describe('pointsToPath', () => {
  test('empty and single-point inputs yield empty string', () => {
    expect(C.pointsToPath([])).toBe('');
    expect(C.pointsToPath([[1, 2]])).toBe('');
    expect(C.pointsToPath(null)).toBe('');
  });
  test('two points produce M then L', () => {
    expect(C.pointsToPath([[0, 0], [10, 5]])).toBe('M0 0 L10 5');
  });
  test('multi-point path keeps order', () => {
    const p = C.pointsToPath([[0, 0], [5, 5], [10, 0]]);
    expect(p.startsWith('M0 0')).toBe(true);
    expect(p).toContain('L5 5');
    expect(p.endsWith('L10 0')).toBe(true);
    expect(p.match(/M/g).length).toBe(1);
    expect(p.match(/L/g).length).toBe(2);
  });
});

describe('areaPath', () => {
  test('closes down to the baseline', () => {
    const p = C.areaPath([[0, 10], [10, 20], [20, 10]], 100);
    expect(p.startsWith('M0 10')).toBe(true);
    expect(p.endsWith('L0 100 Z')).toBe(true);
    expect(p).toContain('L20 100');
  });
  test('empty for fewer than 2 points', () => {
    expect(C.areaPath([], 100)).toBe('');
    expect(C.areaPath([[0, 0]], 100)).toBe('');
  });
});

// ── 1. activity chart ───────────────────────────────────────────────────────
describe('buildActivityGeometry', () => {
  const daily = makeDaily(30, '2026-08-04');
  const g = C.buildActivityGeometry(daily, {});

  test('captures row count, totals, and last point', () => {
    expect(g.n).toBe(30);
    expect(g.totals.minutes).toBe(daily.reduce((a, r) => a + r.minutes, 0));
    expect(g.totals.calls).toBe(daily.reduce((a, r) => a + r.calls, 0));
    expect(g.lastPoint).toEqual(g.minutePts[29]);
  });

  test('y-axis maximum covers the data and divides into 4 gridlines', () => {
    const maxMinutes = Math.max(...daily.map(r => r.minutes));
    expect(g.yMax).toBeGreaterThanOrEqual(maxMinutes);
    expect(g.grid).toHaveLength(5); // 0..ticks inclusive
    expect(g.grid[0].val).toBe(0);
    expect(g.grid[4].val).toBe(g.yMax);
    expect(g.grid[4].y).toBeLessThan(g.grid[0].y); // inverted y range
  });

  test('all minute/call points sit inside the plot box', () => {
    for (const [x, y] of [...g.minutePts, ...g.callPts]) {
      expect(x).toBeGreaterThanOrEqual(g.xScale.range[0]);
      expect(x).toBeLessThanOrEqual(g.xScale.range[1]);
      expect(y).toBeGreaterThanOrEqual(g.yScale.range[1]);
      expect(y).toBeLessThanOrEqual(g.yScale.range[0]);
    }
  });

  test('minute peak touches the top gridline', () => {
    const maxMinutes = Math.max(...daily.map(r => r.minutes));
    const peak = g.minutePts.reduce((a, p) => (p[1] < a[1] ? p : a));
    expect(peak[1]).toBeCloseTo(g.yScale.map(maxMinutes), 5);
  });

  test('handles empty and single-row inputs without throwing', () => {
    expect(() => C.buildActivityGeometry([], {})).not.toThrow();
    expect(() => C.buildActivityGeometry([{ date: '2026-09-01', minutes: 5, calls: 1 }], {})).not.toThrow();
    expect(C.buildActivityGeometry([], {}).n).toBe(0);
  });

  test('negative and NaN values are clamped to zero, not NaN', () => {
    const g2 = C.buildActivityGeometry([
      { date: '2026-09-01', minutes: -5, calls: NaN },
      { date: '2026-09-02', minutes: 3, calls: 2 },
    ], {});
    expect(g2.minutePts[0][1]).not.toBeNaN();
    expect(g2.callPts[0][1]).not.toBeNaN();
    expect(g2.totals.minutes).toBe(3);
    expect(g2.totals.calls).toBe(2);
  });
});

describe('activityChartSVG', () => {
  const daily = makeDaily(30, '2026-08-04');
  const svg = C.activityChartSVG(daily, 30);

  test('is an svg with role=img and an aria-label', () => {
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('role="img"');
    expect(svg).toContain('aria-label="Activity chart: 30-day trend');
    expect(svg).toContain('Total ');
  });

  test('renders area, both series lines, gridlines, and last-point highlight', () => {
    expect(svg).toContain('dchart-area');
    expect(svg).toContain('dchart-minutes');
    expect(svg).toContain('dchart-calls');
    expect(svg).toContain('dchart-grid');
    expect(svg).toContain('dchart-last');
  });

  test('emits one hover hit-target per day', () => {
    expect((svg.match(/dchart-hit/g) || []).length).toBe(30);
  });

  test('y gridline labels are present', () => {
    expect(svg).toContain('dchart-y');
  });

  test('single-point data renders a dot, not an empty path', () => {
    const one = C.activityChartSVG([{ date: '2026-09-01', minutes: 5, calls: 1 }], 7);
    expect(one).toContain('dchart-dot');
    expect(one).toContain('dchart-hit');
  });

  test('empty input still renders a valid accessible svg', () => {
    const empty = C.activityChartSVG([], 30);
    expect(empty.startsWith('<svg')).toBe(true);
    expect(empty).toContain('role="img"');
    expect(empty).not.toContain('NaN');
  });

  test('contains no external references (zero dependencies)', () => {
    for (const s of [svg, C.activityChartSVG([], 7)]) {
      expect(s).not.toMatch(/https?:\/\//);
      expect(s).not.toContain('src=');
      expect(s).not.toContain('xlink');
    }
  });
});

// ── 2. weekday bars ─────────────────────────────────────────────────────────
describe('buildWeekdayGeometry', () => {
  test('reorders Sunday-first payload into Monday-first display order', () => {
    const g = C.buildWeekdayGeometry(WEEKDAY);
    expect(g.bars.map(b => b.day)).toEqual([
      'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
    ]);
  });

  test('finds the max day and the total', () => {
    const g = C.buildWeekdayGeometry(WEEKDAY);
    expect(g.maxCalls).toBe(12);
    expect(g.maxIdx).toBe(2); // Wednesday is 3rd in Mon-first order
    expect(g.total).toBe(22);
  });

  test('merges duplicate day entries and drops junk values', () => {
    const g = C.buildWeekdayGeometry([
      { day: 'Monday', calls: 2 },
      { day: 'Monday', calls: 3 },
      { day: 'Friday', calls: -4 },
      { day: 'Saturday', calls: 'x' },
      { day: 'Sunday', calls: 1 },
    ]);
    expect(g.bars.find(b => b.day === 'Monday').calls).toBe(5);
    expect(g.bars.find(b => b.day === 'Friday').calls).toBe(0);
    expect(g.bars.find(b => b.day === 'Saturday').calls).toBe(0);
    expect(g.total).toBe(6);
  });

  test('all-zero week has no max bar', () => {
    const g = C.buildWeekdayGeometry(WEEKDAY.map(w => ({ day: w.day, calls: 0 })));
    expect(g.total).toBe(0);
    expect(g.maxCalls).toBe(0);
  });

  test('non-array input is tolerated', () => {
    expect(C.buildWeekdayGeometry(null).total).toBe(0);
    expect(C.buildWeekdayGeometry(undefined).bars).toHaveLength(7);
  });
});

describe('weekdayBarsSVG', () => {
  const svg = C.weekdayBarsSVG(WEEKDAY);

  test('renders 7 bars Monday-first with the max day emphasized', () => {
    expect((svg.match(/dchart-bar /g) || []).length + (svg.match(/dchart-bar"/g) || []).length).toBe(7);
    expect(svg).toContain('dchart-bar max');
    expect(svg).toContain('<title>Wednesday: 12 calls</title>');
    // Monday must appear before Sunday in the markup
    expect(svg.indexOf('>Mon<')).toBeLessThan(svg.indexOf('>Sun<'));
  });

  test('count labels only on bars with calls > 0', () => {
    const labels = svg.match(/dchart-bar-label[^>]*>(\d+)</g) || [];
    expect(labels).toHaveLength(3); // Mon 7, Wed 12, Fri 3
    expect(svg).toContain('>12<');
    expect(svg).toContain('>7<');
    expect(svg).toContain('>3<');
  });

  test('aria-label lists Mon-first values as a text alternative', () => {
    expect(svg).toContain('aria-label="Calls by weekday: Mon 7, Tue 0, Wed 12, Thu 0, Fri 3, Sat 0, Sun 0."');
  });

  test('all-zero input renders no max emphasis and clean aria', () => {
    const empty = C.weekdayBarsSVG(WEEKDAY.map(w => ({ day: w.day, calls: 0 })));
    expect(empty).not.toContain('dchart-bar max');
    expect(empty).toContain('aria-label="Calls by weekday: Mon 0, Tue 0, Wed 0, Thu 0, Fri 0, Sat 0, Sun 0."');
  });
});

// ── 3. leads by source ──────────────────────────────────────────────────────
describe('sourceLabel', () => {
  test('maps known backend source keys to human labels', () => {
    expect(C.sourceLabel('inbound_call')).toBe('Voice call');
    expect(C.sourceLabel('web_form')).toBe('Web form');
    expect(C.sourceLabel('sms_campaign')).toBe('SMS campaign');
    expect(C.sourceLabel('booking_form')).toBe('Booking form');
    expect(C.sourceLabel('triggered_call')).toBe('Follow-up call');
    expect(C.sourceLabel('missed_call_sms')).toBe('Missed-call SMS');
    expect(C.sourceLabel('lead_intake_webhook')).toBe('Lead webhook');
    expect(C.sourceLabel('csv_import')).toBe('CSV import');
    expect(C.sourceLabel('square_webhook')).toBe('Square');
  });
  test('unknown keys fall back to title-cased words', () => {
    expect(C.sourceLabel('some_new_source')).toBe('Some New Source');
    expect(C.sourceLabel('')).toBe('');
  });
});

describe('buildSourceRows', () => {
  test('sorts desc by count with alphabetical tiebreak', () => {
    const rows = C.buildSourceRows({ web_form: 3, inbound_call: 6, sms_campaign: 6 });
    expect(rows.map(r => r.key)).toEqual(['inbound_call', 'sms_campaign', 'web_form']);
  });
  test('drops zero, negative, and non-numeric counts', () => {
    const rows = C.buildSourceRows({ a: 1, b: 0, c: -2, d: 'x', e: 2.5 });
    expect(rows.map(r => r.key)).toEqual(['e', 'a']);
  });
  test('non-object inputs yield empty rows', () => {
    expect(C.buildSourceRows(null)).toEqual([]);
    expect(C.buildSourceRows(undefined)).toEqual([]);
    expect(C.buildSourceRows([])).toEqual([]);
    expect(C.buildSourceRows('x')).toEqual([]);
  });
});

describe('sourceBarsSVG', () => {
  const svg = C.sourceBarsSVG(BY_SOURCE);

  test('renders one bar per source with label and count', () => {
    expect(svg).toContain('Voice call');
    expect(svg).toContain('Web form');
    expect(svg).toContain('SMS campaign');
    expect((svg.match(/dchart-hbar /g) || []).length + (svg.match(/dchart-hbar"/g) || []).length).toBe(3);
    expect(svg).toContain('>6<');
    expect(svg).toContain('>3<');
    expect(svg).toContain('>1<');
  });

  test('top source is sorted first and emphasized', () => {
    expect(svg.indexOf('Voice call')).toBeLessThan(svg.indexOf('Web form'));
    expect(svg).toContain('dchart-hbar max');
  });

  test('aria-label is a text alternative with counts', () => {
    expect(svg).toContain('aria-label="Leads by source: Voice call 6, Web form 3, SMS campaign 1."');
  });

  test('empty input renders clean state', () => {
    const empty = C.sourceBarsSVG({});
    expect(empty).toContain('aria-label="Leads by source: no leads yet."');
    expect(empty).not.toContain('dchart-hbar');
  });
});

// ── 4. usage sparkline ──────────────────────────────────────────────────────
describe('buildSparkGeometry', () => {
  const trend = makeUsageTrend();
  const g = C.buildSparkGeometry(trend);

  test('captures maxima and last-month values', () => {
    expect(g.n).toBe(6);
    expect(g.maxMinutes).toBe(Math.max(...trend.map(r => r.minutes)));
    expect(g.maxSms).toBe(Math.max(...trend.map(r => r.sms)));
    expect(g.lastMinutes).toBe(trend[5].minutes);
    expect(g.lastSms).toBe(trend[5].sms);
  });

  test('empty input is tolerated', () => {
    const g0 = C.buildSparkGeometry([]);
    expect(g0.n).toBe(0);
    expect(g0.maxMinutes).toBe(0);
  });
});

describe('usageSparkSVG', () => {
  const trend = makeUsageTrend();
  const svg = C.usageSparkSVG(trend);

  test('renders both series and endpoint value labels', () => {
    expect(svg).toContain('dchart-minutes');
    expect(svg).toContain('dchart-sms');
    expect((svg.match(/dchart-spark-val/g) || []).length).toBe(2);
  });

  test('first and last month labels are present', () => {
    expect(svg).toContain('>Apr<');
    expect(svg).toContain('>Sep<');
  });

  test('aria-label spells out both series as a text alternative', () => {
    expect(svg).toContain('aria-label="Usage trend, Apr to Sep:');
    expect(svg).toContain('voice minutes');
    expect(svg).toContain('SMS');
  });

  test('empty input renders clean state', () => {
    const empty = C.usageSparkSVG([]);
    expect(empty).toContain('aria-label="Usage trend: no data yet."');
    expect(empty).not.toContain('dchart-line');
  });

  test('single month renders without paths', () => {
    const one = C.usageSparkSVG([{ period: '2026-09', minutes: 5, sms: 1 }]);
    expect(one).toContain('dchart-dot');
    expect(one).not.toContain('dchart-line');
  });

  test('all-zero months still render both flat lines (payload always sends 6 buckets)', () => {
    const flat = C.usageSparkSVG(Array.from({ length: 6 }, (_, i) => ({
      period: `2026-0${i + 4}`, minutes: 0, sms: 0,
    })));
    expect(flat).toContain('dchart-line');
    expect(flat).not.toContain('NaN');
  });
});

// ── cross-cutting: accessibility + zero deps on every chart ─────────────────
describe('all four charts: accessibility + zero dependencies', () => {
  const svgs = {
    activity: C.activityChartSVG(makeDaily(7, '2026-08-27'), 7),
    weekday: C.weekdayBarsSVG(WEEKDAY),
    source: C.sourceBarsSVG(BY_SOURCE),
    spark: C.usageSparkSVG(makeUsageTrend()),
  };

  for (const [name, svg] of Object.entries(svgs)) {
    test(`${name}: role=img + aria-label present`, () => {
      expect(svg).toContain('role="img"');
      expect(svg).toMatch(/aria-label="[^"]{10,}"/);
    });
    test(`${name}: viewBox present for responsive scaling`, () => {
      expect(svg).toMatch(/viewBox="0 0 \d+ [\d.]+"/);
    });
    test(`${name}: no NaN/undefined leaked into markup`, () => {
      expect(svg).not.toContain('NaN');
      expect(svg).not.toContain('undefined');
    });
    test(`${name}: no external refs (zero dependencies)`, () => {
      expect(svg).not.toMatch(/https?:\/\//);
      expect(svg).not.toContain('src=');
    });
  }
});
