// js/dashboard-conversion.js — Dashboard D6 (ticket zeus_1788322144357_b0cc6c65)
//
// Dashboard wave D6 of 9 — LEADS & CONVERSION. Renders the right rail of the
// "Leads & Conversion" dashboard section from EXISTING endpoints:
//   - Booking funnel   ← D1 summary payload: funnel { calls, leads,
//     appointments } (GET /portal/dashboard/summary)
//   - Top intents      ← D1 summary payload: leads.by_intent (grouped
//     case-insensitively — the backend buckets raw caller intents)
//   - Recent leads     ← GET /portal/leads (10 most recent, portal.html sorts)
//
// D2 wrote call outcomes ('booked'|'lead'|'info') onto call records
// server-side (atlas-ai PR #518). No portal endpoint exposes them yet, so the
// funnel renders the D1 counts; if the summary payload ever carries a
// call_outcomes map, the funnel surfaces it as outcome-verified quality text
// (buildFunnel passes it through — defensive hook, unit-tested).
//
// Design rules (mirrors js/dashboard-charts.js / D4):
//   - ZERO dependencies. Pure data→HTML-string functions below the "render*"
//     boundary; unit-tested in test/dashboard-conversion.test.js.
//   - Styling via portal.html CSS variables → light/dark themes both work.
//   - PII-safe: phone numbers render masked (last 4 only) everywhere on the
//     dashboard, including the expanded row detail.
//   - Every render: aria labels; lead rows are keyboard-focusable buttons
//     with aria-expanded; intent chips are real <button>s.

