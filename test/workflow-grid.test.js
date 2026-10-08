// test/workflow-grid.test.js — unit tests for js/workflow-grid.js (TRG-4).
//
// Pure-function coverage for the Automations grid helpers: offering/legacy
// row discrimination, payload normalization (with offline fallback when the
// API has no offering rows), channel splitting, standardized cadence copy,
// and the entitlement gate. DOM rendering (loadWorkflows in portal.html) is
// exercised manually via the .validate harness / staging screenshots.

const WG = require('../js/workflow-grid.js');

// ── fixtures ────────────────────────────────────────────────────────────────
function apiOfferingRow(key, over = {}) {
  const [trigger, channel] = key.split(/-(?=[^-]*$)/);
  return {
    offeringKey: key,
    trigger,
    channel,
    legacy: false,
    name: `API name ${key}`,
    summary: `API summary ${key}`,
    description: `API description ${key}`,
    status: 'off',
    ...over,
  };
}

const ALL_KEYS = [
  'lead_capture_form-call', 'lead_capture_form-sms',
  'ai_receptionist-call', 'ai_receptionist-sms',
  'post_appointment-call', 'post_appointment-sms',
  'campaign_response-call', 'campaign_response-sms',
];

// ── row discrimination ──────────────────────────────────────────────────────
describe('isOfferingRow / isLegacyRow', () => {
  test('offering rows carry a string offeringKey', () => {
    expect(WG.isOfferingRow({ offeringKey: 'lead_capture_form-call' })).toBe(true);
    expect(WG.isOfferingRow({})).toBe(false);
    expect(WG.isOfferingRow(null)).toBe(false);
  });

  test('legacy rows carry a templateId and no offeringKey', () => {
    expect(WG.isLegacyRow({ templateId: 3, status: 'active' })).toBe(true);
    expect(WG.isLegacyRow({ templateId: '3' })).toBe(true);
    expect(WG.isLegacyRow({ offeringKey: 'lead_capture_form-call' })).toBe(false);
    expect(WG.isLegacyRow(null)).toBe(false);
  });

  test('isOfferingKey: numeric strings are legacy template ids', () => {
    expect(WG.isOfferingKey('lead_capture_form-call')).toBe(true);
    expect(WG.isOfferingKey('3')).toBe(false);
  });
});

// ── normalization + fallback ────────────────────────────────────────────────
describe('normalizeWorkflows', () => {
  test('passes through API offering rows and splits legacy rows', () => {
    const rows = [
      apiOfferingRow('lead_capture_form-call'),
      { templateId: 3, name: 'Unresponsive Leads', status: 'active' },
      apiOfferingRow('campaign_response-sms', { status: 'requested' }),
    ];
    const { offerings, legacy } = WG.normalizeWorkflows(rows);
    expect(offerings).toHaveLength(2);
    expect(legacy).toHaveLength(1);
    expect(legacy[0].templateId).toBe(3);
    expect(offerings.find(o => o.offeringKey === 'campaign_response-sms').status).toBe('requested');
  });

  test('empty payload falls back to the 8-offering registry with status off', () => {
    const { offerings, legacy } = WG.normalizeWorkflows([]);
    expect(offerings).toHaveLength(8);
    expect(legacy).toEqual([]);
    expect(new Set(offerings.map(o => o.offeringKey))).toEqual(new Set(ALL_KEYS));
    expect(offerings.every(o => o.status === 'off')).toBe(true);
  });

  test('legacy-only payload (pre-TRG-3 API) still yields the 8 offerings', () => {
    const rows = [{ templateId: 6, status: 'active', name: 'Missed Call Auto Callback' }];
    const { offerings, legacy } = WG.normalizeWorkflows(rows);
    expect(offerings).toHaveLength(8);
    expect(legacy).toHaveLength(1);
    // fallback cards keep API-independent registry copy
    const formCall = offerings.find(o => o.offeringKey === 'lead_capture_form-call');
    expect(formCall.name).toContain('Form Lead');
    expect(formCall.description).toContain('intake form');
  });

  test('offerings are sorted by trigger order then call-before-sms', () => {
    const { offerings } = WG.normalizeWorkflows([]);
    const keys = offerings.map(o => o.offeringKey);
    expect(keys).toEqual([
      'lead_capture_form-call', 'lead_capture_form-sms',
      'ai_receptionist-call', 'ai_receptionist-sms',
      'post_appointment-call', 'post_appointment-sms',
      'campaign_response-call', 'campaign_response-sms',
    ]);
  });
});

