// js/dashboard-charts.js — Dashboard D4 charts (ticket zeus_1788322144030_f0832d2b)
//
// Dashboard wave D4 of 9 — CHARTS. Dependency-free inline SVG rendered from the
// D1 summary payload (GET /portal/dashboard/summary):
//   daily       [{date:'YYYY-MM-DD', minutes, calls, sms, leads} × days]
//   weekday     [{day:'Sunday'…'Saturday', calls} × 7]   (Sunday-first)
//   leads.by_source { inbound_call: 6, web_form: 3, … }  (snake_case keys)
//   usage_trend [{period:'YYYY-MM', minutes, sms} × 6]
//
// Design rules (from the ticket):
//   - ZERO dependencies — no chart lib, hand-built SVG path strings.
//   - Pure data→SVG-string render functions: everything below the "render*"
//     boundary is a pure function of its inputs (unit-tested in
//     test/dashboard-charts.test.js via `module.exports`).
//   - Styling via CSS variables from portal.html's oklch-family palette
//     (--accent #3B82F6, --accent2 #7C3AED, --text/--muted/--border), so the
//     charts follow the light/dark theme automatically. Axis/label numerics
//     use a JetBrains-style mono stack (ui-monospace → JetBrains Mono).
//   - Every chart: role="img" + aria-label summary; weekday/source charts
//     ALSO carry a <desc>/text-alternative block (values are in the DOM as
//     real <text> nodes, so they are readable text alternatives).
//     Tooltips are pointer-only (per ticket: keyboard-focusable skipped).
//
// Rendering boundary (DOM side — only these touch document/*):
//   renderActivityChart(daily, days)   → #dash-activity-chart-slot
//   renderWeekdayChart(weekday)        → #dash-weekday-slot
//   renderSourceStrip(bySource)        → #dash-source-slot
//   renderUsageSparkline(usageTrend)   → #dash-usage-spark-slot

