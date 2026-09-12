/**
 * test/automations-builder.test.js — unit tests for AUT-6
 * js/automations-builder.js (Your Automations + guided builder timeline).
 *
 * The builder's client-side validation mirrors the AUT-1 server validator
 * (atlas-ai src/services/automationDefinitionService.js + workflowParamCatalog.js)
 * error-for-error; these tests pin that contract so the AC "builder refuses
 * invalid sequences with the same copy as the server errors" is enforced.
 */
const AUT = require('../js/automations-builder');

// ── Shared valid definition used across tests ──
function validDef(overrides) {
  return Object.assign({
    type: 'hybrid',
    trigger: 'lead-inbound',
    name: 'New lead follow-up',
    steps: [
      { kind: 'sms', template: 'Hi {{first_name}}, thanks for reaching out to {{business_name}}!' },
      { kind: 'wait', value: 15, unit: 'minutes' },
      { kind: 'call', template: 'Hi {{first_name}}, this is {{agent_name}} calling about {{service}}.' },
    ],
  }, overrides || {});
}

function msgs(result) { return result.errors.map(e => e.msg); }

describe('AUT.validateDefinition — valid definitions pass', () => {
  test('hybrid sms+wait+call sequence is ok', () => {
    const r = AUT.validateDefinition(validDef());
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
  });

  test('all three types pass with their own valid steps', () => {
    expect(AUT.validateDefinition(validDef({ type: 'call', steps: [{ kind: 'call', template: 'Hello {{first_name}}' }] })).ok).toBe(true);
    expect(AUT.validateDefinition(validDef({ type: 'sms', steps: [{ kind: 'sms', template: 'Hello {{first_name}}' }] })).ok).toBe(true);
    expect(AUT.validateDefinition(validDef()).ok).toBe(true);
  });

  test('specific-time wait with timezone passes', () => {
    const r = AUT.validateDefinition(validDef({
      type: 'sms',
      steps: [{ kind: 'sms', template: 'We are closed' }, { kind: 'wait', mode: 'specificTime', at: '09:00', timezone: 'America/Chicago' }],
    }));
    expect(r.ok).toBe(true);
  });
});

describe('AUT.validateDefinition — header errors (same copy as server)', () => {
  test('missing type', () => {
    const d = validDef(); delete d.type;
    expect(msgs(AUT.validateDefinition(d))).toContain('type is required — must be one of: call, sms, hybrid');
  });

  test('unknown trigger is rejected (trigger whitelist enforced)', () => {
    const r = AUT.validateDefinition(validDef({ trigger: 'not-a-trigger' }));
    expect(r.ok).toBe(false);
    expect(msgs(r)).toContain('unknown trigger "not-a-trigger" — must be one of: ' + Object.keys(AUT.TRIGGER_LABELS).join(', '));
  });

  test('empty name', () => {
    expect(msgs(AUT.validateDefinition(validDef({ name: '' })))).toContain('name is required (non-empty string)');
  });

  test('name over 80 chars', () => {
    const r = AUT.validateDefinition(validDef({ name: 'x'.repeat(81) }));
    expect(msgs(r)).toContain('name must be 80 characters or fewer (currently 81)');
  });

  test('zero steps', () => {
    expect(msgs(AUT.validateDefinition(validDef({ steps: [] })))).toContain('automation must have at least one step');
  });

  test('>12 steps — the AC over-cap sequence is refused with server copy', () => {
    const steps = [];
    for (let i = 0; i < 13; i++) steps.push({ kind: 'sms', template: 'Hi {{first_name}} ' });
    const r = AUT.validateDefinition(validDef({ type: 'sms', steps }));
    expect(r.ok).toBe(false);
    expect(msgs(r)).toContain('automation cannot exceed 12 steps (got 13)');
  });
});

