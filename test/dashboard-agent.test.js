// test/dashboard-agent.test.js — unit tests for the agent health card (D7)
const DashboardAgent = require('../js/dashboard-agent');

describe('buildAgentCard', () => {
  const mockVoices = [
    { id: 'voice-1', label: 'Sarah' },
    { id: 'voice-2', label: 'James' },
    { id: 'voice-3', label: 'Emily' }
  ];

  const baseClient = {
    twilio_number: '+15559876543',
    agent_name: 'Auzora',
    business_name: 'Demo Biz',
    voice_id: 'voice-1',
    office_hours: '9-5 M-F',
    after_hours_message: 'Please leave a message',
    calendar_provider: 'native'
  };

  test('renders live agent with all fields present', () => {
    const html = DashboardAgent.buildAgentCard(baseClient, mockVoices);

    expect(html).toContain('agent-status-pill-live');
    expect(html).toContain('Live');
    // The agent's OWN number is now shown IN FULL — see formatPhone(). It was
    // masked to '•••• 6543', which had no privacy value (the client owns and
    // publishes this line) and hid the number they need in order to test the
    // agent or configure carrier forwarding. Lead phones stay masked.
    expect(html).toContain('+1 (555) 987-6543');
    expect(html).not.toContain('•••• 6543');
    expect(html).toContain('Sarah');
    expect(html).toContain('Auzora');
    expect(html).toContain('Demo Biz');
    expect(html).toContain('ON');
    expect(html).toContain('Native');
  });

  test('renders setup pending when no twilio_number', () => {
    const client = { ...baseClient, twilio_number: null };
    const html = DashboardAgent.buildAgentCard(client, mockVoices);
    
    expect(html).toContain('agent-status-pill-setup');
    expect(html).toContain('Setup pending');
    expect(html).toContain('not configured');
  });

  test('degrades gracefully for missing voice', () => {
    const client = { ...baseClient, voice_id: null };
    const html = DashboardAgent.buildAgentCard(client, mockVoices);
    
    expect(html).toContain('Voice:');
    expect(html).toContain('—');
  });

  test('matches voice by id when available', () => {
    const client = { ...baseClient, voice_id: 'voice-2' };
    const html = DashboardAgent.buildAgentCard(client, mockVoices);
    
    expect(html).toContain('James');
  });

  test('shows OFF for after-hours when no message', () => {
    const client = { ...baseClient, after_hours_message: null };
    const html = DashboardAgent.buildAgentCard(client, mockVoices);
    
    expect(html).toContain('OFF');
  });

  test('shows None only when a third-party provider has no credentials', () => {
    // 'none' is not a real provider value; a record carrying it has nothing
    // connected, which means the NATIVE calendar (no connection required).
    const client = { ...baseClient, calendar_provider: 'google' };
    const html = DashboardAgent.buildAgentCard(client, mockVoices);
    expect(html).toContain('None');
  });

  test('a client with NO calendar_provider field still reports Native', () => {
    // The reported "Calendar: None" bug. Clients created before
    // calendar_provider existed have no such field, but the backend's
    // resolveProviderName() falls back to 'native' and books them fine — so
    // the card claiming "None" contradicted the booking engine.
    const client = { ...baseClient };
    delete client.calendar_provider;
    const html = DashboardAgent.buildAgentCard(client, mockVoices);
    expect(html).toContain('Native');
    expect(html).not.toContain('Calendar:</span> <b>None');
  });

  test('handles null/undefined client', () => {
    const html = DashboardAgent.buildAgentCard(null, mockVoices);
    
    expect(html).toContain('agent-status-pill-setup');
    expect(html).toContain('Setup pending');
    expect(html).toContain('not configured');
  });

  test('escapes HTML in business and agent names', () => {
    const client = {
      ...baseClient,
      business_name: '<script>alert("xss")</script>',
      agent_name: 'Agent & Friends'
    };
    const html = DashboardAgent.buildAgentCard(client, mockVoices);
    
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('Agent &amp; Friends');
  });
});

describe('maskPhone', () => {
  test('masks phone number keeping last 4 digits', () => {
    expect(DashboardAgent.maskPhone('+15559876543')).toBe('•••• 6543');
    expect(DashboardAgent.maskPhone('15559876543')).toBe('•••• 6543');
    expect(DashboardAgent.maskPhone('(555) 987-6543')).toBe('•••• 6543');
  });

  test('handles short numbers', () => {
    expect(DashboardAgent.maskPhone('123')).toBe('•••• 123');
  });

  test('handles empty/null', () => {
    expect(DashboardAgent.maskPhone('')).toBe('');
    expect(DashboardAgent.maskPhone(null)).toBe('');
    expect(DashboardAgent.maskPhone(undefined)).toBe('');
  });
});

