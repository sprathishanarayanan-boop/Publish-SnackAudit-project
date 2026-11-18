CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('salesman','admin','production','auditor','owner')),
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL,
  gstin TEXT NOT NULL DEFAULT '',
  customer_type TEXT NOT NULL CHECK (customer_type IN ('retailer','distributor')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('raw','packaging','finished')),
  unit TEXT NOT NULL,
  hsn TEXT NOT NULL DEFAULT '',
  gst_rate NUMERIC(5,2) NOT NULL DEFAULT 5,
  sale_price_paise INTEGER NOT NULL DEFAULT 0 CHECK (sale_price_paise >= 0),
  opening_cost_paise INTEGER NOT NULL DEFAULT 0 CHECK (opening_cost_paise >= 0),
  expected_yield NUMERIC(16,4) NOT NULL DEFAULT 0,
  reorder_level NUMERIC(16,4) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bom_lines (
  product_id UUID NOT NULL REFERENCES items(id),
  material_id UUID NOT NULL REFERENCES items(id),
  quantity NUMERIC(16,4) NOT NULL CHECK (quantity > 0),
  PRIMARY KEY (product_id, material_id)
);

CREATE TABLE IF NOT EXISTS purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  number TEXT NOT NULL UNIQUE,
  supplier TEXT NOT NULL,
  item_id UUID NOT NULL REFERENCES items(id),
  quantity NUMERIC(16,4) NOT NULL CHECK (quantity > 0),
  unit_cost_paise INTEGER NOT NULL CHECK (unit_cost_paise >= 0),
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS production_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  number TEXT NOT NULL UNIQUE,
  product_id UUID NOT NULL REFERENCES items(id),
  batch_quantity NUMERIC(16,4) NOT NULL CHECK (batch_quantity > 0),
  expected_output NUMERIC(16,4) NOT NULL,
  actual_output NUMERIC(16,4) NOT NULL CHECK (actual_output >= 0),
  damaged_quantity NUMERIC(16,4) NOT NULL DEFAULT 0,
  labour_paise INTEGER NOT NULL DEFAULT 0,
  overhead_paise INTEGER NOT NULL DEFAULT 0,
  material_cost_paise INTEGER NOT NULL DEFAULT 0,
  total_cost_paise INTEGER NOT NULL DEFAULT 0,
  cost_per_packet_paise NUMERIC(16,4) NOT NULL DEFAULT 0,
  yield_variance_pct NUMERIC(10,4) NOT NULL DEFAULT 0,
  flagged BOOLEAN NOT NULL DEFAULT false,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS production_consumption (
  run_id UUID NOT NULL REFERENCES production_runs(id),
  item_id UUID NOT NULL REFERENCES items(id),
  planned_quantity NUMERIC(16,4) NOT NULL,
  actual_quantity NUMERIC(16,4) NOT NULL,
  variance_pct NUMERIC(10,4) NOT NULL,
  PRIMARY KEY (run_id, item_id)
);

CREATE TABLE IF NOT EXISTS sales_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  number TEXT NOT NULL UNIQUE,
  customer_id UUID NOT NULL REFERENCES customers(id),
  salesman_id UUID NOT NULL REFERENCES users(id),
  status TEXT NOT NULL CHECK (status IN ('submitted','approved','invoiced','dispatched','rejected')),
  shortage NUMERIC(16,4) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sales_order_lines (
  order_id UUID NOT NULL REFERENCES sales_orders(id),
  product_id UUID NOT NULL REFERENCES items(id),
  quantity NUMERIC(16,4) NOT NULL CHECK (quantity > 0),
  unit_price_paise INTEGER NOT NULL CHECK (unit_price_paise >= 0),
  PRIMARY KEY (order_id, product_id)
);

CREATE TABLE IF NOT EXISTS invoice_counters (
  financial_year TEXT PRIMARY KEY,
  last_number INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  number TEXT NOT NULL UNIQUE,
  order_id UUID NOT NULL UNIQUE REFERENCES sales_orders(id),
  customer_id UUID NOT NULL REFERENCES customers(id),
  place_of_supply TEXT NOT NULL,
  taxable_paise INTEGER NOT NULL,
  cgst_paise INTEGER NOT NULL DEFAULT 0,
  sgst_paise INTEGER NOT NULL DEFAULT 0,
  igst_paise INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'posted' CHECK (status IN ('posted','cancelled')),
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS invoice_lines (
  invoice_id UUID NOT NULL REFERENCES invoices(id),
  product_id UUID NOT NULL REFERENCES items(id),
  quantity NUMERIC(16,4) NOT NULL,
  unit_price_paise INTEGER NOT NULL,
  taxable_paise INTEGER NOT NULL,
  gst_paise INTEGER NOT NULL,
  PRIMARY KEY (invoice_id, product_id)
);

CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES invoices(id),
  amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
  note TEXT NOT NULL DEFAULT '',
  received_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS stock_ledger (
  id BIGSERIAL PRIMARY KEY,
  item_id UUID NOT NULL REFERENCES items(id),
  quantity_delta NUMERIC(16,4) NOT NULL CHECK (quantity_delta <> 0),
  unit_cost_paise NUMERIC(16,4),
  movement_type TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id UUID,
  note TEXT NOT NULL DEFAULT '',
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS stock_ledger_item_time ON stock_ledger(item_id, created_at, id);

CREATE TABLE IF NOT EXISTS audit_log (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