// ── channel splitting ───────────────────────────────────────────────────────
describe('channel sections', () => {
  const { offerings } = WG.normalizeWorkflows([]);

  test('4 cards per channel section', () => {
    expect(WG.offeringsForChannel(offerings, 'call')).toHaveLength(4);
    expect(WG.offeringsForChannel(offerings, 'sms')).toHaveLength(4);
    expect(WG.offeringsForChannel(offerings, 'call').every(o => o.channel === 'call')).toBe(true);
  });

  test('one card per trigger type within each channel', () => {
    const triggers = WG.offeringsForChannel(offerings, 'call').map(o => o.trigger);
    expect(new Set(triggers)).toEqual(new Set(WG.TRIGGER_TYPES));
  });

  test('legacy rows route to their original section via the ID lists', () => {
    const rows = [
      { templateId: 1, status: 'active' }, // SMS section (Inbound Lead Follow-Up)
      { templateId: 6, status: 'active' }, // Call section (Missed Call Auto Callback)
      { templateId: 5, status: 'active' }, // SMS section
    ];
    expect(WG.legacyForChannel(rows, [1, 2, 5]).map(r => r.templateId)).toEqual([1, 5]);
    expect(WG.legacyForChannel(rows, [3, 4, 6]).map(r => r.templateId)).toEqual([6]);
  });
});

// ── cadence copy ────────────────────────────────────────────────────────────
describe('offeringDescLines', () => {
  test('call offerings re-engage with AI callback calls', () => {
    const [desc, cadence] = WG.offeringDescLines({ channel: 'call', description: 'D1' });
    expect(desc).toBe('D1');
    expect(cadence).toContain('AI callback call');
    expect(cadence).not.toContain('re-engagement text');
  });

  test('sms offerings re-engage with re-engagement texts', () => {
    const [, cadence] = WG.offeringDescLines({ channel: 'sms', description: 'D1' });
    expect(cadence).toContain('re-engagement text');
    expect(cadence).not.toContain('AI callback call');
  });

  test('standardized cadence is identical across all 4 trigger types per channel', () => {
    const callCadences = ALL_KEYS.filter(k => k.endsWith('-call'))
      .map(k => WG.offeringDescLines({ channel: 'call', description: k })[1]);
    expect(new Set(callCadences).size).toBe(1);
    const smsCadences = ALL_KEYS.filter(k => k.endsWith('-sms'))
      .map(k => WG.offeringDescLines({ channel: 'sms', description: k })[1]);
    expect(new Set(smsCadences).size).toBe(1);
  });

  test('cadence encodes the full standardized sequence', () => {
    const [, cadence] = WG.offeringDescLines({ channel: 'call', description: 'x' });
    expect(cadence).toContain('Trigger fires');
    expect(cadence.match(/wait 2 days/g)).toHaveLength(3);
    expect(cadence).toContain('final AI callback call');
    expect(cadence).toContain('mark lead cold');
  });
});

