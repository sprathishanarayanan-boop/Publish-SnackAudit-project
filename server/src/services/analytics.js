const { query } = require('../db');

const RANGES = {
  '24h': { unit: 'hour', span: '23 hours' },
  '7d': { unit: 'day', span: '6 days' },
  '30d': { unit: 'day', span: '29 days' },
};

const pct = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0);

/**
 * Organizer analytics. organizationId === null means "whole platform" (admin).
 * All queries share the same scope: ($1 org or all) AND ($2 event or all).
 */
async function overview({ organizationId = null, eventId = null, range = '7d' }) {
  const r = RANGES[range] || RANGES['7d'];
  const scope = `e.organization_id = COALESCE($1::uuid, e.organization_id) AND e.id = COALESCE($2::uuid, e.id)`;
  const params = [organizationId, eventId];

  const [events, series, tiers, funnel, recent] = await Promise.all([
    query(
      `SELECT e.id, e.title, e.status, e.starts_at, e.sales_end_at,
              COALESCE(t.capacity, 0) AS capacity, COALESCE(t.sold, 0) AS sold, COALESCE(t.held, 0) AS held,
              COALESCE(o.revenue, 0) AS revenue_cents, COALESCE(o.holds, 0) AS holds, COALESCE(o.paid, 0) AS paid_orders
         FROM events e
         LEFT JOIN (SELECT event_id, count(*)::int AS capacity,
                           count(*) FILTER (WHERE status = 'sold')::int AS sold,
                           count(*) FILTER (WHERE status = 'held')::int AS held
                      FROM tickets GROUP BY event_id) t ON t.event_id = e.id
         LEFT JOIN (SELECT event_id, count(*)::int AS holds,
                           count(*) FILTER (WHERE status = 'paid')::int AS paid,
                           COALESCE(sum(total_cents) FILTER (WHERE status = 'paid'), 0)::int AS revenue
                      FROM orders GROUP BY event_id) o ON o.event_id = e.id
        WHERE ${scope}
        ORDER BY e.starts_at`,
      params
    ),
    query(
      `WITH b AS (
         SELECT generate_series(date_trunc('${r.unit}', now() - interval '${r.span}'),
                                date_trunc('${r.unit}', now()), interval '1 ${r.unit}') AS bucket
       ), paid AS (
         SELECT date_trunc('${r.unit}', o.paid_at) AS bucket, o.total_cents,
                (SELECT count(*) FROM order_items oi WHERE oi.order_id = o.id) AS tickets
           FROM orders o JOIN events e ON e.id = o.event_id
          WHERE o.status = 'paid' AND o.paid_at >= now() - interval '${r.span}' - interval '1 ${r.unit}' AND ${scope}
       ), holds AS (
         SELECT date_trunc('${r.unit}', o.created_at) AS bucket
           FROM orders o JOIN events e ON e.id = o.event_id
          WHERE o.created_at >= now() - interval '${r.span}' - interval '1 ${r.unit}' AND ${scope}
       )
       SELECT b.bucket,
              COALESCE((SELECT sum(total_cents) FROM paid p WHERE p.bucket = b.bucket), 0)::int AS revenue_cents,
              COALESCE((SELECT sum(tickets) FROM paid p WHERE p.bucket = b.bucket), 0)::int AS tickets,
              (SELECT count(*) FROM paid p WHERE p.bucket = b.bucket)::int AS paid_orders,
              (SELECT count(*) FROM holds h WHERE h.bucket = b.bucket)::int AS holds
         FROM b ORDER BY b.bucket`,
      params
    ),
    query(
      `SELECT tt.id, tt.name, e.title AS event_title, tt.price_cents, tt.quantity,
              count(t.*) FILTER (WHERE t.status = 'sold')::int AS sold,
              count(t.*) FILTER (WHERE t.status = 'held')::int AS held,
              (count(t.*) FILTER (WHERE t.status = 'sold') * tt.price_cents)::int AS revenue_cents
         FROM ticket_tiers tt JOIN events e ON e.id = tt.event_id
         LEFT JOIN tickets t ON t.tier_id = tt.id
        WHERE ${scope}
        GROUP BY tt.id, e.title, e.starts_at
        ORDER BY e.starts_at, tt.sort_order`,
      params
    ),
    query(
      `SELECT count(*)::int AS holds,
              count(*) FILTER (WHERE EXISTS (SELECT 1 FROM transactions x WHERE x.order_id = o.id))::int AS checkouts,
              count(*) FILTER (WHERE o.status = 'paid')::int AS paid,
              count(*) FILTER (WHERE o.status = 'expired')::int AS expired,
              count(*) FILTER (WHERE o.status = 'cancelled')::int AS cancelled,
              count(*) FILTER (WHERE o.status = 'failed')::int AS failed,
              count(*) FILTER (WHERE o.status IN ('pending','processing'))::int AS active,
              (SELECT count(*) FROM transactions x JOIN orders o2 ON o2.id = x.order_id JOIN events e ON e.id = o2.event_id
                WHERE x.status = 'rejected' AND ${scope})::int AS rejected_payments
         FROM orders o JOIN events e ON e.id = o.event_id
        WHERE ${scope}`,
      params
    ),
    query(
      `SELECT o.id, o.total_cents, o.paid_at, u.name AS buyer, e.title AS event_title,
              (SELECT count(*) FROM order_items oi WHERE oi.order_id = o.id)::int AS tickets
         FROM orders o JOIN events e ON e.id = o.event_id JOIN users u ON u.id = o.user_id
        WHERE o.status = 'paid' AND ${scope}
        ORDER BY o.paid_at DESC LIMIT 8`,
      params
    ),
  ]);

  const f = funnel.rows[0];
  const ev = events.rows;
  const capacity = ev.reduce((s, e) => s + e.capacity, 0);
  const sold = ev.reduce((s, e) => s + e.sold, 0);
  const held = ev.reduce((s, e) => s + e.held, 0);
  const revenue = ev.reduce((s, e) => s + e.revenue_cents, 0);

  return {
    range,
    generatedAt: new Date().toISOString(),
    totals: {
      revenueCents: revenue,
      ticketsSold: sold,
      ticketsHeld: held,
      capacity,
      sellThroughPct: pct(sold, capacity),
      // Of every 10-minute hold created, how many turned into a paid order.
      holdToPaidPct: pct(f.paid, f.holds),
      // Of every checkout started (payment attempted), how many succeeded.
      checkoutToPaidPct: pct(f.paid, f.checkouts),
      avgOrderCents: f.paid ? Math.round(revenue / f.paid) : 0,
    },
    funnel: { ...f },
    series: series.rows.map((s) => ({
      bucket: s.bucket, revenueCents: s.revenue_cents, tickets: s.tickets, paidOrders: s.paid_orders, holds: s.holds,
    })),
    events: ev.map((e) => ({
      id: e.id, title: e.title, status: e.status, startsAt: e.starts_at, salesEndAt: e.sales_end_at,
      capacity: e.capacity, sold: e.sold, held: e.held, revenueCents: e.revenue_cents,
      holds: e.holds, paidOrders: e.paid_orders,
      conversionPct: pct(e.paid_orders, e.holds), sellThroughPct: pct(e.sold, e.capacity),
    })),
    tiers: tiers.rows.map((t) => ({
      id: t.id, name: t.name, eventTitle: t.event_title, priceCents: t.price_cents, quantity: t.quantity,
      sold: t.sold, held: t.held, revenueCents: t.revenue_cents,
    })),
    recentOrders: recent.rows.map((o) => ({
      id: o.id, totalCents: o.total_cents, paidAt: o.paid_at, buyer: o.buyer, eventTitle: o.event_title, tickets: o.tickets,
    })),
  };
}

module.exports = { overview, RANGES };
