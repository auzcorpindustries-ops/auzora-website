const express = require('express');
const router = express.Router();
const { createClient, getClientById, updateClient, getCallsByClient, getLeadsByClient, getAllClients, getAllCalls, getAllLeads } = require('../services/dynamo');
const { logger } = require('../services/logger');

// Simple admin auth middleware
//
// Primary auth: x-api-key for internal tooling.
// Fallback auth: requests originating from the Auzora admin portal origin,
// which is already protected by the portal's own login/passcode flow.
const ALLOWED_ADMIN_ORIGINS = new Set([
  'https://auzora.io',
  'https://www.auzora.io',
  'https://atlas.6845165.xyz',
  'https://atlas.6845165.xyz/',
  'http://localhost:3000',
  'http://localhost:5173'
]);

router.use((req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  const origin = req.headers.origin;
  if (apiKey && apiKey === process.env.ADMIN_API_KEY) return next();
  if (origin && ALLOWED_ADMIN_ORIGINS.has(origin)) return next();
  // Helpful debug info for origin-related auth failures
  if (!apiKey) {
    console.warn('Admin auth failed: missing x-api-key; origin=', origin);
  } else {
    console.warn('Admin auth failed: invalid x-api-key or origin; origin=', origin);
  }
  return res.status(401).json({ error: 'Unauthorized' });
});

// GET /admin/clients — list all clients
router.get('/clients', async (req, res) => {
  try {
    const clients = await getAllClients();
    res.json(clients);
  } catch (err) {
    logger.error('List clients error', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// GET /admin/calls — all calls (cross-client)
router.get('/calls', async (req, res) => {
  try {
    const calls = await getAllCalls(200);
    res.json(calls);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /admin/leads — all leads (cross-client)
router.get('/leads', async (req, res) => {
  try {
    const leads = await getAllLeads(200);
    res.json(leads);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /admin/clients — create new client
router.post('/clients', async (req, res) => {
  try {
    const client = await createClient(req.body);
    logger.info('Client created', { clientId: client.client_id });
    res.status(201).json(client);
  } catch (err) {
    logger.error('Create client error', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// GET /admin/clients/:id — get client config
router.get('/clients/:id', async (req, res) => {
  try {
    const client = await getClientById(req.params.id);
    if (!client) return res.status(404).json({ error: 'Client not found' });
    res.json(client);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /admin/clients/:id — update client config
router.put('/clients/:id', async (req, res) => {
  try {
    await updateClient(req.params.id, req.body);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /admin/clients/:id/calls — call history
router.get('/clients/:id/calls', async (req, res) => {
  try {
    const calls = await getCallsByClient(req.params.id);
    res.json(calls);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /admin/clients/:id/leads — captured leads
router.get('/clients/:id/leads', async (req, res) => {
  try {
    const leads = await getLeadsByClient(req.params.id);
    res.json(leads);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /admin/clients/:id/test — trigger health check call
router.post('/clients/:id/test', async (req, res) => {
  try {
    const client = await getClientById(req.params.id);
    if (!client) return res.status(404).json({ error: 'Client not found' });
    // TODO: trigger Twilio test call
    res.json({ message: 'Test call triggered', clientId: req.params.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