// ── entitlement gate ────────────────────────────────────────────────────────
describe('requiredEntitlement', () => {
  const LEGACY_GATE = { 3: 'aiFollowUpCalls', 4: 'bulkCallCampaigns' };

  test('call offerings require aiFollowUpCalls (plan-neutral gate)', () => {
    expect(WG.requiredEntitlement({ offeringKey: 'post_appointment-call', channel: 'call' }, LEGACY_GATE))
      .toEqual({ feature: 'aiFollowUpCalls' });
  });

  test('sms offerings are included with every plan', () => {
    expect(WG.requiredEntitlement({ offeringKey: 'post_appointment-sms', channel: 'sms' }, LEGACY_GATE))
      .toBeNull();
  });

  test('legacy templates keep their per-template gates', () => {
    expect(WG.requiredEntitlement({ templateId: 3 }, LEGACY_GATE))
      .toEqual({ feature: 'aiFollowUpCalls' });
    expect(WG.requiredEntitlement({ templateId: 4 }, LEGACY_GATE))
      .toEqual({ feature: 'bulkCallCampaigns' });
    expect(WG.requiredEntitlement({ templateId: 1 }, LEGACY_GATE)).toBeNull();
  });
});

// ── fallback registry integrity ─────────────────────────────────────────────
describe('FALLBACK_OFFERINGS registry', () => {
  test('is the full 4x2 grid with unique keys', () => {
    expect(WG.FALLBACK_OFFERINGS).toHaveLength(8);
    expect(new Set(WG.FALLBACK_OFFERINGS.map(o => o.offeringKey))).toEqual(new Set(ALL_KEYS));
    expect(WG.FALLBACK_OFFERINGS.every(o => o.legacy === false)).toBe(true);
  });

  test('every entry has display copy for name, summary and description', () => {
    for (const o of WG.FALLBACK_OFFERINGS) {
      expect(o.name.length).toBeGreaterThan(0);
      expect(o.summary.length).toBeGreaterThan(0);
      expect(o.description.length).toBeGreaterThan(0);
      expect(WG.TRIGGER_TYPES).toContain(o.trigger);
      expect(['call', 'sms']).toContain(o.channel);
    }
  });

  test('fallbackOfferings clones rows (no shared references) with status off', () => {
    const a = WG.fallbackOfferings();
    const b = WG.fallbackOfferings();
    expect(a).not.toBe(b);
    expect(a[0]).not.toBe(b[0]);
    expect(a[0].status).toBe('off');
  });

  test('trigger labels cover all 4 canonical types', () => {
    expect(WG.TRIGGER_TYPES.map(t => WG.TRIGGER_LABELS[t])).toEqual([
      'Lead Capture Form', 'AI Receptionist', 'Post-Appointment', 'Campaign Response',
    ]);
  });
});

// ── stuck-pending fix: toggle + pending age (zeus_1791325526552_7232e5bf) ────
describe('workflowToggle', () => {
  test('requested (Pending) exposes an ENABLED Cancel request action', () => {
    expect(WG.workflowToggle('requested'))
      .toEqual({ label: 'Cancel request', action: 'cancel', disabled: false });
  });

  test('active disables via the cancel endpoint', () => {
    expect(WG.workflowToggle('active'))
      .toEqual({ label: 'Disable', action: 'cancel', disabled: false });
  });

  test.each(['off', 'cancelled', 'rejected', 'failed'])('%s re-requests', (s) => {
    expect(WG.workflowToggle(s))
      .toEqual({ label: 'Request', action: 'request', disabled: false });
  });

  test('unknown/undefined status falls back to Request', () => {
    expect(WG.workflowToggle(undefined).action).toBe('request');
  });
});

describe('pendingAge', () => {
  const now = new Date('2026-10-06T12:00:00.000Z');
  const ago = (ms) => new Date(now.getTime() - ms).toISOString();

  test('no timestamp → empty', () => expect(WG.pendingAge(null, now)).toBe(''));
  test('invalid timestamp → empty', () => expect(WG.pendingAge('not-a-date', now)).toBe(''));
  test('under a minute → just now', () => expect(WG.pendingAge(ago(30 * 1000), now)).toBe('pending just now'));
  test('singular minute', () => expect(WG.pendingAge(ago(60000), now)).toBe('pending 1 minute'));
  test('plural minutes', () => expect(WG.pendingAge(ago(5 * 60000), now)).toBe('pending 5 minutes'));
  test('plural hours', () => expect(WG.pendingAge(ago(3 * 3600000), now)).toBe('pending 3 hours'));
  test('singular day', () => expect(WG.pendingAge(ago(86400000), now)).toBe('pending 1 day'));
  test('plural days (ticket example)', () => expect(WG.pendingAge(ago(3 * 86400000), now)).toBe('pending 3 days'));
});