(function (global) {
  'use strict';

  // ── Constants ──────────────────────────────────────────────────────────────
  var MONO_FONT = "ui-monospace, 'JetBrains Mono', 'SF Mono', Menlo, Consolas, monospace";

  // Human label for snake_case backend source keys (same map as
  // js/dashboard-charts.js SOURCE_LABELS — kept local so this module stays
  // self-contained like its D4 sibling).
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

  /** Human label for a source key; unknown keys → Title Case. */
  function sourceLabel(key) {
    var k = String(key || '');
    if (SOURCE_LABELS[k]) return SOURCE_LABELS[k];
    return k.replace(/_/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }

  // ── PII-safe helpers ───────────────────────────────────────────────────────

  /**
   * Mask a phone number for dashboard display: keep only the last 4 digits.
   * '+11234567891' → '•••• 7891'. Null/empty → ''. Numbers with <4 digits
   * (or already-masked input like '+155****4567') still render only a
   * masked tail — never a full number.
   */
  function maskPhone(phone) {
    var raw = String(phone == null ? '' : phone);
    var digits = raw.replace(/\D/g, '');
    if (!digits) return '';
    var tail = digits.slice(-4);
    return '•••• ' + tail;
  }

  // ── Small pure helpers ─────────────────────────────────────────────────────

  /** Escape a string for safe HTML interpolation. */
  function esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /** Rounded percentage of part/whole; 0 when whole <= 0; clamped to 100. */
  function pct(part, whole) {
    var p = Math.max(0, Number(part) || 0);
    var w = Math.max(0, Number(whole) || 0);
    if (w <= 0) return 0;
    return Math.min(100, Math.round((p / w) * 100));
  }

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  /**
   * Relative time for a captured_at ISO string: 'just now', 'Xm ago',
   * 'Xh ago', 'Xd ago', 'Aug 23', or 'Aug 23, 2025' (other year).
   * Invalid/missing → ''. `now` injectable for tests (defaults to Date.now()).
   */
  function relTime(iso, now) {
    if (!iso) return '';
    var t = Date.parse(iso);
    if (!isFinite(t)) return '';
    var nowMs = now != null ? Number(now) : Date.now();
    var diff = nowMs - t;
    if (diff < 60 * 1000) return 'just now';
    if (diff < 60 * 60 * 1000) return Math.floor(diff / 60000) + 'm ago';
    if (diff < 24 * 60 * 60 * 1000) return Math.floor(diff / 3600000) + 'h ago';
    if (diff < 7 * 24 * 60 * 60 * 1000) return Math.floor(diff / 86400000) + 'd ago';
    var d = new Date(t);
    // UTC getters: captured_at is a UTC instant and the backend's date
    // convention is UTC (portalRouter comment) — local getters made the
    // label TZ-dependent (a UTC midnight instant shows the previous day in
    // US timezones).
    var label = MONTHS[d.getUTCMonth()] + ' ' + d.getUTCDate();
    if (d.getUTCFullYear() !== new Date(nowMs).getUTCFullYear()) label += ', ' + d.getUTCFullYear();
    return label;
  }

  // ── Intent grouping (top intents chips) ────────────────────────────────────

  /** Grouping key for intents: case- and whitespace-insensitive. */
  function intentKey(intent) {
    return String(intent || '').trim().toLowerCase();
  }

  /**
   * Top intents from a by_intent map, grouped case-insensitively (staging
   * data mixes 'book an appointment' and 'Book an appointment'), sorted desc
   * by count with an alphabetical tiebreak (stable for tests), capped at
   * `max` (default 5). Rows: [{ key, label, count }] — label is the
   * first-seen spelling.
   */
  function buildTopIntents(byIntent, max) {
    var src = (byIntent && typeof byIntent === 'object' && !Array.isArray(byIntent)) ? byIntent : {};
    var cap = Math.max(1, Number(max) || 5);
    var groups = {};
    for (var k in src) {
      if (!Object.prototype.hasOwnProperty.call(src, k)) continue;
      var c = Number(src[k]);
      if (!isFinite(c) || c <= 0) continue;
      var key = intentKey(k) || 'unknown';
      if (!groups[key]) groups[key] = { key: key, label: String(k).trim() || 'unknown', count: 0 };
      groups[key].count += c;
    }
    var rows = [];
    for (var g in groups) {
      if (Object.prototype.hasOwnProperty.call(groups, g)) rows.push(groups[g]);
    }
    rows.sort(function (a, b) {
      return b.count - a.count || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0);
    });
    return rows.slice(0, cap);
  }

  // ── Funnel (booking funnel card) ───────────────────────────────────────────

  /** Coerce to a non-negative finite number. */
  function nn(v) { return Math.max(0, Number(v) || 0); }

  /**
   * Funnel data from the D1 summary payload (pure). Prefers funnel.{calls,
   * leads,appointments}, falls back to kpis.*.current. Passes through a
   * call_outcomes map when present (D2 defensive hook — no portal endpoint
   * exposes outcomes today).
   */
  function buildFunnel(summary) {
    var s = (summary && typeof summary === 'object') ? summary : {};
    var f = (s.funnel && typeof s.funnel === 'object') ? s.funnel : {};
    var k = (s.kpis && typeof s.kpis === 'object') ? s.kpis : {};
    var calls = f.calls != null ? nn(f.calls) : nn(k.calls_answered && k.calls_answered.current);
    var leads = f.leads != null ? nn(f.leads) : nn(k.leads_captured && k.leads_captured.current);
    var appts = f.appointments != null ? nn(f.appointments) : nn(k.appointments_booked && k.appointments_booked.current);
    return {
      calls: calls,
      leads: leads,
      appointments: appts,
      callToLeadPct: pct(leads, calls),
      leadToApptPct: pct(appts, leads),
      endToEndPct: pct(appts, calls),
      outcomes: (s.call_outcomes && typeof s.call_outcomes === 'object') ? s.call_outcomes : null,
    };
  }

  // ── Lead rows (recent leads table) ─────────────────────────────────────────

  /**
   * Normalize one lead record into dashboard-row data (pure). Name falls back
   * email → masked phone → 'Unknown'; the phone column is ALWAYS masked.
   */
  function leadRowData(lead) {
    var l = lead || {};
    var masked = maskPhone(l.phone);
    return {
      leadId: l.lead_id || '',
      name: (l.name && String(l.name).trim()) || l.email || masked || 'Unknown',
      phoneMasked: masked,
      email: l.email || '',
      source: sourceLabel(l.source) || 'Unknown',
      intent: l.intent || l.lead_context || '—',
      score: (l.score === 0 || l.score) ? String(l.score) : '—',
      capturedAt: l.captured_at || '',
      rel: relTime(l.captured_at),
      status: l.status || '',
      needsAttention: l.needs_agent_attention === true,
      nextAction: l.next_action_display || '',
    };
  }

  /** Full absolute date for the expanded detail row. */
  function fullDate(iso) {
    if (!iso) return '—';
    var t = Date.parse(iso);
    if (!isFinite(t)) return '—';
    return new Date(t).toLocaleString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit',
    });
  }

  // ── HTML builders (pure string → string) ───────────────────────────────────

  /**
   * Booking funnel card HTML (pure). Three horizontal stage bars with counts
   * plus between-stage conversion; degraded states for zero data.
   */
  function funnelHTML(funnelData) {
    var f = funnelData || { calls: 0, leads: 0, appointments: 0, callToLeadPct: 0, leadToApptPct: 0, endToEndPct: 0, outcomes: null };
    var total = f.calls + f.leads + f.appointments;
    if (total <= 0) {
      return '<div class="dconv-empty"><i data-lucide="filter"></i>' +
        '<span>No activity yet — your funnel appears after your first call or lead</span></div>';
    }
    var maxStage = Math.max(f.calls, f.leads, f.appointments, 1);
    function stageRow(idx, label, count) {
      var w = Math.round((count / maxStage) * 100);
      return '<div class="dconv-stage" role="listitem">' +
        '<div class="dconv-stage-head"><span class="dconv-stage-label">' + esc(label) + '</span>' +
        '<span class="dconv-stage-count">' + count + '</span></div>' +
        '<div class="dconv-stage-track"><div class="dconv-stage-fill' + (count === 0 ? ' zero' : '') + '" style="width:' + w + '%"></div></div>' +
        '</div>';
    }
    function arrowRow(pctVal, text) {
      return '<div class="dconv-arrow" aria-hidden="true"><span class="dconv-arrow-line"></span>' +
        '<span class="dconv-arrow-label">' + pctVal + '% ' + esc(text) + '</span></div>';
    }
    var aria = 'Booking funnel: ' + f.calls + ' calls, ' + f.leads + ' leads, ' + f.appointments +
      ' appointments. Call to lead conversion ' + f.callToLeadPct + ' percent, lead to appointment ' +
      f.leadToApptPct + ' percent.';
    var html = '<div class="dconv-funnel" role="list" aria-label="' + esc(aria) + '">';
    html += stageRow(0, 'Calls', f.calls);
    html += arrowRow(f.callToLeadPct, 'became leads');
    html += stageRow(1, 'Leads', f.leads);
    html += arrowRow(f.leadToApptPct, 'booked');
    html += stageRow(2, 'Appointments', f.appointments);
    html += '</div>';
    if (f.calls === 0 && f.leads > 0) {
      html += '<div class="dconv-hint">No calls in this period — leads came from web, SMS, or form sources</div>';
    }
    // D2 hook — outcome-verified quality text when the payload carries it.
    if (f.outcomes && f.outcomes.booked != null) {
      html += '<div class="dconv-hint">' + nn(f.outcomes.booked) + ' of ' + f.calls +
        ' calls ended in a booking (outcome-verified)</div>';
    }
    return html;
  }

  /**
   * Top intents chips HTML (pure). Clickable buttons route to the Analytics
   * page (which shows the full intent breakdown) — the Analytics page has no
   * per-intent filter, so chips navigate rather than pre-filter.
   */
  function intentChipsHTML(intents) {
    var rows = Array.isArray(intents) ? intents : [];
    if (!rows.length) {
      return '<div class="dconv-empty"><i data-lucide="tags"></i>' +
        '<span>No intents yet — they appear as your AI handles calls and leads</span></div>';
    }
    var colors = ['var(--accent)', 'var(--accent2)', '#22c55e', '#f59e0b', '#8b5cf6', '#ec4899'];
    var html = '<div class="dconv-chips" role="group" aria-label="Top lead intents">';
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var color = colors[i % colors.length];
      html += '<button type="button" class="dconv-chip" data-intent="' + esc(r.key) + '"' +
        ' onclick="showPage(\'analytics\')"' +
        ' aria-label="' + esc(r.label) + ': ' + r.count + ' leads. Opens the Analytics page.">' +
        '<span class="dconv-chip-dot" style="background:' + color + '"></span>' +
        '<span class="dconv-chip-label">' + esc(r.label) + '</span>' +
        '<span class="dconv-chip-count">' + r.count + '</span></button>';
    }
    html += '</div>';
    return html;
  }

  /**
   * Recent leads table HTML (pure). 10 rows max; every phone masked; rows are
   * keyboard-focusable toggles (aria-expanded) with an expandable detail row
   * beneath each.
   */
  function leadTableHTML(rowsData) {
    var rows = (Array.isArray(rowsData) ? rowsData : []).slice(0, 10);
    if (!rows.length) {
      return '<div class="dconv-empty"><i data-lucide="users"></i>' +
        '<span>No leads captured yet. When someone calls or fills a form, they show up here.</span></div>';
    }
    var html = '<div class="dconv-table-scroll"><table class="dash-mini-table dconv-lead-table"><thead><tr>' +
      '<th scope="col">Name</th><th scope="col">Phone</th><th scope="col">Source</th>' +
      '<th scope="col">Intent</th><th scope="col">Score</th><th scope="col">Captured</th>' +
      '</tr></thead><tbody>';
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var detailId = 'dconv-lead-detail-' + i;
      html += '<tr class="dconv-lead-row" data-lead-row="' + i + '"' +
        ' tabindex="0" role="button" aria-expanded="false" aria-controls="' + detailId + '"' +
        ' title="Show lead details">' +
        '<td class="dconv-lead-name">' + esc(r.name) + '</td>' +
        '<td class="dconv-lead-phone">' + esc(r.phoneMasked || '—') + '</td>' +
        '<td><span class="dconv-source-badge">' + esc(r.source) + '</span></td>' +
        '<td class="dconv-lead-intent">' + esc(r.intent) + '</td>' +
        '<td class="dconv-lead-score">' + esc(r.score) + '</td>' +
        '<td class="dconv-lead-when" title="' + esc(fullDate(r.capturedAt)) + '">' + esc(r.rel || '—') + '</td>' +
        '</tr>';
      html += '<tr class="dconv-lead-detail" id="' + detailId + '" hidden>' +
        '<td colspan="6">' +
        '<div class="dconv-detail-grid">' +
        '<span><b>Captured</b> ' + esc(fullDate(r.capturedAt)) + '</span>' +
        '<span><b>Status</b> ' + esc(r.status || 'new') + (r.needsAttention ? ' <span class="dconv-attn">needs attention</span>' : '') + '</span>' +
        (r.nextAction ? '<span><b>Next</b> ' + esc(r.nextAction) + '</span>' : '') +
        '<span class="dconv-detail-note">Full details &amp; unmasked contact info live in Leads &amp; CRM</span>' +
        '</div></td></tr>';
    }
    html += '</tbody></table></div>';
    return html;
  }

  // ── DOM wiring (the only non-pure surface) ─────────────────────────────────

  function setSlot(el, html, isEmpty) {
    if (!el) return;
    el.innerHTML = html;
    if (isEmpty) el.classList.add('dash-slot-empty');
    else el.classList.remove('dash-slot-empty');
  }

  /** Toggle a lead row's detail row; collapses any other open row. */
  function toggleLeadRow(row) {
    if (!row) return;
    var idx = row.getAttribute('data-lead-row');
    var detail = document.getElementById('dconv-lead-detail-' + idx);
    if (!detail) return;
    var open = row.getAttribute('aria-expanded') === 'true';
    // Collapse all rows first (one open at a time keeps the table tidy).
    var all = document.querySelectorAll('.dconv-lead-row[aria-expanded="true"]');
    for (var i = 0; i < all.length; i++) {
      all[i].setAttribute('aria-expanded', 'false');
      var d = document.getElementById('dconv-lead-detail-' + all[i].getAttribute('data-lead-row'));
      if (d) d.hidden = true;
    }
    if (!open) {
      row.setAttribute('aria-expanded', 'true');
      detail.hidden = false;
    }
  }

  /** Render the recent-leads table into #dash-leads-table. */
  function renderLeadRows(leads) {
    var el = document.getElementById('dash-leads-table');
    if (!el) return;
    var list = Array.isArray(leads) ? leads : [];
    var rowsData = [];
    for (var i = 0; i < list.length && i < 10; i++) rowsData.push(leadRowData(list[i]));
    setSlot(el, leadTableHTML(rowsData), rowsData.length === 0);
    if (rowsData.length) {
      el.addEventListener('click', function (ev) {
        var row = ev.target && ev.target.closest ? ev.target.closest('.dconv-lead-row') : null;
        if (row) toggleLeadRow(row);
      });
      el.addEventListener('keydown', function (ev) {
        if (ev.key !== 'Enter' && ev.key !== ' ') return;
        var row = ev.target && ev.target.closest ? ev.target.closest('.dconv-lead-row') : null;
        if (row) { ev.preventDefault(); toggleLeadRow(row); }
      });
    }
    if (global.lucide) global.lucide.createIcons();
  }

  /** Render the booking funnel into #dash-funnel-slot. */
  function renderFunnel(summary) {
    var el = document.getElementById('dash-funnel-slot');
    if (!el) return;
    var f = buildFunnel(summary);
    setSlot(el, funnelHTML(f), (f.calls + f.leads + f.appointments) <= 0);
    if (global.lucide) global.lucide.createIcons();
  }

  /** Render the top-intents chips into #dash-intents-slot. */
  function renderIntentChips(byIntent) {
    var el = document.getElementById('dash-intents-slot');
    if (!el) return;
    var rows = buildTopIntents(byIntent, 5);
    setSlot(el,
      '<div class="dconv-slot-title">Top intents</div>' + intentChipsHTML(rows),
      rows.length === 0);
    if (global.lucide) global.lucide.createIcons();
  }

  // ── Export — module for jest, window global for the portal ────────────────
  var api = {
    maskPhone: maskPhone,
    esc: esc,
    pct: pct,
    relTime: relTime,
    intentKey: intentKey,
    buildTopIntents: buildTopIntents,
    buildFunnel: buildFunnel,
    leadRowData: leadRowData,
    fullDate: fullDate,
    sourceLabel: sourceLabel,
    funnelHTML: funnelHTML,
    intentChipsHTML: intentChipsHTML,
    leadTableHTML: leadTableHTML,
    toggleLeadRow: toggleLeadRow,
    renderLeadRows: renderLeadRows,
    renderFunnel: renderFunnel,
    renderIntentChips: renderIntentChips,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  global.DashboardConversion = api;
})(typeof window !== 'undefined' ? window : globalThis);