describe('AUT.validateDefinition — step errors (same copy as server)', () => {
  test('wait-first sequence refused with server copy (AC)', () => {
    const r = AUT.validateDefinition(validDef({
      type: 'sms',
      steps: [{ kind: 'wait', value: 30, unit: 'minutes' }, { kind: 'sms', template: 'Hi {{first_name}}' }],
    }));
    expect(r.ok).toBe(false);
    expect(msgs(r)).toContain('step 0: automation cannot start with a wait — begin with an sms or call step');
  });

  test('SMS template over 960 chars', () => {
    const r = AUT.validateDefinition(validDef({
      type: 'sms',
      steps: [{ kind: 'sms', template: 'x'.repeat(961) }],
    }));
    expect(msgs(r)).toContain('step 0: template must be 960 characters or fewer (currently 961)');
  });

  test('voice template over 600 chars', () => {
    const r = AUT.validateDefinition(validDef({
      type: 'call',
      steps: [{ kind: 'call', template: 'x'.repeat(601) }],
    }));
    expect(msgs(r)).toContain('step 0: template must be 600 characters or fewer (currently 601)');
  });

  test('empty template', () => {
    const r = AUT.validateDefinition(validDef({
      type: 'sms',
      steps: [{ kind: 'sms', template: '   ' }],
    }));
    expect(msgs(r)).toContain('step 0: template is required for sms steps');
  });

  test('unbalanced merge-field braces', () => {
    const r = AUT.validateDefinition(validDef({
      type: 'sms',
      steps: [{ kind: 'sms', template: 'Hi {{first_name, book here' }],
    }));
    expect(msgs(r)).toContain('step 0: unbalanced merge field braces — every {{ needs a matching }}');
  });

  test('unknown merge field', () => {
    const r = AUT.validateDefinition(validDef({
      type: 'sms',
      steps: [{ kind: 'sms', template: 'Hi {{nope}}' }],
    }));
    expect(msgs(r)).toContain('step 0: unknown merge field(s): {{nope}}');
  });

  test('wait value over cap for unit', () => {
    const r = AUT.validateDefinition(validDef({
      type: 'sms',
      steps: [{ kind: 'sms', template: 'Hi {{first_name}}' }, { kind: 'wait', value: 169, unit: 'hours' }],
    }));
    expect(msgs(r)).toContain('step 1: value must be 168 or less when unit is hours');
  });

  test('non-integer wait value', () => {
    const r = AUT.validateDefinition(validDef({
      type: 'sms',
      steps: [{ kind: 'sms', template: 'Hi {{first_name}}' }, { kind: 'wait', value: 1.5, unit: 'hours' }],
    }));
    expect(msgs(r)).toContain('step 1: value must be a positive integer (1 or greater)');
  });

  test('bad specific time format', () => {
    const r = AUT.validateDefinition(validDef({
      type: 'sms',
      steps: [{ kind: 'sms', template: 'Hi {{first_name}}' }, { kind: 'wait', mode: 'specificTime', at: '9am' }],
    }));
    expect(msgs(r)).toContain('step 1: time must be in HH:MM 24-hour format (e.g. 09:00)');
  });

  test('unknown step kind', () => {
    const r = AUT.validateDefinition(validDef({
      type: 'hybrid',
      steps: [{ kind: 'fax', template: 'nope' }],
    }));
    expect(msgs(r)).toContain('step 0: unknown step kind "fax" — must be one of: sms, call, wait');
  });

  test('call type cannot contain sms steps (server copy)', () => {
    const r = AUT.validateDefinition(validDef({
      type: 'call',
      steps: [{ kind: 'call', template: 'Hi {{first_name}}' }, { kind: 'sms', template: 'Hi {{first_name}}' }],
    }));
    expect(r.ok).toBe(false);
    expect(msgs(r)).toContain('step sequence: "call" automations only support call and wait steps — use the sms or hybrid type for SMS steps');
  });

  test('sms type cannot contain call steps (server copy)', () => {
    const r = AUT.validateDefinition(validDef({
      type: 'sms',
      steps: [{ kind: 'sms', template: 'Hi {{first_name}}' }, { kind: 'call', template: 'Hi {{first_name}}' }],
    }));
    expect(r.ok).toBe(false);
    expect(msgs(r)).toContain('step sequence: "sms" automations only support sms and wait steps — use the call or hybrid type for call steps');
  });
});

describe('AUT.validateDefinition — trigger whitelist from the API', () => {
  test('accepts a trigger served by GET /portal/automations', () => {
    const r = AUT.validateDefinition(validDef({ trigger: 'lead-after-hours' }), { triggerWhitelist: ['lead-after-hours', 'missed-call'] });
    expect(r.ok).toBe(true);
  });

  test('rejects a trigger outside the served whitelist', () => {
    const r = AUT.validateDefinition(validDef({ trigger: 'lead-inbound' }), { triggerWhitelist: ['lead-after-hours'] });
    expect(r.ok).toBe(false);
    // Unknown triggers are rejected with the whitelist in the message copy.
    expect(msgs(r).some(m => m.indexOf('must be one of: lead-after-hours') !== -1)).toBe(true);
  });
});

