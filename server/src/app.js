const path = require('path');
const fs = require('fs');
const express = require('express');
const { securityHeaders, cors, requestLog, rateLimit } = require('./middleware/http');
const config = require('./config');
const { query } = require('./db');
const { isReady } = require('./redis');
const cache = require('./services/cache');
const { getLastRun } = require('./jobs/releaseHolds');
const { HttpError } = require('./errors');

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(securityHeaders);
app.use(cors);
app.use(requestLog);
// Keep the raw body: the payment webhook verifies an HMAC over the exact bytes.
app.use(express.json({ limit: '200kb', verify: (req, _res, buf) => { req.rawBody = buf.toString('utf8'); } }));

app.use('/api/auth', rateLimit({ windowSec: 60, limit: config.authRateLimitPerMin, prefix: 'rl:auth' }));

app.get('/api/health', async (_req, res) => {
  let db = 'down';
  try { await query('SELECT 1'); db = 'up'; } catch (_) { /* down */ }
  res.status(db === 'up' ? 200 : 503).json({
    status: db === 'up' ? 'ok' : 'degraded',
    db,
    redis: isReady() ? 'up' : 'down',
    holdMinutes: config.holdMinutes,
    cache: cache.stats,
    lastHoldSweep: getLastRun(),
    time: new Date().toISOString(),
  });
});

app.use('/api/auth', require('./routes/auth'));
app.use('/api/events', require('./routes/events'));
app.use('/api/orders', require('./routes/orders'));
app.use('/api/organizer', require('./routes/organizer'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/payments', require('./routes/payments'));
app.use('/api/mock-gateway', require('./routes/gateway'));

app.use('/api', (_req, _res, next) => next(new HttpError(404, 'NOT_FOUND', 'Route not found')));

// Serve the built React app (client/dist) for everything else.
const dist = path.join(__dirname, '..', '..', 'client', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist, { maxAge: '1h', index: false }));
  app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  if (err.type === 'entity.parse.failed') err = new HttpError(400, 'BAD_JSON', 'Malformed JSON body');
  // Map relevant Postgres errors to clean API errors.
  if (err.code === '22P02') err = new HttpError(400, 'BAD_REQUEST', 'Invalid identifier');
  if (err.code === '23505') err = new HttpError(409, 'DUPLICATE', 'Duplicate value');
  if (err.code === '40P01') err = new HttpError(409, 'RETRY', 'Concurrent update detected, please retry');
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({
    error: {
      code: err instanceof HttpError ? err.code : 'INTERNAL',
      message: status >= 500 && !(err instanceof HttpError) ? 'Internal server error' : err.message,
      ...(err.details ? { details: err.details } : {}),
    },
  });
});

module.exports = app;
