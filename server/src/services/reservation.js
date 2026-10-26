/**
 * Reservation engine.
 *
 * Concurrency model
 * -----------------
 * Every seat is a row in `tickets`. A hold is created inside one PostgreSQL
 * transaction that takes row-level locks on the exact seats it wants:
 *
 *   - Specific seats  -> SELECT ... WHERE id = ANY($ids) ORDER BY id FOR UPDATE
 *       Two buyers racing for seat A-1 serialise on that row lock. The loser wakes
 *       up after the winner commits, re-reads the row (READ COMMITTED re-check),
 *       sees status='held', and gets 409 SEATS_UNAVAILABLE. Ordering by id keeps
 *       lock acquisition order identical across transactions, so no deadlocks.
 *
 *   - Best available  -> SELECT ... WHERE status='available' LIMIT n FOR UPDATE SKIP LOCKED
 *       Concurrent buyers of General Admission skip rows someone else is locking and
 *       grab the next free ones instead of queueing behind each other.
 *
 * A per-(user,event) advisory lock stops one user firing parallel requests to
 * create several holds and hoard inventory.
 */
const config = require('../config');
const { withTransaction, query } = require('../db');
const cache = require('./cache');
const realtime = require('./realtime');
const { badRequest, notFound, conflict, unprocessable } = require('../errors');

async function loadSellableEvent(client, eventId) {
  const { rows } = await client.query(
    `SELECT id, organization_id, status, sales_end_at, starts_at, title
       FROM events WHERE id = $1 FOR SHARE`,
    [eventId]
  );
  const event = rows[0];
  if (!event) throw notFound('Event not found');
  if (event.status !== 'published') throw unprocessable('EVENT_NOT_ON_SALE', 'This event is not open for sales');
  if (new Date(event.sales_end_at) <= new Date()) {
    throw unprocessable('SALES_CLOSED', 'Ticket sales for this event have ended');
  }
  return event;
}

/**
 * @param {{userId:string, eventId:string, ticketIds?:string[], items?:{tierId:string, quantity:number}[]}} input
 */
