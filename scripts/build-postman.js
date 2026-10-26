#!/usr/bin/env node
/**
 * Generates postman/TicketForge.postman_collection.json (Postman v2.1).
 * Edit the request list here, then run: node scripts/build-postman.js
 */
const fs = require('fs');
const path = require('path');

// Shared helpers injected into scripts that need parallel requests / polling.
const HELPERS = `
const base = pm.collectionVariables.get('baseUrl');
function call(method, p, token, body) {
  return new Promise((resolve) => pm.sendRequest({
    url: base + p, method,
    header: [{ key: 'Content-Type', value: 'application/json' }].concat(token ? [{ key: 'Authorization', value: 'Bearer ' + token }] : []),
    body: body ? { mode: 'raw', raw: JSON.stringify(body) } : undefined
  }, (err, res) => resolve(err ? { code: 0, body: {} } : { code: res.code, body: res.json() })));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function pollOrder(id, token, notStatus) {
  let o;
  for (let i = 0; i < 20; i++) { await sleep(500); o = (await call('GET', '/api/orders/' + id, token)).body.order; if (o && o.status !== notStatus) break; }
  return o;
}`;

const lines = (s) => s.trim().split('\n');
const J = (o) => ({ mode: 'raw', raw: JSON.stringify(o, null, 2), options: { raw: { language: 'json' } } });

function req(name, method, url, { token, body, test, pre, description } = {}) {
  const header = [{ key: 'Content-Type', value: 'application/json' }];
  if (token) header.push({ key: 'Authorization', value: `Bearer {{${token}}}` });
  const event = [];
  if (pre) event.push({ listen: 'prerequest', script: { type: 'text/javascript', exec: lines(pre) } });
  if (test) event.push({ listen: 'test', script: { type: 'text/javascript', exec: lines(test) } });
  const [p, q] = url.split('?');
  return {
    name,
    event,
    request: {
      method,
      header,
      ...(body ? { body: J(body) } : {}),
      url: {
        raw: `{{baseUrl}}${url}`,
        host: ['{{baseUrl}}'],
        path: p.split('/').filter(Boolean),
        ...(q ? { query: q.split('&').map((kv) => { const [key, value] = kv.split('='); return { key, value }; }) } : {}),
      },
      ...(description ? { description } : {}),
    },
  };
}

const status = (code) => `pm.test('Status is ${code}', () => pm.expect(pm.response.code).to.equal(${code}));`;
const errCode = (code) => `pm.test('Error code is ${code}', () => pm.expect(pm.response.json().error.code).to.equal('${code}'));`;

