/**
 * Minimal Redis distributed lock (SET NX PX + compare-and-delete release).
 * Used for:
 *   - making sure only one instance runs the hold-release sweep at a time
 *   - serialising checkout attempts for the same order (fast-fail double clicks)
 * Correctness of seat allocation does NOT depend on this lock; that is enforced by
 * PostgreSQL row locks. If Redis is unavailable, acquire() reports `degraded` and
 * callers fall back to the database guarantees.
 */
const crypto = require('crypto');
const { redis, isReady } = require('../redis');

const RELEASE_SCRIPT = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('del', KEYS[1])
else
  return 0
end`;

async function acquire(key, ttlMs) {
  if (!isReady()) return { acquired: true, degraded: true, release: async () => {} };
  const token = crypto.randomBytes(16).toString('hex');
  try {
    const ok = await redis.set(`lock:${key}`, token, 'PX', ttlMs, 'NX');
    if (ok !== 'OK') return { acquired: false };
    return {
      acquired: true,
      release: async () => {
        try { await redis.eval(RELEASE_SCRIPT, 1, `lock:${key}`, token); } catch (_) { /* expires anyway */ }
      },
    };
  } catch (e) {
    return { acquired: true, degraded: true, release: async () => {} };
  }
}

async function withLock(key, ttlMs, fn, onBusy) {
  const lock = await acquire(key, ttlMs);
  if (!lock.acquired) return onBusy ? onBusy() : null;
  try {
    return await fn();
  } finally {
    await lock.release();
  }
}

module.exports = { acquire, withLock };