async function createHold({ userId, eventId, ticketIds, items }) {
  const wanted = ticketIds?.length
    ? ticketIds.length
    : (items || []).reduce((n, i) => n + i.quantity, 0);
  if (wanted === 0) throw badRequest('Choose at least one seat or ticket');
  if (wanted > config.maxSeatsPerOrder) {
    throw unprocessable('TOO_MANY_TICKETS', `You can hold at most ${config.maxSeatsPerOrder} tickets per order`);
  }

  const result = await withTransaction(async (c) => {
    const event = await loadSellableEvent(c, eventId);

    // Serialise this user's requests for this event (released at COMMIT/ROLLBACK).
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`hold:${userId}:${eventId}`]);
    const existing = await c.query(
      `SELECT id, expires_at FROM orders
        WHERE user_id = $1 AND event_id = $2 AND status IN ('pending','processing') AND expires_at > now()`,
      [userId, eventId]
    );
    if (existing.rows.length) {
      throw conflict('ACTIVE_HOLD_EXISTS', 'You already have an active hold for this event. Complete or cancel it first.', {
        orderId: existing.rows[0].id,
        expiresAt: existing.rows[0].expires_at,
      });
    }

    let seats;
    if (ticketIds?.length) {
      const unique = [...new Set(ticketIds)];
      if (unique.length !== ticketIds.length) throw badRequest('Duplicate seats in request');
      const { rows } = await c.query(
        `SELECT t.id, t.tier_id, t.seat_label, t.status, tt.price_cents
           FROM tickets t JOIN ticket_tiers tt ON tt.id = t.tier_id
          WHERE t.event_id = $1 AND t.id = ANY($2::uuid[])
          ORDER BY t.id
          FOR UPDATE OF t`,
        [eventId, unique]
      );
      if (rows.length !== unique.length) throw badRequest('One or more seats do not belong to this event');
      const taken = rows.filter((r) => r.status !== 'available');
      if (taken.length) {
        throw conflict('SEATS_UNAVAILABLE', 'Some of the selected seats were just taken by another buyer', {
          seats: taken.map((r) => r.seat_label),
        });
      }
      seats = rows;
    } else {
      seats = [];
      for (const item of items) {
        const { rows } = await c.query(
          `SELECT t.id, t.tier_id, t.seat_label, t.status, tt.price_cents
             FROM tickets t JOIN ticket_tiers tt ON tt.id = t.tier_id
            WHERE t.event_id = $1 AND t.tier_id = $2 AND t.status = 'available'
            ORDER BY t.seat_number
            LIMIT $3
            FOR UPDATE OF t SKIP LOCKED`,
          [eventId, item.tierId, item.quantity]
        );
        if (rows.length < item.quantity) {
          throw conflict('INSUFFICIENT_INVENTORY', 'Not enough tickets left in this tier', {
            tierId: item.tierId,
            requested: item.quantity,
            available: rows.length,
          });
        }
        seats.push(...rows);
      }
    }

    const total = seats.reduce((sum, s) => sum + s.price_cents, 0);
    const { rows: [order] } = await c.query(
      `INSERT INTO orders (user_id, event_id, status, total_cents, expires_at)
       VALUES ($1, $2, 'pending', $3, now() + make_interval(mins => $4))
       RETURNING *`,
      [userId, eventId, total, config.holdMinutes]
    );
    const ids = seats.map((s) => s.id);
    const upd = await c.query(
      `UPDATE tickets SET status = 'held', order_id = $1, held_until = $2, updated_at = now()
        WHERE id = ANY($3::uuid[]) AND status = 'available'`,
      [order.id, order.expires_at, ids]
    );
    // Defence in depth: the locks above make this impossible, but never sell a seat twice.
    if (upd.rowCount !== ids.length) throw conflict('SEATS_UNAVAILABLE', 'Seat state changed, please retry');

    await c.query(
      `INSERT INTO order_items (order_id, ticket_id, tier_id, price_cents)
       SELECT $1, s.id, s.tier_id, s.price_cents
         FROM jsonb_to_recordset($2::jsonb) AS s(id uuid, tier_id uuid, price_cents int)`,
      [order.id, JSON.stringify(seats.map(({ id, tier_id, price_cents }) => ({ id, tier_id, price_cents })))]
    );
    return { order, event, seats };
  });

  await cache.invalidateAvailability(eventId);
  realtime.publish({
    type: 'hold.created',
    eventId,
    organizationId: result.event.organization_id,
    orderId: result.order.id,
    quantity: result.seats.length,
  });

  return getOrder(result.order.id, userId);
}

/** Release a set of held seats back to inventory. Must run inside a transaction. */
async function releaseSeats(client, orderIds) {
  const res = await client.query(
    `UPDATE tickets SET status = 'available', order_id = NULL, held_until = NULL, updated_at = now()
      WHERE order_id = ANY($1::uuid[]) AND status = 'held'`,
    [orderIds]
  );
  return res.rowCount;
}

