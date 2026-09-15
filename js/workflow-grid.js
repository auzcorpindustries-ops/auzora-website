// js/workflow-grid.js — TRG-4: portal automation grid helpers.
//
// The Automations page renders 8 offering cards (4 trigger types x Call/SMS
// sections) from the API-provided offering meta (GET /portal/workflows —
// TRG-3 offering registry), grouped under the existing Call Automations /
// SMS Automations sections. The legacy 6-preset WORKFLOW_META block in
// portal.html stays as the display meta for legacy preset cards (clients
// with active legacy clones) and for the params step parser.
//
// Pure helpers only (unit-tested in test/workflow-grid.test.js via
// module.exports — same pattern as js/dashboard-charts.js). DOM rendering
// stays in portal.html's loadWorkflows().

(function (global) {
  'use strict';

  // 4 canonical trigger types (TRG-1 model), in display order.
  var TRIGGER_TYPES = ['lead_capture_form', 'ai_receptionist', 'post_appointment', 'campaign_response'];

  var TRIGGER_LABELS = {
    lead_capture_form: 'Lead Capture Form',
    ai_receptionist: 'AI Receptionist',
    post_appointment: 'Post-Appointment',
    campaign_response: 'Campaign Response',
  };

  // Standardized cadence (identical for all 4 trigger types, per channel —
  // TRG-4 spec): trigger fires -> 2-day waits between re-engages -> mark cold.
  // Call automations re-engage with AI callback calls; SMS automations with
  // re-engagement texts.
  var CADENCE_DESC = {
    call: 'Trigger fires → wait 2 days → AI callback call → wait 2 days → AI callback call → wait 2 days → final AI callback call → mark lead cold',
    sms: 'Trigger fires → wait 2 days → re-engagement text → wait 2 days → re-engagement text → wait 2 days → final re-engagement text → mark lead cold',
  };

  // Offline fallback offering meta — mirrors the TRG-3 registry
  // (atlas-ai src/services/n8nService.js OFFERINGS) so the 8-card grid still
  // renders when the API returns no offering rows (pre-TRG-3 backend).
  // API-provided meta always wins when present. Copy kept verbatim from the
  // backend registry — update both together.
  var FALLBACK_OFFERINGS = [
    {
      offeringKey: 'lead_capture_form-call',
      trigger: 'lead_capture_form',
      channel: 'call',
      legacy: false,
      name: 'Form Lead — AI Callback Cadence',
      summary: 'Re-engage form submissions with AI calls',
      description: 'When a lead comes in via your intake form, this automation follows up with a series of AI callback calls (2-day intervals) until they respond or are marked cold.',
    },
    {
      offeringKey: 'lead_capture_form-sms',
      trigger: 'lead_capture_form',
      channel: 'sms',
      legacy: false,
      name: 'Form Lead — SMS Cadence',
      summary: 'Re-engage form submissions with SMS texts',
      description: 'When a lead comes in via your intake form, this automation follows up with a series of SMS texts (2-day intervals) until they respond or are marked cold.',
    },
    {
      offeringKey: 'ai_receptionist-call',
      trigger: 'ai_receptionist',
      channel: 'call',
      legacy: false,
      name: 'AI Receptionist — AI Callback Cadence',
      summary: 'Re-engage AI receptionist captures with AI calls',
      description: 'When your AI receptionist captures a new lead from an inbound call, this automation follows up with a series of AI callback calls (2-day intervals) until they respond or are marked cold.',
    },
    {
      offeringKey: 'ai_receptionist-sms',
      trigger: 'ai_receptionist',
      channel: 'sms',
      legacy: false,
      name: 'AI Receptionist — SMS Cadence',
      summary: 'Re-engage AI receptionist captures with SMS texts',
      description: 'When your AI receptionist captures a new lead from an inbound call, this automation follows up with a series of SMS texts (2-day intervals) until they respond or are marked cold.',
    },
    {
      offeringKey: 'post_appointment-call',
      trigger: 'post_appointment',
      channel: 'call',
      legacy: false,
      name: 'Post-Appointment — AI Callback Cadence',
      summary: 'Re-engage after booked appointments with AI calls',
      description: 'After an appointment is booked, this automation follows up with a series of AI callback calls (2-day intervals) to check in and nurture the relationship until they respond or are marked cold.',
    },
    {
      offeringKey: 'post_appointment-sms',
      trigger: 'post_appointment',
      channel: 'sms',
      legacy: false,
      name: 'Post-Appointment — SMS Cadence',
      summary: 'Re-engage after booked appointments with SMS texts',
      description: 'After an appointment is booked, this automation follows up with a series of SMS texts (2-day intervals) to check in and nurture the relationship until they respond or are marked cold.',
    },
    {
      offeringKey: 'campaign_response-call',
      trigger: 'campaign_response',
      channel: 'call',
      legacy: false,
      name: 'Campaign Response — AI Callback Cadence',
      summary: 'Re-engage campaign responders with AI calls',
      description: 'When someone responds to your outbound campaign (call or SMS), this automation follows up with a series of AI callback calls (2-day intervals) until they respond or are marked cold.',
    },
    {
      offeringKey: 'campaign_response-sms',
      trigger: 'campaign_response',
      channel: 'sms',
      legacy: false,
      name: 'Campaign Response — SMS Cadence',
      summary: 'Re-engage campaign responders with SMS texts',
      description: 'When someone responds to your outbound campaign (call or SMS), this automation follows up with a series of SMS texts (2-day intervals) until they respond or are marked cold.',
    },
  ];

  // An offering row (new trigger x channel card) carries a string offeringKey
  // ('<trigger>-<channel>'); legacy preset rows carry a templateId.
  function isOfferingRow(row) {
    return !!(row && typeof row.offeringKey === 'string' && row.offeringKey.length > 0);
  }

  function isLegacyRow(row) {
    if (!row || isOfferingRow(row)) return false;
    return typeof row.templateId === 'number' || typeof row.templateId === 'string';
  }

  // Same discriminator the backend uses for path params: numeric strings are
  // legacy template IDs, anything else is an offering key.
  function isOfferingKey(key) {
    return typeof key === 'string' && !/^\d+$/.test(key);
  }

  function fallbackOfferings() {
    return FALLBACK_OFFERINGS.map(function (o) {
      return Object.assign({}, o, { status: 'off' });
    });
  }

  // Trigger display order, then call before sms within a trigger.
  function sortOfferings(list) {
    return list.slice().sort(function (a, b) {
      var ta = TRIGGER_TYPES.indexOf(a.trigger);
      var tb = TRIGGER_TYPES.indexOf(b.trigger);
      if (ta !== tb) {
        return (ta < 0 ? TRIGGER_TYPES.length : ta) - (tb < 0 ? TRIGGER_TYPES.length : tb);
      }
      return (a.channel === 'call' ? 0 : 1) - (b.channel === 'call' ? 0 : 1);
    });
  }

  // Split a GET /portal/workflows payload into offering rows and legacy
  // preset rows. When the API provides no offering rows (pre-TRG-3 backend),
  // synthesize them from the local registry copy so the 8-card grid still
  // renders with statuses 'off'.
  function normalizeWorkflows(rows) {
    var list = Array.isArray(rows) ? rows : [];
    var offerings = list.filter(isOfferingRow);
    if (offerings.length === 0) offerings = fallbackOfferings();
    return { offerings: sortOfferings(offerings), legacy: list.filter(isLegacyRow) };
  }

  function offeringsForChannel(offerings, channel) {
    return (offerings || []).filter(function (o) { return o.channel === channel; });
  }

  function legacyForChannel(legacyRows, templateIds) {
    return (legacyRows || []).filter(function (r) {
      return templateIds.indexOf(r.templateId) !== -1;
    });
  }

  // Card description lines for an offering card:
  // [API description, standardized cadence string].
  function offeringDescLines(offering) {
    var channel = offering && offering.channel === 'sms' ? 'sms' : 'call';
    return [offering.description || offering.summary || '', CADENCE_DESC[channel]];
  }

  // Entitlement gate for a workflow row. Call-channel offerings require the
  // aiFollowUpCalls entitlement (matching the backend TRG-3 gate); SMS
  // offerings are included with every plan. Legacy templates keep their
  // WORKFLOW_TEMPLATE_ENTITLEMENTS mapping (passed in as legacyGate).
  // Returns null when unlocked, else { feature, tier }.
  function requiredEntitlement(row, legacyGate) {
    if (isOfferingRow(row)) {
      return row.channel === 'call' ? { feature: 'aiFollowUpCalls', tier: 'Pro' } : null;
    }
    var feature = row && legacyGate ? legacyGate[row.templateId] : null;
    if (!feature) return null;
    return { feature: feature, tier: feature === 'bulkCallCampaigns' ? 'Premium' : 'Pro' };
  }

  var api = {
    TRIGGER_TYPES: TRIGGER_TYPES,
    TRIGGER_LABELS: TRIGGER_LABELS,
    CADENCE_DESC: CADENCE_DESC,
    FALLBACK_OFFERINGS: FALLBACK_OFFERINGS,
    isOfferingRow: isOfferingRow,
    isLegacyRow: isLegacyRow,
    isOfferingKey: isOfferingKey,
    fallbackOfferings: fallbackOfferings,
    sortOfferings: sortOfferings,
    normalizeWorkflows: normalizeWorkflows,
    offeringsForChannel: offeringsForChannel,
    legacyForChannel: legacyForChannel,
    offeringDescLines: offeringDescLines,
    requiredEntitlement: requiredEntitlement,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  global.WorkflowGrid = api;
})(typeof window !== 'undefined' ? window : globalThis);
