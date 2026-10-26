const express = require('express');
const { query, withTransaction } = require('../db');
const { authenticate, optionalAuth, requireRole, assertTenant } = require('../middleware/auth');
const v = require('../validate');
const cache = require('../services/cache');
const realtime = require('../services/realtime');
const reservation = require('../services/reservation');
const { getEventWithAvailability, listPublishedEvents } = require('../services/events');
const { ah, notFound, conflict, unprocessable, badRequest } = require('../errors');

const router = express.Router();

function seatPrefixes(tiers) {
  const used = new Set();
  return tiers.map((t) => {
    let p = (t.seatPrefix || t.name.replace(/[^A-Za-z0-9]/g, '').slice(0, 3) || 'T').toUpperCase();
    let candidate = p;
    let i = 2;
    while (used.has(candidate)) candidate = `${p}${i++}`;
    used.add(candidate);
    return candidate;
  });
}

async function insertTiers(c, eventId, tiers) {
  const prefixes = seatPrefixes(tiers);
  for (let i = 0; i < tiers.length; i++) {
    const t = tiers[i];
    const { rows: [tier] } = await c.query(
      `INSERT INTO ticket_tiers (event_id, name, price_cents, quantity, seat_prefix, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [eventId, t.name, t.priceCents, t.quantity, prefixes[i], i]
    );
    // One row per seat: A-1 ... A-n
    await c.query(
      `INSERT INTO tickets (event_id, tier_id, seat_label, seat_number)
       SELECT $1, $2, $3 || '-' || n, n FROM generate_series(1, $4) AS n`,
      [eventId, tier.id, prefixes[i], t.quantity]
    );
  }
}

async function loadOwnedEvent(user, eventId, c = { query }) {
  const { rows } = await c.query('SELECT * FROM events WHERE id = $1', [eventId]);
  if (!rows[0]) throw notFound('Event not found');
  assertTenant(user, rows[0].organization_id);
  return rows[0];
}

// ---------- Public ----------

router.get('/', ah(async (_req, res) => {
  const { value, hit } = await listPublishedEvents();
  res.set('X-Cache', hit ? 'HIT' : 'MISS').json({ events: value });
}));

router.get('/:id', optionalAuth, ah(async (req, res) => {
  v.parse(v.uuid, req.params.id);
  const { event, cache: c } = await getEventWithAvailability(req.params.id);
  if (!event) throw notFound('Event not found');
  if (event.status !== 'published') {
    // Drafts are visible only to their own organizer (and admins).
    if (!req.user) throw notFound('Event not found');
    try { assertTenant(req.user, event.organizationId); } catch (_) { throw notFound('Event not found'); }
  }
  res.set('X-Cache', c.details).set('X-Cache-Availability', c.availability);
  res.json({ event: { ...event, salesOpen: event.status === 'published' && new Date(event.salesEndAt) > new Date() } });
}));

/** Full seat map. Not cached: buyers need the live picture when choosing seats. */
router.get('/:id/seats', ah(async (req, res) => {
  v.parse(v.uuid, req.params.id);
  const { rows } = await query(
    `SELECT t.id, t.seat_label AS seat, t.seat_number AS "number", t.tier_id AS "tierId",
            CASE WHEN t.status = 'held' AND t.held_until <= now() THEN 'available' ELSE t.status::text END AS status
       FROM tickets t JOIN ticket_tiers tt ON tt.id = t.tier_id
      WHERE t.event_id = $1
      ORDER BY tt.sort_order, t.seat_number`,
    [req.params.id]
  );
  res.json({ seats: rows });
}));

// Server-sent events for live seat-map updates on a single event page.
router.get('/:id/stream', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  res.write('retry: 3000\n\n');
  const off = realtime.subscribe((msg) => {
    if (msg.eventId === req.params.id) res.write(`data: ${JSON.stringify(msg)}\n\n`);
  });
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => { off(); clearInterval(ping); });
});

// ---------- Attendee: place a 10-minute hold ----------

router.post('/:id/holds', authenticate, requireRole('attendee'), ah(async (req, res) => {
  v.parse(v.uuid, req.params.id);
  const body = v.parse(v.hold, req.body);
  const order = await reservation.createHold({
    userId: req.user.id,
    eventId: req.params.id,
    ticketIds: body.ticketIds,
    items: body.items,
  });
  res.status(201).json({ order });
}));

// ---------- Organizer: manage events ----------

router.post('/', authenticate, requireRole('organizer'), ah(async (req, res) => {
  const body = v.parse(v.createEvent, req.body);
  const eventId = await withTransaction(async (c) => {
    const { rows: [e] } = await c.query(
      `INSERT INTO events (organization_id, created_by, title, description, venue, starts_at, sales_end_at, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [req.user.organization_id, req.user.id, body.title, body.description, body.venue,
        body.startsAt, body.salesEndAt, body.publish ? 'published' : 'draft']
    );
    await insertTiers(c, e.id, body.tiers);
    return e.id;
  });
  await cache.invalidateEvent(eventId);
  const { event } = await getEventWithAvailability(eventId);
  res.status(201).json({ event });
}));

