const express = require('express');
const { query } = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const v = require('../validate');
const reservation = require('../services/reservation');
const payment = require('../services/payment');
const { ah } = require('../errors');

const router = express.Router();
router.use(authenticate);

router.get('/', requireRole('attendee', 'admin'), ah(async (req, res) => {
  const { rows } = await query(
    `SELECT o.id FROM orders o WHERE o.user_id = $1 ORDER BY o.created_at DESC LIMIT 50`,
    [req.user.id]
  );
  const orders = await Promise.all(rows.map((r) => reservation.getOrder(r.id, req.user.id)));
  res.json({ orders });
}));

router.get('/:id', ah(async (req, res) => {
  v.parse(v.uuid, req.params.id);
  const order = await reservation.getOrder(req.params.id, req.user.id, req.user.role === 'admin');
  res.json({ order });
}));

/** Cancel an active hold and return its seats to inventory. */
router.delete('/:id/hold', ah(async (req, res) => {
  v.parse(v.uuid, req.params.id);
  const order = await reservation.cancelHold({ userId: req.user.id, orderId: req.params.id, isAdmin: req.user.role === 'admin' });
  res.json({ order });
}));

/** Start payment. Returns 202: the result arrives asynchronously from the gateway. Poll GET /orders/:id. */
router.post('/:id/checkout', requireRole('attendee'), ah(async (req, res) => {
  v.parse(v.uuid, req.params.id);
  const body = v.parse(v.checkout, req.body);
  const order = await payment.startCheckout({ userId: req.user.id, orderId: req.params.id, cardNumber: body.cardNumber });
  res.status(202).json({ order, message: 'Payment submitted. Poll this order for the final status.' });
}));

module.exports = router;
