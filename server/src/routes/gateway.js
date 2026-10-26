/**
 * Mock payment gateway (stands in for Razorpay/Stripe).
 *
 * POST /api/mock-gateway/charges  -> 202 Accepted immediately, then after 1.5-3.5 s
 * POSTs a signed webhook to callbackUrl with { reference, id, status, reason }.
 *
 * Test cards
 *   4242 4242 4242 4242  approved
 *   4000 0000 0000 0002  rejected: card_declined
 *   4000 0000 0000 9995  rejected: insufficient_funds
 *   4000 0000 0000 0119  never answers (simulates a gateway timeout)
 *   anything else        approved 80% / declined 20% at random
 */
const express = require('express');
const crypto = require('crypto');
const config = require('../config');
const { sign } = require('../services/payment');
const { z, parse } = require('../validate');
const { ah, notFound } = require('../errors');

const router = express.Router();
const charges = new Map(); // in-memory ledger of the fake gateway

const chargeSchema = z.object({
  amountCents: z.number().int().min(0),
  currency: z.string().default('INR'),
  cardNumber: z.string().regex(/^\d{12,19}$/),
  reference: z.string().min(1),
  callbackUrl: z.string().url(),
});

function decide(card) {
  switch (card) {
    case '4242424242424242': return { status: 'approved' };
    case '4000000000000002': return { status: 'rejected', reason: 'card_declined' };
    case '4000000000009995': return { status: 'rejected', reason: 'insufficient_funds' };
    case '4000000000000119': return { status: 'timeout' };
    default: return Math.random() < 0.8 ? { status: 'approved' } : { status: 'rejected', reason: 'issuer_declined' };
  }
}

router.post('/charges', ah(async (req, res) => {
  const body = parse(chargeSchema, req.body);
  const id = `ch_${crypto.randomBytes(10).toString('hex')}`;
  const verdict = decide(body.cardNumber);
  const charge = { id, reference: body.reference, amountCents: body.amountCents, currency: body.currency,
    status: 'processing', last4: body.cardNumber.slice(-4), createdAt: new Date().toISOString() };
  charges.set(id, charge);
  res.status(202).json(charge);

  if (verdict.status === 'timeout') return; // never calls back
  const delay = config.gatewayMinDelayMs + Math.random() * (config.gatewayMaxDelayMs - config.gatewayMinDelayMs);
  setTimeout(async () => {
    charge.status = verdict.status;
    charge.reason = verdict.reason || null;
    const payload = JSON.stringify({ id, reference: body.reference, status: verdict.status, reason: verdict.reason || null });
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const r = await fetch(body.callbackUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Gateway-Signature': sign(payload) },
          body: payload,
        });
        if (r.ok) return;
      } catch (_) { /* retry */ }
      await new Promise((ok) => setTimeout(ok, attempt * 1000));
    }
  }, delay);
}));

router.get('/charges/:id', (req, res, next) => {
  const c = charges.get(req.params.id);
  if (!c) return next(notFound('Charge not found'));
  res.json(c);
});

module.exports = router;