router.patch('/:id', authenticate, requireRole('organizer', 'admin'), ah(async (req, res) => {
  v.parse(v.uuid, req.params.id);
  const body = v.parse(v.updateEvent, req.body);
  await withTransaction(async (c) => {
    const { rows: [e] } = await c.query('SELECT * FROM events WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (!e) throw notFound('Event not found');
    assertTenant(req.user, e.organization_id);
    const startsAt = body.startsAt || e.starts_at;
    const salesEndAt = body.salesEndAt || e.sales_end_at;
    if (new Date(salesEndAt) > new Date(startsAt)) throw badRequest('Sales must end before the event starts');

    if (body.tiers) {
      const { rows: [{ n }] } = await c.query(
        `SELECT count(*)::int AS n FROM orders WHERE event_id = $1`, [e.id]
      );
      if (n > 0) throw conflict('TIERS_LOCKED', 'Ticket tiers cannot be changed after orders exist');
      await c.query('DELETE FROM ticket_tiers WHERE event_id = $1', [e.id]);
      await insertTiers(c, e.id, body.tiers);
    }
    await c.query(
      `UPDATE events SET title = $2, description = $3, venue = $4, starts_at = $5, sales_end_at = $6, updated_at = now()
        WHERE id = $1`,
      [e.id, body.title ?? e.title, body.description ?? e.description, body.venue ?? e.venue, startsAt, salesEndAt]
    );
  });
  await cache.invalidateEvent(req.params.id);
  const { event } = await getEventWithAvailability(req.params.id);
  res.json({ event });
}));

async function setStatus(req, res, status) {
  v.parse(v.uuid, req.params.id);
  const e = await loadOwnedEvent(req.user, req.params.id);
  if (e.status === 'cancelled') throw conflict('EVENT_CANCELLED', 'Cancelled events cannot be changed');
  if (status === 'published' && new Date(e.sales_end_at) <= new Date()) {
    throw unprocessable('SALES_CLOSED', 'Move the sales cut-off into the future before publishing');
  }
  await withTransaction(async (c) => {
    await c.query('UPDATE events SET status = $2, updated_at = now() WHERE id = $1', [e.id, status]);
    if (status === 'cancelled') {
      // Release every open hold for a cancelled event.
      const { rows } = await c.query(
        `UPDATE orders SET status = 'cancelled', updated_at = now()
          WHERE event_id = $1 AND status = 'pending' RETURNING id`, [e.id]
      );
      if (rows.length) await reservation.releaseSeats(c, rows.map((r) => r.id));
    }
  });
  await cache.invalidateEvent(e.id);
  const { event } = await getEventWithAvailability(e.id);
  res.json({ event });
}

router.post('/:id/publish', authenticate, requireRole('organizer', 'admin'), ah((req, res) => setStatus(req, res, 'published')));
router.post('/:id/unpublish', authenticate, requireRole('organizer', 'admin'), ah((req, res) => setStatus(req, res, 'draft')));
router.post('/:id/cancel', authenticate, requireRole('organizer', 'admin'), ah((req, res) => setStatus(req, res, 'cancelled')));

module.exports = router;
module.exports.insertTiers = insertTiers;
