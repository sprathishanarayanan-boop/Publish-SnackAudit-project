const fs = require('fs');
const path = require('path');
const { pool } = require('./db');

async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  const client = await pool.connect();
  try {
    // Advisory lock so two booting instances don't run DDL at the same time.
    await client.query('SELECT pg_advisory_lock(724001)');
    await client.query(sql);
  } finally {
    await client.query('SELECT pg_advisory_unlock(724001)').catch(() => {});
    client.release();
  }
}

module.exports = { migrate };

if (require.main === module) {
  migrate()
    .then(() => { console.log('Migration complete'); return pool.end(); })
    .catch((e) => { console.error(e); process.exit(1); });
}
