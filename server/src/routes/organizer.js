const express = require('express');
const { query } = require('../db');
const { authenticate, requireRole, assertTenant } = require('../middleware/auth');
const analytics = require('../services/analytics');
const realtime = require('../services/realtime');
const v = require('../validate');
const { ah, notFound } = require('../errors');

const router = express.Router();
router.use(authenticate, requireRole('organizer', 'admin'));

/** Events belonging to the caller's organization (admin: all, or ?organizationId=). */
router.get('/events', ah(async (req, res) => {
  const orgId = req.user.role === 'admin' ? req.query.organizationId || null : req.user.organization_id;
  const data = await analytics.overview({ organizationId: orgId, range: '7d' });
  res.json({ events: data.events });
}));

router.get('/analytics', ah(async (req, res) => {
  let orgId = req.user.role === 'admin' ? req.query.organizationId || null : req.user.organization_id;
  const eventId = req.query.eventId || null;
  if (eventId) {
    v.parse(v.uuid, eventId);
    const { rows } = await query('SELECT organization_id FROM events WHERE id = $1', [eventId]);
    if (!rows[0]) throw notFound('Event not found');
    assertTenant(req.user, rows[0].organization_id);
    if (req.user.role === 'admin') orgId = rows[0].organization_id;
  }
  const range = analytics.RANGES[req.query.range] ? req.query.range : '7d';
  res.json(await analytics.overview({ organizationId: orgId, eventId, range }));
}));

/**
 * Server-sent events: pushes a tiny "something changed" message whenever a hold,
 * payment or expiry touches one of this organization's events. The dashboard
 * re-fetches /analytics on each message, so charts update in real time.
 */
router.get('/analytics/stream', ah(async (req, res) => {
  const orgId = req.user.role === 'admin' ? null : req.user.organization_id;
  const { rows } = await query(
    'SELECT id FROM events WHERE organization_id = COALESCE($1::uuid, organization_id)', [orgId]
  );
  const mine = new Set(rows.map((r) => r.id));
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  res.write('retry: 3000\n\n');
  const off = realtime.subscribe((msg) => {
    if (orgId === null || mine.has(msg.eventId)) res.write(`data: ${JSON.stringify(msg)}\n\n`);
  });
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => { off(); clearInterval(ping); });
}));

/** Attendee list for one event (paid orders only). */
router.get('/events/:id/orders', ah(async (req, res) => {
  v.parse(v.uuid, req.params.id);
  const { rows: [e] } = await query('SELECT organization_id FROM events WHERE id = $1', [req.params.id]);
  if (!e) throw notFound('Event not found');
  assertTenant(req.user, e.organization_id);
  const { rows } = await query(
    `SELECT o.id, o.status, o.total_cents, o.created_at, o.paid_at, u.name AS buyer, u.email,
            (SELECT string_agg(t.seat_label, ', ' ORDER BY t.seat_number) FROM order_items oi
               JOIN tickets t ON t.id = oi.ticket_id WHERE oi.order_id = o.id) AS seats
       FROM orders o JOIN users u ON u.id = o.user_id
      WHERE o.event_id = $1 ORDER BY o.created_at DESC LIMIT 200`,
    [req.params.id]
  );
  res.json({ orders: rows });
}));

module.exports = router;
