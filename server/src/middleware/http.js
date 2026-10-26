/** Small, dependency-free HTTP middleware: security headers, CORS, request log, rate limiting. */
const config = require('../config');
const { redis, isReady } = require('../redis');
const { HttpError } = require('../errors');

function securityHeaders(_req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  if (config.env === 'production') res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  next();
}

function cors(req, res, next) {
  const origin = req.headers.origin;
  const allowed = config.corsOrigin === '*' ? true : config.corsOrigin.split(',').map((s) => s.trim()).includes(origin);
  if (origin && allowed) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Expose-Headers', 'X-Cache, X-Cache-Availability, RateLimit-Remaining');
  }
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
}

function requestLog(req, res, next) {
  if (config.env === 'test' || req.path.endsWith('/stream')) return next();
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    console.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${ms.toFixed(1)}ms`);
  });
  next();
}

/** Fixed-window rate limiter backed by Redis INCR (shared across instances). Fails open. */
function rateLimit({ windowSec = 60, limit = 60, prefix = 'rl' } = {}) {
  return async (req, res, next) => {
    if (!isReady()) return next();
    const window = Math.floor(Date.now() / 1000 / windowSec);
    const key = `${prefix}:${req.ip}:${window}`;
    try {
      const n = await redis.incr(key);
      if (n === 1) await redis.expire(key, windowSec + 1);
      res.setHeader('RateLimit-Limit', String(limit));
      res.setHeader('RateLimit-Remaining', String(Math.max(0, limit - n)));
      if (n > limit) return next(new HttpError(429, 'RATE_LIMITED', 'Too many requests, slow down'));
    } catch (_) { /* fail open */ }
    next();
  };
}

module.exports = { securityHeaders, cors, requestLog, rateLimit };
