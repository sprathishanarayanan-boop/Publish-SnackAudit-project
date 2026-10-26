/**
 * Read-through cache for active event details. Redis is an optimisation, never a
 * source of truth: if it is down, every call falls through to PostgreSQL.
 */
const { redis, isReady } = require('../redis');

const stats = { hits: 0, misses: 0, errors: 0 };

const keys = {
  event: (id) => `cache:event:${id}`,
  availability: (id) => `cache:event:${id}:availability`,
  eventList: () => 'cache:events:published',
};

async function getJson(key) {
  if (!isReady()) return null;
  try {
    const raw = await redis.get(key);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    stats.errors++;
    return null;
  }
}

async function setJson(key, value, ttlSeconds) {
  if (!isReady()) return;
  try {
    await redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  } catch (e) {
    stats.errors++;
  }
}

/** Returns { value, hit } */
async function remember(key, ttlSeconds, loader) {
  const cached = await getJson(key);
  if (cached !== null) {
    stats.hits++;
    return { value: cached, hit: true };
  }
  stats.misses++;
  const value = await loader();
  if (value !== null && value !== undefined) await setJson(key, value, ttlSeconds);
  return { value, hit: false };
}

async function del(...keyList) {
  if (!isReady() || keyList.length === 0) return;
  try { await redis.del(...keyList); } catch (e) { stats.errors++; }
}

/** Event metadata changed (edit, publish, tier change). */
const invalidateEvent = (eventId) => del(keys.event(eventId), keys.availability(eventId), keys.eventList());

/** Only seat counts changed (reserve, release, sale). */
const invalidateAvailability = (eventId) => del(keys.availability(eventId), keys.eventList());

module.exports = { keys, remember, del, invalidateEvent, invalidateAvailability, stats };