const folders = [
  {
    name: '0. Health',
    item: [
      req('Health check', 'GET', '/api/health', {
        test: `${status(200)}
pm.test('DB and Redis are up', () => { const b = pm.response.json(); pm.expect(b.db).to.equal('up'); pm.expect(b.redis).to.equal('up'); });
pm.test('Hold length is configured', () => pm.expect(pm.response.json().holdMinutes).to.be.above(0));`,
      }),
    ],
  },
  {
    name: '1. Auth & sessions',
    item: [
      req('Login – admin', 'POST', '/api/auth/login', {
        body: { email: 'admin@ticketforge.dev', password: 'Admin@123' },
        test: `${status(200)}
pm.test('Role is admin', () => pm.expect(pm.response.json().user.role).to.equal('admin'));
pm.collectionVariables.set('adminToken', pm.response.json().token);
pm.collectionVariables.set('adminId', pm.response.json().user.id);`,
      }),
      req('Login – organizer (Chennai Live Co)', 'POST', '/api/auth/login', {
        body: { email: 'organizer@ticketforge.dev', password: 'Organizer@123' },
        test: `${status(200)}
pm.test('Organizer belongs to a tenant', () => pm.expect(pm.response.json().user.organizationId).to.be.a('string'));
pm.collectionVariables.set('orgToken', pm.response.json().token);`,
      }),
      req('Login – organizer 2 (Bengaluru Tech Events)', 'POST', '/api/auth/login', {
        body: { email: 'organizer2@ticketforge.dev', password: 'Organizer@123' },
        test: `${status(200)}
pm.collectionVariables.set('org2Token', pm.response.json().token);`,
      }),
      req('Register attendee A', 'POST', '/api/auth/register', {
        body: { name: 'QA Attendee A', email: 'qa.a.{{$timestamp}}@example.com', password: 'Passw0rd!' },
        test: `${status(201)}
pm.test('Default role is attendee', () => pm.expect(pm.response.json().user.role).to.equal('attendee'));
pm.collectionVariables.set('attToken', pm.response.json().token);`,
      }),
      req('Register attendee B', 'POST', '/api/auth/register', {
        body: { name: 'QA Attendee B', email: 'qa.b.{{$timestamp}}@example.com', password: 'Passw0rd!' },
        test: `${status(201)}
pm.collectionVariables.set('att2Token', pm.response.json().token);
pm.collectionVariables.set('att2Id', pm.response.json().user.id);`,
      }),
      req('Register – duplicate email → 409', 'POST', '/api/auth/register', {
        body: { name: 'Dup', email: 'attendee@ticketforge.dev', password: 'Passw0rd!' },
        test: `${status(409)}\n${errCode('EMAIL_TAKEN')}`,
      }),
      req('Register organizer without organization → 400', 'POST', '/api/auth/register', {
        body: { name: 'No Org', email: 'noorg.{{$timestamp}}@example.com', password: 'Passw0rd!', role: 'organizer' },
        test: `${status(400)}
pm.test('Validation points at organizationName', () => pm.expect(JSON.stringify(pm.response.json().error.details)).to.include('organizationName'));`,
      }),
      req('Login – wrong password → 401', 'POST', '/api/auth/login', {
        body: { email: 'attendee@ticketforge.dev', password: 'wrong-password' },
        test: status(401),
      }),
      req('Me – no token → 401', 'GET', '/api/auth/me', { test: `${status(401)}\n${errCode('UNAUTHORIZED')}` }),
      req('Me – tampered/invalid session token → 401', 'GET', '/api/auth/me', {
        pre: `pm.collectionVariables.set('badToken', pm.collectionVariables.get('attToken') + 'tampered');`,
        token: 'badToken',
        test: `${status(401)}\n${errCode('INVALID_TOKEN')}`,
      }),
      req('Me – valid token', 'GET', '/api/auth/me', {
        token: 'attToken',
        test: `${status(200)}\npm.test('Returns the user', () => pm.expect(pm.response.json().user.email).to.include('qa.a.'));`,
      }),
    ],
  },
  {
    name: '2. Event management (Organizer) + RBAC + caching',
    item: [
      req('Attendee cannot create events → 403', 'POST', '/api/events', {
        token: 'attToken',
        body: { title: 'Nope', startsAt: '2030-01-01T10:00:00Z', salesEndAt: '2029-12-31T10:00:00Z', tiers: [{ name: 'GA', priceCents: 100, quantity: 1 }] },
        test: `${status(403)}\n${errCode('FORBIDDEN')}`,
      }),
      req('Create event – sales cut-off after start → 400', 'POST', '/api/events', {
        token: 'orgToken',
        body: { title: 'Invalid dates', startsAt: '2030-01-01T10:00:00Z', salesEndAt: '2030-01-02T10:00:00Z', tiers: [{ name: 'GA', priceCents: 100, quantity: 5 }] },
        test: `${status(400)}\n${errCode('BAD_REQUEST')}`,
      }),
      req('Create event with VIP + GA tiers (published)', 'POST', '/api/events', {
        token: 'orgToken',
        pre: `const start = new Date(Date.now() + 20 * 864e5);
pm.collectionVariables.set('startsAt', start.toISOString());
pm.collectionVariables.set('salesEndAt', new Date(start.getTime() - 864e5).toISOString());`,
        body: {
          title: 'Postman QA Concert', description: 'Created by the Postman suite', venue: 'Test Arena',
          startsAt: '{{startsAt}}', salesEndAt: '{{salesEndAt}}', publish: true,
          tiers: [
            { name: 'VIP', priceCents: 250000, quantity: 4, seatPrefix: 'VIP' },
            { name: 'General Admission', priceCents: 50000, quantity: 10, seatPrefix: 'GA' },
          ],
        },
        test: `${status(201)}
const e = pm.response.json().event;
pm.test('Two tiers with correct inventory', () => { pm.expect(e.tiers).to.have.lengthOf(2); pm.expect(e.tiers[0].available).to.equal(4); pm.expect(e.tiers[1].available).to.equal(10); });
pm.test('Published with sales cut-off', () => { pm.expect(e.status).to.equal('published'); pm.expect(e.salesEndAt).to.be.a('string'); });
pm.collectionVariables.set('eventId', e.id);
pm.collectionVariables.set('vipTierId', e.tiers[0].id);
pm.collectionVariables.set('gaTierId', e.tiers[1].id);`,
      }),
      req('Create draft event', 'POST', '/api/events', {
        token: 'orgToken',
        body: { title: 'Postman Draft Event', startsAt: '{{startsAt}}', salesEndAt: '{{salesEndAt}}', tiers: [{ name: 'GA', priceCents: 1000, quantity: 5 }] },
        test: `${status(201)}
pm.test('Status is draft', () => pm.expect(pm.response.json().event.status).to.equal('draft'));
pm.collectionVariables.set('draftEventId', pm.response.json().event.id);`,
      }),
      req('Tenant isolation – organizer 2 cannot edit organizer 1 event → 403', 'PATCH', '/api/events/{{eventId}}', {
        token: 'org2Token', body: { venue: 'Hijacked' }, test: `${status(403)}\n${errCode('FORBIDDEN')}`,
      }),
      req('Update event venue (owner)', 'PATCH', '/api/events/{{eventId}}', {
        token: 'orgToken', body: { venue: 'Test Arena, Hall 2' },
        test: `${status(200)}\npm.test('Venue updated', () => pm.expect(pm.response.json().event.venue).to.equal('Test Arena, Hall 2'));`,
      }),
      req('Get event (warms Redis cache)', 'GET', '/api/events/{{eventId}}', {
        test: `${status(200)}
pm.test('X-Cache header present', () => pm.expect(pm.response.headers.get('X-Cache')).to.be.oneOf(['HIT', 'MISS']));`,
      }),
      req('Get event again → served from Redis (X-Cache: HIT)', 'GET', '/api/events/{{eventId}}', {
        test: `${status(200)}
pm.test('Event details served from cache', () => pm.expect(pm.response.headers.get('X-Cache')).to.equal('HIT'));
pm.test('Cache reflects the latest edit', () => pm.expect(pm.response.json().event.venue).to.equal('Test Arena, Hall 2'));`,
      }),
      req('List published events', 'GET', '/api/events', {
        test: `${status(200)}
pm.test('New event is listed', () => pm.expect(pm.response.json().events.map((e) => e.id)).to.include(pm.collectionVariables.get('eventId')));
pm.test('Draft is not listed', () => pm.expect(pm.response.json().events.map((e) => e.id)).to.not.include(pm.collectionVariables.get('draftEventId')));`,
      }),
      req('Draft event hidden from public → 404', 'GET', '/api/events/{{draftEventId}}', { test: status(404) }),
      req('Seat map', 'GET', '/api/events/{{eventId}}/seats', {
        test: `${status(200)}
const seats = pm.response.json().seats;
pm.test('14 seats generated', () => pm.expect(seats).to.have.lengthOf(14));
const vip = seats.filter((s) => s.tierId === pm.collectionVariables.get('vipTierId'));
pm.collectionVariables.set('seat1', vip[0].id);
pm.collectionVariables.set('seat2', vip[1].id);
pm.collectionVariables.set('seat3', vip[2].id);`,
      }),
    ],
  },
  {
    name: '3. Reservation engine (10-minute holds)',
    item: [
      req('Hold on a draft event → 422', 'POST', '/api/events/{{draftEventId}}/holds', {
        token: 'attToken', body: { items: [{ tierId: '{{gaTierId}}', quantity: 1 }] }, test: `${status(422)}\n${errCode('EVENT_NOT_ON_SALE')}`,
      }),
      req('Organizer cannot book tickets (RBAC) → 403', 'POST', '/api/events/{{eventId}}/holds', {
        token: 'orgToken', body: { ticketIds: ['{{seat1}}'] }, test: status(403),
      }),
      req('Ambiguous body (seats AND quantities) → 400', 'POST', '/api/events/{{eventId}}/holds', {
        token: 'attToken', body: { ticketIds: ['{{seat1}}'], items: [{ tierId: '{{gaTierId}}', quantity: 1 }] }, test: status(400),
      }),
      req('Too many tickets in one order → 422', 'POST', '/api/events/{{eventId}}/holds', {
        token: 'attToken', body: { items: [{ tierId: '{{gaTierId}}', quantity: 11 }] }, test: `${status(422)}\n${errCode('TOO_MANY_TICKETS')}`,
      }),
      req('Attendee A holds VIP seat', 'POST', '/api/events/{{eventId}}/holds', {
        token: 'attToken', body: { ticketIds: ['{{seat1}}'] },
        test: `${status(201)}
const o = pm.response.json().order;
pm.test('Order is pending with a 10-minute hold', () => { pm.expect(o.status).to.equal('pending'); pm.expect(o.secondsRemaining).to.be.above(0); pm.expect(o.secondsRemaining).to.be.at.most(600); });
pm.test('Seat is held and priced', () => { pm.expect(o.items[0].status).to.equal('held'); pm.expect(o.totalCents).to.equal(250000); });
pm.collectionVariables.set('orderId', o.id);`,
      }),
      req('Attendee B tries the same seat → 409', 'POST', '/api/events/{{eventId}}/holds', {
        token: 'att2Token', body: { ticketIds: ['{{seat1}}'] },
        test: `${status(409)}\n${errCode('SEATS_UNAVAILABLE')}
pm.test('Response names the taken seat', () => pm.expect(pm.response.json().error.details.seats).to.include('VIP-1'));`,
      }),
      req('Attendee A second hold on same event → 409', 'POST', '/api/events/{{eventId}}/holds', {
        token: 'attToken', body: { ticketIds: ['{{seat2}}'] },
        test: `${status(409)}\n${errCode('ACTIVE_HOLD_EXISTS')}`,
      }),
      req('Availability counts update immediately (cache invalidated)', 'GET', '/api/events/{{eventId}}', {
        test: `${status(200)}
pm.test('VIP shows 1 held, 3 available', () => { const t = pm.response.json().event.tiers[0]; pm.expect(t.held).to.equal(1); pm.expect(t.available).to.equal(3); });`,
      }),
      req('CONCURRENT – 8 buyers race for one seat (exactly 1 wins)', 'GET', '/api/events/{{eventId}}/seats', {
        description: 'Pre-request registers 8 buyers. The test script fires 8 hold requests for VIP-2 in parallel with pm.sendRequest and asserts exactly one 201 and seven 409 SEATS_UNAVAILABLE.',
        pre: `${HELPERS}
const ts = Date.now();
Promise.all([...Array(8).keys()].map((i) => call('POST', '/api/auth/register', null, { name: 'Racer ' + i, email: 'racer' + i + '.' + ts + '@example.com', password: 'Passw0rd!' })))
  .then((rs) => pm.collectionVariables.set('racers', JSON.stringify(rs.map((r) => r.body.token))));`,
        test: `${HELPERS}
const tokens = JSON.parse(pm.collectionVariables.get('racers'));
const ev = pm.collectionVariables.get('eventId');
(async () => {
  const results = await Promise.all(tokens.map((t) => call('POST', '/api/events/' + ev + '/holds', t, { ticketIds: [pm.collectionVariables.get('seat2')] })));
  const wins = results.filter((r) => r.code === 201);
  const lost = results.filter((r) => r.code === 409 && r.body.error.code === 'SEATS_UNAVAILABLE');
  pm.test('Exactly one hold succeeded', () => pm.expect(wins.length).to.equal(1));
  pm.test('Seven got 409 SEATS_UNAVAILABLE', () => pm.expect(lost.length).to.equal(7));
})();`,
      }),
      req('CONCURRENT – 12 buyers race for 10 GA tickets (no oversell)', 'GET', '/api/events/{{eventId}}/seats', {
        description: '12 parallel quantity-based holds against a 10-seat tier. Uses FOR UPDATE SKIP LOCKED: exactly 10 succeed with 10 distinct seats; 2 get 409 INSUFFICIENT_INVENTORY.',
        pre: `${HELPERS}
const ts = Date.now();
Promise.all([...Array(12).keys()].map((i) => call('POST', '/api/auth/register', null, { name: 'GA ' + i, email: 'ga' + i + '.' + ts + '@example.com', password: 'Passw0rd!' })))
  .then((rs) => pm.collectionVariables.set('gaBuyers', JSON.stringify(rs.map((r) => r.body.token))));`,
        test: `${HELPERS}
const tokens = JSON.parse(pm.collectionVariables.get('gaBuyers'));
const ev = pm.collectionVariables.get('eventId');
(async () => {
  const results = await Promise.all(tokens.map((t) => call('POST', '/api/events/' + ev + '/holds', t, { items: [{ tierId: pm.collectionVariables.get('gaTierId'), quantity: 1 }] })));
  const wins = results.filter((r) => r.code === 201);
  const seats = wins.map((r) => r.body.order.items[0].seat);
  pm.test('Exactly 10 holds succeeded', () => pm.expect(wins.length).to.equal(10));
  pm.test('All 10 seats are distinct', () => pm.expect(new Set(seats).size).to.equal(10));
  pm.test('2 buyers got INSUFFICIENT_INVENTORY', () => pm.expect(results.filter((r) => r.code === 409 && r.body.error.code === 'INSUFFICIENT_INVENTORY').length).to.equal(2));
  const map = (await call('GET', '/api/events/' + ev + '/seats')).body.seats.filter((s) => s.tierId === pm.collectionVariables.get('gaTierId'));
  pm.test('GA tier fully held, nothing double-booked', () => pm.expect(map.filter((s) => s.status === 'held').length).to.equal(10));
})();`,
      }),
    ],
  },
  {
    name: '4. Checkout & async payment gateway',
    item: [
      req("Another attendee cannot pay someone else's order → 404", 'POST', '/api/orders/{{orderId}}/checkout', {
        token: 'att2Token', body: { cardNumber: '4242424242424242' }, test: status(404),
      }),
      req('Invalid card format → 400', 'POST', '/api/orders/{{orderId}}/checkout', {
        token: 'attToken', body: { cardNumber: '1234' }, test: status(400),
      }),
      req('Checkout with declining card → 202, then rejected', 'POST', '/api/orders/{{orderId}}/checkout', {
        token: 'attToken', body: { cardNumber: '4000000000000002' },
        test: `${status(202)}
pm.test('Order is processing', () => pm.expect(pm.response.json().order.status).to.equal('processing'));
${HELPERS}
const id = pm.collectionVariables.get('orderId');
const tok = pm.collectionVariables.get('attToken');
(async () => {
  const dbl = await call('POST', '/api/orders/' + id + '/checkout', tok, { cardNumber: '4242424242424242' });
  pm.test('Second checkout while processing → 409', () => { pm.expect(dbl.code).to.equal(409); pm.expect(dbl.body.error.code).to.be.oneOf(['PAYMENT_IN_PROGRESS', 'CHECKOUT_IN_PROGRESS']); });
  const o = await pollOrder(id, tok, 'processing');
  pm.test('Gateway rejected asynchronously; hold kept for retry', () => { pm.expect(o.status).to.equal('pending'); pm.expect(o.lastTransaction.status).to.equal('rejected'); pm.expect(o.lastTransaction.failureReason).to.equal('card_declined'); });
  pm.test('Seat still held', () => pm.expect(o.items[0].status).to.equal('held'));
})();`,
      }),
      req('Retry with approving card → 202, then paid', 'POST', '/api/orders/{{orderId}}/checkout', {
        token: 'attToken', body: { cardNumber: '4242424242424242' },
        test: `${status(202)}
${HELPERS}
(async () => {
  const o = await pollOrder(pm.collectionVariables.get('orderId'), pm.collectionVariables.get('attToken'), 'processing');
  pm.test('Order paid', () => pm.expect(o.status).to.equal('paid'));
  pm.test('Seat sold', () => pm.expect(o.items[0].status).to.equal('sold'));
  pm.test('Transaction approved', () => pm.expect(o.lastTransaction.status).to.equal('approved'));
})();`,
      }),
      req('Pay again after paid → 409', 'POST', '/api/orders/{{orderId}}/checkout', {
        token: 'attToken', body: { cardNumber: '4242424242424242' }, test: `${status(409)}\n${errCode('ALREADY_PAID')}`,
      }),
      req('Cancel a paid order → 409', 'DELETE', '/api/orders/{{orderId}}/hold', {
        token: 'attToken', test: `${status(409)}\n${errCode('ORDER_NOT_PENDING')}`,
      }),
      req('Forged gateway webhook → 401', 'POST', '/api/payments/webhook', {
        body: { id: 'ch_fake', reference: '00000000-0000-0000-0000-000000000000', status: 'approved' },
        test: `${status(401)}\n${errCode('INVALID_SIGNATURE')}`,
      }),
      req('Mock gateway – direct charge returns 202 Accepted', 'POST', '/api/mock-gateway/charges', {
        body: { amountCents: 1000, cardNumber: '4000000000000119', reference: 'manual-test', callbackUrl: 'http://127.0.0.1:1/never' },
        test: `${status(202)}\npm.test('Charge id issued', () => pm.expect(pm.response.json().id).to.include('ch_'));`,
      }),
      req('My orders', 'GET', '/api/orders', {
        token: 'attToken',
        test: `${status(200)}\npm.test('Contains the paid order', () => pm.expect(pm.response.json().orders.map((o) => o.status)).to.include('paid'));`,
      }),
    ],
  },
  {
    name: '5. Expired sessions & background hold release',
    item: [
      req('Attendee B holds VIP seat 3', 'POST', '/api/events/{{eventId}}/holds', {
        token: 'att2Token', body: { ticketIds: ['{{seat3}}'] },
        test: `${status(201)}\npm.collectionVariables.set('order2Id', pm.response.json().order.id);`,
      }),
      req('[test hook] Fast-forward hold past 10 minutes', 'POST', '/api/admin/orders/{{order2Id}}/force-expire', {
        token: 'adminToken', test: status(200),
        description: 'Admin-only test route (disable with ENABLE_TEST_ROUTES=false) so the suite does not have to wait 10 minutes.',
      }),
      req('Checkout after hold expired → 410 Gone', 'POST', '/api/orders/{{order2Id}}/checkout', {
        token: 'att2Token', body: { cardNumber: '4242424242424242' },
        test: `${status(410)}\n${errCode('HOLD_EXPIRED')}`,
      }),
      req('Expired order shows status expired', 'GET', '/api/orders/{{order2Id}}', {
        token: 'att2Token',
        test: `${status(200)}\npm.test('Status expired, 0 seconds left', () => { pm.expect(pm.response.json().order.status).to.equal('expired'); pm.expect(pm.response.json().order.secondsRemaining).to.equal(0); });`,
      }),
      req('Seat is back on sale', 'GET', '/api/events/{{eventId}}/seats', {
        test: `${status(200)}\npm.test('VIP-3 available again', () => pm.expect(pm.response.json().seats.find((s) => s.id === pm.collectionVariables.get('seat3')).status).to.equal('available'));`,
      }),
      req('Attendee B holds seat 3 again', 'POST', '/api/events/{{eventId}}/holds', {
        token: 'att2Token', body: { ticketIds: ['{{seat3}}'] },
        test: `${status(201)}\npm.collectionVariables.set('order3Id', pm.response.json().order.id);`,
      }),
      req('[test hook] Fast-forward this hold', 'POST', '/api/admin/orders/{{order3Id}}/force-expire', { token: 'adminToken', test: status(200) }),
      req('Run background release job now', 'POST', '/api/admin/jobs/release-holds', {
        token: 'adminToken',
        description: 'The same job runs automatically every 30 s; this endpoint triggers it on demand.',
        test: `${status(200)}\npm.test('Job expired at least one hold', () => pm.expect(pm.response.json().result.expiredOrders).to.be.at.least(1));`,
      }),
      req('Order released by the worker is expired', 'GET', '/api/orders/{{order3Id}}', {
        token: 'att2Token',
        test: `${status(200)}\npm.test('Status expired', () => pm.expect(pm.response.json().order.status).to.equal('expired'));
pm.test('Seat returned to inventory', () => pm.expect(pm.response.json().order.items[0].status).to.equal('available'));`,
      }),
      req('Attendee B holds seat 3, then cancels', 'POST', '/api/events/{{eventId}}/holds', {
        token: 'att2Token', body: { ticketIds: ['{{seat3}}'] },
        test: `${status(201)}\npm.collectionVariables.set('order4Id', pm.response.json().order.id);`,
      }),
      req('Cancel hold releases seat immediately', 'DELETE', '/api/orders/{{order4Id}}/hold', {
        token: 'att2Token',
        test: `${status(200)}\npm.test('Cancelled + seat available', () => { const o = pm.response.json().order; pm.expect(o.status).to.equal('cancelled'); pm.expect(o.items[0].status).to.equal('available'); });`,
      }),
    ],
  },
  {
    name: '6. Analytics dashboard',
    item: [
      req('Organizer analytics (24h)', 'GET', '/api/organizer/analytics?range=24h', {
        token: 'orgToken',
        test: `${status(200)}
const b = pm.response.json();
pm.test('Revenue includes the paid VIP order', () => pm.expect(b.totals.revenueCents).to.be.at.least(250000));
pm.test('24 hourly buckets', () => pm.expect(b.series).to.have.lengthOf(24));
pm.test('Conversion metrics present', () => { pm.expect(b.totals.holdToPaidPct).to.be.a('number'); pm.expect(b.totals.checkoutToPaidPct).to.be.a('number'); });`,
      }),
      req('Analytics for one event', 'GET', '/api/organizer/analytics?eventId={{eventId}}&range=24h', {
        token: 'orgToken',
        test: `${status(200)}
const b = pm.response.json();
pm.test('Scoped to the event', () => pm.expect(b.events).to.have.lengthOf(1));
pm.test('1 sold, revenue 2500.00', () => { pm.expect(b.totals.ticketsSold).to.equal(1); pm.expect(b.totals.revenueCents).to.equal(250000); });
pm.test('Funnel counts declined payment', () => pm.expect(b.funnel.rejected_payments).to.be.at.least(1));`,
      }),
      req("Organizer 2 cannot read organizer 1's analytics → 403", 'GET', '/api/organizer/analytics?eventId={{eventId}}', {
        token: 'org2Token', test: status(403),
      }),
      req('Attendee cannot access analytics → 403', 'GET', '/api/organizer/analytics', { token: 'attToken', test: status(403) }),
      req('Organizer – orders for an event', 'GET', '/api/organizer/events/{{eventId}}/orders', {
        token: 'orgToken',
        test: `${status(200)}\npm.test('Includes the paid order', () => pm.expect(pm.response.json().orders.map((o) => o.id)).to.include(pm.collectionVariables.get('orderId')));`,
      }),
    ],
  },
  {
    name: '7. Admin',
    item: [
      req('Platform stats', 'GET', '/api/admin/stats', {
        token: 'adminToken', test: `${status(200)}\npm.test('Has revenue and users', () => { pm.expect(pm.response.json().stats.users).to.be.above(0); });`,
      }),
      req('List users', 'GET', '/api/admin/users', { token: 'adminToken', test: status(200) }),
      req('List organizations (tenants)', 'GET', '/api/admin/organizations', {
        token: 'adminToken', test: `${status(200)}\npm.test('At least 2 tenants', () => pm.expect(pm.response.json().organizations.length).to.be.at.least(2));`,
      }),
      req('Attendee cannot use admin API → 403', 'GET', '/api/admin/stats', { token: 'attToken', test: status(403) }),
      req('Organizer cannot use admin API → 403', 'GET', '/api/admin/users', { token: 'orgToken', test: status(403) }),
      req('Promote to organizer without organization → 400', 'PATCH', '/api/admin/users/{{att2Id}}/role', {
        token: 'adminToken', body: { role: 'organizer' }, test: status(400),
      }),
      req('Admin cannot demote themselves → 409', 'PATCH', '/api/admin/users/{{adminId}}/role', {
        token: 'adminToken', body: { role: 'attendee' }, test: `${status(409)}\n${errCode('SELF_DEMOTION')}`,
      }),
    ],
  },
];

const collection = {
  info: {
    name: 'TicketForge – Event & Ticket Reservation API',
    description: 'End-to-end suite: auth/RBAC, multi-tenant isolation, Redis caching, concurrent booking races, async payments and expired holds.\n\nSet `baseUrl` (collection variable) to your deployment, then run the whole collection in order with the Collection Runner.',
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
  },
  item: folders,
  variable: [{ key: 'baseUrl', value: 'http://localhost:4000' }],
};

const out = path.join(__dirname, '..', 'postman', 'TicketForge.postman_collection.json');
fs.writeFileSync(out, JSON.stringify(collection, null, 2) + '\n');
const count = folders.reduce((n, f) => n + f.item.length, 0);
console.log(`Wrote ${out} (${count} requests)`);
