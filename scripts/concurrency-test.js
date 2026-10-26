#!/usr/bin/env node
/**
 * Concurrency stress test: fires truly parallel requests at the API and checks
 * that no seat is ever sold twice.
 *
 *   BASE_URL=https://your-app.onrender.com node scripts/concurrency-test.js
 *
 * Scenarios
 *   A. N buyers race for the SAME seat        -> exactly 1 hold, N-1 get 409 SEATS_UNAVAILABLE
 *   B. N buyers race for a 20-seat GA tier    -> exactly 20 holds, all seats distinct, rest 409
 *   C. 8 parallel checkouts of ONE order      -> exactly 1 accepted (202), rest 409
 *   D. Seat counts reported by the API add up to capacity
 */
const BASE = (process.env.BASE_URL || 'http://localhost:4000').replace(/\/$/, '');
const N = Number(process.env.BUYERS || 30);
const ORG = { email: process.env.ORG_EMAIL || 'organizer@ticketforge.dev', password: process.env.ORG_PASSWORD || 'Organizer@123' };

let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '  PASS' : '  FAIL'}  ${name}${extra ? `  (${extra})` : ''}`);
  if (!cond) failures++;
};

async function api(method, path, { token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

const tally = (results) => results.reduce((m, r) => {
  const k = `${r.status}${r.data?.error ? ' ' + r.data.error.code : ''}`;
  m[k] = (m[k] || 0) + 1;
  return m;
}, {});

(async () => {
  console.log(`Target: ${BASE}   buyers: ${N}\n`);
  const org = await api('POST', '/api/auth/login', { body: ORG });
  if (org.status !== 200) throw new Error(`Organizer login failed: ${JSON.stringify(org.data)}`);

  const starts = new Date(Date.now() + 14 * 864e5);
  const ev = await api('POST', '/api/events', {
    token: org.data.token,
    body: {
      title: `Concurrency Test ${new Date().toISOString().slice(0, 19)}`,
      venue: 'Load test hall',
      startsAt: starts.toISOString(),
      salesEndAt: new Date(starts.getTime() - 864e5).toISOString(),
      publish: true,
      tiers: [
        { name: 'VIP', priceCents: 500000, quantity: 5, seatPrefix: 'V' },
        { name: 'General', priceCents: 100000, quantity: 20, seatPrefix: 'GA' },
      ],
    },
  });
  if (ev.status !== 201) throw new Error(`Event create failed: ${JSON.stringify(ev.data)}`);
  const event = ev.data.event;
  const [vip, ga] = event.tiers;
  console.log(`Created event ${event.id} (VIP x5, General x20)`);

  const stamp = Date.now();
  const buyers = await Promise.all(Array.from({ length: N }, (_, i) =>
    api('POST', '/api/auth/register', {
      body: { name: `Load Buyer ${i}`, email: `load${stamp}_${i}@example.com`, password: 'LoadTest@123' },
    }).then((r) => r.data.token)));
  if (buyers.some((t) => !t)) throw new Error('Could not register all buyers (rate limit?)');

  const seats = (await api('GET', `/api/events/${event.id}/seats`)).data.seats;
  const target = seats.find((s) => s.tierId === vip.id && s.seat === 'V-1');

  console.log(`\nA. ${N} buyers -> the same seat ${target.seat}, all at once`);
  const a = await Promise.all(buyers.map((t) => api('POST', `/api/events/${event.id}/holds`, { token: t, body: { ticketIds: [target.id] } })));
  const aWins = a.filter((r) => r.status === 201);
  console.log('     results:', tally(a));
  check('exactly one hold succeeded', aWins.length === 1, `${aWins.length} succeeded`);
  check('all others got 409 SEATS_UNAVAILABLE', a.filter((r) => r.data?.error?.code === 'SEATS_UNAVAILABLE').length === N - 1);
  const winnerIdx = a.findIndex((r) => r.status === 201);

  const others = buyers.filter((_, i) => i !== winnerIdx);
  console.log(`\nB. ${others.length} buyers -> 1 General ticket each (20 in stock), all at once`);
  const b = await Promise.all(others.map((t) => api('POST', `/api/events/${event.id}/holds`, { token: t, body: { items: [{ tierId: ga.id, quantity: 1 }] } })));
  const bWins = b.filter((r) => r.status === 201);
  const assigned = bWins.map((r) => r.data.order.items[0].seat);
  console.log('     results:', tally(b));
  check('exactly 20 holds succeeded', bWins.length === Math.min(20, others.length), `${bWins.length} succeeded`);
  check('every held seat is distinct', new Set(assigned).size === assigned.length, `${new Set(assigned).size} distinct`);
  check('the rest got 409 INSUFFICIENT_INVENTORY',
    b.filter((r) => r.data?.error?.code === 'INSUFFICIENT_INVENTORY').length === others.length - bWins.length);

  console.log('\nC. 8 parallel checkouts of the same order (double-click / retry storm)');
  const winnerToken = buyers[winnerIdx];
  const orderId = aWins[0].data.order.id;
  const c = await Promise.all(Array.from({ length: 8 }, () =>
    api('POST', `/api/orders/${orderId}/checkout`, { token: winnerToken, body: { cardNumber: '4242424242424242' } })));
  console.log('     results:', tally(c));
  check('exactly one checkout accepted', c.filter((r) => r.status === 202).length === 1);

  // Wait for the async gateway to settle the payment.
  let final;
  for (let i = 0; i < 20; i++) {
    await new Promise((ok) => setTimeout(ok, 500));
    final = (await api('GET', `/api/orders/${orderId}`, { token: winnerToken })).data.order;
    if (!['processing'].includes(final.status)) break;
  }
  check('order ends up paid after gateway callback', final.status === 'paid', final.status);

  console.log('\nD. Inventory invariant');
  const after = (await api('GET', `/api/events/${event.id}/seats`)).data.seats;
  const counts = after.reduce((m, s) => { m[s.status] = (m[s.status] || 0) + 1; return m; }, {});
  console.log('     seat states:', counts);
  check('capacity = available + held + sold', after.length === 25 && (counts.available || 0) + (counts.held || 0) + (counts.sold || 0) === 25);
  check('1 sold, 20 held', counts.sold === 1 && counts.held === 20);

  console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll concurrency checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error('Test aborted:', e.message);
  process.exit(1);
});