async function cancelHold({ userId, orderId, isAdmin }) {
  const order = await withTransaction(async (c) => {
    const { rows } = await c.query('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [orderId]);
    const o = rows[0];
    if (!o || (!isAdmin && o.user_id !== userId)) throw notFound('Order not found');
    if (o.status === 'processing') throw conflict('PAYMENT_IN_PROGRESS', 'Payment is being processed and cannot be cancelled');
    if (o.status !== 'pending') throw conflict('ORDER_NOT_PENDING', `Order is already ${o.status}`);
    await releaseSeats(c, [o.id]);
    const upd = await c.query(
      `UPDATE orders SET status = 'cancelled', updated_at = now() WHERE id = $1 RETURNING *`,
      [o.id]
    );
    return upd.rows[0];
  });
  await cache.invalidateAvailability(order.event_id);
  realtime.publish({ type: 'hold.cancelled', eventId: order.event_id, orderId: order.id });
  return getOrder(order.id, userId, isAdmin);
}

/**
 * Background job body: expire holds whose 10 minutes are up, and fail payments
 * that the gateway never answered. Uses SKIP LOCKED so it never blocks (or is
 * blocked by) a buyer who is checking out that exact order right now.
 */
async function releaseExpiredHolds({ batchSize = 500, gatewayTimeoutSeconds = 120 } = {}) {
  let expiredCount = 0;
  let releasedSeats = 0;
  let timedOutPayments = 0;
  const touchedEvents = new Set();

  // 1) Payments stuck in "processing" with no gateway callback.
  await withTransaction(async (c) => {
    const { rows } = await c.query(
      `SELECT o.id, o.event_id, o.expires_at
         FROM orders o
         JOIN transactions t ON t.order_id = o.id AND t.status = 'processing'
        WHERE o.status = 'processing' AND t.created_at < now() - make_interval(secs => $1)
        FOR UPDATE OF o, t SKIP LOCKED`,
      [gatewayTimeoutSeconds]
    );
    for (const o of rows) {
      await c.query(
        `UPDATE transactions SET status = 'rejected', failure_reason = 'GATEWAY_TIMEOUT', updated_at = now()
          WHERE order_id = $1 AND status = 'processing'`,
        [o.id]
      );
      if (new Date(o.expires_at) > new Date()) {
        await c.query(`UPDATE orders SET status = 'pending', updated_at = now() WHERE id = $1`, [o.id]);
      } else {
        releasedSeats += await releaseSeats(c, [o.id]);
        await c.query(`UPDATE orders SET status = 'failed', updated_at = now() WHERE id = $1`, [o.id]);
        touchedEvents.add(o.event_id);
      }
      timedOutPayments++;
    }
  });

  // 2) Expired holds, in batches.
  for (;;) {
    const batch = await withTransaction(async (c) => {
      const { rows } = await c.query(
        `WITH due AS (
           SELECT id FROM orders
            WHERE status = 'pending' AND expires_at <= now()
            ORDER BY expires_at
            LIMIT $1
            FOR UPDATE SKIP LOCKED
         )
         UPDATE orders o SET status = 'expired', updated_at = now()
           FROM due WHERE o.id = due.id
         RETURNING o.id, o.event_id`,
        [batchSize]
      );
      if (rows.length) releasedSeats += await releaseSeats(c, rows.map((r) => r.id));
      return rows;
    });
    expiredCount += batch.length;
    batch.forEach((r) => touchedEvents.add(r.event_id));
    if (batch.length < batchSize) break;
  }

  for (const eventId of touchedEvents) {
    await cache.invalidateAvailability(eventId);
    realtime.publish({ type: 'hold.expired', eventId });
  }
  return { expiredOrders: expiredCount, releasedSeats, timedOutPayments };
}

async function getOrder(orderId, userId, isAdmin = false) {
  const { rows } = await query(
    `SELECT o.*, e.title AS event_title, e.starts_at AS event_starts_at, e.venue AS event_venue,
            GREATEST(0, EXTRACT(EPOCH FROM (o.expires_at - now())))::int AS seconds_remaining,
            COALESCE((
              SELECT json_agg(json_build_object(
                       'ticketId', t.id, 'seat', t.seat_label, 'tier', tt.name,
                       'priceCents', oi.price_cents, 'status', t.status)
                     ORDER BY tt.sort_order, t.seat_number)
                FROM order_items oi
                JOIN tickets t ON t.id = oi.ticket_id
                JOIN ticket_tiers tt ON tt.id = oi.tier_id
               WHERE oi.order_id = o.id), '[]') AS items,
            (SELECT json_build_object('id', x.id, 'status', x.status, 'failureReason', x.failure_reason,
                                      'gatewayRef', x.gateway_ref, 'cardLast4', x.card_last4)
               FROM transactions x WHERE x.order_id = o.id ORDER BY x.created_at DESC LIMIT 1) AS last_transaction
       FROM orders o JOIN events e ON e.id = o.event_id
      WHERE o.id = $1`,
    [orderId]
  );
  const o = rows[0];
  if (!o || (!isAdmin && userId && o.user_id !== userId)) throw notFound('Order not found');
  return formatOrder(o);
}

function formatOrder(o) {
  return {
    id: o.id,
    status: o.status,
    eventId: o.event_id,
    eventTitle: o.event_title,
    eventStartsAt: o.event_starts_at,
    eventVenue: o.event_venue,
    totalCents: o.total_cents,
    expiresAt: o.expires_at,
    secondsRemaining: ['pending', 'processing'].includes(o.status) ? o.seconds_remaining : 0,
    createdAt: o.created_at,
    paidAt: o.paid_at,
    items: o.items,
    lastTransaction: o.last_transaction,
  };
}

module.exports = { createHold, cancelHold, releaseExpiredHolds, releaseSeats, getOrder };
