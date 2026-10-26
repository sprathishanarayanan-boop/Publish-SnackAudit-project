const jwt = require('../lib/jwt');
const config = require('../config');
const { query } = require('../db');
const { unauthorized, forbidden } = require('../errors');

function signToken(user) {
  return jwt.sign({ sub: user.id, role: user.role, orgId: user.organization_id }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
  });
}

function extractToken(req) {
  const h = req.headers.authorization || '';
  if (h.startsWith('Bearer ')) return h.slice(7);
  // EventSource cannot set headers, so the SSE endpoint accepts ?token=
  if (req.query && typeof req.query.token === 'string') return req.query.token;
  return null;
}

async function resolveUser(token) {
  let payload;
  try {
    payload = jwt.verify(token, config.jwtSecret);
  } catch (e) {
    const err = unauthorized(e.name === 'TokenExpiredError' ? 'Session expired, please log in again' : 'Invalid token');
    err.code = e.name === 'TokenExpiredError' ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN';
    throw err;
  }
  // Re-read the user so role changes / deletions take effect immediately.
  const { rows } = await query(
    `SELECT u.id, u.email, u.name, u.role, u.organization_id, o.name AS organization_name
       FROM users u LEFT JOIN organizations o ON o.id = u.organization_id WHERE u.id = $1`,
    [payload.sub]
  );
  if (!rows[0]) throw unauthorized('User no longer exists');
  return rows[0];
}

const authenticate = async (req, _res, next) => {
  try {
    const token = extractToken(req);
    if (!token) throw unauthorized();
    req.user = await resolveUser(token);
    next();
  } catch (e) { next(e); }
};

const optionalAuth = async (req, _res, next) => {
  try {
    const token = extractToken(req);
    if (token) req.user = await resolveUser(token);
    next();
  } catch (e) { next(e); }
};

const requireRole = (...roles) => (req, _res, next) => {
  if (!req.user) return next(unauthorized());
  if (!roles.includes(req.user.role)) return next(forbidden(`This action requires role: ${roles.join(' or ')}`));
  next();
};

/** Tenant isolation: organizers may only touch their own organization's data. */
function assertTenant(user, organizationId) {
  if (user.role === 'admin') return;
  if (user.role === 'organizer' && user.organization_id === organizationId) return;
  throw forbidden('This event belongs to another organization');
}

module.exports = { signToken, authenticate, optionalAuth, requireRole, assertTenant };
