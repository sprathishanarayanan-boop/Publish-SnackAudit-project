/**
 * Real-time fan-out for dashboards and seat maps.
 * Publishes over Redis pub/sub so every web instance hears every change;
 * falls back to an in-process emitter when Redis is unavailable.
 */
const { EventEmitter } = require('events');
const { redis, getSubscriber, isReady } = require('../redis');

const CHANNEL = 'tf:events';
const local = new EventEmitter();
local.setMaxListeners(1000);
let subscribed = false;

function ensureSubscribed() {
  if (subscribed) return;
  subscribed = true;
  const sub = getSubscriber();
  sub.subscribe(CHANNEL).catch(() => { subscribed = false; });
  sub.on('message', (_channel, message) => {
    try {
      local.emit('change', JSON.parse(message));
    } catch (_) { /* ignore malformed */ }
  });
}

/** payload: { type, eventId, organizationId, ... } */
async function publish(payload) {
  const msg = { ...payload, at: new Date().toISOString() };
  if (isReady()) {
    try {
      await redis.publish(CHANNEL, JSON.stringify(msg));
      return;
    } catch (_) { /* fall through */ }
  }
  local.emit('change', msg);
}

function subscribe(listener) {
  ensureSubscribed();
  local.on('change', listener);
  return () => local.off('change', listener);
}

module.exports = { publish, subscribe };