describe('AUT.validateDefinition — no mutation of builder state', () => {
  test('validation does not mutate the definition object', () => {
    const def = validDef();
    const snapshot = JSON.stringify(def);
    AUT.validateDefinition(def);
    expect(JSON.stringify(def)).toBe(snapshot);
  });

  test('all 6 legacy preset IRs validate clean (they are the migration defaults)', () => {
    Object.keys(AUT.LEGACY_PRESETS).forEach(id => {
      const p = AUT.LEGACY_PRESETS[id];
      const r = AUT.validateDefinition(
        { type: p.type, trigger: p.trigger, name: p.name, steps: p.steps },
        // The migrate route passes allowLeadingWait for template 3 only.
        { allowLeadingWait: Number(id) === 3 }
      );
      expect(r.ok).toBe(true);
    });
  });

  test('wait-first preset 3 is refused without the migrate opt-in', () => {
    const p = AUT.LEGACY_PRESETS[3];
    const r = AUT.validateDefinition({ type: p.type, trigger: p.trigger, name: p.name, steps: p.steps });
    expect(r.ok).toBe(false);
    expect(msgs(r)).toContain('step 0: automation cannot start with a wait — begin with an sms or call step');
  });
});

describe('AUT.buildDefinition — IR assembly', () => {
  test('interval wait normalizes value to Number and defaults unit', () => {
    const def = AUT.buildDefinition({
      type: 'sms', trigger: 'missed-call', name: ' Test ',
      steps: [{ kind: 'wait', value: '30', unit: undefined }],
    });
    expect(def.steps[0]).toEqual({ kind: 'wait', value: 30, unit: 'minutes' });
    expect(def.name).toBe('Test');
  });

  test('specific-time wait keeps mode/at/timezone and drops empty timezone', () => {
    const def = AUT.buildDefinition({
      type: 'sms', trigger: 'lead-after-hours', name: 'x',
      steps: [{ kind: 'wait', mode: 'specificTime', at: '09:00', timezone: undefined }],
    });
    expect(def.steps[0]).toEqual({ kind: 'wait', mode: 'specificTime', at: '09:00' });
  });

  test('sms/call steps carry templates', () => {
    const def = AUT.buildDefinition({
      type: 'hybrid', trigger: 'lead-inbound', name: 'x',
      steps: [{ kind: 'sms', template: 'hey' }, { kind: 'call', template: 'yo' }],
    });
    expect(def.steps).toEqual([{ kind: 'sms', template: 'hey' }, { kind: 'call', template: 'yo' }]);
  });
});

describe('AUT.partitionServerErrors — API details map back to step cards', () => {
  test('step-indexed details are grouped per step', () => {
    const p = AUT.partitionServerErrors(['step 2: value must be 168 or less when unit is hours', 'step 2: another', 'type is required — must be one of: call, sms, hybrid']);
    expect(p.byStep[2]).toEqual(['step 2: value must be 168 or less when unit is hours', 'step 2: another']);
    expect(p.seq).toEqual(['type is required — must be one of: call, sms, hybrid']);
  });

  test('empty details partition cleanly', () => {
    const p = AUT.partitionServerErrors([]);
    expect(p.byStep).toEqual({});
    expect(p.seq).toEqual([]);
  });
});

describe('AUT.sequenceSummary — card sequence line', () => {
  test('renders the IR as SMS → wait → AI call', () => {
    const s = AUT.sequenceSummary('hybrid', [
      { kind: 'sms', template: 'x' },
      { kind: 'wait', value: 15, unit: 'minutes' },
      { kind: 'call', template: 'y' },
      { kind: 'wait', value: 1, unit: 'hours' },
      { kind: 'wait', mode: 'specificTime', at: '09:00' },
    ]);
    expect(s).toBe('SMS → wait 15 minutes → AI call → wait 1 hour → wait until 9:00 AM');
  });

  test('falls back to a type-appropriate line without steps', () => {
    expect(AUT.sequenceSummary('call', null)).toBe('AI call sequence.');
    expect(AUT.sequenceSummary('sms', [])).toBe('SMS sequence.');
    expect(AUT.sequenceSummary('hybrid', [])).toBe('SMS + AI call sequence.');
  });
});

