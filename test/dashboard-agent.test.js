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
    expect(html).toContain('•••• 6543'); // Masked phone
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

  test('shows None for calendar provider', () => {
    const client = { ...baseClient, calendar_provider: 'none' };
    const html = DashboardAgent.buildAgentCard(client, mockVoices);
    
    expect(html).toContain('None');
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
});

describe('getCalendarLabel', () => {
  test('returns readable labels for providers', () => {
    expect(DashboardAgent.getCalendarLabel('native')).toBe('Native');
    expect(DashboardAgent.getCalendarLabel('google')).toBe('Google');
    expect(DashboardAgent.getCalendarLabel('none')).toBe('None');
  });

  test('returns None for unknown/missing provider', () => {
    expect(DashboardAgent.getCalendarLabel('')).toBe('None');
    expect(DashboardAgent.getCalendarLabel(null)).toBe('None');
    expect(DashboardAgent.getCalendarLabel('unknown')).toBe('None');
  });
});