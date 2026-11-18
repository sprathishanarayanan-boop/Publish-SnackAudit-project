const fs = require('node:fs/promises');
const path = require('node:path');
const { pool } = require('./db');

async function migrate() {
  const sql = await fs.readFile(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(sql);
  console.log('Database schema is ready.');
}

if (require.main === module) {
  migrate().then(() => pool.end()).catch(async (error) => {
    console.error(error);
    await pool.end();
    process.exitCode = 1;
  });
}

module.exports = { migrate };
