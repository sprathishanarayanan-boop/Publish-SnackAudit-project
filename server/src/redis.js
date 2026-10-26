const Redis = require('ioredis');
const config = require('./config');

function makeClient(name) {
  const client = new Redis(config.redisUrl, {
    maxRetriesPerRequest: 2,
    enableOfflineQueue: false,
    lazyConnect: false,
    retryStrategy: (times) => Math.min(times * 500, 5000),
  });
  client.on('error', (err) => {
    if (!client._lastErr || Date.now() - client._lastErr > 10000) {
      console.warn(`[redis:${name}]`, err.message);
      client._lastErr = Date.now();
    }
  });
  return client;
}

const redis = makeClient('main');
let subscriber = null;

function getSubscriber() {
  if (!subscriber) subscriber = makeClient('sub');
  return subscriber;
}

const isReady = () => redis.status === 'ready';

module.exports = { redis, getSubscriber, isReady };
