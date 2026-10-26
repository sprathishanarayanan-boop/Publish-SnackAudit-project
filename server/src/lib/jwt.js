/** Minimal HS256 JSON Web Tokens (RFC 7519) using Node's crypto. */
const crypto = require('crypto');

const b64url = (buf) => Buffer.from(buf).toString('base64url');
const fromB64url = (s) => Buffer.from(s, 'base64url').toString('utf8');

function parseDuration(v) {
  if (typeof v === 'number') return v;
  const m = /^(\d+)\s*([smhd])$/.exec(String(v));
  if (!m) throw new Error(`Bad duration: ${v}`);
  return Number(m[1]) * { s: 1, m: 60, h: 3600, d: 86400 }[m[2]];
}

class JwtError extends Error {
  constructor(name, message) { super(message); this.name = name; }
}

function sign(payload, secret, { expiresIn } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat: now, ...(expiresIn ? { exp: now + parseDuration(expiresIn) } : {}) };
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const data = `${head}.${b64url(JSON.stringify(body))}`;
  const sig = crypto.createHmac('sha256', secret).update(data).digest('base64url');
  return `${data}.${sig}`;
}

function verify(token, secret) {
  const parts = String(token).split('.');
  if (parts.length !== 3) throw new JwtError('JsonWebTokenError', 'jwt malformed');
  const [h, p, s] = parts;
  let header;
  try { header = JSON.parse(fromB64url(h)); } catch (_) { throw new JwtError('JsonWebTokenError', 'jwt malformed'); }
  if (header.alg !== 'HS256') throw new JwtError('JsonWebTokenError', 'unsupported alg');
  const expected = Buffer.from(crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url'));
  const given = Buffer.from(s);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) {
    throw new JwtError('JsonWebTokenError', 'invalid signature');
  }
  let payload;
  try { payload = JSON.parse(fromB64url(p)); } catch (_) { throw new JwtError('JsonWebTokenError', 'jwt malformed'); }
  if (payload.exp && Math.floor(Date.now() / 1000) >= payload.exp) throw new JwtError('TokenExpiredError', 'jwt expired');
  return payload;
}

module.exports = { sign, verify, parseDuration };
