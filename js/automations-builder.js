/**
 * automations-builder.js — AUT-6: Your Automations + guided builder timeline
 * ==========================================================================
 * Client-side module for the portal Automations page (auzora-website).
 * Replaces the legacy two-preset-list view (#ob-workflow-list /
 * #sms-workflow-list from WORKFLOW_META + SMS/OB_WORKFLOW_IDS) with ONE
 * 'Your Automations' section backed by the AUT-3 API:
 *
 *   GET  /portal/automations            → { automations, triggers, types, plan_availability }
 *   POST /portal/automations            → { type, name, trigger, steps } (IR)
 *   PUT  /portal/automations/:id        → same body, non-active records only
 *   POST /portal/automations/:id/cancel
 *   POST /portal/automations/legacy-template-<N>/migrate   (AUT-5)
 *
 * The builder is a GUIDED timeline (n8n-inspired vertical rail — same
 * visual language as the AUTOMATIONS-TIMELINE-HANDOFF doc: dashed rail,
 * 31px ring nodes, tinted channel badges), NOT a free canvas. All inline
 * handlers live under the AUT namespace so nothing collides with the
 * portal.html globals.
 *
 * Server error strings mirrored in validateDefinition() come from
 * atlas-ai src/services/automationDefinitionService.js (AUT-1) and
 * workflowParamCatalog.js — keep them in sync when those change.
 * No external JS libraries (portal.html is dependency-free).
 */
