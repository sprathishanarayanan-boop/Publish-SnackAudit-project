const express = require('express');
const { hashPassword, verifyPassword } = require('../lib/password');
const { query, withTransaction } = require('../db');
const { signToken, authenticate } = require('../middleware/auth');
const v = require('../validate');
const { ah, conflict, unauthorized } = require('../errors');

const router = express.Router();

const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 40) || 'org';

const publicUser = (u) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  role: u.role,
  organizationId: u.organization_id,
  organizationName: u.organization_name || null,
});

router.post('/register', ah(async (req, res) => {
  const body = v.parse(v.register, req.body);
  const hash = await hashPassword(body.password);
  const user = await withTransaction(async (c) => {
    const exists = await c.query('SELECT 1 FROM users WHERE email = $1', [body.email]);
    if (exists.rowCount) throw conflict('EMAIL_TAKEN', 'An account with this email already exists');
    let orgId = null;
    let orgName = null;
    if (body.role === 'organizer') {
      const base = slugify(body.organizationName);
      const { rows: [org] } = await c.query(
        `INSERT INTO organizations (name, slug)
         VALUES ($1, $2 || CASE WHEN EXISTS (SELECT 1 FROM organizations WHERE slug = $2)
                               THEN '-' || substr(md5(random()::text), 1, 5) ELSE '' END)
         RETURNING id, name`,
        [body.organizationName, base]
      );
      orgId = org.id;
      orgName = org.name;
    }
    const { rows: [u] } = await c.query(
      `INSERT INTO users (email, password_hash, name, role, organization_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [body.email, hash, body.name, body.role, orgId]
    );
    return { ...u, organization_name: orgName };
  });
  res.status(201).json({ token: signToken(user), user: publicUser(user) });
}));

router.post('/login', ah(async (req, res) => {
  const body = v.parse(v.login, req.body);
  const { rows } = await query(
    `SELECT u.*, o.name AS organization_name FROM users u
       LEFT JOIN organizations o ON o.id = u.organization_id WHERE u.email = $1`,
    [body.email]
  );
  const user = rows[0];
  if (!user || !(await verifyPassword(body.password, user.password_hash))) {
    throw unauthorized('Incorrect email or password');
  }
  res.json({ token: signToken(user), user: publicUser(user) });
}));

router.get('/me', authenticate, (req, res) => res.json({ user: publicUser(req.user) }));

module.exports = router;
module.exports.publicUser = publicUser;