describe('getVoiceLabel', () => {
  test('finds voice by id in catalog', () => {
    const voices = [
      { id: 'voice-1', label: 'Sarah' },
      { id: 'voice-2', label: 'John' },
    ];
    expect(DashboardAgent.getVoiceLabel('voice-1', voices)).toBe('Sarah');
    expect(DashboardAgent.getVoiceLabel('voice-2', voices)).toBe('John');
  });

  test('returns dash for missing voice', () => {
    const voices = [{ id: 'voice-1', label: 'Sarah' }];
    expect(DashboardAgent.getVoiceLabel('voice-999', voices)).toBe('—');
    expect(DashboardAgent.getVoiceLabel(null, voices)).toBe('—');
    expect(DashboardAgent.getVoiceLabel('', voices)).toBe('—');
  });

  test('handles empty voice catalog', () => {
    expect(DashboardAgent.getVoiceLabel('voice-1', [])).toBe('—');
    expect(DashboardAgent.getVoiceLabel(null, [])).toBe('—');
  });

  // Regression guard for the dashboard's "Voice: —" bug. This function is
  // correct in isolation — '—' IS the right answer for an empty catalog — but
  // it made the dashboard lie, because renderAgentCard() called it before the
  // catalog was ever fetched: VOICES is only populated by loadVoices(), which
  // used to run solely from the AI Agent settings page. On a fresh login the
  // dashboard renders first, so a client with a real configured voice saw it
  // reported as unset. The fix is at the CALL SITE (renderAgentCard() awaits
  // ensureVoiceCatalog()); these tests pin the contract that makes the
  // difference between "unset" and "not loaded yet" observable.
  test('a configured voice resolves once the catalog IS loaded', () => {
    const voices = [{ id: 'aura-2-thalia-en', label: 'Thalia' }];
    // Same voice_id, catalog absent vs present — the only difference is load
    // order, so the caller must not render until the catalog resolves.
    expect(DashboardAgent.getVoiceLabel('aura-2-thalia-en', [])).toBe('—');
    expect(DashboardAgent.getVoiceLabel('aura-2-thalia-en', voices)).toBe('Thalia');
  });

  test('an unloaded catalog is indistinguishable from an unset voice', () => {
    // Both render '—', which is exactly why the bug was invisible on screen.
    expect(DashboardAgent.getVoiceLabel('aura-2-thalia-en', undefined)).toBe('—');
    expect(DashboardAgent.getVoiceLabel(null, [{ id: 'x', label: 'X' }])).toBe('—');
  });

  test('falls back to voice_name when a catalog entry has no label', () => {
    expect(DashboardAgent.getVoiceLabel('v1', [{ id: 'v1', voice_name: 'Orion' }])).toBe('Orion');
  });

  // The catalog is fetched asynchronously and can be empty, stale, or fail.
  // Prod client records already carry voice_name/voice_label next to
  // voice_id, so resolving from the catalog ALONE reported a configured
  // voice as unset. The client record is now the fallback of record.
  test('falls back to the name stored on the client when the catalog misses', () => {
    const client = { voice_id: 'uMM5TEnpKKgD758knVJO', voice_name: 'Liz', voice_label: 'Liz' };
    // Catalog empty (not yet loaded) — still resolves to the real voice.
    expect(DashboardAgent.getVoiceLabel(client.voice_id, [], client)).toBe('Liz');
    expect(DashboardAgent.getVoiceLabel(client.voice_id, undefined, client)).toBe('Liz');
    // Catalog loaded but the voice was retired from it.
    expect(DashboardAgent.getVoiceLabel(client.voice_id, [{ id: 'other', label: 'Other' }], client)).toBe('Liz');
  });

  test('the catalog still WINS over the stored name when both are present', () => {
    const client = { voice_id: 'v1', voice_name: 'StaleName' };
    expect(DashboardAgent.getVoiceLabel('v1', [{ id: 'v1', label: 'Canonical' }], client)).toBe('Canonical');
  });

  test('a client with genuinely no voice anywhere still reports the dash', () => {
    expect(DashboardAgent.getVoiceLabel(null, [], {})).toBe('—');
    expect(DashboardAgent.getVoiceLabel('v9', [], { voice_name: '   ' })).toBe('—');
  });

  test('the card shows the real voice even when the catalog never loaded', () => {
    // End-to-end on the reported symptom: "Voice: —" for a client whose
    // record names a configured voice.
    const client = {
      twilio_number: '+15559876543', agent_name: 'Jessy', business_name: 'Meridian',
      voice_id: 'uMM5TEnpKKgD758knVJO', voice_name: 'Liz',
    };
    const html = DashboardAgent.buildAgentCard(client, []);
    expect(html).toContain('Liz');
    expect(html).not.toContain('Voice:</span> <b>—');
  });
});

