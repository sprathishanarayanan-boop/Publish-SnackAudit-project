/**
 * Standalone background worker (optional). Use when the web service runs with
 * RUN_JOBS_IN_WEB=false, e.g. as a Render "Background Worker".
 */
const { migrate } = require('./migrate');
const { startHoldSweeper } = require('./jobs/releaseHolds');

migrate()
  .then(() => {
    startHoldSweeper();
    console.log('Worker running');
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
