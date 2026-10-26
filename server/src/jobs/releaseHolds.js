/**
 * Background job: release ticket holds older than HOLD_MINUTES (10 by default).
 * Scheduled every HOLD_SWEEP_SECONDS (30 s by default). A Redis lock makes sure only
 * one instance sweeps at a time when the app is scaled horizontally; the SQL
 * itself uses FOR UPDATE SKIP LOCKED so it is safe even without the lock.
 */
const config = require('../config');
const lock = require('../services/lock');
const { releaseExpiredHolds } = require('../services/reservation');

let lastRun = null;

async function runHoldSweep(trigger = 'cron') {
  return lock.withLock('job:release-holds', 60_000, async () => {
    const started = Date.now();
    const result = await releaseExpiredHolds();
    lastRun = { trigger, at: new Date().toISOString(), ms: Date.now() - started, ...result };
    if (result.expiredOrders || result.timedOutPayments) {
      console.log(`[job:release-holds] expired=${result.expiredOrders} seats=${result.releasedSeats} timeouts=${result.timedOutPayments}`);
    }
    return lastRun;
  }, () => ({ skipped: true, reason: 'another instance is running the sweep' }));
}

function startHoldSweeper() {
  const timer = setInterval(() => {
    runHoldSweep().catch((e) => console.error('[job:release-holds] failed:', e.message));
  }, config.holdSweepSeconds * 1000);
  console.log(`[job:release-holds] every ${config.holdSweepSeconds}s, hold length ${config.holdMinutes} min`);
  return { stop: () => clearInterval(timer) };
}

module.exports = { runHoldSweep, startHoldSweeper, getLastRun: () => lastRun };