// ── CSV-import follow-up variants (API-driven rows) ─────────────────────────
describe('CSV-import follow-up variants', () => {
  const voice = {
    offeringKey: 'imported_leads_voice', trigger: 'csv_import', channel: 'call',
    provision: 'client_flag', legacy: false, name: 'Voice Services', summary: 's',
    description: 'd', status: 'off',
  };
  const sms = {
    offeringKey: 'imported_leads_sms', trigger: 'csv_import', channel: 'sms',
    provision: 'client_flag', legacy: false, name: 'SMS Services', summary: 's',
    description: 'd', status: 'off',
  };

  test('render under their channel sections, after the cadence grid', () => {
    const rows = [...ALL_KEYS.map(k => apiOfferingRow(k)), voice, sms];
    const { offerings } = WG.normalizeWorkflows(rows);
    expect(WG.offeringsForChannel(offerings, 'call').map(o => o.offeringKey))
      .toContain('imported_leads_voice');
    expect(WG.offeringsForChannel(offerings, 'sms').map(o => o.offeringKey))
      .toContain('imported_leads_sms');
    // unknown trigger sorts after the 4 canonical triggers
    expect(offerings[offerings.length - 1].trigger).toBe('csv_import');
  });

  test('voice variant is gated by aiFollowUpCalls; sms variant is not', () => {
    expect(WG.requiredEntitlement(voice, {})).toEqual({ feature: 'aiFollowUpCalls' });
    expect(WG.requiredEntitlement(sms, {})).toBeNull();
  });

  test('csv_import variants now show the standardized re-engage cadence', () => {
    const [, line2] = WG.offeringDescLines(voice);
    expect(line2).toBe(WG.CADENCE_DESC.call);
    expect(line2).toContain('wait 2 days');
    expect(line2).toContain('final AI callback call');
  });
});

// ── Customize gating (zeus_1791430190387_7ad7a48a; restored for CSV-import by
// zeus_1791434486949_a3ba29e7; restored for ALL offering cards by
// zeus_1791467501809_d080bfcb) ─────────────────────────────────────────────
// GET /portal/workflows/:id/params resolves legacy template IDs (1-6) AND every
// offering key — the 8 cadence offerings (wait_1/2/3 + call/sms_template) and
// the 2 compiled CSV-import follow-ups (wait_1/3/5 + …_2/4/6). Every offering
// card therefore exposes Customize.
describe('isCustomizable', () => {
  test('legacy preset rows are customizable (params catalog 1-6)', () => {
    expect(WG.isCustomizable({ templateId: 1 })).toBe(true);
    expect(WG.isCustomizable({ templateId: 3, status: 'active' })).toBe(true);
    expect(WG.isCustomizable({ templateId: '5' })).toBe(true);
  });

  test('CSV-import offering rows ARE customizable (params catalog)', () => {
    expect(WG.isCustomizable({
      offeringKey: 'imported_leads_voice', trigger: 'csv_import',
      channel: 'call', provision: 'compiled',
    })).toBe(true);
    expect(WG.isCustomizable({
      offeringKey: 'imported_leads_sms', trigger: 'csv_import',
      channel: 'sms', provision: 'compiled',
    })).toBe(true);
  });

  test('ALL 8 cadence offering rows are customizable now (params catalog added)', () => {
    for (const k of ALL_KEYS) {
      expect(WG.isCustomizable(apiOfferingRow(k))).toBe(true);
    }
  });

  test('missing/null rows are not customizable', () => {
    expect(WG.isCustomizable(null)).toBe(false);
    expect(WG.isCustomizable(undefined)).toBe(false);
    expect(WG.isCustomizable({})).toBe(false);
  });
});