describe('AUT.render helpers — timeline HTML', () => {
  test('node strip renders START + one node per step with arrows', () => {
    const html = AUT.nodeStripHtml([{ kind: 'sms', template: 'x' }, { kind: 'wait', value: 5, unit: 'minutes' }]);
    expect(html).toContain('START');
    expect(html).toContain('data-lucide="message-square"');
    expect(html).toContain('data-lucide="clock"');
    expect(html).toContain('chevron-right');
  });

  test('step card renders merge-field chips + textarea + counter for SMS steps', () => {
    const html = AUT.stepCardHtml({ kind: 'sms', template: 'Hi' }, 0, null, [], 1);
    expect(html).toContain('{{first_name}}');
    expect(html).toContain('ab-step-0-tpl');
    expect(html).toContain('data-channel="sms"');
    expect(html).toContain('SMS');
  });

  test('call card renders the voice hint + CALL badge', () => {
    const html = AUT.stepCardHtml({ kind: 'call', template: 'Hi' }, 1, null, [], 2);
    expect(html).toContain('Read aloud by your AI agent');
    expect(html).toContain('data-channel="voice"');
    expect(html).toContain('Call');
  });

  test('wait card renders interval controls and the specific-time toggle', () => {
    const html = AUT.stepCardHtml({ kind: 'wait', value: 15, unit: 'minutes' }, 0, null, [], 1);
    expect(html).toContain('How long the workflow pauses before the next step.');
    expect(html).toContain('Use specific time');
    expect(html).toContain('Wait 15 minutes');
  });

  test('specific-time wait card renders time input + timezone select', () => {
    const html = AUT.stepCardHtml({ kind: 'wait', mode: 'specificTime', at: '09:00' }, 0, ['America/Chicago'], [], 1);
    expect(html).toContain('type="time"');
    expect(html).toContain('Use my business timezone');
    expect(html).toContain('America/Chicago');
    expect(html).toContain('TIME OF DAY');
  });

  test('per-step errors render inline in the card', () => {
    const html = AUT.stepCardHtml({ kind: 'sms', template: '' }, 0, null, ['step 0: template is required for sms steps'], 1);
    expect(html).toContain('step 0: template is required for sms steps');
  });

  test('first step has move-up disabled; last has move-down disabled', () => {
    const first = AUT.stepCardHtml({ kind: 'sms', template: 'x' }, 0, null, [], 2);
    expect(first).toContain('disabled');
    const last = AUT.stepCardHtml({ kind: 'sms', template: 'x' }, 1, null, [], 2);
    expect(last).toContain('AUT.moveStep(1,-1)');
  });

  test('automation card renders Grandfathered + Preset badges from the view-model', () => {
    const html = AUT.automationCardHtml({
      automation_id: 'legacy-template-3', source: 'legacy', type: 'hybrid',
      name: 'Unresponsive Leads', trigger: 'warm-lead-unresponsive', status: 'active',
      grandfathered: true, legacy: { template_id: 3 }, definition: null,
    });
    expect(html).toContain('Grandfathered');
    expect(html).toContain('Preset');
    expect(html).toContain('ab-editor-legacy-template-3');
  });

  test('active custom automation gets Test + Disable, no Edit', () => {
    const html = AUT.automationCardHtml({
      automation_id: 'a1', type: 'sms', name: 'N', trigger: 'missed-call',
      status: 'active', definition: { steps: [{ kind: 'sms', template: 'x' }] },
    });
    expect(html).toContain('openTestModal');
    expect(html).toContain('Disable');
    expect(html).not.toContain('>Edit<');
  });

  test('requested automation shows Cancel request but no Disable', () => {
    const html = AUT.automationCardHtml({
      automation_id: 'a2', type: 'call', name: 'N', trigger: 'missed-call',
      status: 'requested', definition: { steps: [{ kind: 'call', template: 'x' }] },
    });
    expect(html).toContain('Cancel request');
    expect(html).not.toContain('Disable');
    expect(html).toContain('Pending');
  });
});

describe('AUT.listHtml — unified section groups', () => {
  beforeEach(() => {
    AUT.state.list = [];
    AUT.state.planAvailability = {};
  });

  test('renders all three type sections with add buttons', () => {
    const html = AUT.listHtml();
    expect(html).toContain('Call automations');
    expect(html).toContain('SMS automations');
    expect(html).toContain('Hybrid automations');
    expect(html).toContain('AUT.openBuilder(\'call\')');
    expect(html).toContain('AUT.openBuilder(\'sms\')');
    expect(html).toContain('AUT.openBuilder(\'hybrid\')');
  });

  test('plan-locked type shows upgrade button instead of add', () => {
    AUT.state.planAvailability = { call: { available: false, required_entitlement: 'aiFollowUpCalls' } };
    const html = AUT.listHtml();
    expect(html).toContain('Upgrade to add');
    expect(html).toContain('plan upgrade required');
  });

  test('empty list shows per-type empty state', () => {
    const html = AUT.listHtml();
    expect(html).toContain('No automations yet — add one to get started.');
  });

  test('legacy and custom entries render through the same card', () => {
    AUT.state.list = [
      { automation_id: 'legacy-template-5', source: 'legacy', type: 'sms', name: 'Missed Call Auto SMS', trigger: 'missed-call', status: 'active', legacy: { template_id: 5 }, definition: null, grandfathered: false },
      { automation_id: 'c1', type: 'sms', name: 'Custom', trigger: 'missed-call', status: 'draft', definition: { steps: [{ kind: 'sms', template: 'x' }] } },
    ];
    const html = AUT.listHtml();
    expect(html).toContain('Preset');
    expect(html).toContain('Missed Call Auto SMS');
    expect(html).toContain('Custom');
    expect(html).toContain('Trigger: Missed call');
  });
});
