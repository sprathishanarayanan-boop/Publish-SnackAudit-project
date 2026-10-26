-- TicketForge schema (idempotent: safe to run on every boot)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('admin', 'organizer', 'attendee');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE event_status AS ENUM ('draft', 'published', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE ticket_status AS ENUM ('available', 'held', 'sold');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE order_status AS ENUM ('pending', 'processing', 'paid', 'failed', 'expired', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE txn_status AS ENUM ('processing', 'approved', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Tenants: every organizer belongs to exactly one organization; all event data is scoped to it.
CREATE TABLE IF NOT EXISTS organizations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID REFERENCES organizations(id) ON DELETE SET NULL,
  email            TEXT NOT NULL UNIQUE,
  password_hash    TEXT NOT NULL,
  name             TEXT NOT NULL,
  role             user_role NOT NULL DEFAULT 'attendee',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT organizer_has_org CHECK (role <> 'organizer' OR organization_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS events (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_by       UUID NOT NULL REFERENCES users(id),
  title            TEXT NOT NULL,
  description      TEXT NOT NULL DEFAULT '',
  venue            TEXT NOT NULL DEFAULT '',
  starts_at        TIMESTAMPTZ NOT NULL,
  sales_end_at     TIMESTAMPTZ NOT NULL,
  status           event_status NOT NULL DEFAULT 'draft',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT sales_before_start CHECK (sales_end_at <= starts_at)
);
CREATE INDEX IF NOT EXISTS idx_events_org ON events(organization_id);
CREATE INDEX IF NOT EXISTS idx_events_status ON events(status, starts_at);

CREATE TABLE IF NOT EXISTS ticket_tiers (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id     UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  price_cents  INTEGER NOT NULL CHECK (price_cents >= 0),
  quantity     INTEGER NOT NULL CHECK (quantity > 0 AND quantity <= 5000),
  seat_prefix  TEXT NOT NULL,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  UNIQUE (event_id, name)
);

-- One row per sellable seat. The row lock on this table is what prevents double-booking.
CREATE TABLE IF NOT EXISTS tickets (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  tier_id     UUID NOT NULL REFERENCES ticket_tiers(id) ON DELETE CASCADE,
  seat_label  TEXT NOT NULL,
  seat_number INTEGER NOT NULL,
  status      ticket_status NOT NULL DEFAULT 'available',
  order_id    UUID,
  held_until  TIMESTAMPTZ,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event_id, seat_label),
  CONSTRAINT held_has_order CHECK (status = 'available' OR order_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_tickets_tier_status ON tickets(tier_id, status);
CREATE INDEX IF NOT EXISTS idx_tickets_order ON tickets(order_id);

CREATE TABLE IF NOT EXISTS orders (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id),
  event_id     UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  status       order_status NOT NULL DEFAULT 'pending',
  total_cents  INTEGER NOT NULL CHECK (total_cents >= 0),
  expires_at   TIMESTAMPTZ NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at      TIMESTAMPTZ,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_event ON orders(event_id, status);
CREATE INDEX IF NOT EXISTS idx_orders_expiry ON orders(expires_at) WHERE status = 'pending';

DO $$ BEGIN
  ALTER TABLE tickets ADD CONSTRAINT fk_tickets_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS order_items (
  order_id     UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  ticket_id    UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  tier_id      UUID NOT NULL REFERENCES ticket_tiers(id),
  price_cents  INTEGER NOT NULL,
  PRIMARY KEY (order_id, ticket_id)
);

CREATE TABLE IF NOT EXISTS transactions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  amount_cents    INTEGER NOT NULL,
  status          txn_status NOT NULL DEFAULT 'processing',
  gateway_ref     TEXT UNIQUE,
  card_last4      TEXT,
  failure_reason  TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_txn_order ON transactions(order_id);
-- At most one in-flight or successful charge per order.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_txn_per_order
  ON transactions(order_id) WHERE status IN ('processing', 'approved');
