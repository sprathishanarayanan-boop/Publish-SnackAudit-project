#!/usr/bin/env node
/**
 * Zero-dependency runner for the Postman collection (a small newman stand-in).
 * Supports the pm.* API subset this collection uses: collectionVariables,
 * environment, test, expect (chai-style), response, sendRequest, setTimeout.
 *
 *   node scripts/run-postman.js postman/TicketForge.postman_collection.json [--base-url https://...]
 *
 * You can equally run the collection with Postman's Collection Runner or with
 * `npx newman run postman/TicketForge.postman_collection.json --env-var baseUrl=...`.
 */
const fs = require('fs');
const util = require('util');

const file = process.argv[2] || 'postman/TicketForge.postman_collection.json';
const argBase = process.argv.indexOf('--base-url');
const collection = JSON.parse(fs.readFileSync(file, 'utf8'));
const vars = Object.fromEntries((collection.variable || []).map((v) => [v.key, v.value]));
if (argBase > 0) vars.baseUrl = process.argv[argBase + 1];
if (process.env.BASE_URL) vars.baseUrl = process.env.BASE_URL;
vars.baseUrl = vars.baseUrl.replace(/\/$/, '');

const subst = (s) => String(s)
  .replace(/{{\$timestamp}}/g, () => String(Math.floor(Date.now() / 1000)))
  .replace(/{{\$guid}}/g, () => require('crypto').randomUUID())
  .replace(/{{(\w+)}}/g, (m, k) => (k in vars ? vars[k] : m));

// ---------- mini chai ----------
class AssertionError extends Error {}
function expect(actual) {
  let negate = false;
  const show = (v) => util.inspect(v, { depth: 2, breakLength: 120 });
  const assert = (ok, msg) => { if (negate ? ok : !ok) throw new AssertionError(`expected ${show(actual)} ${negate ? 'not ' : ''}${msg}`); return api; };
  const deepEq = (a, b) => util.isDeepStrictEqual(a, b);
  const api = {
    equal: (v) => assert(actual === v, `to equal ${show(v)}`),
    eql: (v) => assert(deepEq(actual, v), `to deeply equal ${show(v)}`),
    oneOf: (list) => assert(list.includes(actual), `to be one of ${show(list)}`),
    include: (v) => assert(actual != null && (typeof actual === 'string' ? actual.includes(v) : Array.isArray(actual) ? actual.some((x) => deepEq(x, v)) : false), `to include ${show(v)}`),
    above: (n) => assert(actual > n, `to be above ${n}`),
    below: (n) => assert(actual < n, `to be below ${n}`),
    least: (n) => assert(actual >= n, `to be at least ${n}`),
    most: (n) => assert(actual <= n, `to be at most ${n}`),
    lengthOf: (n) => assert(actual != null && actual.length === n, `to have length ${n} (got ${actual && actual.length})`),
    property: (k) => assert(actual != null && Object.prototype.hasOwnProperty.call(actual, k), `to have property ${k}`),
    a: (t) => assert(t === 'array' ? Array.isArray(actual) : typeof actual === t, `to be a ${t}`),
  };
  api.contain = api.include; api.an = api.a;
  for (const w of ['to', 'be', 'been', 'is', 'that', 'which', 'and', 'has', 'have', 'with', 'at', 'of', 'does']) {
    Object.defineProperty(api, w, { get: () => api });
  }
  Object.defineProperty(api, 'not', { get: () => { negate = !negate; return api; } });
  Object.defineProperty(api, 'true', { get: () => assert(actual === true, 'to be true') });
  Object.defineProperty(api, 'false', { get: () => assert(actual === false, 'to be false') });
  Object.defineProperty(api, 'ok', { get: () => assert(!!actual, 'to be truthy') });
  return api;
}