(function (global) {
  'use strict';

  // ── Palette / metrics constants (shared with portal CSS) ──────────────────
  var MONO_FONT = "ui-monospace, 'JetBrains Mono', 'SF Mono', Menlo, Consolas, monospace";
  var ACCENT = 'var(--accent)';        // minutes series (blue)
  var ACCENT2 = 'var(--accent2)';      // calls series (violet)
  var TEXT = 'var(--text)';
  var MUTED = 'var(--muted)';
  var BORDER = 'var(--border)';

  // ── Number/date helpers ───────────────────────────────────────────────────

  /** Short month-day label: '2026-08-27' → 'Aug 27'. */
  function shortDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    if (!m) return String(iso || '');
    var names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return names[parseInt(m[2], 10) - 1] + ' ' + parseInt(m[3], 10);
  }

  /** '2026-08' → 'Aug'. */
  function shortMonth(period) {
    var m = /^(\d{4})-(\d{2})$/.exec(String(period || ''));
    if (!m) return String(period || '');
    var names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return names[parseInt(m[2], 10) - 1];
  }

  /** Trim trailing zeros of a number for axis ticks: 1.5 → 1.5, 2 → 2. */
  function num(v) {
    return String(parseFloat(Number(v).toFixed(2)));
  }

  /** Clamp v into [lo, hi]. */
  function clamp(v, lo, hi) {
    return Math.min(hi, Math.max(lo, v));
  }

  // ── Scale builders (pure) ─────────────────────────────────────────────────

  /**
   * Linear scale factory. map(x) → px, where domain [d0,d1] maps onto
   * [r0,r1]. Degenerate domain (d0===d1) collapses to r0 + (r1-r0)/2.
   */
  function linearScale(d0, d1, r0, r1) {
    var dd = d1 - d0;
    var mid = r0 + (r1 - r0) / 2;
    return {
      map: function (x) {
        if (!isFinite(dd) || dd === 0) return mid;
        return r0 + ((x - d0) / dd) * (r1 - r0);
      },
      domain: [d0, d1],
      range: [r0, r1],
    };
  }

  /**
   * "Nice" y-axis maximum: smallest step of {1,2,2.5,5,10}×10^k such that
   * 4 gridlines divide the range evenly and max is covered.
   * chartMaxY(0) → 1 (never a zero-height axis).
   */
  function chartMaxY(maxValue, ticks) {
    var n = ticks || 4;
    var v = Math.max(0, Number(maxValue) || 0);
    if (v <= 0) return n === 4 ? 1 : 1;
    var raw = v / n;
    var mag = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10));
    var norm = raw / mag;
    var step;
    if (norm <= 1) step = 1;
    else if (norm <= 2) step = 2;
    else if (norm <= 2.5) step = 2.5;
    else if (norm <= 5) step = 5;
    else step = 10;
    var y = step * mag * n;
    // Rounding artifacts (e.g. 2.5*10*4) can land just under v.
    while (y < v) y += step * mag;
    return y;
  }

  /**
   * Polyline → SVG path "M x0 y0 L x1 y1 …". Points: [[x,y],…].
   * Empty/1-point input returns '' (a line needs 2+ points).
   */
  function pointsToPath(points) {
    if (!points || points.length < 2) return '';
    var parts = [];
    for (var i = 0; i < points.length; i++) {
      parts.push((i === 0 ? 'M' : 'L') + num(points[i][0]) + ' ' + num(points[i][1]));
    }
    return parts.join(' ');
  }

  /**
   * Area path: line along points, closed down to baseline y.
   * "M x0 y0 L … xn yn L xn y L x0 y Z" — empty for <2 points.
   */
  function areaPath(points, baselineY) {
    if (!points || points.length < 2) return '';
    var top = pointsToPath(points);
    var first = points[0];
    var last = points[points.length - 1];
    return top + ' L' + num(last[0]) + ' ' + num(baselineY) +
      ' L' + num(first[0]) + ' ' + num(baselineY) + ' Z';
  }

  /** Escape a string for safe embedding in SVG text nodes / attributes. */
  function esc(str) {
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // ── 1. Activity area chart ────────────────────────────────────────────────

  /**
   * Build the activity chart geometry (pure).
   * @param {Array} daily  [{date, minutes, calls} …] (any length ≥ 1)
   * @param {object} opts  {w, h, padL, padR, padT, padB, ticks}
   * @returns {object} scales, gridlines, series point lists, paths
   */
  function buildActivityGeometry(daily, opts) {
    var o = opts || {};
    var w = o.w || 640, h = o.h || 230;
    var padL = o.padL != null ? o.padL : 30, padR = o.padR != null ? o.padR : 10;
    var padT = o.padT != null ? o.padT : 12, padB = o.padB != null ? o.padB : 20;
    var ticks = o.ticks || 4;
    var rows = Array.isArray(daily) ? daily : [];
    var n = rows.length;

    var maxMinutes = 0, maxCalls = 0, totalMinutes = 0, totalCalls = 0;
    for (var i = 0; i < n; i++) {
      var m = Math.max(0, Number(rows[i] && rows[i].minutes) || 0);
      var c = Math.max(0, Number(rows[i] && rows[i].calls) || 0);
      if (m > maxMinutes) maxMinutes = m;
      if (c > maxCalls) maxCalls = c;
      totalMinutes += m;
      totalCalls += c;
    }

    var yMax = chartMaxY(maxMinutes, ticks);
    var x0 = padL, x1 = w - padR, y0 = h - padB, y1 = padT;
    var xScale = linearScale(0, Math.max(1, n - 1), x0, x1);
    var yScale = linearScale(0, yMax, y0, y1);

    // Gridlines: ticks horizontal lines including axis top (yMax) and base (0).
    var grid = [];
    for (var t = 0; t <= ticks; t++) {
      var val = (yMax / ticks) * t;
      grid.push({ val: val, y: yScale.map(val) });
    }

    var minutePts = [], callPts = [];
    for (var j = 0; j < n; j++) {
      var x = xScale.map(j);
      minutePts.push([x, yScale.map(Math.max(0, Number(rows[j] && rows[j].minutes) || 0))]);
      callPts.push([x, yScale.map(Math.max(0, Number(rows[j] && rows[j].calls) || 0))]);
    }

    return {
      w: w, h: h, n: n, rows: rows,
      xScale: xScale, yScale: yScale, yMax: yMax,
      grid: grid,
      minutePts: minutePts, callPts: callPts,
      minutesPath: pointsToPath(minutePts),
      callsPath: pointsToPath(callPts),
      minutesArea: areaPath(minutePts, y0),
      lastPoint: n ? minutePts[n - 1] : null,
      totals: { minutes: totalMinutes, calls: totalCalls },
    };
  }

  /**
   * Activity chart SVG (pure). Minutes/day as accent area line; calls/day as
   * accent2 overlay line; y gridlines; x labels at ~6 spots; last-point
   * highlight; per-point invisible hover hit-targets.
   */
  function activityChartSVG(daily, days) {
    var g = buildActivityGeometry(daily, {});
    var n = g.n;
    var aria = 'Activity chart: ' + (days || n) + '-day trend of voice minutes (area) and calls answered (line)' +
      '. Total ' + g.totals.minutes + ' minutes and ' + g.totals.calls + ' calls.';
    var svg = '<svg class="dchart dchart-activity" viewBox="0 0 ' + g.w + ' ' + g.h + '" preserveAspectRatio="none"' +
      ' role="img" aria-label="' + esc(aria) + '" focusable="false">';

    // Y gridlines + tick labels
    for (var i = 0; i < g.grid.length; i++) {
      var gl = g.grid[i];
      svg += '<line class="dchart-grid" x1="' + g.xScale.range[0] + '" y1="' + num(gl.y) + '"' +
        ' x2="' + g.xScale.range[1] + '" y2="' + num(gl.y) + '"/>';
      svg += '<text class="dchart-tick dchart-y" x="' + (g.xScale.range[0] - 5) + '" y="' + num(gl.y + 3.5) + '" text-anchor="end">' + num(gl.val) + '</text>';
    }

    // X labels: ≤6 evenly spaced date labels (skips first when crowded)
    if (n > 0) {
      var stepX = Math.max(1, Math.ceil(n / 6));
      for (var k = 0; k < n; k += stepX) {
        svg += '<text class="dchart-tick dchart-x" x="' + num(g.minutePts[k][0]) + '" y="' + (g.h - 5) + '" text-anchor="middle">' + esc(shortDate(g.rows[k].date)) + '</text>';
      }
    }

    // Series
    if (n >= 2) {
      svg += '<path class="dchart-area" d="' + g.minutesArea + '"/>';
      svg += '<path class="dchart-line dchart-minutes" d="' + g.minutesPath + '"/>';
      svg += '<path class="dchart-line dchart-calls" d="' + g.callsPath + '"/>';
    } else if (n === 1) {
      svg += '<circle class="dchart-dot dchart-minutes" cx="' + num(g.minutePts[0][0]) + '" cy="' + num(g.minutePts[0][1]) + '" r="3"/>';
    }

    // Last-point highlight
    if (g.lastPoint && n >= 2) {
      svg += '<circle class="dchart-last" cx="' + num(g.lastPoint[0]) + '" cy="' + num(g.lastPoint[1]) + '" r="3.5"/>';
    }

    // Hover hit-targets (pointer-only tooltips, per ticket)
    if (n > 0) {
      var bandW = Math.max(4, (g.xScale.range[1] - g.xScale.range[0]) / n);
      for (var p = 0; p < n; p++) {
        var bx = g.minutePts[p][0] - bandW / 2;
        svg += '<rect class="dchart-hit" data-i="' + p + '" x="' + num(bx) + '" y="0" width="' + num(bandW) + '" height="' + num(g.yScale.range[0]) + '"/>';
      }
    }

    svg += '</svg>';
    return svg;
  }

  // ── 2. Weekday bars ───────────────────────────────────────────────────────

  /**
   * Weekday bar geometry (pure). Reorders the Sunday-first payload into
   * Monday-first for display (Mon→Sun), finds the max day.
   */
  function buildWeekdayGeometry(weekday) {
    var rows = Array.isArray(weekday) ? weekday.slice() : [];
    var byName = {};
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i] || {};
      var calls = Math.max(0, Number(r.calls) || 0);
      if (r.day) byName[String(r.day)] = (byName[String(r.day)] || 0) + calls;
    }
    var order = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    var bars = order.map(function (d) {
      return { day: d, short: d.slice(0, 3), calls: byName[d] || 0 };
    });
    var maxCalls = 0, maxIdx = 0, total = 0;
    for (var j = 0; j < bars.length; j++) {
      total += bars[j].calls;
      if (bars[j].calls > maxCalls) { maxCalls = bars[j].calls; maxIdx = j; }
    }
    return { bars: bars, maxCalls: maxCalls, maxIdx: maxIdx, total: total };
  }

  /**
   * Weekday bars SVG (pure): 7 vertical bars Mon–Sun, count labels, max day
   * emphasized in accent color.
   */
  function weekdayBarsSVG(weekday) {
    var g = buildWeekdayGeometry(weekday);
    var w = 240, h = 190;
    var padT = 16, padB = 22, padL = 4, padR = 4;
    var y0 = h - padB;
    var aria = 'Calls by weekday: ' + g.bars.map(function (b) {
      return b.short + ' ' + b.calls;
    }).join(', ') + '.';
    var svg = '<svg class="dchart dchart-weekday" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="xMidYMid meet"' +
      ' role="img" aria-label="' + esc(aria) + '" focusable="false">';
    var slot = (w - padL - padR) / 7;
    var barW = Math.min(20, slot * 0.62);
    var denom = g.maxCalls > 0 ? g.maxCalls : 1;
    for (var i = 0; i < 7; i++) {
      var b = g.bars[i];
      var cx = padL + slot * i + slot / 2;
      var barH = (b.calls / denom) * (y0 - padT);
      var y = y0 - barH;
      var isMax = i === g.maxIdx && b.calls > 0;
      svg += '<rect class="dchart-bar' + (isMax ? ' max' : '') + '" x="' + num(cx - barW / 2) + '" y="' + num(y) + '"' +
        ' width="' + num(barW) + '" height="' + num(barH) + '" rx="3"><title>' + esc(b.day + ': ' + b.calls + ' calls') + '</title></rect>';
      if (b.calls > 0) {
        svg += '<text class="dchart-bar-label" x="' + num(cx) + '" y="' + num(y - 4) + '" text-anchor="middle">' + b.calls + '</text>';
      }
      svg += '<text class="dchart-tick dchart-x' + (isMax ? ' strong' : '') + '" x="' + num(cx) + '" y="' + (h - 7) + '" text-anchor="middle">' + b.short + '</text>';
    }
    svg += '</svg>';
    return svg;
  }

  // ── 3. Leads by source ────────────────────────────────────────────────────

  /** Human label for snake_case backend source keys. */
  var SOURCE_LABELS = {
    inbound_call: 'Voice call',
    web_form: 'Web form',
    booking_form: 'Booking form',
    sms_campaign: 'SMS campaign',
    campaign_outreach: 'Campaign outreach',
    triggered_call: 'Follow-up call',
    triggered_sms: 'Follow-up SMS',
    missed_call_sms: 'Missed-call SMS',
    missed_call_callback: 'Missed-call callback',
    lead_intake_webhook: 'Lead webhook',
    csv_import: 'CSV import',
    square_webhook: 'Square',
    google: 'Google',
    portal: 'Portal',
  };

  function sourceLabel(key) {
    var k = String(key || '');
    if (SOURCE_LABELS[k]) return SOURCE_LABELS[k];
    return k.replace(/_/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }

  /**
   * Source rows (pure): bySource object → sorted [{key,label,count}] desc by
   * count, alphabetical tiebreak (stable for tests).
   */
  function buildSourceRows(bySource) {
    var src = (bySource && typeof bySource === 'object' && !Array.isArray(bySource)) ? bySource : {};
    var rows = [];
    for (var k in src) {
      if (!Object.prototype.hasOwnProperty.call(src, k)) continue;
      var c = Number(src[k]);
      if (!isFinite(c) || c <= 0) continue;
      rows.push({ key: k, label: sourceLabel(k), count: c });
    }
    rows.sort(function (a, b) { return b.count - a.count || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0); });
    return rows;
  }

  /**
   * Leads-by-source SVG (pure): horizontal mini-bars with counts. Fixed
   * viewBox scales responsively inside the KPI-section strip slot.
   */
  function sourceBarsSVG(bySource) {
    var rows = buildSourceRows(bySource);
    var w = 260;
    var rowH = 26, padT = 6, padB = 4;
    var labelW = 118, countW = 34, gap = 8;
    var trackW = w - labelW - countW - gap * 2;
    var h = padT + Math.max(1, rows.length) * rowH + padB;
    var total = 0;
    for (var i = 0; i < rows.length; i++) total += rows[i].count;
    var aria = 'Leads by source: ' + (rows.length
      ? rows.map(function (r) { return r.label + ' ' + r.count; }).join(', ')
      : 'no leads yet') + '.';
    var svg = '<svg class="dchart dchart-source" viewBox="0 0 ' + w + ' ' + num(h) + '" preserveAspectRatio="xMidYMid meet"' +
      ' role="img" aria-label="' + esc(aria) + '" focusable="false">';
    var maxC = rows.length ? rows[0].count : 1;
    for (var j = 0; j < rows.length; j++) {
      var r = rows[j];
      var y = padT + j * rowH;
      var cy = y + rowH / 2;
      var barW = Math.max(2, (r.count / maxC) * trackW);
      svg += '<text class="dchart-label" x="0" y="' + num(cy + 4) + '">' + esc(r.label) + '</text>';
      svg += '<rect class="dchart-hbar-track" x="' + (labelW + gap) + '" y="' + num(cy - 4) + '" width="' + num(trackW) + '" height="8" rx="4"/>';
      svg += '<rect class="dchart-hbar' + (j === 0 ? ' max' : '') + '" x="' + (labelW + gap) + '" y="' + num(cy - 4) + '" width="' + num(barW) + '" height="8" rx="4"><title>' + esc(r.label + ': ' + r.count + ' leads (' + Math.round((r.count / (total || 1)) * 100) + '%)') + '</title></rect>';
      svg += '<text class="dchart-count" x="' + (w - 2) + '" y="' + num(cy + 4) + '" text-anchor="end">' + r.count + '</text>';
    }
    svg += '</svg>';
    return svg;
  }

  // ── 4. Usage sparkline ────────────────────────────────────────────────────

  /**
   * Usage sparkline geometry (pure): two series (minutes, sms) over 6 months.
   * Each series scaled to its own max (a shared max would flatten SMS to
   * invisible next to minutes).
   */
  function buildSparkGeometry(usageTrend) {
    var rows = Array.isArray(usageTrend) ? usageTrend : [];
    var n = rows.length;
    var maxMin = 0, maxSms = 0, lastMin = 0, lastSms = 0;
    for (var i = 0; i < n; i++) {
      var m = Math.max(0, Number(rows[i] && rows[i].minutes) || 0);
      var s = Math.max(0, Number(rows[i] && rows[i].sms) || 0);
      if (m > maxMin) maxMin = m;
      if (s > maxSms) maxSms = s;
    }
    if (n) {
      lastMin = Math.max(0, Number(rows[n - 1].minutes) || 0);
      lastSms = Math.max(0, Number(rows[n - 1].sms) || 0);
    }
    return { rows: rows, n: n, maxMinutes: maxMin, maxSms: maxSms, lastMinutes: lastMin, lastSms: lastSms };
  }

  /**
   * Dual mini-line sparkline SVG (pure): minutes (accent) + SMS (accent2)
   * over the last 6 months, first/last month labels underneath.
   */
  function usageSparkSVG(usageTrend) {
    var g = buildSparkGeometry(usageTrend);
    var w = 220, h = 54;
    var padT = 6, padB = 14, padL = 4, padR = 26;
    var y0 = h - padB, y1 = padT;
    var svg = '<svg class="dchart dchart-spark" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="xMidYMid meet"';
    var aria;
    if (!g.n) {
      aria = 'Usage trend: no data yet.';
    } else {
      aria = 'Usage trend, ' + shortMonth(g.rows[0].period) + ' to ' + shortMonth(g.rows[g.n - 1].period) + ': ' +
        'voice minutes ' + g.rows.map(function (r) { return r.minutes; }).join(', ') + '; ' +
        'SMS ' + g.rows.map(function (r) { return r.sms; }).join(', ') + '.';
    }
    svg += ' role="img" aria-label="' + esc(aria) + '" focusable="false">';
    if (g.n >= 2) {
      var xS = linearScale(0, g.n - 1, padL, w - padR);
      var minS = linearScale(0, g.maxMinutes || 1, y0, y1);
      var smsS = linearScale(0, g.maxSms || 1, y0, y1);
      var minPts = [], smsPts = [];
      for (var i = 0; i < g.n; i++) {
        var x = xS.map(i);
        minPts.push([x, minS.map(Math.max(0, Number(g.rows[i].minutes) || 0))]);
        smsPts.push([x, smsS.map(Math.max(0, Number(g.rows[i].sms) || 0))]);
      }
      svg += '<path class="dchart-line dchart-minutes" d="' + pointsToPath(minPts) + '"/>';
      svg += '<path class="dchart-line dchart-calls dchart-sms" d="' + pointsToPath(smsPts) + '"/>';
      // Last-value endpoint dots + right-edge value labels
      var lastX = minPts[g.n - 1][0];
      svg += '<circle class="dchart-dot dchart-minutes" cx="' + num(lastX) + '" cy="' + num(minPts[g.n - 1][1]) + '" r="2.5"/>';
      svg += '<circle class="dchart-dot dchart-calls" cx="' + num(lastX) + '" cy="' + num(smsPts[g.n - 1][1]) + '" r="2.5"/>';
      svg += '<text class="dchart-tick dchart-spark-val" x="' + (w - 2) + '" y="' + num(minPts[g.n - 1][1] + 3) + '" text-anchor="end">' + g.lastMinutes + '</text>';
      svg += '<text class="dchart-tick dchart-spark-val sms" x="' + (w - 2) + '" y="' + num(smsPts[g.n - 1][1] + 3) + '" text-anchor="end">' + g.lastSms + '</text>';
      svg += '<text class="dchart-tick dchart-x" x="' + num(minPts[0][0]) + '" y="' + (h - 2) + '">' + esc(shortMonth(g.rows[0].period)) + '</text>';
      svg += '<text class="dchart-tick dchart-x" x="' + num(lastX) + '" y="' + (h - 2) + '" text-anchor="end">' + esc(shortMonth(g.rows[g.n - 1].period)) + '</text>';
    } else if (g.n === 1) {
      svg += '<circle class="dchart-dot dchart-minutes" cx="' + num(padL + 2) + '" cy="' + num((y0 + y1) / 2) + '" r="2.5"/>';
      svg += '<text class="dchart-tick dchart-x" x="' + num(padL + 2) + '" y="' + (h - 2) + '">' + esc(shortMonth(g.rows[0].period)) + '</text>';
    }
    svg += '</svg>';
    return svg;
  }

  // ── DOM wiring (the only non-pure surface) ────────────────────────────────

  function emptySlotHTML(icon, text) {
    return '<i data-lucide="' + icon + '"></i><span>' + text + '</span>';
  }

  function setSlot(el, html, isEmpty) {
    if (!el) return;
    el.innerHTML = html;
    if (isEmpty) el.classList.add('dash-slot-empty');
    else el.classList.remove('dash-slot-empty');
  }

  var tooltipEl = null;

  function getTooltip() {
    if (!tooltipEl || !tooltipEl.isConnected) {
      tooltipEl = document.createElement('div');
      tooltipEl.className = 'dchart-tip';
      tooltipEl.setAttribute('aria-hidden', 'true');
      document.body.appendChild(tooltipEl);
    }
    return tooltipEl;
  }

  function hideTooltip() {
    if (tooltipEl) tooltipEl.style.display = 'none';
  }

  /** Position the shared tooltip near ev.clientX/Y, clamped to viewport. */
  function placeTooltip(ev) {
    var tip = getTooltip();
    tip.style.display = 'block';
    var tw = tip.offsetWidth, th = tip.offsetHeight;
    var x = ev.clientX + 12;
    var y = ev.clientY - th - 10;
    if (x + tw > window.innerWidth - 8) x = ev.clientX - tw - 12;
    if (y < 8) y = ev.clientY + 14;
    tip.style.left = x + 'px';
    tip.style.top = y + 'px';
  }

  /**
   * Wire pointer tooltips onto a rendered activity chart container.
   * Listener scope is the container (one pointermove/pointerleave pair).
   */
  function wireActivityTooltip(container, daily) {
    if (!container || !daily || !daily.length) return;
    var rows = daily;
    container.addEventListener('pointermove', function (ev) {
      if (ev.pointerType === 'touch' && ev.pointerType !== 'touch') return; // future-proof no-op
      var target = ev.target;
      if (!target || !target.classList || !target.classList.contains('dchart-hit')) {
        hideTooltip();
        return;
      }
      var i = parseInt(target.getAttribute('data-i'), 10);
      var r = rows[i];
      if (!r) { hideTooltip(); return; }
      var tip = getTooltip();
      tip.innerHTML = '<b>' + esc(shortDate(r.date)) + '</b>' +
        '<span class="dchart-tip-row"><i class="dchart-swatch minutes"></i>Minutes <b>' + (Math.max(0, Number(r.minutes) || 0)) + '</b></span>' +
        '<span class="dchart-tip-row"><i class="dchart-swatch calls"></i>Calls <b>' + (Math.max(0, Number(r.calls) || 0)) + '</b></span>' +
        (Number(r.leads) > 0 ? '<span class="dchart-tip-row"><i class="dchart-swatch leads"></i>Leads <b>' + (Math.max(0, Number(r.leads) || 0)) + '</b></span>' : '');
      placeTooltip(ev);
    });
    container.addEventListener('pointerleave', hideTooltip);
  }

  var state = { daily: [] };

  /** Render #1 into the D3 shell slot. */
  function renderActivityChart(daily, days) {
    var el = document.getElementById('dash-activity-chart-slot');
    if (!el) return;
    var rows = Array.isArray(daily) ? daily : [];
    var hasData = rows.some(function (r) {
      return (Number(r && r.minutes) || 0) > 0 || (Number(r && r.calls) || 0) > 0;
    });
    if (!hasData) {
      state.daily = [];
      setSlot(el, emptySlotHTML('line-chart', 'No call activity in this period — your chart appears once calls come in'), true);
      return;
    }
    state.daily = rows;
    setSlot(el, '<div class="dchart-legend">' +
      '<span class="dchart-legend-item"><i class="dchart-swatch minutes"></i>Voice minutes</span>' +
      '<span class="dchart-legend-item"><i class="dchart-swatch calls"></i>Calls</span>' +
      '</div>' + activityChartSVG(rows, days), false);
    wireActivityTooltip(el, rows);
  }

  /** Render #2 into the weekday slot. */
  function renderWeekdayChart(weekday) {
    var el = document.getElementById('dash-weekday-slot');
    if (!el) return;
    var g = buildWeekdayGeometry(weekday);
    if (g.total <= 0) {
      setSlot(el, emptySlotHTML('bar-chart-3', 'No calls yet — weekday bars appear once calls come in'), true);
      return;
    }
    setSlot(el, '<div class="dchart-slot-title">Calls by weekday</div>' + weekdayBarsSVG(weekday), false);
  }

  /** Render #3 into the KPI-strip source slot. */
  function renderSourceStrip(bySource) {
    var el = document.getElementById('dash-source-slot');
    if (!el) return;
    var rows = buildSourceRows(bySource);
    if (!rows.length) {
      setSlot(el, emptySlotHTML('users', 'No leads captured in this period'), true);
      return;
    }
    setSlot(el, '<div class="dchart-slot-title">Leads by source</div>' + sourceBarsSVG(bySource), false);
  }

  /** Render #4 into the usage-card sparkline slot. */
  function renderUsageSparkline(usageTrend) {
    var el = document.getElementById('dash-usage-spark-slot');
    if (!el) return;
    var g = buildSparkGeometry(usageTrend);
    var any = g.n && (g.maxMinutes > 0 || g.maxSms > 0);
    if (!any) {
      setSlot(el, emptySlotHTML('trending-up', 'Usage trend appears after your first month of activity'), true);
      return;
    }
    setSlot(el, '<div class="dchart-slot-title">6-month trend' +
      '<span class="dchart-legend-inline"><i class="dchart-swatch minutes"></i>min' +
      '<i class="dchart-swatch calls"></i>SMS</span></div>' + usageSparkSVG(usageTrend), false);
  }

  // Export — module for jest, window global for the portal.
  var api = {
    // pure helpers (tested)
    shortDate: shortDate,
    shortMonth: shortMonth,
    num: num,
    clamp: clamp,
    linearScale: linearScale,
    chartMaxY: chartMaxY,
    pointsToPath: pointsToPath,
    areaPath: areaPath,
    esc: esc,
    buildActivityGeometry: buildActivityGeometry,
    activityChartSVG: activityChartSVG,
    buildWeekdayGeometry: buildWeekdayGeometry,
    weekdayBarsSVG: weekdayBarsSVG,
    sourceLabel: sourceLabel,
    buildSourceRows: buildSourceRows,
    sourceBarsSVG: sourceBarsSVG,
    buildSparkGeometry: buildSparkGeometry,
    usageSparkSVG: usageSparkSVG,
    // DOM render fns
    renderActivityChart: renderActivityChart,
    renderWeekdayChart: renderWeekdayChart,
    renderSourceStrip: renderSourceStrip,
    renderUsageSparkline: renderUsageSparkline,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  global.DashboardCharts = api;
})(typeof window !== 'undefined' ? window : globalThis);
