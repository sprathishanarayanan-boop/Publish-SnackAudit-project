/**
 * Demo data: 2 tenant organizations, an admin, organizers, attendees, events
 * with tiered seating and a week of historical orders so the dashboards have
 * something to show. Runs automatically on first boot when the DB is empty.
 */
const { hashPassword } = require('./lib/password');
const { pool, withTransaction } = require('./db');
const { insertTiers } = require('./routes/events');

const DAY = 24 * 3600 * 1000;
const inDays = (d, h = 19) => {
  const t = new Date(Date.now() + d * DAY);
  t.setUTCHours(h - 5, 30, 0, 0); // ~h:00 IST
  return t;
};

const DEMO = {
  admin: { name: 'Platform Admin', email: 'admin@ticketforge.dev', password: 'Admin@123' },
  organizers: [
    { name: 'Priya Raman', email: 'organizer@ticketforge.dev', password: 'Organizer@123', org: 'Chennai Live Co' },
    { name: 'Arjun Mehta', email: 'organizer2@ticketforge.dev', password: 'Organizer@123', org: 'Bengaluru Tech Events' },
  ],
  attendee: { name: 'Demo Attendee', email: 'attendee@ticketforge.dev', password: 'Attendee@123' },
};

async function seed() {
  const hash = (p) => hashPassword(p);
  await withTransaction(async (c) => {
    await c.query(`INSERT INTO users (email, password_hash, name, role) VALUES ($1, $2, $3, 'admin')`,
      [DEMO.admin.email, await hash(DEMO.admin.password), DEMO.admin.name]);

    const orgs = [];
    for (const o of DEMO.organizers) {
      const slug = o.org.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const { rows: [org] } = await c.query('INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id', [o.org, slug]);
      const { rows: [u] } = await c.query(
        `INSERT INTO users (email, password_hash, name, role, organization_id) VALUES ($1, $2, $3, 'organizer', $4) RETURNING id`,
        [o.email, await hash(o.password), o.name, org.id]
      );
      orgs.push({ id: org.id, userId: u.id });
    }

    const attendeeHash = await hash(DEMO.attendee.password);
    await c.query(`INSERT INTO users (email, password_hash, name, role) VALUES ($1, $2, $3, 'attendee')`,
      [DEMO.attendee.email, attendeeHash, DEMO.attendee.name]);
    const names = ['Kavya', 'Rohan', 'Ananya', 'Vikram', 'Sneha', 'Aditya', 'Meera', 'Karthik', 'Ishita', 'Rahul',
      'Divya', 'Siddharth', 'Pooja', 'Nikhil', 'Lakshmi', 'Harish', 'Tanvi', 'Varun', 'Nithya', 'Abhinav'];
    const buyers = [];
    const buyerHash = await hash('Attendee@123');
    for (let i = 0; i < names.length; i++) {
      const { rows: [u] } = await c.query(
        `INSERT INTO users (email, password_hash, name, role) VALUES ($1, $2, $3, 'attendee') RETURNING id`,
        [`${names[i].toLowerCase()}@example.com`, buyerHash, `${names[i]} ${String.fromCharCode(65 + i)}.`]
      );
      buyers.push(u.id);
    }

    const events = [
      { org: 0, title: 'Monsoon Indie Music Festival', venue: 'YMCA Grounds, Nandanam, Chennai', start: 24, salesEnd: 23,
        description: 'Six indie bands, two stages, one rainy evening. Gates open 4 PM.',
        tiers: [{ name: 'VIP', priceCents: 499900, quantity: 40, seatPrefix: 'VIP' },
                { name: 'Gold', priceCents: 249900, quantity: 80, seatPrefix: 'G' },
                { name: 'General Admission', priceCents: 99900, quantity: 200, seatPrefix: 'GA' }] },
      { org: 0, title: 'Stand-up Comedy Night: Filter Kaapi Edition', venue: 'The Music Academy, Chennai', start: 10, salesEnd: 9,
        description: 'Ninety minutes of Chennai-flavoured stand-up from four comics.',
        tiers: [{ name: 'Front Row', priceCents: 199900, quantity: 20, seatPrefix: 'FR' },
                { name: 'Regular', priceCents: 79900, quantity: 100, seatPrefix: 'R' }] },
      { org: 1, title: 'Full Stack Dev Summit 2026', venue: 'NIMHANS Convention Centre, Bengaluru', start: 32, salesEnd: 30,
        description: 'Talks and hands-on workshops on distributed systems, databases and frontend performance.',
        tiers: [{ name: 'Workshop + Conference', priceCents: 350000, quantity: 40, seatPrefix: 'WS' },
                { name: 'Conference', priceCents: 150000, quantity: 160, seatPrefix: 'C' },
                { name: 'Student', priceCents: 49900, quantity: 60, seatPrefix: 'ST' }] },
      { org: 1, title: 'Postgres Internals Meetup', venue: 'Draft — venue TBC', start: 45, salesEnd: 44, draft: true,
        description: 'MVCC, WAL and the planner — an evening for database nerds.',
        tiers: [{ name: 'Free RSVP', priceCents: 0, quantity: 50, seatPrefix: 'RSVP' }] },
    ];

    for (const e of events) {
      const { rows: [ev] } = await c.query(
        `INSERT INTO events (organization_id, created_by, title, description, venue, starts_at, sales_end_at, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [orgs[e.org].id, orgs[e.org].userId, e.title, e.description, e.venue, inDays(e.start), inDays(e.salesEnd, 23),
          e.draft ? 'draft' : 'published']
      );
      await insertTiers(c, ev.id, e.tiers);
      if (e.draft) continue;

      // Historical activity over the past 7 days.
      const { rows: tiers } = await c.query('SELECT id, price_cents, quantity FROM ticket_tiers WHERE event_id = $1 ORDER BY sort_order', [ev.id]);
      const orderCount = 18 + Math.floor(Math.random() * 14);
      for (let i = 0; i < orderCount; i++) {
        const tier = tiers[Math.floor(Math.random() * tiers.length)];
        const qty = 1 + Math.floor(Math.random() * 3);
        const createdAt = new Date(Date.now() - Math.random() * 6.8 * DAY);
        const roll = Math.random();
        const status = roll < 0.68 ? 'paid' : roll < 0.9 ? 'expired' : 'cancelled';
        const { rows: seats } = await c.query(
          `SELECT id FROM tickets WHERE tier_id = $1 AND status = 'available' ORDER BY seat_number LIMIT $2`, [tier.id, qty]
        );
        if (seats.length < qty) continue;
        const total = tier.price_cents * qty;
        const { rows: [o] } = await c.query(
          `INSERT INTO orders (user_id, event_id, status, total_cents, expires_at, created_at, paid_at, updated_at)
           VALUES ($1, $2, $3, $4, $5::timestamptz + interval '10 minutes', $5, $6, $5) RETURNING id`,
          [buyers[Math.floor(Math.random() * buyers.length)], ev.id, status, total, createdAt,
            status === 'paid' ? new Date(createdAt.getTime() + 3 * 60 * 1000) : null]
        );
        for (const s of seats) {
          await c.query('INSERT INTO order_items (order_id, ticket_id, tier_id, price_cents) VALUES ($1, $2, $3, $4)',
            [o.id, s.id, tier.id, tier.price_cents]);
        }
        if (status === 'paid') {
          await c.query(`UPDATE tickets SET status = 'sold', order_id = $1 WHERE id = ANY($2::uuid[])`, [o.id, seats.map((s) => s.id)]);
          await c.query(
            `INSERT INTO transactions (order_id, amount_cents, status, gateway_ref, card_last4, created_at)
             VALUES ($1, $2, 'approved', $3, '4242', $4)`,
            [o.id, total, `ch_seed_${o.id.slice(0, 12)}`, createdAt]
          );
        } else if (status === 'expired' && Math.random() < 0.4) {
          await c.query(
            `INSERT INTO transactions (order_id, amount_cents, status, gateway_ref, card_last4, failure_reason, created_at)
             VALUES ($1, $2, 'rejected', $3, '0002', 'card_declined', $4)`,
            [o.id, total, `ch_seed_${o.id.slice(0, 12)}`, createdAt]
          );
        }
      }
    }
  });
  console.log('Seeded demo data. Logins:');
  console.log(`  admin      ${DEMO.admin.email} / ${DEMO.admin.password}`);
  DEMO.organizers.forEach((o) => console.log(`  organizer  ${o.email} / ${o.password}  (${o.org})`));
  console.log(`  attendee   ${DEMO.attendee.email} / ${DEMO.attendee.password}`);
}

async function seedIfEmpty() {
  const { rows: [{ n }] } = await pool.query('SELECT count(*)::int AS n FROM users');
  if (n === 0) await seed();
}

module.exports = { seed, seedIfEmpty, DEMO };

if (require.main === module) {
  const { migrate } = require('./migrate');
  const reset = process.argv.includes('--reset');
  (async () => {
    await migrate();
    if (reset) {
      await pool.query('TRUNCATE transactions, order_items, orders, tickets, ticket_tiers, events, users, organizations CASCADE');
    }
    await seedIfEmpty();
    await pool.end();
    process.exit(0);
  })().catch((e) => { console.error(e); process.exit(1); });
}
