// js/dashboard-agent.js — Dashboard D7 (ticket zeus_1788322144485_8d712fe3)
//
// Dashboard wave D7 of 9 — AGENT STATUS. Renders the agent health status card
// from the client record (portalClient object) and voice catalog.
//
// Pure data→HTML-string functions; unit-tested in test/dashboard-agent.test.js.
// Follows the same design rules as D4 (dashboard-charts.js) and D6
// (dashboard-conversion.js): ZERO dependencies, PII-safe phone masking,
// degraded states for missing data.

(function (global) {
  'use strict';

  // ── PII-safe helpers ───────────────────────────────────────────────────────

  /**
   * Mask a phone number for dashboard display: keep only the last 4 digits.
   * '+15551234567' → '•••• 4567'. Null/empty → ''.
   */
  function maskPhone(phone) {
    var raw = String(phone == null ? '' : phone);
    var digits = raw.replace(/\D/g, '');
    if (!digits) return '';
    var tail = digits.slice(-4);
    return '•••• ' + tail;
  }

  /**
   * Escape a string for safe HTML interpolation.
   */
  function esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // ── Label helpers ───────────────────────────────────────────────────────────

  /**
   * Get the display label for a voice ID from the voice catalog.
   * Returns '—' if not found or missing.
   */
  function getVoiceLabel(voiceId, voices) {
    if (!voiceId || !Array.isArray(voices)) return '—';
    var match = null;
    for (var i = 0; i < voices.length; i++) {
      if (voices[i].id === voiceId) {
        match = voices[i];
        break;
      }
    }
    return match ? esc(match.label || match.voice_name || '—') : '—';
  }

  /**
   * Get the display label for a calendar provider.
   * Returns 'None' for unknown/missing providers.
   */
  function getCalendarLabel(provider) {
    var p = String(provider || '').toLowerCase();
    if (p === 'native') return 'Native';
    if (p === 'google') return 'Google';
    return 'None';
  }

  // ── Main render function ───────────────────────────────────────────────────

  /**
   * Build the agent health status card HTML.
   *
   * @param {Object} client - The portalClient record (or null/undefined)
   * @param {Array} voices - The voice catalog array (from /api/voices)
   * @returns {string} HTML string for the card content
   */
  function buildAgentCard(client, voices) {
    // Determine agent state: Live if twilio_number assigned, else Setup pending
    var isLive = client && client.twilio_number;
    var statusClass = isLive ? 'agent-status-pill-live' : 'agent-status-pill-setup';
    var statusText = isLive ? 'Live' : 'Setup pending';

    var phoneHtml = '';
    if (isLive && client.twilio_number) {
      phoneHtml = '<div class="dash-agent-line"><span>Active phone:</span> <span class="dash-agent-phone" id="stat-phone">' +
        esc(maskPhone(client.twilio_number)) + '</span></div>';
    }

    var voiceLabel = getVoiceLabel(client && client.voice_id, voices);

    // After-hours: ON if message exists, OFF otherwise
    var afterHoursState = (client && client.after_hours_message) ? 'ON' : 'OFF';

    var calendarLabel = getCalendarLabel(client && client.calendar_provider);

    // Build the card HTML
    var html = '<div class="dash-agent-line">' +
      '<span class="agent-status-pill ' + statusClass + '"><div class="pulse"></div>' +
      '<span>' + statusText + '</span></span>' +
      '<span>Your AI agent is ' + (isLive ? 'live and answering calls' : 'not configured') + '</span>' +
      '</div>' +
      phoneHtml +
      '<div class="dash-agent-line"><span>Agent name:</span> <b>' +
      esc(client && client.agent_name || '—') + '</b> · <span>Business:</span> <b>' +
      esc(client && client.business_name || '—') + '</b></div>' +
      '<div class="dash-agent-line"><span>Voice:</span> <b>' + voiceLabel + '</b></div>' +
      '<div class="dash-agent-line"><span>After-hours handling:</span> <b>' +
      afterHoursState + '</b></div>' +
      '<div class="dash-agent-line"><span>Calendar:</span> <b>' + calendarLabel + '</b></div>';

    return html;
  }

  // ── Export ─────────────────────────────────────────────────────────────────

  var DashboardAgent = {
    buildAgentCard: buildAgentCard,
    renderAgentHealthCard: buildAgentCard, // Alias for test compatibility
    maskPhone: maskPhone,
    getVoiceLabel: getVoiceLabel,
    getCalendarLabel: getCalendarLabel,
  };

  // Export for Node/CommonJS (tests)
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = DashboardAgent;
  }

  // Export for browser (portal.html)
  global.DashboardAgent = DashboardAgent;

}(typeof window !== 'undefined' ? window : this));
