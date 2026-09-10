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
   * '+155****4567' → '•••• 4567'. Null/empty → ''.
   *
   * LEAD phone numbers stay masked — that is deliberate privacy design for
   * third-party contact data shown in the leads table. This helper is kept
   * for that purpose. The AGENT's own Twilio number is NOT third-party data
   * (the client owns it and needs to read it to test/forward calls), so the
   * Agent Status card renders it with formatPhone() instead — see
   * buildAgentCard().
   */
  function maskPhone(phone) {
    var raw = String(phone == null ? '' : phone);
    var digits = raw.replace(/\D/g, '');
    if (!digits) return '';
    var tail = digits.slice(-4);
    return '•••• ' + tail;
  }

  /**
   * Format the agent's OWN phone number for display, in full.
   *
   * The Agent Status card used to render this through maskPhone(), so the
   * client saw "•••• 3789" for their own published business line — no
   * privacy value (it is their number, printed on their own marketing) and
   * actively unhelpful, since the number is what they dial to test the agent
   * or hand to a forwarding carrier.
   *
   * US/CA E.164 (+1 + 10 digits) renders as '+1 (555) 123-4567'. Anything
   * else (international, short codes, already-formatted input) is returned
   * digit-preserving so no number is ever truncated or mangled — we would
   * rather show a plain E.164 string than a wrong pretty one.
   */
  function formatPhone(phone) {
    var raw = String(phone == null ? '' : phone).trim();
    if (!raw) return '';
    var digits = raw.replace(/\D/g, '');
    if (!digits) return '';
    // North American: 11 digits starting with country code 1, or bare 10.
    if (digits.length === 11 && digits.charAt(0) === '1') {
      return '+1 (' + digits.slice(1, 4) + ') ' + digits.slice(4, 7) + '-' + digits.slice(7);
    }
    if (digits.length === 10) {
      return '(' + digits.slice(0, 3) + ') ' + digits.slice(3, 6) + '-' + digits.slice(6);
    }
    // International or non-standard: keep the caller's own formatting when it
    // already looks like E.164, otherwise emit the raw digits with a +.
    return raw.charAt(0) === '+' ? raw : '+' + digits;
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
   * Get the display label for a voice.
   *
   * Resolution order:
   *   1. the catalog entry for voiceId (canonical display name)
   *   2. the voice name already stored on the client record
   *   3. '—' (genuinely unset)
   *
   * Step 2 matters: the catalog is fetched asynchronously and can be empty or
   * fail, and prod client records already carry voice_name/voice_label
   * alongside voice_id. Resolving from the catalog ALONE meant a client with
   * a real configured voice saw "Voice: —" whenever the catalog had not
   * loaded — indistinguishable from having no voice at all. The card now
   * falls back to the client's own stored name so it can only say '—' when
   * nothing anywhere names a voice.
   *
   * @param {string} voiceId  client.voice_id
   * @param {Array}  voices   the voice catalog (may be empty/undefined)
   * @param {Object} [client] the client record, for the stored-name fallback
   */
  function getVoiceLabel(voiceId, voices, client) {
    if (voiceId && Array.isArray(voices)) {
      for (var i = 0; i < voices.length; i++) {
        if (voices[i].id === voiceId) {
          var match = voices[i];
          if (match.label || match.voice_name) return esc(match.label || match.voice_name);
          break;
        }
      }
    }
    // Catalog miss (not loaded, failed, or voice retired) — use the name the
    // client record already carries before admitting defeat.
    if (client) {
      var stored = client.voice_label || client.voice_name;
      if (stored && String(stored).trim()) return esc(String(stored).trim());
    }
    return '—';
  }

  /**
   * Get the display label for a calendar provider.
   *
   * Mirrors the backend's calendarProvider.resolveProviderName(): an explicit
   * provider wins, and a record with NO provider field falls back to the
   * connection that actually exists, else 'native'.
   *
   * Why this changed: the card previously returned 'None' for anything that
   * was not the literal string 'native' or 'google'. Clients created before
   * calendar_provider was introduced have no such field, so the row read
   * "Calendar: None" even though the backend books them on the native
   * calendar and hasAnyCalendar() reports true. That is not a missing
   * integration — it is the card contradicting the booking engine. 'None' is
   * now reserved for a third-party provider selected WITHOUT credentials,
   * which is the only genuinely unbookable state.
   */
  function getCalendarLabel(client) {
    // Accept either a client record or a bare provider string (the original
    // signature) so existing callers keep working.
    var c = (client && typeof client === 'object') ? client : { calendar_provider: client };
    var p = String(c.calendar_provider || '').toLowerCase();

    if (p === 'native') return 'Native';
    if (p === 'google') return c.google_calendar_id || c.google_oauth_connected ? 'Google' : 'None';
    if (p === 'square') return c.square_merchant_id ? 'Square' : 'None';
    if (p === 'outlook') return c.outlook_calendar_id ? 'Outlook' : 'None';

    // No explicit provider — infer from whatever is connected (legacy records).
    if (c.google_calendar_id || c.google_oauth_connected) return 'Google';
    if (c.square_merchant_id) return 'Square';
    if (c.outlook_calendar_id) return 'Outlook';

    // Nothing connected and nothing selected: the native calendar needs no
    // third-party connection, so this account CAN take bookings.
    return 'Native';
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
      // FULL number, not masked. This is the client's own agent line; the
      // API already returns it in full on /portal/settings (twilio_number),
      // so no payload change was needed. Lead phones in the leads table stay
      // masked — see maskPhone().
      phoneHtml = '<div class="dash-agent-line"><span>Active phone:</span> <span class="dash-agent-phone" id="stat-phone">' +
        esc(formatPhone(client.twilio_number)) + '</span></div>';
    }

    var voiceLabel = getVoiceLabel(client && client.voice_id, voices, client);

    // After-hours: ON if message exists, OFF otherwise
    var afterHoursState = (client && client.after_hours_message) ? 'ON' : 'OFF';

    var calendarLabel = getCalendarLabel(client);

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
    formatPhone: formatPhone,
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
