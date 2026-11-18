const crypto = require('node:crypto');
const { promisify } = require('node:util');
const config=require('./config');
const scrypt = promisify(crypto.scrypt);
const { pool } = require('./db');

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, 64);
  return `${salt.toString('hex')}:${key.toString('hex')}`;
}

async function verifyPassword(password, stored) {
  const [saltHex, keyHex] = stored.split(':');
  if (!saltHex || !keyHex) return false;
  const expected = Buffer.from(keyHex, 'hex');
  const actual = await scrypt(password, Buffer.from(saltHex, 'hex'), expected.length);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function sign(userId, expiresAt) {
  const body = `${userId}.${expiresAt}`;
  const signature = crypto.createHmac('sha256', config.jwtSecret).update(body).digest('hex');
  return `${body}.${signature}`;
}

function tokenUser(token) {
  const [userId, expiry, signature, extra] = String(token || '').split('.');
  if (!userId || !expiry || !signature || extra) return null;
  const body = `${userId}.${expiry}`;
  const expected = crypto.createHmac('sha256', config.jwtSecret).update(body).digest();
  let actual;
  try { actual = Buffer.from(signature, 'hex'); } catch { return null; }
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;
  if (!/^\d+$/.test(expiry) || Number(expiry) <= Date.now()) return null;
  return userId;
}

async function authenticate(req, res, next) {
  const header = req.get('authorization') || '';
  const id = header.startsWith('Bearer ') ? tokenUser(header.slice(7)) : null;
  if (!id) return res.status(401).json({ error: 'Please sign in again.' });
  try {
    const { rows } = await pool.query('SELECT id,email,name,role FROM users WHERE id=$1', [id]);
    if (!rows[0]) return res.status(401).json({ error: 'Account no longer exists.' });
    req.user = rows[0];
    next();
  } catch (error) { next(error); }
}

function allow(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user?.role)) return res.status(403).json({ error: 'You do not have permission for this action.' });
    next();
  };
}

module.exports = { hashPassword, verifyPassword, sign, authenticate, allow };
