const { query } = require('../db');
const cache = require('./cache');
const config = require('../config');

function toEvent(r) {
  return {
    id: r.id,
    organizationId: r.organization_id,
    organizationName: r.organization_name,
    title: r.title,
    description: r.description,
    venue: r.venue,
    startsAt: r.starts_at,
    salesEndAt: r.sales_end_at,
    status: r.status,
    createdAt: r.created_at,
    tiers: r.tiers || [],
  };
}

/** Static event details: title, venue, dates, tier definitions. Cached (5 min default). */
async function loadEventDetails(eventId) {
  const { rows } = await query(
    `SELECT e.*, o.name AS organization_name,
            COALESCE((SELECT json_agg(json_build_object(
                        'id', t.id, 'name', t.name, 'priceCents', t.price_cents,
                        'quantity', t.quantity, 'seatPrefix', t.seat_prefix) ORDER BY t.sort_order)
                        FROM ticket_tiers t WHERE t.event_id = e.id), '[]') AS tiers
       FROM events e JOIN organizations o ON o.id = e.organization_id
      WHERE e.id = $1`,
    [eventId]
  );
  return rows[0] ? toEvent(rows[0]) : null;
}

/** Live-ish seat counts per tier. Very short TTL + explicit invalidation on every change. */
async function loadAvailability(eventId) {
  const { rows } = await query(
    `SELECT tier_id,
            count(*) FILTER (WHERE status = 'available')::int AS available,
            count(*) FILTER (WHERE status = 'held')::int AS held,
            count(*) FILTER (WHERE status = 'sold')::int AS sold
       FROM tickets WHERE event_id = $1 GROUP BY tier_id`,
    [eventId]
  );
  const byTier = {};
  rows.forEach((r) => { byTier[r.tier_id] = { available: r.available, held: r.held, sold: r.sold }; });
  return byTier;
}

async function getEventWithAvailability(eventId) {
  const details = await cache.remember(cache.keys.event(eventId), config.eventCacheTtl, () => loadEventDetails(eventId));
  if (!details.value) return { event: null };
  const avail = await cache.remember(cache.keys.availability(eventId), config.availabilityCacheTtl, () => loadAvailability(eventId));
  const event = {
    ...details.value,
    tiers: details.value.tiers.map((t) => ({ ...t, ...(avail.value[t.id] || { available: 0, held: 0, sold: 0 }) })),
  };
  return { event, cache: { details: details.hit ? 'HIT' : 'MISS', availability: avail.hit ? 'HIT' : 'MISS' } };
}

async function listPublishedEvents() {
  return cache.remember(cache.keys.eventList(), 30, async () => {
    const { rows } = await query(
      `SELECT e.id, e.title, e.venue, e.starts_at, e.sales_end_at, e.status, e.description,
              e.organization_id, o.name AS organization_name,
              min(tt.price_cents)::int AS min_price_cents,
              (SELECT count(*)::int FROM tickets t WHERE t.event_id = e.id AND t.status = 'available') AS available,
              (SELECT count(*)::int FROM tickets t WHERE t.event_id = e.id) AS capacity
         FROM events e
         JOIN organizations o ON o.id = e.organization_id
         LEFT JOIN ticket_tiers tt ON tt.event_id = e.id
        WHERE e.status = 'published' AND e.starts_at > now()
        GROUP BY e.id, o.name
        ORDER BY e.starts_at`
    );
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      description: r.description,
      venue: r.venue,
      startsAt: r.starts_at,
      salesEndAt: r.sales_end_at,
      salesOpen: new Date(r.sales_end_at) > new Date(),
      organizationName: r.organization_name,
      minPriceCents: r.min_price_cents,
      available: r.available,
      capacity: r.capacity,
    }));
  });
}

module.exports = { loadEventDetails, getEventWithAvailability, listPublishedEvents, toEvent };
