const express = require('express');
const { query } = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const v = require('../validate');
const config = require('../config');
const { runHoldSweep } = require('../jobs/releaseHolds');
const cache = require('../services/cache');
const { ah, notFound, badRequest, conflict } = require('../errors');

const router = express.Router();
router.use(authenticate, requireRole('admin'));

router.get('/stats', ah(async (_req, res) => {
  const { rows: [s] } = await query(`
    SELECT (SELECT count(*) FROM users)::int AS users,
           (SELECT count(*) FROM users WHERE role = 'organizer')::int AS organizers,
           (SELECT count(*) FROM users WHERE role = 'attendee')::int AS attendees,
           (SELECT count(*) FROM organizations)::int AS organizations,
           (SELECT count(*) FROM events)::int AS events,
           (SELECT count(*) FROM events WHERE status = 'published')::int AS published_events,
           (SELECT count(*) FROM tickets WHERE status = 'sold')::int AS tickets_sold,
           (SELECT count(*) FROM tickets WHERE status = 'held')::int AS tickets_held,
           (SELECT COALESCE(sum(total_cents), 0) FROM orders WHERE status = 'paid')::int AS revenue_cents,
           (SELECT count(*) FROM orders WHERE status = 'pending')::int AS active_holds`);
  res.json({ stats: s, cache: cache.stats });
}));

router.get('/users', ah(async (req, res) => {
  const { rows } = await query(
    `SELECT u.id, u.name, u.email, u.role, u.created_at, o.name AS organization_name, u.organization_id
       FROM users u LEFT JOIN organizations o ON o.id = u.organization_id
      ORDER BY u.created_at DESC LIMIT 500`
  );
  res.json({ users: rows });
}));

router.patch('/users/:id/role', ah(async (req, res) => {
  v.parse(v.uuid, req.params.id);
  const body = v.parse(v.z.object({
    role: v.z.enum(['admin', 'organizer', 'attendee']),
    organizationId: v.uuid.optional(),
  }), req.body);
  if (req.params.id === req.user.id && body.role !== 'admin') throw conflict('SELF_DEMOTION', 'Admins cannot remove their own admin role');
  const { rows: [u] } = await query('SELECT * FROM users WHERE id = $1', [req.params.id]);
  if (!u) throw notFound('User not found');
  const orgId = body.organizationId || u.organization_id;
  if (body.role === 'organizer' && !orgId) throw badRequest('organizationId is required to make someone an organizer');
  const { rows: [updated] } = await query(
    `UPDATE users SET role = $2, organization_id = $3 WHERE id = $1
     RETURNING id, name, email, role, organization_id`,
    [u.id, body.role, orgId]
  );
  res.json({ user: updated });
}));

router.get('/organizations', ah(async (_req, res) => {
  const { rows } = await query(
    `SELECT o.id, o.name, o.slug, o.created_at,
            (SELECT count(*) FROM users u WHERE u.organization_id = o.id)::int AS members,
            (SELECT count(*) FROM events e WHERE e.organization_id = o.id)::int AS events,
            (SELECT COALESCE(sum(ord.total_cents), 0) FROM orders ord JOIN events e ON e.id = ord.event_id
              WHERE e.organization_id = o.id AND ord.status = 'paid')::int AS revenue_cents
       FROM organizations o ORDER BY o.created_at`
  );
  res.json({ organizations: rows });
}));

router.get('/events', ah(async (_req, res) => {
  const { rows } = await query(
    `SELECT e.id, e.title, e.status, e.starts_at, e.sales_end_at, o.name AS organization_name
       FROM events e JOIN organizations o ON o.id = e.organization_id ORDER BY e.starts_at`
  );
  res.json({ events: rows });
}));

/** Run the expired-hold sweeper immediately (it also runs on a schedule). */
router.post('/jobs/release-holds', ah(async (_req, res) => {
  const result = await runHoldSweep('manual');
  res.json({ result });
}));

/**
 * TEST HOOK: fast-forward a hold so it is already expired, to exercise the
 * "expired session" path without waiting 10 minutes. Disable with ENABLE_TEST_ROUTES=false.
 */
router.post('/orders/:id/force-expire', ah(async (req, res) => {
  if (!config.enableTestRoutes) throw notFound();
  v.parse(v.uuid, req.params.id);
  const { rows } = await query(
    `UPDATE orders SET expires_at = now() - interval '1 second'
      WHERE id = $1 AND status IN ('pending') RETURNING id, status, expires_at`,
    [req.params.id]
  );
  if (!rows[0]) throw notFound('No pending order with that id');
  await query(`UPDATE tickets SET held_until = now() - interval '1 second' WHERE order_id = $1 AND status = 'held'`, [req.params.id]);
  res.json({ order: rows[0] });
}));

module.exports = router;