// ---------- sandbox ----------
async function runScript(code, response, results) {
  if (!code) return;
  let pending = 0;
  const errors = [];
  const track = (p) => { pending++; return p.finally(() => { pending--; }); };
  const store = {
    get: (k) => vars[k],
    set: (k, v) => { vars[k] = typeof v === 'string' ? v : String(v); },
    unset: (k) => { delete vars[k]; },
    has: (k) => k in vars,
  };
  const pm = {
    collectionVariables: store,
    environment: store,
    globals: store,
    variables: { get: (k) => vars[k], set: store.set },
    expect,
    test: (name, fn) => {
      try { fn(); results.push({ name, ok: true }); } catch (e) { results.push({ name, ok: false, error: e.message }); }
    },
    response,
    sendRequest: (opts, cb) => {
      const o = typeof opts === 'string' ? { url: opts, method: 'GET' } : opts;
      const headers = {};
      (Array.isArray(o.header) ? o.header : Object.entries(o.header || {}).map(([key, value]) => ({ key, value })))
        .forEach((h) => { headers[h.key] = h.value; });
      track(fetch(o.url, { method: o.method || 'GET', headers, body: o.body ? o.body.raw : undefined })
        .then(async (r) => {
          const text = await r.text();
          const res = { code: r.status, status: r.statusText, text: () => text, json: () => JSON.parse(text), headers: { get: (h) => r.headers.get(h) } };
          cb(null, res);
        })
        .catch((e) => cb(e)));
    },
  };
  const sandboxTimeout = (fn, ms) => track(new Promise((ok) => setTimeout(() => { try { fn(); } finally { ok(); } }, ms)));
  const onRejection = (e) => errors.push(e);
  process.on('unhandledRejection', onRejection);
  try {
    // eslint-disable-next-line no-new-func
    new Function('pm', 'setTimeout', 'console', code)(pm, sandboxTimeout, console);
  } catch (e) {
    errors.push(e);
  }
  const deadline = Date.now() + 60_000;
  while (pending > 0 && Date.now() < deadline) await new Promise((ok) => setImmediate(ok));
  await new Promise((ok) => setTimeout(ok, 5));
  process.off('unhandledRejection', onRejection);
  errors.forEach((e) => results.push({ name: 'Script error', ok: false, error: e.message }));
}

async function runItem(item, prefix) {
  const results = [];
  const script = (type) => (item.event || []).filter((e) => e.listen === type).map((e) => e.script.exec.join('\n')).join('\n');
  await runScript(script('prerequest'), null, results);

  const r = item.request;
  const headers = {};
  (r.header || []).forEach((h) => { headers[h.key] = subst(h.value); });
  const url = subst(r.url.raw);
  const started = Date.now();
  const res = await fetch(url, { method: r.method, headers, body: r.body?.raw ? subst(r.body.raw) : undefined });
  const text = await res.text();
  const response = {
    code: res.status,
    status: res.statusText,
    responseTime: Date.now() - started,
    text: () => text,
    json: () => JSON.parse(text),
    headers: { get: (h) => res.headers.get(h), has: (h) => res.headers.has(h) },
  };
  await runScript(script('test'), response, results);

  const failed = results.filter((t) => !t.ok);
  console.log(`${failed.length ? '✗' : '✓'} ${prefix}${item.name}  [${r.method} ${res.status}, ${response.responseTime}ms]`);
  results.forEach((t) => console.log(`    ${t.ok ? '✓' : '✗'} ${t.name}${t.ok ? '' : `\n        ${t.error}`}`));
  return results;
}

(async () => {
  console.log(`Running "${collection.info.name}" against ${vars.baseUrl}\n`);
  let total = 0;
  let failed = 0;
  let requests = 0;
  const walk = async (items, depth) => {
    for (const it of items) {
      if (it.item) { console.log(`\n${it.name}`); await walk(it.item, depth + 1); continue; }
      const res = await runItem(it, '  ');
      requests++;
      total += res.length;
      failed += res.filter((t) => !t.ok).length;
    }
  };
  await walk(collection.item, 0);
  console.log(`\n${requests} requests, ${total} assertions, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
