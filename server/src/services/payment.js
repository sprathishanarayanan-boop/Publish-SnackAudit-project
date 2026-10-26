/**
 * Checkout + payment orchestration against the mock gateway.
 *
 * Flow
 *   1. POST /api/orders/:id/checkout
 *        - Redis lock on the order (rejects double-clicks fast)
 *        - DB transaction: SELECT order FOR UPDATE, verify hold still valid,
 *          insert transaction(processing), order -> processing
 *        - call mock gateway  -> 202 Accepted (async)
 *   2. Gateway calls back POST /api/payments/webhook (HMAC signed) a few seconds later
 *        - DB transaction: lock transaction + order, then
 *            approved -> seats held->sold, order paid
 *            rejected -> order back to pending (retry allowed while hold lasts)
 *        - idempotent: a repeated webhook for a finished transaction is a no-op
 */
const crypto = require('crypto');
const config = require('../config');
const { withTransaction } = require('../db');
const lock = require('./lock');
const cache = require('./cache');
const realtime = require('./realtime');
const { releaseSeats, getOrder } = require('./reservation');
const { notFound, conflict, gone, HttpError } = require('../errors');

const sign = (body) => crypto.createHmac('sha256', config.gatewaySecret).update(body).digest('hex');

function verifySignature(rawBody, signature) {
  if (!signature || !rawBody) return false;
  const expected = Buffer.from(sign(rawBody));
  const given = Buffer.from(String(signature));
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

async function startCheckout({ userId, orderId, cardNumber }) {
  const l = await lock.acquire(`checkout:${orderId}`, 15000);
  if (!l.acquired) throw conflict('CHECKOUT_IN_PROGRESS', 'A checkout for this order is already in progress');
  try {
    const outcome = await withTransaction(async (c) => {
      const { rows } = await c.query('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [orderId]);
      const o = rows[0];
      if (!o || o.user_id !== userId) throw notFound('Order not found');
      if (o.status === 'paid') throw conflict('ALREADY_PAID', 'This order has already been paid');
      if (o.status === 'processing') throw conflict('PAYMENT_IN_PROGRESS', 'Payment for this order is already being processed');
      if (['expired', 'failed'].includes(o.status)) return { expired: true, order: o };
      if (o.status === 'cancelled') throw gone('ORDER_CANCELLED', 'This reservation was cancelled');

      if (new Date(o.expires_at) <= new Date()) {
        // Hold ran out but the sweeper hasn't reached it yet: expire it right here.
        await releaseSeats(c, [o.id]);
        await c.query(`UPDATE orders SET status = 'expired', updated_at = now() WHERE id = $1`, [o.id]);
        return { expired: true, order: o, releasedNow: true };
      }

      const { rows: [txn] } = await c.query(
        `INSERT INTO transactions (order_id, amount_cents, status, card_last4)
         VALUES ($1, $2, 'processing', $3) RETURNING *`,
        [o.id, o.total_cents, String(cardNumber).slice(-4)]
      );
      await c.query(`UPDATE orders SET status = 'processing', updated_at = now() WHERE id = $1`, [o.id]);
      return { order: o, txn };
    });

    if (outcome.expired) {
      if (outcome.releasedNow) {
        await cache.invalidateAvailability(outcome.order.event_id);
        realtime.publish({ type: 'hold.expired', eventId: outcome.order.event_id });
      }
      throw gone('HOLD_EXPIRED', `Your ${config.holdMinutes}-minute reservation has expired. Please select seats again.`);
    }

    const { txn, order } = outcome;
    try {
      const res = await fetch(`${config.selfUrl}/api/mock-gateway/charges`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amountCents: txn.amount_cents,
          currency: 'INR',
          cardNumber: String(cardNumber),
          reference: txn.id,
          callbackUrl: `${config.selfUrl}/api/payments/webhook`,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status !== 202) throw new Error(body?.error?.message || `Gateway responded ${res.status}`);
      await withTransaction((c) =>
        c.query('UPDATE transactions SET gateway_ref = $1, updated_at = now() WHERE id = $2', [body.id, txn.id])
      );
    } catch (err) {
      // Gateway unreachable/refused synchronously: undo so the user can retry.
      await withTransaction(async (c) => {
        await c.query(
          `UPDATE transactions SET status = 'rejected', failure_reason = $2, updated_at = now() WHERE id = $1`,
          [txn.id, `GATEWAY_ERROR: ${err.message}`.slice(0, 200)]
        );
        await c.query(`UPDATE orders SET status = 'pending', updated_at = now() WHERE id = $1 AND status = 'processing'`, [order.id]);
      });
      throw new HttpError(502, 'GATEWAY_ERROR', 'Payment gateway could not process the request. Please try again.');
    }

    realtime.publish({ type: 'checkout.started', eventId: order.event_id, orderId: order.id });
    return getOrder(order.id, userId);
  } finally {
    await l.release();
  }
}

/** Handle the gateway's async verdict. Safe to call more than once. */
async function finalizePayment({ reference, gatewayRef, status, reason }) {
  const result = await withTransaction(async (c) => {
    const { rows: [txn] } = await c.query('SELECT * FROM transactions WHERE id = $1 FOR UPDATE', [reference]);
    if (!txn) throw notFound('Unknown transaction reference');
    if (txn.status !== 'processing') return { duplicate: true, txn };

    const { rows: [o] } = await c.query(
      `SELECT o.*, e.organization_id FROM orders o JOIN events e ON e.id = o.event_id
        WHERE o.id = $1 FOR UPDATE OF o`,
      [txn.order_id]
    );

    if (status === 'approved' && o.status === 'processing') {
      const { rowCount } = await c.query(
        `UPDATE tickets SET status = 'sold', held_until = NULL, updated_at = now()
          WHERE order_id = $1 AND status = 'held'`,
        [o.id]
      );
      const { rows: [{ n }] } = await c.query('SELECT count(*)::int AS n FROM order_items WHERE order_id = $1', [o.id]);
      if (rowCount !== n) throw new Error(`Invariant violated: order ${o.id} expected ${n} held seats, found ${rowCount}`);
      await c.query(
        `UPDATE transactions SET status = 'approved', gateway_ref = COALESCE(gateway_ref, $2), updated_at = now() WHERE id = $1`,
        [txn.id, gatewayRef]
      );
      await c.query(`UPDATE orders SET status = 'paid', paid_at = now(), updated_at = now() WHERE id = $1`, [o.id]);
      return { order: o, final: 'paid', amount: txn.amount_cents };
    }

    // Rejected, or approved too late (order already timed out) -> record as rejected/refunded.
    const failure = status === 'approved' ? 'LATE_APPROVAL_AUTO_REFUNDED' : reason || 'DECLINED';
    await c.query(
      `UPDATE transactions SET status = 'rejected', failure_reason = $2, gateway_ref = COALESCE(gateway_ref, $3), updated_at = now()
        WHERE id = $1`,
      [txn.id, failure, gatewayRef]
    );
    if (o.status === 'processing') {
      if (new Date(o.expires_at) > new Date()) {
        await c.query(`UPDATE orders SET status = 'pending', updated_at = now() WHERE id = $1`, [o.id]);
        return { order: o, final: 'pending' };
      }
      await releaseSeats(c, [o.id]);
      await c.query(`UPDATE orders SET status = 'failed', updated_at = now() WHERE id = $1`, [o.id]);
      return { order: o, final: 'failed', released: true };
    }
    return { order: o, final: o.status };
  });

  if (result.duplicate) return { ok: true, duplicate: true };
  const { order } = result;
  if (result.final === 'paid' || result.released) await cache.invalidateAvailability(order.event_id);
  realtime.publish({
    type: result.final === 'paid' ? 'order.paid' : 'payment.rejected',
    eventId: order.event_id,
    organizationId: order.organization_id,
    orderId: order.id,
    amountCents: result.amount || 0,
  });
  return { ok: true, orderStatus: result.final };
}

module.exports = { startCheckout, finalizePayment, verifySignature, sign };
