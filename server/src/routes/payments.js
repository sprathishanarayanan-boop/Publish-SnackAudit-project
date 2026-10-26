const express = require('express');
const payment = require('../services/payment');
const { z, parse } = require('../validate');
const { ah, HttpError } = require('../errors');

const router = express.Router();

const webhookSchema = z.object({
  id: z.string(),
  reference: z.string().uuid(),
  status: z.enum(['approved', 'rejected']),
  reason: z.string().nullable().optional(),
});

/** Gateway -> us. Authenticated by HMAC-SHA256 of the raw body. Idempotent. */
router.post('/webhook', ah(async (req, res) => {
  if (!payment.verifySignature(req.rawBody, req.get('X-Gateway-Signature'))) {
    throw new HttpError(401, 'INVALID_SIGNATURE', 'Webhook signature verification failed');
  }
  const body = parse(webhookSchema, req.body);
  const result = await payment.finalizePayment({
    reference: body.reference,
    gatewayRef: body.id,
    status: body.status,
    reason: body.reason,
  });
  res.json(result);
}));

module.exports = router;