describe('getCalendarLabel', () => {
  test('returns readable labels for explicit providers', () => {
    expect(DashboardAgent.getCalendarLabel('native')).toBe('Native');
    // A third-party provider needs credentials before it can accept events;
    // selected-but-unconnected is the ONLY genuinely unbookable state.
    expect(DashboardAgent.getCalendarLabel('google')).toBe('None');
    expect(DashboardAgent.getCalendarLabel({ calendar_provider: 'google', google_calendar_id: 'cal-1' })).toBe('Google');
    expect(DashboardAgent.getCalendarLabel({ calendar_provider: 'google', google_oauth_connected: true })).toBe('Google');
    expect(DashboardAgent.getCalendarLabel({ calendar_provider: 'square', square_merchant_id: 'm1' })).toBe('Square');
    expect(DashboardAgent.getCalendarLabel({ calendar_provider: 'outlook', outlook_calendar_id: 'o1' })).toBe('Outlook');
  });

  // Regression: the reported "Calendar: None" row. The old implementation
  // returned 'None' for anything that was not literally 'native'/'google', so
  // every client whose record predates the calendar_provider field — which is
  // every legacy account, including the one in the bug report — was told it
  // had no calendar. The backend disagreed: resolveProviderName() defaults to
  // 'native' and hasAnyCalendar() returns true, so those accounts book
  // normally. This mirrors the backend's resolution order.
  test('no provider field → Native (native needs no connection)', () => {
    expect(DashboardAgent.getCalendarLabel('')).toBe('Native');
    expect(DashboardAgent.getCalendarLabel(null)).toBe('Native');
    expect(DashboardAgent.getCalendarLabel(undefined)).toBe('Native');
    expect(DashboardAgent.getCalendarLabel({})).toBe('Native');
    expect(DashboardAgent.getCalendarLabel('unknown')).toBe('Native');
  });

  test('legacy records infer the provider from the connection that exists', () => {
    expect(DashboardAgent.getCalendarLabel({ google_calendar_id: 'cal-1' })).toBe('Google');
    expect(DashboardAgent.getCalendarLabel({ google_oauth_connected: true })).toBe('Google');
    expect(DashboardAgent.getCalendarLabel({ square_merchant_id: 'm1' })).toBe('Square');
    expect(DashboardAgent.getCalendarLabel({ outlook_calendar_id: 'o1' })).toBe('Outlook');
  });
});

describe('formatPhone (agent Active phone — deliberately NOT masked)', () => {
  test('US/CA E.164 renders in full, human-readable form', () => {
    expect(DashboardAgent.formatPhone('+15559876543')).toBe('+1 (555) 987-6543');
    expect(DashboardAgent.formatPhone('15559876543')).toBe('+1 (555) 987-6543');
  });

  test('bare 10-digit US numbers render without a country code', () => {
    expect(DashboardAgent.formatPhone('5559876543')).toBe('(555) 987-6543');
    expect(DashboardAgent.formatPhone('(555) 987-6543')).toBe('(555) 987-6543');
  });

  test('international numbers are passed through, never truncated', () => {
    // Every digit must survive — a mangled or shortened number is worse than
    // an unformatted one.
    const uk = '+442071838750';
    expect(DashboardAgent.formatPhone(uk)).toBe(uk);
    expect(DashboardAgent.formatPhone(uk).replace(/\D/g, '')).toBe(uk.replace(/\D/g, ''));
  });

  test('empty/null degrade to an empty string, not a broken placeholder', () => {
    expect(DashboardAgent.formatPhone('')).toBe('');
    expect(DashboardAgent.formatPhone(null)).toBe('');
    expect(DashboardAgent.formatPhone(undefined)).toBe('');
    expect(DashboardAgent.formatPhone('no-digits-here')).toBe('');
  });

  test('formatPhone and maskPhone stay DIFFERENT functions', () => {
    // Lead masking is intentional privacy design and must not be collapsed
    // into the agent-phone formatter by a future refactor.
    const n = '+15559876543';
    expect(DashboardAgent.maskPhone(n)).toBe('•••• 6543');
    expect(DashboardAgent.formatPhone(n)).not.toBe(DashboardAgent.maskPhone(n));
  });
});