(function (global) {
  'use strict';

  // ── Constants mirrored from atlas-ai (single source of truth: server) ──
  var MAX_STEPS = 12;
  var SMS_MAX_CHARS = 960;
  var SMS_WARN_CHARS = 480;
  var VOICE_MAX_CHARS = 600;
  var MAX_NAME_CHARS = 80;
  var MAX_WAIT_BY_UNIT = { minutes: 1440, hours: 168, days: 30 };
  // Valid step kinds per automation type (call → Call/Wait; sms → SMS/Wait;
  // hybrid → all three).
  var KINDS_FOR_TYPE = { call: ['call', 'wait'], sms: ['sms', 'wait'], hybrid: ['sms', 'call', 'wait'] };
  var TYPE_META = {
    call:   { label: 'Call',   icon: 'phone-outgoing', color: '#3B82F6' },
    sms:    { label: 'SMS',    icon: 'message-square', color: '#EC4899' },
    hybrid: { label: 'Hybrid', icon: 'shuffle',        color: '#7C3AED' },
  };
  // Client-language labels for the AUTOMATION_TRIGGERS whitelist.
  var TRIGGER_LABELS = {
    'lead-inbound':           'New lead captured',
    'lead-after-hours':       'After-hours lead',
    'warm-lead-unresponsive': 'Warm lead went quiet',
    'campaign-call-result':   'Campaign call result',
    'missed-call':            'Missed call',
    'missed-call-callback':   'Missed call (callback follow-up)',
  };
  // Merge-field tokens — same set the legacy renderWorkflowParams chips offer
  // (MERGE_FIELD_TOKENS in workflowParamCatalog.js).
  var MERGE_FIELDS = [
    { token: 'first_name', label: 'Contact first name' }, { token: 'last_name', label: 'Contact last name' },
    { token: 'full_name', label: 'Contact full name' },   { token: 'phone', label: 'Contact phone' },
    { token: 'email', label: 'Contact email' },           { token: 'service', label: 'Service of interest' },
    { token: 'appointment_datetime', label: 'Appointment date & time' },
    { token: 'business_name', label: 'Your business name' }, { token: 'agent_name', label: 'Your AI agent name' },
    { token: 'business_phone', label: 'Your business phone' }, { token: 'booking_url', label: 'Your booking link' },
  ];
  var STATUS_META = {
    draft:     { text: 'Draft',    color: 'var(--muted)' },
    requested: { text: 'Pending',  color: '#f59e0b' },
    active:    { text: 'Active',   color: '#22c55e' },
    cancelled: { text: 'Off',      color: 'var(--muted)' },
    failed:    { text: 'Failed',   color: '#ef4444' },
    rejected:  { text: 'Rejected', color: '#ef4444' },
    off:       { text: 'Off',      color: 'var(--muted)' },
  };
  var DEFAULT_TIMEZONES = [
    'America/New_York', 'America/Chicago', 'America/Denver', 'America/Phoenix',
    'America/Los_Angeles', 'America/Anchorage', 'Pacific/Honolulu',
  ];

  // Legacy preset IRs synthesized client-side (mirrors
  // automationMigrationService.TEMPLATE_EQUIVALENT_STEPS defaults) so editing
  // a Preset starts from the true template defaults; the server re-validates
  // everything at migrate time.
  var LEGACY_PRESETS = {
    1: { name: 'Inbound Lead Follow-Up', trigger: 'warm-lead-unresponsive', type: 'hybrid',
         steps: [
           { kind: 'sms',  template: 'Hi {{first_name}}, this is {{agent_name}} from {{business_name}}. Do you still need help with {{service}}?' },
           { kind: 'wait', value: 15, unit: 'minutes' },
           { kind: 'call', template: 'Hi {{first_name}}, this is {{agent_name}} from {{business_name}} — following up on your request about {{service}}. You can also book any time at {{booking_url}}.' },
           { kind: 'wait', value: 2, unit: 'hours' },
           { kind: 'sms',  template: 'Hi {{first_name}} — still happy to help with {{service}} whenever you are. Book here: {{booking_url}}' },
           { kind: 'wait', value: 1, unit: 'days' },
           { kind: 'sms',  template: 'Last check-in from {{business_name}}: we\u2019d love to help with {{service}}. Reply anytime or book {{booking_url}}.' },
         ] },
    2: { name: 'After Hours Lead Follow-Up', trigger: 'lead-after-hours', type: 'hybrid',
         steps: [
           { kind: 'sms',  template: 'Thanks for reaching out to {{business_name}}! We\u2019re closed right now, but we\u2019ll follow up first thing tomorrow morning.' },
           { kind: 'wait', mode: 'specificTime', at: '09:00' },
           { kind: 'call', template: 'Good morning {{first_name}}, this is {{agent_name}} from {{business_name}} — following up on your {{service}} request from last night.' },
           { kind: 'wait', value: 1, unit: 'hours' },
           { kind: 'sms',  template: 'Hi {{first_name}} — just tried calling about {{service}}. Reply here or book: {{booking_url}}' },
         ] },
    3: { name: 'Unresponsive Leads', trigger: 'warm-lead-unresponsive', type: 'hybrid',
         steps: [
           { kind: 'wait', value: 3, unit: 'days' },
           { kind: 'sms',  template: 'Hi {{first_name}}, {{agent_name}} from {{business_name}} here. Still interested in {{service}}?' },
           { kind: 'wait', value: 2, unit: 'days' },
           { kind: 'call', template: 'Hi {{first_name}}, this is {{agent_name}} from {{business_name}} — checking in on {{service}} one more time. You can book at {{booking_url}}.' },
           { kind: 'wait', value: 2, unit: 'days' },
           { kind: 'sms',  template: 'Final note from {{business_name}} about {{service}} — reply anytime to reopen the conversation.' },
         ] },
    4: { name: 'Outreach Campaign Follow Up', trigger: 'campaign-call-result', type: 'hybrid',
         steps: [
           { kind: 'call', template: 'Hi {{first_name}}, {{agent_name}} from {{business_name}} following up on our recent outreach about {{service}}. You can book at {{booking_url}}.' },
           { kind: 'wait', value: 1, unit: 'hours' },
           { kind: 'sms',  template: 'Sorry we missed you, {{first_name}} — this is {{agent_name}} from {{business_name}}. Reply here or book: {{booking_url}}' },
         ] },
    5: { name: 'Missed Call Auto SMS', trigger: 'missed-call', type: 'sms',
         steps: [
           { kind: 'sms',  template: 'Sorry we missed your call! This is {{business_name}} — how can we help?' },
           { kind: 'wait', value: 30, unit: 'minutes' },
           { kind: 'sms',  template: 'Hi {{first_name}} — following up on your missed call. Reply here anytime, or book: {{booking_url}}' },
           { kind: 'wait', value: 2, unit: 'hours' },
           { kind: 'sms',  template: 'Last follow-up from {{business_name}} — we\u2019d love to help. Reply YES and we\u2019ll get started.' },
         ] },
    6: { name: 'Missed Call Auto Callback', trigger: 'missed-call-callback', type: 'hybrid',
         steps: [
           { kind: 'sms',  template: 'Sorry we missed your call! {{business_name}} is calling you back in a moment.' },
           { kind: 'wait', value: 2, unit: 'minutes' },
           { kind: 'call', template: 'Hi {{first_name}}, this is {{agent_name}} from {{business_name}} — calling you back about your missed call.' },
           { kind: 'wait', value: 10, unit: 'minutes' },
           { kind: 'sms',  template: 'Tried calling you back, {{first_name}} — reply here or book: {{booking_url}}' },
         ] },
  };

  // ── Module state (browser only) ──
  var state = {
    list: null,
    triggers: [],
    planAvailability: {},
    builder: null,       // { mode:'create'|'edit'|'migrate', type, id, legacyId, name, trigger, steps, panelId, saving }
    serverErrors: null,  // { byStep: {i: [msg]}, seq: [msg] } from the last 400
  };

  // ── Pure helpers (unit-tested) ─────────────────────────────────

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // '09:00' → '9:00 AM' (mirrors portal.html to12h)
  function to12h(at) {
    var parts = String(at).split(':').map(Number);
    var h = parts[0], m = parts[1];
    var suffix = h < 12 ? 'AM' : 'PM';
    var h12 = h % 12 === 0 ? 12 : h % 12;
    return h12 + ':' + String(m).padStart(2, '0') + ' ' + suffix;
  }

  // ⚠️ MUTATION GUARD: validateDefinition must not mutate the builder steps.
  // Guarded by unit test: validate does not mutate the definition object.
  /**
   * Client-side mirror of automationDefinitionService.validateDefinition —
   * collects ALL errors so every offending step gets flagged in one pass.
   * Error copy matches the server exactly (AC: builder refuses invalid
   * sequences with the same copy as the server errors).
   * @param {object} def { type, name, trigger, steps }
   * @param {object} [opts] { triggerWhitelist?: string[] }
   * @returns {{ ok: boolean, errors: Array<{index: number|null, msg: string}> }}
   */
  function validateDefinition(def, opts) {
    opts = opts || {};
    var errors = [];
    var triggers = opts.triggerWhitelist && opts.triggerWhitelist.length ? opts.triggerWhitelist : Object.keys(TRIGGER_LABELS);
    var steps = def && Array.isArray(def.steps) ? def.steps : null;

    if (!def || typeof def !== 'object') {
      return { ok: false, errors: [{ index: null, msg: 'automation definition must be an object' }] };
    }
    if (['call', 'sms', 'hybrid'].indexOf(def.type) === -1) {
      errors.push({ index: null, msg: 'type is required — must be one of: call, sms, hybrid' });
    }
    if (!def.trigger) {
      errors.push({ index: null, msg: 'trigger is required — must be one of: ' + triggers.join(', ') });
    } else if (triggers.indexOf(def.trigger) === -1) {
      errors.push({ index: null, msg: 'unknown trigger "' + def.trigger + '" — must be one of: ' + triggers.join(', ') });
    }
    var name = (def.name || '').trim();
    if (!name) {
      errors.push({ index: null, msg: 'name is required (non-empty string)' });
    } else if (name.length > MAX_NAME_CHARS) {
      errors.push({ index: null, msg: 'name must be ' + MAX_NAME_CHARS + ' characters or fewer (currently ' + name.length + ')' });
    }
    if (!steps) {
      errors.push({ index: null, msg: 'steps is required — an array of 1-' + MAX_STEPS + ' step objects' });
    } else if (steps.length === 0) {
      errors.push({ index: null, msg: 'automation must have at least one step' });
    } else if (steps.length > MAX_STEPS) {
      errors.push({ index: null, msg: 'automation cannot exceed ' + MAX_STEPS + ' steps (got ' + steps.length + ')' });
    }

    (steps || []).forEach(function (s, i) {
      if (s.kind === 'sms' || s.kind === 'call') {
        var max = s.kind === 'call' ? VOICE_MAX_CHARS : SMS_MAX_CHARS;
        var t = s.template == null ? '' : String(s.template);
        if (!t.trim()) {
          errors.push({ index: i, msg: 'step ' + i + ': template is required for ' + s.kind + ' steps' });
        } else if (t.length > max) {
          errors.push({ index: i, msg: 'step ' + i + ': template must be ' + max + ' characters or fewer (currently ' + t.length + ')' });
        } else if (t.split('{{').length - 1 !== t.split('}}').length - 1) {
          errors.push({ index: i, msg: 'step ' + i + ': unbalanced merge field braces — every {{ needs a matching }}' });
        } else {
          var unknown = (t.match(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g) || [])
            .map(function (m) { return m.replace(/[{}]/g, '').trim(); })
            .filter(function (tok) { return !MERGE_FIELDS.some(function (f) { return f.token === tok; }); });
          if (unknown.length) {
            errors.push({ index: i, msg: 'step ' + i + ': unknown merge field(s): ' + unknown.map(function (u) { return '{{' + u + '}}'; }).join(', ') });
          }
        }
      } else if (s.kind === 'wait') {
        if (s.mode === 'specificTime' || s.at) {
          var at = s.at || '';
          var hh, mm;
          if (!/^\d{1,2}:\d{2}$/.test(at)) {
            errors.push({ index: i, msg: 'step ' + i + ': time must be in HH:MM 24-hour format (e.g. 09:00)' });
          } else {
            hh = Number(String(at).split(':')[0]);
            mm = Number(String(at).split(':')[1]);
            if (hh > 23 || mm > 59) {
              errors.push({ index: i, msg: 'step ' + i + ': time must be in HH:MM 24-hour format (e.g. 09:00)' });
            }
          }
        } else {
          var n = Number(s.value);
          if (!Number.isInteger(n) || n < 1) {
            errors.push({ index: i, msg: 'step ' + i + ': value must be a positive integer (1 or greater)' });
          } else {
            var maxWait = MAX_WAIT_BY_UNIT[s.unit || 'minutes'];
            if (maxWait && n > maxWait) {
              errors.push({ index: i, msg: 'step ' + i + ': value must be ' + maxWait + ' or less when unit is ' + s.unit });
            }
          }
        }
      } else {
        errors.push({ index: i, msg: 'step ' + i + ': unknown step kind "' + s.kind + '" — must be one of: sms, call, wait' });
      }
    });

    // Mirrors the server's allowLeadingWait opt (legacy template 3 migration).
    if (steps && steps.length && steps[0].kind === 'wait' && !opts.allowLeadingWait) {
      errors.push({ index: 0, msg: 'step 0: automation cannot start with a wait — begin with an sms or call step' });
    }
    if (def && def.type === 'call' && steps && steps.some(function (s) { return s.kind === 'sms'; })) {
      errors.push({ index: null, msg: 'step sequence: "call" automations only support call and wait steps — use the sms or hybrid type for SMS steps' });
    }
    if (def && def.type === 'sms' && steps && steps.some(function (s) { return s.kind === 'call'; })) {
      errors.push({ index: null, msg: 'step sequence: "sms" automations only support sms and wait steps — use the call or hybrid type for call steps' });
    }
    return { ok: errors.length === 0, errors: errors };
  }

  /**
   * Normalize builder steps into the API IR shape (wait interval →
   * { kind, value, unit }; specificTime → { kind, mode, at, timezone? }).
   */
  function buildDefinition(builder) {
    var steps = (builder.steps || []).map(function (s) {
      if (s.kind === 'wait') {
        if (s.mode === 'specificTime' || s.at) {
          var step = { kind: 'wait', mode: 'specificTime', at: s.at || '09:00' };
          if (s.timezone) step.timezone = s.timezone;
          return step;
        }
        return { kind: 'wait', value: Number(s.value), unit: s.unit || 'minutes' };
      }
      return { kind: s.kind, template: s.template || '' };
    });
    return { type: builder.type, trigger: builder.trigger, name: (builder.name || '').trim(), steps: steps };
  }

  /**
   * Partition server validation details ("step 3: …") into per-step vs
   * sequence-level so they map back onto the step cards.
   */
  function partitionServerErrors(details) {
    var byStep = {};
    var seq = [];
    (details || []).forEach(function (d) {
      var m = /^step (\d+)/.exec(String(d));
      if (m) {
        var i = Number(m[1]);
        if (!byStep[i]) byStep[i] = [];
        byStep[i].push(String(d));
      } else {
        seq.push(String(d));
      }
    });
    return { byStep: byStep, seq: seq };
  }

  /** "SMS → wait 15m → AI call → …" one-line summary from IR steps. */
  function sequenceSummary(type, steps) {
    if (!steps || !steps.length) {
      return type === 'call' ? 'AI call sequence.' : type === 'sms' ? 'SMS sequence.' : 'SMS + AI call sequence.';
    }
    return steps.map(function (s) {
      if (s.kind === 'wait') {
        if (s.mode === 'specificTime' || s.at) return 'wait until ' + to12h(s.at || '09:00');
        var u = String(s.unit || 'minutes').replace(/s$/, '');
        return 'wait ' + s.value + ' ' + u + (Number(s.value) === 1 ? '' : 's');
      }
      if (s.kind === 'call') return 'AI call';
      return 'SMS';
    }).join(' → ');
  }

  /** Synthesized editing steps for a legacy preset entry (source:'legacy'). */
  function legacyStepsFor(templateId) {
    var preset = LEGACY_PRESETS[Number(templateId)];
    return preset ? JSON.parse(JSON.stringify(preset.steps)) : [];
  }

  function badgeHtml(status) {
    var m = STATUS_META[status] || STATUS_META.off;
    return '<span style="font-size:11px;font-weight:600;padding:3px 8px;border-radius:6px;background:' + m.color + '22;color:' + m.color + ';">' + m.text + '</span>';
  }

  // ── Render helpers (return HTML strings; unit-testable) ────────

  var NODE_META = {
    trigger: { icon: 'play',           label: 'START', color: '#16a34a', ring: 'rgba(34,197,94,0.35)' },
    sms:     { icon: 'message-square', label: 'SMS',   color: '#EC4899', ring: 'rgba(236,72,153,0.35)' },
    call:    { icon: 'phone-call',     label: 'Call',  color: '#3B82F6', ring: 'rgba(59,130,246,0.35)' },
    wait:    { icon: 'clock',          label: 'Wait',  color: '#9aa3b2', ring: 'rgba(16,24,38,0.14)' },
  };

  /** Live n8n-style node graph strip: [START] → [SMS] → … (no canvas lib). */
  function nodeStripHtml(steps) {
    var all = [{ kind: 'trigger' }].concat(steps || []);
    return all.map(function (s, i) {
      var meta = NODE_META[s.kind] || { icon: 'circle', label: '?', color: '#9aa3b2' };
      var arrow = i === 0 ? '' : '<i data-lucide="chevron-right" style="width:13px;height:13px;color:#c3c9d4;flex-shrink:0;"></i>';
      return arrow
        + '<div title="' + meta.label + '" style="display:flex;align-items:center;gap:4px;flex-shrink:0;">'
        +   '<div style="width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:#fff;box-shadow:0 0 0 1px ' + meta.color + '55;">'
        +     '<i data-lucide="' + meta.icon + '" style="width:12px;height:12px;color:' + meta.color + ';"></i>'
        +   '</div>'
        +   '<span style="font-size:10px;font-weight:700;color:' + meta.color + ';">' + meta.label + '</span>'
        + '</div>';
    }).join('');
  }

  function mergeChipsHtml(targetId) {
    return MERGE_FIELDS.map(function (f) {
      return '<button type="button" onclick="AUT.insertMergeField(\'' + targetId + '\', \'' + f.token + '\')"'
        + ' title="' + esc(f.label) + '"'
        + ' style="background:rgba(16,24,38,0.04);border:1px solid rgba(16,24,38,0.08);border-radius:6px;padding:3px 8px;font-size:11px;font-family:ui-monospace,monospace;color:#101826;cursor:pointer;">{{' + f.token + '}}</button>';
    }).join(' ');
  }

  function stepCardHtml(s, i, timezones, errs, totalSteps) {
    var isSms = s.kind === 'sms';
    var isCall = s.kind === 'call';
    var isWait = s.kind === 'wait';
    var meta = NODE_META[s.kind] || NODE_META.wait;
    var targetId = 'ab-step-' + i + '-tpl';

    var title = 'Untitled step';
    var summary = '';
    if (isWait) {
      if (s.mode === 'specificTime' || s.at) {
        title = 'Wait until ' + to12h(s.at || '09:00');
        summary = 'at ' + to12h(s.at || '09:00');
      } else {
        var u = String(s.unit || 'minutes').replace(/s$/, '');
        title = 'Wait ' + s.value + ' ' + u + (Number(s.value) === 1 ? '' : 's');
        summary = (s.value == null ? '' : s.value) + ' ' + (s.unit || '');
      }
    } else if (isCall) {
      title = 'AI call';
      summary = 'Read aloud by your AI agent';
    } else if (isSms) {
      title = 'SMS message';
      summary = (s.template || '').length + ' chars';
    }

    var body = '';
    if (isWait) {
      if (s.mode === 'specificTime' || s.at) {
        var tzOpts = ['<option value="">Use my business timezone</option>'].concat(
          (timezones || DEFAULT_TIMEZONES).map(function (tz) {
            return '<option value="' + esc(tz) + '"' + (tz === s.timezone ? ' selected' : '') + '>' + esc(tz) + '</option>';
          })
        ).join('');
        body = ''
          + '<div style="font-size:13px;color:#5f687a;line-height:1.55;margin-bottom:12px;">How long the workflow pauses before the next step.</div>'
          + '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">'
          +   '<input type="time" value="' + esc(s.at || '09:00') + '" oninput="AUT.setStepField(' + i + ',\'at\',this.value)"'
          +     ' style="background:#f7f8fa;border:1px solid rgba(16,24,38,0.14);border-radius:9px;padding:9px 11px;font-size:13.5px;color:#101826;outline:none;" />'
          +   '<select onchange="AUT.setStepField(' + i + ',\'timezone\',this.value||undefined)"'
          +     ' style="background:#f7f8fa;border:1px solid rgba(16,24,38,0.14);border-radius:9px;padding:9px 11px;font-size:13.5px;color:#101826;outline:none;max-width:220px;">'
          +     tzOpts
          +   '</select>'
          +   '<span style="font-size:10px;font-weight:700;padding:2px 7px;border-radius:5px;background:rgba(124,58,237,0.12);color:var(--accent2);">TIME OF DAY</span>'
          + '</div>';
      } else {
        var unitOpts = ['minutes', 'hours', 'days'].map(function (un) {
          return '<option value="' + un + '"' + (un === (s.unit || 'minutes') ? ' selected' : '') + '>' + un + '</option>';
        }).join('');
        body = ''
          + '<div style="font-size:13px;color:#5f687a;line-height:1.55;margin-bottom:12px;">How long the workflow pauses before the next step.</div>'
          + '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">'
          +   '<input type="number" min="1" value="' + esc(s.value == null ? 15 : s.value) + '" oninput="AUT.setStepField(' + i + ',\'value\',Number(this.value))"'
          +     ' style="width:88px;background:#f7f8fa;border:1px solid rgba(16,24,38,0.14);border-radius:9px;padding:9px 11px;font-size:13.5px;color:#101826;outline:none;" />'
          +   '<select onchange="AUT.setStepField(' + i + ',\'unit\',this.value)"'
          +     ' style="background:#f7f8fa;border:1px solid rgba(16,24,38,0.14);border-radius:9px;padding:9px 12px;font-size:13.5px;color:#101826;outline:none;">'
          +     unitOpts
          +   '</select>'
          +   '<button type="button" onclick="AUT.useSpecificTime(' + i + ')"'
          +     ' style="font-size:11.5px;font-weight:600;color:#7C3AED;background:none;border:1px solid rgba(124,58,237,0.3);border-radius:7px;padding:5px 10px;cursor:pointer;">Use specific time</button>'
          + '</div>';
      }
    } else {
      var hint = isCall
        ? 'Read aloud by your AI agent — keep it conversational. Links are spoken as "the link we just texted you".'
        : 'Unknown values are left out cleanly rather than showing a placeholder.';
      body = ''
        + '<div style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:10px;">' + mergeChipsHtml(targetId) + '</div>'
        + '<textarea id="' + targetId + '" data-channel="' + (isCall ? 'voice' : 'sms') + '" rows="3"'
        +   ' oninput="AUT.setStepField(' + i + ',\'template\',this.value); AUT.updateStepCount(\'' + targetId + '\')"'
        +   ' style="width:100%;box-sizing:border-box;background:#f7f8fa;border:1px solid rgba(16,24,38,0.14);border-radius:9px;padding:10px 12px;font-size:13.5px;line-height:1.5;color:#101826;outline:none;resize:vertical;font-family:inherit;">' + esc(s.template || '') + '</textarea>'
        + '<div style="display:flex;flex-wrap:wrap;gap:10px;align-items:baseline;margin-top:7px;">'
        +   '<span style="font-size:11.5px;color:#5f687a;flex:1 1 auto;min-width:0;line-height:1.5;">' + hint + '</span>'
        +   '<span id="' + targetId + '-count" style="font-size:11.5px;color:var(--muted);white-space:nowrap;"></span>'
        + '</div>';
    }

    var errHtml = (errs || []).length
      ? '<div style="margin-top:10px;font-size:12px;color:#ef4444;background:rgba(239,68,68,0.06);padding:6px 10px;border-radius:6px;line-height:1.6;">'
        + errs.map(function (e) { return '• ' + esc(e); }).join('<br>') + '</div>'
      : '';

    var upDisabled = i === 0 ? 'disabled' : '';
    var downDisabled = i === totalSteps - 1 ? 'disabled' : '';
    var btnStyle = 'width:26px;height:26px;border-radius:7px;display:flex;align-items:center;justify-content:center;background:#fff;border:1px solid var(--border);cursor:pointer;color:#5f687a;';

    return ''
      + '<div id="ab-step-' + i + '" style="display:flex;gap:14px;align-items:flex-start;position:relative;">'
      +   '<div style="width:31px;height:31px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;background:#fff;margin-top:6px;z-index:1;box-shadow:0 0 0 1px ' + meta.ring + ';">'
      +     '<i data-lucide="' + meta.icon + '" style="width:14px;height:14px;color:' + meta.color + ';"></i>'
      +   '</div>'
      +   '<div style="flex:1;min-width:0;border:1px solid rgba(16,24,38,0.08);border-radius:12px;background:#fbfbfc;overflow:hidden;">'
      +     '<div style="display:flex;align-items:center;gap:10px;padding:11px 14px;flex-wrap:wrap;">'
      +       '<span style="font-size:14px;font-weight:600;color:#101826;">' + esc(title) + '</span>'
      +       (meta.label ? '<span style="font-size:10px;font-weight:700;letter-spacing:0.4px;padding:2px 7px;border-radius:5px;color:' + meta.color + ';background:' + meta.color + '1f;">' + meta.label + '</span>' : '')
      +       '<span style="font-size:12px;color:#9aa3b2;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + esc(summary) + '</span>'
      +       '<span style="display:flex;gap:4px;flex-shrink:0;">'
      +         '<button ' + upDisabled + ' onclick="AUT.moveStep(' + i + ',-1)" title="Move up" style="' + btnStyle + '"><i data-lucide="chevron-up" style="width:14px;height:14px;"></i></button>'
      +         '<button ' + downDisabled + ' onclick="AUT.moveStep(' + i + ',1)" title="Move down" style="' + btnStyle + '"><i data-lucide="chevron-down" style="width:14px;height:14px;"></i></button>'
      +         '<button onclick="AUT.removeStep(' + i + ')" title="Remove step" style="' + btnStyle + '"><i data-lucide="trash-2" style="width:13px;height:13px;"></i></button>'
      +       '</span>'
      +     '</div>'
      +     '<div style="padding:0 14px 14px;">'
      +       '<div style="border:1px solid rgba(16,24,38,0.08);border-radius:10px;background:#fff;padding:14px 16px;">'
      +         body
      +         errHtml
      +       '</div>'
      +     '</div>'
      +   '</div>'
      + '</div>';
  }

  /** Whole builder panel (name + trigger + node strip + step rail + save). */
  function builderPanelHtml() {
    var b = state.builder;
    if (!b) return '';
    var timezones = (global.AUT_TIMEZONES && global.AUT_TIMEZONES.length) ? global.AUT_TIMEZONES : DEFAULT_TIMEZONES;
    var tm = TYPE_META[b.type] || TYPE_META.call;
    var kinds = KINDS_FOR_TYPE[b.type] || [];

    var validation = validateDefinition(buildDefinition(b), {
      triggerWhitelist: state.triggers,
      // Mirrors the server migrate route: only legacy template 3 may lead with a wait.
      allowLeadingWait: b.mode === 'migrate' && Number(b.legacyId) === 3,
    });
    var errByStep = {};
    validation.errors.forEach(function (e) {
      if (e.index != null) {
        if (!errByStep[e.index]) errByStep[e.index] = [];
        errByStep[e.index].push(e.msg);
      }
    });
    var srv = state.serverErrors || { byStep: {}, seq: [] };
    Object.keys(srv.byStep || {}).forEach(function (k) {
      var i = Number(k);
      errByStep[i] = (errByStep[i] || []).concat(srv.byStep[k]);
    });
    var seqErrors = validation.errors.filter(function (e) { return e.index == null; }).map(function (e) { return e.msg; }).concat(srv.seq || []);

    var triggerOpts = ['<option value="">Select a trigger…</option>'].concat(
      (state.triggers.length ? state.triggers : Object.keys(TRIGGER_LABELS)).map(function (t) {
        return '<option value="' + esc(t) + '"' + (t === b.trigger ? ' selected' : '') + '>' + esc(TRIGGER_LABELS[t] || t) + '</option>';
      })
    ).join('');

    var stepCards = b.steps.map(function (s, i) { return stepCardHtml(s, i, timezones, errByStep[i] || [], b.steps.length); }).join('');
    var counter = '<span style="font-size:12px;color:' + (b.steps.length >= MAX_STEPS ? '#ef4444' : 'var(--muted)') + ';white-space:nowrap;">' + b.steps.length + '/' + MAX_STEPS + ' steps</span>';

    var addMenu = kinds.map(function (k) {
      var km = { sms: { label: 'SMS message', icon: 'message-square' }, call: { label: 'AI call', icon: 'phone-call' }, wait: { label: 'Wait', icon: 'clock' } }[k];
      return '<button onclick="AUT.addStep(\'' + k + '\')" style="display:flex;align-items:center;gap:8px;width:100%;background:none;border:none;padding:8px 12px;font-size:13px;font-weight:600;color:#101826;cursor:pointer;text-align:left;">'
        + '<i data-lucide="' + km.icon + '" style="width:14px;height:14px;color:' + tm.color + ';"></i>' + km.label + '</button>';
    }).join('');

    var seqErrorHtml = seqErrors.length
      ? '<div style="margin-top:10px;font-size:12.5px;color:#ef4444;background:rgba(239,68,68,0.06);border-radius:8px;padding:8px 12px;line-height:1.6;">'
        + seqErrors.map(function (e) { return '• ' + esc(e); }).join('<br>') + '</div>'
      : '';

    var saveLabel = b.mode === 'create' ? 'Submit for activation' : b.mode === 'migrate' ? 'Save & activate changes' : 'Save changes';
    var saveHint = b.mode === 'create'
      ? 'Your request goes to an admin for review and activation.'
      : b.mode === 'migrate'
        ? 'Saving migrates this preset to a custom automation — it goes back through admin approval with your changes.'
        : 'Your changes go to an admin for review and activation.';

    return ''
      + '<div style="display:flex;flex-direction:column;">'
      +   '<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;flex-wrap:wrap;">'
      +     '<span style="font-size:14px;font-weight:700;color:#101826;">' + (b.mode === 'create' ? 'New ' + tm.label + ' automation' : 'Edit — ' + esc(b.name || tm.label + ' automation')) + '</span>'
      +     '<span style="margin-left:auto;cursor:pointer;font-size:12.5px;font-weight:600;color:#5f687a;" onclick="AUT.closeBuilder()">Close</span>'
      +   '</div>'
      +   '<div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:14px;">'
      +     '<div style="flex:1;min-width:220px;">'
      +       '<label style="display:block;font-size:11.5px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">Name</label>'
      +       '<input type="text" value="' + esc(b.name) + '" oninput="AUT.setName(this.value)" maxlength="120" placeholder="e.g. New lead follow-up"'
      +         ' style="width:100%;box-sizing:border-box;background:#f7f8fa;border:1px solid rgba(16,24,38,0.14);border-radius:9px;padding:10px 12px;font-size:13.5px;color:#101826;outline:none;" />'
      +     '</div>'
      +     '<div style="flex:1;min-width:220px;">'
      +       '<label style="display:block;font-size:11.5px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">Trigger</label>'
      +       '<select onchange="AUT.setTrigger(this.value)" style="width:100%;background:#f7f8fa;border:1px solid rgba(16,24,38,0.14);border-radius:9px;padding:10px 12px;font-size:13.5px;color:#101826;outline:none;">'
      +         triggerOpts
      +       '</select>'
      +     '</div>'
      +   '</div>'
      +   '<div style="font-size:11.5px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">Sequence preview</div>'
      +   '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;background:var(--field);border:1px solid var(--border);border-radius:10px;padding:10px 12px;overflow-x:auto;">'
      +     nodeStripHtml(b.steps)
      +   '</div>'
      +   '<div style="display:flex;align-items:center;gap:10px;margin:16px 0 8px;">'
      +     '<span style="font-size:11.5px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:0.5px;">Steps</span>'
      +     counter
      +     '<span style="margin-left:auto;position:relative;">'
      +       '<button onclick="AUT.toggleAddMenu()"' + (b.steps.length >= MAX_STEPS ? ' disabled' : '')
      +         ' style="padding:7px 14px;border-radius:8px;font-size:12.5px;font-weight:600;background:var(--accent);color:#fff;border:none;cursor:pointer;">+ Add step</button>'
      +       '<div id="ab-add-menu" style="display:none;position:absolute;right:0;top:calc(100% + 4px);background:#fff;border:1px solid var(--border);border-radius:10px;box-shadow:0 8px 24px rgba(16,24,38,0.12);z-index:50;min-width:170px;overflow:hidden;">'
      +         addMenu
      +       '</div>'
      +     '</span>'
      +   '</div>'
      +   '<div style="position:relative;">'
      +     '<div style="position:absolute;left:15px;top:16px;bottom:16px;width:0;border-left:1px dashed rgba(16,24,38,0.18);"></div>'
      +     '<div style="display:flex;flex-direction:column;gap:10px;">'
      +       (stepCards || '<div style="border:1px dashed var(--border);border-radius:12px;padding:16px;font-size:13px;color:var(--muted);text-align:center;">No steps yet — add your first step.</div>')
      +     '</div>'
      +   '</div>'
      +   seqErrorHtml
      +   '<div style="margin-top:14px;font-size:12px;color:var(--muted);line-height:1.6;">' + saveHint + '</div>'
      +   '<div style="display:flex;gap:9px;margin-top:12px;flex-wrap:wrap;">'
      +     '<button onclick="AUT.saveBuilder(this)" style="padding:9px 20px;border-radius:9px;font-size:13px;font-weight:700;background:#3B82F6;color:#fff;border:none;cursor:pointer;">' + saveLabel + '</button>'
      +     '<button onclick="AUT.closeBuilder()" style="padding:9px 20px;border-radius:9px;font-size:13px;font-weight:600;background:none;border:1px solid rgba(16,24,38,0.14);color:#5f687a;cursor:pointer;">Cancel</button>'
      +   '</div>'
      + '</div>';
  }

  function automationCardHtml(a) {
    var isLegacy = a.source === 'legacy';
    var tm = TYPE_META[a.type] || TYPE_META.call;
    var steps = (a.definition && Array.isArray(a.definition.steps)) ? a.definition.steps : (isLegacy ? legacyStepsFor(a.legacy && a.legacy.template_id) : null);
    var seq = sequenceSummary(a.type, steps);
    var requested = a.status === 'requested';
    var active = a.status === 'active';
    var canEdit = !active && !requested && !isLegacy;
    var canMigrate = isLegacy && a.status === 'active';
    var canCancel = active || requested;
    var reason = a.rejection_reason && (a.status === 'failed' || a.status === 'rejected')
      ? '<div style="margin-top:6px;font-size:12px;color:#ef4444;background:rgba(239,68,68,0.06);padding:6px 10px;border-radius:6px;">' + esc(a.rejection_reason) + '</div>'
      : '';
    var grand = a.grandfathered
      ? '<span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:6px;background:rgba(245,158,11,.12);color:#f59e0b;margin-left:6px;vertical-align:middle;" title="This automation is active from a previous plan. Disabling it will require an upgrade to re-enable.">Grandfathered</span>'
      : '';

    return ''
      + '<div style="border:1px solid var(--border);border-radius:12px;">'
      +   '<div style="display:flex;align-items:center;justify-content:space-between;padding:14px 16px;gap:12px;flex-wrap:wrap;">'
      +     '<div style="flex:1;min-width:220px;">'
      +       '<div style="font-weight:600;font-size:14px;">' + esc(a.name || tm.label + ' automation') + grand
      +         (isLegacy ? '<span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:6px;background:rgba(124,58,237,.12);color:#7c3aed;margin-left:6px;vertical-align:middle;" title="Legacy preset — saving through the builder migrates it to a custom automation.">Preset</span>' : '')
      +       '</div>'
      +       (a.trigger ? '<div style="font-size:12.5px;color:var(--muted);margin-top:2px;">Trigger: ' + esc(TRIGGER_LABELS[a.trigger] || a.trigger) + '</div>' : '')
      +       '<div style="font-size:12.5px;color:var(--muted);margin-top:4px;">' + esc(seq) + '</div>'
      +       reason
      +     '</div>'
      +     '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">'
      +       badgeHtml(a.status)
      +       (canEdit ? '<button onclick="AUT.openBuilder(\'' + esc(a.type) + '\',\'' + esc(a.automation_id) + '\')" style="padding:6px 14px;border-radius:8px;font-size:12px;font-weight:600;background:none;border:1px solid var(--border);color:var(--text);cursor:pointer;">Edit</button>' : '')
      +       (canMigrate ? '<button onclick="AUT.openBuilder(\'' + esc(a.type) + '\',\'' + esc(a.automation_id) + '\')" style="padding:6px 14px;border-radius:8px;font-size:12px;font-weight:600;background:none;border:1px solid var(--border);color:var(--text);cursor:pointer;">Customize</button>' : '')
      +       (active && !isLegacy ? '<button onclick="openTestModal(\'' + esc(a.automation_id) + '\',\'' + esc(a.name || '') + '\')" style="padding:6px 14px;border-radius:8px;font-size:12px;font-weight:600;background:none;border:1px solid var(--accent);color:var(--accent);cursor:pointer;">Test</button>' : '')
      +       (canCancel ? '<button onclick="AUT.cancelAutomation(\'' + esc(a.automation_id) + '\')" style="padding:6px 14px;border-radius:8px;font-size:12px;font-weight:600;background:transparent;border:1px solid var(--border);color:var(--text);cursor:pointer;">' + (active ? 'Disable' : 'Cancel request') + '</button>' : '')
      +     '</div>'
      +   '</div>'
      +   '<div id="ab-editor-' + esc(a.automation_id) + '" style="display:none;border-top:1px solid var(--border);padding:16px;"></div>'
      + '</div>';
  }

  /** The three per-type sections (Call / SMS / Hybrid) + add buttons. */
  function listHtml() {
    var list = state.list || [];
    return ['call', 'sms', 'hybrid'].map(function (type) {
      var tm = TYPE_META[type];
      var instances = list.filter(function (a) { return a && a.type === type; });
      var pa = state.planAvailability[type];
      var locked = !!(pa && !pa.available);
      var activeCount = instances.filter(function (a) { return a.status === 'active'; }).length;
      var cards = instances.map(automationCardHtml).join('');
      var addBtn = locked
        ? '<button disabled title="Your current plan doesn\'t include ' + tm.label + ' automations." style="padding:8px 16px;border-radius:9px;font-size:12.5px;font-weight:600;background:var(--border);color:var(--muted);border:none;cursor:not-allowed;">Upgrade to add</button>'
        : '<button onclick="AUT.openBuilder(\'' + type + '\')" style="padding:8px 16px;border-radius:9px;font-size:12.5px;font-weight:600;background:' + tm.color + ';color:#fff;border:none;cursor:pointer;">+ Add automation</button>';
      var desc = type === 'call' ? 'Automated AI call-back and follow-up calls.' : type === 'sms' ? 'Automated SMS follow-up workflows.' : 'Mix of SMS and AI call steps in one sequence.';
      return ''
        + '<div style="margin-bottom:26px;">'
        +   '<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;">'
        +     '<i data-lucide="' + tm.icon + '" style="width:18px;height:18px;color:' + tm.color + '"></i>'
        +     '<span style="font-size:17px;font-weight:700;">' + tm.label + ' automations</span>'
        +     '<span style="font-size:12px;color:var(--muted);">(' + activeCount + ' active' + (locked ? ' · plan upgrade required' : '') + ')</span>'
        +     '<span style="margin-left:auto;">' + addBtn + '</span>'
        +   '</div>'
        +   '<div style="font-size:13.5px;color:var(--muted);line-height:1.6;margin-bottom:14px;">' + desc + ' One active automation per type.</div>'
        +   '<div style="display:flex;flex-direction:column;gap:12px;">'
        +     (cards || '<div style="border:1px dashed var(--border);border-radius:12px;padding:16px;font-size:13px;color:var(--muted);text-align:center;">No automations yet — add one to get started.</div>')
        +   '</div>'
        + '</div>';
    }).join('');
  }

  // ── Browser wiring (no-ops without a DOM; exercised by .validate harness) ──

  function hasDom() { return typeof document !== 'undefined' && !!document.getElementById; }
  // portal.html declares `const API` / `let portalToken` at script top level —
  // global-lexical scope, which does NOT attach to window/globalThis. So fall
  // back to bare references in the browser (typeof guard keeps jest happy,
  // where neither exists). Same pattern the harness needs to mock them.
  function api() {
    if (typeof global.API !== 'undefined') return global.API;
    if (typeof API !== 'undefined') return API; // eslint-disable-line no-undef
    return '';
  }
  function token() {
    if (typeof global.portalToken !== 'undefined') return global.portalToken;
    if (typeof portalToken !== 'undefined') return portalToken; // eslint-disable-line no-undef
    return null;
  }
  function toast(msg, kind) { if (typeof global.showToast === 'function') global.showToast(msg, kind || 'success'); }
  function icons() { if (global.lucide && typeof global.lucide.createIcons === 'function') global.lucide.createIcons(); }

  function loadAutomations() {
    if (!hasDom()) return;
    var container = document.getElementById('automations-list');
    if (!container) return;
    if (!token()) {
      container.innerHTML = '<div style="text-align:center;padding:30px;color:var(--muted);font-size:13px;">Session expired. Please sign in again.</div>';
      return;
    }
    container.innerHTML = '<div style="text-align:center;padding:30px;color:var(--muted);font-size:13px;">Loading automations…</div>';
    fetch(api() + '/portal/automations', { headers: { 'X-Portal-Token': token() } })
      .then(function (res) {
        if (res.status === 401) return null; // global interceptor redirects
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (data) {
        if (!data) return;
        state.list = data.automations || [];
        state.triggers = data.triggers || Object.keys(TRIGGER_LABELS);
        state.planAvailability = data.plan_availability || {};
        renderAutomations();
      })
      .catch(function (err) {
        if (typeof console !== 'undefined') console.error('[Auzora] loadAutomations failed:', err && err.message);
        container.innerHTML = '<div style="text-align:center;padding:30px;color:var(--muted);font-size:13px;">Unable to load automations. '
          + '<a href="#" onclick="AUT.load();return false;" style="color:var(--accent);text-decoration:underline;">Retry</a></div>';
      });
  }

  function renderAutomations() {
    if (!hasDom()) return;
    var container = document.getElementById('automations-list');
    if (!container) return;
    container.innerHTML = listHtml();
    icons();
  }

  function openBuilder(type, automationId) {
    var list = state.list || [];
    var entry = automationId ? list.find(function (a) { return a.automation_id === automationId; }) : null;
    if (automationId && !entry) return;

    var mode = 'create', id = null, legacyId = null, name = '', trigger = '', steps = [], panelId;
    if (entry && entry.source === 'legacy') {
      // Legacy preset → SAME timeline from the synthesized IR; saving runs migrate.
      mode = 'migrate';
      legacyId = entry.legacy ? entry.legacy.template_id : null;
      var preset = LEGACY_PRESETS[Number(legacyId)] || {};
      name = preset.name || entry.name || '';
      trigger = entry.trigger || preset.trigger || '';
      steps = legacyStepsFor(legacyId);
      panelId = 'ab-editor-' + automationId;
    } else if (entry) {
      mode = 'edit';
      id = entry.automation_id;
      name = entry.name || '';
      trigger = entry.trigger || '';
      steps = JSON.parse(JSON.stringify((entry.definition && entry.definition.steps) || []));
      panelId = 'ab-editor-' + id;
    } else {
      panelId = 'ab-editor-new-' + type;
    }
    state.builder = { mode: mode, id: id, legacyId: legacyId, type: type, name: name, trigger: trigger, steps: steps, panelId: panelId, saving: false };
    state.serverErrors = null;

    var host = document.getElementById(panelId);
    if (!host && mode === 'create' && hasDom()) {
      // Create mode has no per-card editor host — insert one at the top of
      // the list so '+ Add automation' opens the builder above the sections.
      var container = document.getElementById('automations-list');
      if (!container) return;
      host = document.createElement('div');
      host.id = panelId;
      host.style.cssText = 'border:1px solid var(--border);border-radius:12px;padding:16px;margin-bottom:16px;background:#fff;';
      container.insertBefore(host, container.firstChild);
    }
    if (!host) return;
    host.style.display = 'block';
    renderBuilder();
    if (host.scrollIntoView) host.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function closeBuilder() {
    var b = state.builder;
    if (b && b.panelId && hasDom()) {
      var host = document.getElementById(b.panelId);
      if (host) {
        // Create-mode hosts are dynamically inserted — remove them outright;
        // per-card hosts stay hidden in the DOM for the next open.
        if (b.mode === 'create' && b.panelId.indexOf('ab-editor-new-') === 0) {
          if (host.remove) host.remove();
        } else {
          host.style.display = 'none';
          host.innerHTML = '';
        }
      }
    }
    state.builder = null;
    state.serverErrors = null;
  }

  function renderBuilder() {
    if (!hasDom() || !state.builder) return;
    var host = document.getElementById(state.builder.panelId);
    if (!host) return;
    host.innerHTML = builderPanelHtml();
    (state.builder.steps || []).forEach(function (s, i) {
      if (s.kind === 'sms' || s.kind === 'call') updateStepCount('ab-step-' + i + '-tpl');
    });
    icons();
  }

  // ── Inline-handler targets (AUT namespace) ──

  function setName(v) { if (state.builder) { state.builder.name = v; } }
  function setTrigger(v) { if (state.builder) { state.builder.trigger = v; } }
  function setStepField(i, key, value) {
    if (state.builder && state.builder.steps[i]) state.builder.steps[i][key] = value;
    if (key !== 'template') renderBuilder(); // template typing must not re-render (keeps caret)
  }
  function useSpecificTime(i) {
    if (state.builder && state.builder.steps[i]) {
      state.builder.steps[i] = { kind: 'wait', mode: 'specificTime', at: '09:00' };
      renderBuilder();
    }
  }
  function toggleAddMenu() {
    if (!hasDom()) return;
    var m = document.getElementById('ab-add-menu');
    if (m) m.style.display = m.style.display === 'none' ? 'block' : 'none';
  }
  function addStep(kind) {
    var b = state.builder;
    if (!b || b.steps.length >= MAX_STEPS) return;
    var s = kind === 'wait' ? { kind: 'wait', value: 15, unit: 'minutes' }
      : kind === 'call' ? { kind: 'call', template: '' }
      : { kind: 'sms', template: '' };
    b.steps.push(s);
    renderBuilder();
  }
  function removeStep(i) {
    var b = state.builder;
    if (!b) return;
    b.steps.splice(i, 1);
    renderBuilder();
  }
  function moveStep(i, dir) {
    var b = state.builder;
    if (!b) return;
    var j = i + dir;
    if (j < 0 || j >= b.steps.length) return;
    var tmp = b.steps[i]; b.steps[i] = b.steps[j]; b.steps[j] = tmp;
    renderBuilder();
  }

  // Merge-field insertion at the cursor — same UX as the legacy
  // insertMergeField, keyed by element id (AUT namespace, no collisions).
  function insertMergeField(targetId, tkn) {
    if (!hasDom()) return;
    var el = document.getElementById(targetId);
    if (!el || el.tagName !== 'TEXTAREA') return;
    var snippet = '{{' + tkn + '}}';
    var start = el.selectionStart != null ? el.selectionStart : el.value.length;
    var end = el.selectionEnd != null ? el.selectionEnd : el.value.length;
    el.value = el.value.slice(0, start) + snippet + el.value.slice(end);
    el.focus();
    el.selectionStart = el.selectionEnd = start + snippet.length;
    // Keep builder state in sync (input event may not fire for programmatic sets).
    var m = /^ab-step-(\d+)-tpl$/.exec(targetId);
    if (m && state.builder && state.builder.steps[Number(m[1])]) {
      state.builder.steps[Number(m[1])].template = el.value;
    }
    updateStepCount(targetId);
  }

  // Live char count (updateTemplateCount pattern): voice → chars, sms →
  // chars + segments, amber past the 480-char warn threshold.
  function updateStepCount(targetId) {
    if (!hasDom()) return;
    var el = document.getElementById(targetId);
    var out = document.getElementById(targetId + '-count');
    if (!el || !out) return;
    var len = el.value.length;
    if (el.dataset.channel === 'voice') {
      out.textContent = len + ' chars';
      out.style.color = len > VOICE_MAX_CHARS ? '#ef4444' : 'var(--muted)';
      return;
    }
    var segments = Math.ceil(len / 160) || 0;
    out.textContent = len + ' chars · ' + segments + ' SMS segment' + (segments === 1 ? '' : 's');
    out.style.color = len > SMS_WARN_CHARS ? '#f59e0b' : 'var(--muted)';
  }

  function saveBuilder(btn) {
    var b = state.builder;
    if (!b || b.saving) return;
    var def = buildDefinition(b);
    var validation = validateDefinition(def, {
      triggerWhitelist: state.triggers,
      allowLeadingWait: b.mode === 'migrate' && Number(b.legacyId) === 3,
    });
    if (!validation.ok) {
      state.serverErrors = partitionServerErrors(validation.errors.map(function (e) { return e.msg; }));
      toast('Fix the highlighted steps before saving (' + validation.errors.length + ' problem' + (validation.errors.length === 1 ? '' : 's') + ').', 'error');
      renderBuilder();
      return;
    }
    var method = 'POST';
    var url = api() + '/portal/automations';
    if (b.mode === 'edit') { method = 'PUT'; url = api() + '/portal/automations/' + b.id; }
    if (b.mode === 'migrate') { url = api() + '/portal/automations/legacy-template-' + b.legacyId + '/migrate'; }

    b.saving = true;
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; btn.style.opacity = '0.6'; }
    fetch(url, {
      method: method,
      headers: { 'X-Portal-Token': token(), 'Content-Type': 'application/json' },
      body: JSON.stringify(b.mode === 'migrate' ? {} : def),
    })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (data) { return { ok: res.ok, status: res.status, data: data }; });
      })
      .then(function (r) {
        if (!r.ok) {
          var details = r.data.details || [];
          if (details.length) {
            state.serverErrors = partitionServerErrors(details);
            toast(r.data.error || 'Validation failed', 'error');
            renderBuilder();
          } else {
            toast(r.data.error || 'Failed to save automation (HTTP ' + r.status + ')', 'error');
          }
          return;
        }
        closeBuilder();
        loadAutomations();
        toast(r.data.message || 'Automation request submitted. An admin will review and activate it.', 'success');
        if ((r.data.warnings || []).length) toast(r.data.warnings.join(' · '), 'error');
      })
      .catch(function (err) {
        toast('Error saving: ' + (err && err.message), 'error');
      })
      .then(function () {
        if (state.builder) state.builder.saving = false;
        if (btn && btn.isConnected) { btn.disabled = false; btn.textContent = 'Save'; btn.style.opacity = '1'; }
      });
  }

  function cancelAutomation(id) {
    var entry = (state.list || []).find(function (a) { return a.automation_id === id; });
    var active = entry && entry.status === 'active';
    if (typeof global.confirm === 'function' && typeof window !== 'undefined'
        && !window.confirm(active
          ? 'Disable this automation? The compiled workflow will be deactivated and deleted.'
          : 'Cancel this pending request?')) return;
    fetch(api() + '/portal/automations/' + encodeURIComponent(id) + '/cancel', {
      method: 'POST',
      headers: { 'X-Portal-Token': token() },
    })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (data) { return { ok: res.ok, data: data }; });
      })
      .then(function (r) {
        if (!r.ok) { toast(r.data.error || 'Failed to cancel automation', 'error'); return; }
        toast(active ? 'Automation disabled.' : 'Request cancelled.', 'success');
        loadAutomations();
      })
      .catch(function (err) { toast('Error: ' + (err && err.message), 'error'); });
  }

  // ── Public surface ──
  var AUT = {
    MAX_STEPS: MAX_STEPS,
    SMS_MAX_CHARS: SMS_MAX_CHARS,
    VOICE_MAX_CHARS: VOICE_MAX_CHARS,
    MAX_WAIT_BY_UNIT: MAX_WAIT_BY_UNIT,
    KINDS_FOR_TYPE: KINDS_FOR_TYPE,
    TYPE_META: TYPE_META,
    TRIGGER_LABELS: TRIGGER_LABELS,
    MERGE_FIELDS: MERGE_FIELDS,
    LEGACY_PRESETS: LEGACY_PRESETS,
    STATUS_META: STATUS_META,
    state: state,
    esc: esc,
    to12h: to12h,
    validateDefinition: validateDefinition,
    buildDefinition: buildDefinition,
    partitionServerErrors: partitionServerErrors,
    sequenceSummary: sequenceSummary,
    legacyStepsFor: legacyStepsFor,
    badgeHtml: badgeHtml,
    nodeStripHtml: nodeStripHtml,
    stepCardHtml: stepCardHtml,
    builderPanelHtml: builderPanelHtml,
    automationCardHtml: automationCardHtml,
    listHtml: listHtml,
    load: loadAutomations,
    renderList: renderAutomations,
    openBuilder: openBuilder,
    closeBuilder: closeBuilder,
    renderBuilder: renderBuilder,
    setName: setName,
    setTrigger: setTrigger,
    setStepField: setStepField,
    useSpecificTime: useSpecificTime,
    toggleAddMenu: toggleAddMenu,
    addStep: addStep,
    removeStep: removeStep,
    moveStep: moveStep,
    insertMergeField: insertMergeField,
    updateStepCount: updateStepCount,
    saveBuilder: saveBuilder,
    cancelAutomation: cancelAutomation,
  };

  global.AUT = AUT;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = AUT;
  }
}(typeof window !== 'undefined' ? window : this));
