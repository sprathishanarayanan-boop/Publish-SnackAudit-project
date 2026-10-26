const config = require('./config');
const app = require('./app');
const { migrate } = require('./migrate');
const { seedIfEmpty } = require('./seed');
const { startHoldSweeper, runHoldSweep } = require('./jobs/releaseHolds');
const { pool } = require('./db');

async function main() {
  await migrate();
  if (config.seedDemo) await seedIfEmpty();

  const server = app.listen(config.port, () => {
    console.log(`TicketForge API listening on :${config.port} (${config.env})`);
  });

  // Run the hold sweeper in the web process by default (works on free hosting tiers).
  // Set RUN_JOBS_IN_WEB=false and run `npm run worker` to split it into its own process.
  let task;
  if (config.runJobsInWeb) {
    task = startHoldSweeper();
    runHoldSweep('startup').catch(() => {});
  }

  const shutdown = () => {
    console.log('Shutting down...');
    task?.stop();
    server.close(() => pool.end().finally(() => process.exit(0)));
    setTimeout(() => process.exit(0), 8000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((e) => {
  console.error('Failed to start:', e);
  process.exit(1);
});
