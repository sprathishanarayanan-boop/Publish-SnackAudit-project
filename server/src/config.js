const env = process.env;

const port = Number(env.PORT || 4000);

module.exports = {
  env: env.NODE_ENV || 'development',
  port,
  databaseUrl: env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/tickets',
  databaseSsl: env.DATABASE_SSL === 'true',
  redisUrl: env.REDIS_URL || 'redis://localhost:6379',
  jwtSecret: env.JWT_SECRET || 'dev-only-change-me',
  jwtExpiresIn: env.JWT_EXPIRES_IN || '12h',
  // Reservation hold length. The spec says 10 minutes; overridable for demos/tests.
  holdMinutes: Number(env.HOLD_MINUTES || 10),
  maxSeatsPerOrder: Number(env.MAX_SEATS_PER_ORDER || 10),
  authRateLimitPerMin: Number(env.AUTH_RATE_LIMIT_PER_MIN || 120),
  // How often the background job sweeps for expired holds.
  holdSweepSeconds: Number(env.HOLD_SWEEP_SECONDS || 30),
  runJobsInWeb: env.RUN_JOBS_IN_WEB !== 'false',
  eventCacheTtl: Number(env.EVENT_CACHE_TTL || 300),
  availabilityCacheTtl: Number(env.AVAILABILITY_CACHE_TTL || 5),
  // Mock payment gateway
  gatewaySecret: env.GATEWAY_WEBHOOK_SECRET || 'dev-gateway-secret',
  gatewayMinDelayMs: Number(env.GATEWAY_MIN_DELAY_MS || 1500),
  gatewayMaxDelayMs: Number(env.GATEWAY_MAX_DELAY_MS || 3500),
  selfUrl: env.SELF_URL || `http://127.0.0.1:${port}`,
  seedDemo: env.SEED_DEMO !== 'false',
  enableTestRoutes: env.ENABLE_TEST_ROUTES !== 'false',
  corsOrigin: env.CORS_ORIGIN || '*',
};
