const { Pool, types } = require('pg');
const config = require('./config');

// Return BIGINT/NUMERIC aggregates as JS numbers (values here stay well below 2^53).
types.setTypeParser(20, (v) => Number(v));
types.setTypeParser(1700, (v) => Number(v));

const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: config.databaseSsl ? { rejectUnauthorized: false } : undefined,
  max: Number(process.env.PG_POOL_MAX || 15),
});

pool.on('error', (err) => console.error('[pg] idle client error', err.message));

const query = (text, params) => pool.query(text, params);

/**
 * Run fn inside a single transaction. fn receives a dedicated client.
 * Rolls back on any thrown error.
 */
async function withTransaction(fn, { isolation } = {}) {
  const client = await pool.connect();
  try {
    await client.query(isolation ? `BEGIN ISOLATION LEVEL ${isolation}` : 'BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, query, withTransaction };
