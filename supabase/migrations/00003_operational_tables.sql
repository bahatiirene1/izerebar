-- ============================================
-- IZEREBAR DATABASE SCHEMA
-- Migration: 00003_operational_tables.sql
-- Description: Create operational tables (days, shifts, stock, sales, etc.)
-- Implements: ARCHITECTURE.md Section 2.3.6 - 2.3.16
-- ============================================

-- 2.3.6 Days
CREATE TABLE days (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bar_id UUID NOT NULL REFERENCES bars(id),

  -- Identity
  business_date DATE NOT NULL,

  -- Status
  status day_status NOT NULL DEFAULT 'open',

  -- Lifecycle
  opened_at TIMESTAMPTZ DEFAULT now(),
  opened_by UUID NOT NULL REFERENCES users(id),
  opened_device_id UUID NOT NULL REFERENCES devices(id),

  closed_at TIMESTAMPTZ,
  closed_by UUID REFERENCES users(id),
  closed_device_id UUID REFERENCES devices(id),

  reconciled_at TIMESTAMPTZ,
  reconciled_by UUID REFERENCES users(id),
  reconciliation_notes TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT now(),

  -- Constraints
  CONSTRAINT days_unique_date UNIQUE (bar_id, business_date)
);

COMMENT ON TABLE days IS 'Business days - a day must be open before shifts can operate';

-- 2.3.7 Shifts
CREATE TABLE shifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bar_id UUID NOT NULL REFERENCES bars(id),
  day_id UUID NOT NULL REFERENCES days(id),

  -- Identity
  name VARCHAR(50),                   -- e.g., "Morning", "Evening"
  scheduled_start TIME,
  scheduled_end TIME,

  -- Status
  status shift_status NOT NULL DEFAULT 'scheduled',

  -- Lifecycle
  opened_at TIMESTAMPTZ,
  opened_by UUID REFERENCES users(id),
  opened_device_id UUID REFERENCES devices(id),

  closed_at TIMESTAMPTZ,
  closed_by UUID REFERENCES users(id),
  closed_device_id UUID REFERENCES devices(id),
  close_reason TEXT,

  reconciled_at TIMESTAMPTZ,
  reconciled_by UUID REFERENCES users(id),
  reconciliation_notes TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT now(),

  -- Constraints
  CONSTRAINT shifts_valid_times CHECK (
    scheduled_start IS NULL OR
    scheduled_end IS NULL OR
    scheduled_start < scheduled_end
  )
);

COMMENT ON TABLE shifts IS 'Work shifts within a business day';

-- 2.3.8 Shift Assignments
CREATE TABLE shift_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id UUID NOT NULL REFERENCES shifts(id),
  user_id UUID NOT NULL REFERENCES users(id),
  role user_role NOT NULL,

  -- Audit
  assigned_by UUID NOT NULL REFERENCES users(id),
  assigned_at TIMESTAMPTZ DEFAULT now(),
  device_id UUID NOT NULL REFERENCES devices(id),

  -- Constraints
  CONSTRAINT shift_assignments_unique UNIQUE (shift_id, user_id)
);

COMMENT ON TABLE shift_assignments IS 'Which users are assigned to which shifts';

-- 2.3.9 Stock Batches (Incoming Stock)
CREATE TABLE stock_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bar_id UUID NOT NULL REFERENCES bars(id),

  -- Product
  product_id UUID NOT NULL REFERENCES products(id),

  -- Quantity
  quantity DECIMAL(10,2) NOT NULL,
  cost_per_unit_rwf DECIMAL(10,2),

  -- Source
  supplier_name VARCHAR(100),
  invoice_reference VARCHAR(50),

  -- Audit
  received_by UUID NOT NULL REFERENCES users(id),
  received_at TIMESTAMPTZ DEFAULT now(),
  device_id UUID NOT NULL REFERENCES devices(id),

  -- Notes
  notes TEXT,

  -- Sync
  sync_status sync_status DEFAULT 'local',
  client_id UUID,                     -- For offline dedup

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT now(),

  -- Constraints
  CONSTRAINT stock_batches_positive_qty CHECK (quantity > 0)
);

COMMENT ON TABLE stock_batches IS 'Stock deliveries from suppliers';

-- 2.3.10 Stock Movements (Custody Transfers)
CREATE TABLE stock_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bar_id UUID NOT NULL REFERENCES bars(id),
  shift_id UUID REFERENCES shifts(id),

  -- Product
  product_id UUID NOT NULL REFERENCES products(id),
  quantity DECIMAL(10,2) NOT NULL,

  -- Movement type
  movement_type movement_type NOT NULL,

  -- Custody transfer
  from_user_id UUID REFERENCES users(id),    -- NULL for delivery
  to_user_id UUID REFERENCES users(id),      -- NULL for damage/loss

  -- Reference (for returns/reversals)
  reference_movement_id UUID REFERENCES stock_movements(id),

  -- Audit
  performed_by UUID NOT NULL REFERENCES users(id),
  performed_at TIMESTAMPTZ DEFAULT now(),
  device_id UUID NOT NULL REFERENCES devices(id),

  -- Reason (REQUIRED for adjustment, damage, loss, return)
  reason TEXT,

  -- Sync
  sync_status sync_status DEFAULT 'local',
  client_id UUID,
  client_timestamp TIMESTAMPTZ,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT now(),

  -- Constraints
  CONSTRAINT stock_movements_positive_qty CHECK (quantity > 0),
  CONSTRAINT stock_movements_reason_required CHECK (
    (movement_type IN ('adjustment', 'damage', 'loss', 'return', 'return_to_stock') AND reason IS NOT NULL) OR
    (movement_type NOT IN ('adjustment', 'damage', 'loss', 'return', 'return_to_stock'))
  ),
  CONSTRAINT stock_movements_custody_valid CHECK (
    (movement_type = 'delivery' AND from_user_id IS NULL AND to_user_id IS NOT NULL) OR
    (movement_type IN ('damage', 'loss') AND from_user_id IS NOT NULL AND to_user_id IS NULL) OR
    (movement_type NOT IN ('delivery', 'damage', 'loss') AND from_user_id IS NOT NULL AND to_user_id IS NOT NULL)
  )
);

COMMENT ON TABLE stock_movements IS 'All stock custody transfers - the core accountability chain';
COMMENT ON COLUMN stock_movements.movement_type IS 'Type of movement: delivery, allocation, assignment, return, etc.';
COMMENT ON COLUMN stock_movements.reason IS 'Required explanation for adjustments, damage, loss, returns';

-- 2.3.11 Sales
CREATE TABLE sales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bar_id UUID NOT NULL REFERENCES bars(id),
  shift_id UUID NOT NULL REFERENCES shifts(id),

  -- Product
  product_id UUID NOT NULL REFERENCES products(id),
  quantity DECIMAL(10,2) NOT NULL,
  unit_price_rwf DECIMAL(10,2) NOT NULL,
  total_price_rwf DECIMAL(10,2) NOT NULL,

  -- Accountability chain
  assigned_to_server_id UUID NOT NULL REFERENCES users(id),
  assigned_by_bartender_id UUID NOT NULL REFERENCES users(id),
  assigned_at TIMESTAMPTZ DEFAULT now(),

  -- Status
  status sale_status NOT NULL DEFAULT 'pending',

  -- Collection (when server collects from customer)
  collected_at TIMESTAMPTZ,
  collected_amount_rwf DECIMAL(10,2),
  payment_method payment_method,

  -- Confirmation (when bartender confirms receipt)
  confirmed_at TIMESTAMPTZ,
  confirmed_by UUID REFERENCES users(id),
  confirmed_device_id UUID REFERENCES devices(id),

  -- Reversal (if applicable)
  reversed_at TIMESTAMPTZ,
  reversed_by UUID REFERENCES users(id),
  reversal_reason TEXT,
  reversal_device_id UUID REFERENCES devices(id),

  -- Device tracking
  created_device_id UUID NOT NULL REFERENCES devices(id),

  -- Sync
  sync_status sync_status DEFAULT 'local',
  client_id UUID,
  client_timestamp TIMESTAMPTZ,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT now(),

  -- Constraints
  CONSTRAINT sales_positive_qty CHECK (quantity > 0),
  CONSTRAINT sales_positive_price CHECK (unit_price_rwf >= 0),
  CONSTRAINT sales_total_matches CHECK (total_price_rwf = quantity * unit_price_rwf),
  CONSTRAINT sales_reversal_reason CHECK (
    (status = 'reversed' AND reversal_reason IS NOT NULL) OR
    (status != 'reversed')
  )
);

COMMENT ON TABLE sales IS 'All sales transactions with full accountability chain';
COMMENT ON COLUMN sales.assigned_to_server_id IS 'Server responsible for collecting payment';
COMMENT ON COLUMN sales.assigned_by_bartender_id IS 'Bartender who assigned the sale';

-- 2.3.13 Credits
CREATE TABLE credits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bar_id UUID NOT NULL REFERENCES bars(id),
  shift_id UUID NOT NULL REFERENCES shifts(id),

  -- Amount
  amount_rwf DECIMAL(10,2) NOT NULL,

  -- Customer (informal - no strict identity required)
  customer_description TEXT,          -- e.g., "Regular guy with red shirt"
  customer_phone VARCHAR(20),         -- Optional

  -- Status
  is_collected BOOLEAN DEFAULT false,
  collected_at TIMESTAMPTZ,
  collected_by UUID REFERENCES users(id),
  collected_device_id UUID REFERENCES devices(id),

  -- Audit
  issued_by UUID NOT NULL REFERENCES users(id),
  issued_at TIMESTAMPTZ DEFAULT now(),
  device_id UUID NOT NULL REFERENCES devices(id),

  -- Notes
  notes TEXT,

  -- Sync
  sync_status sync_status DEFAULT 'local',
  client_id UUID,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT now(),

  -- Constraints
  CONSTRAINT credits_positive_amount CHECK (amount_rwf > 0)
);

COMMENT ON TABLE credits IS 'Credit issued to customers - tracked until collected';

-- 2.3.14 Disputes
CREATE TABLE disputes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bar_id UUID NOT NULL REFERENCES bars(id),
  shift_id UUID REFERENCES shifts(id),

  -- What is disputed
  entity_type VARCHAR(50) NOT NULL,   -- 'sale', 'payment', 'stock', 'missing_money'
  entity_id UUID,                     -- Reference to the disputed entity

  -- Amount involved
  amount_rwf DECIMAL(10,2),

  -- Status
  status dispute_status NOT NULL DEFAULT 'open',

  -- Details
  description TEXT NOT NULL,

  -- Accountability
  responsible_user_id UUID REFERENCES users(id),

  -- Resolution
  resolution TEXT,
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES users(id),

  -- Audit
  opened_by UUID NOT NULL REFERENCES users(id),
  opened_at TIMESTAMPTZ DEFAULT now(),
  device_id UUID NOT NULL REFERENCES devices(id),

  -- Sync
  sync_status sync_status DEFAULT 'local',
  client_id UUID,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT now(),

  -- Constraints
  CONSTRAINT disputes_valid_entity_type CHECK (
    entity_type IN ('sale', 'payment', 'stock', 'missing_money', 'other')
  )
);

COMMENT ON TABLE disputes IS 'Disputes and discrepancies requiring resolution';

-- 2.3.15 Events (Append-Only Audit Log)
CREATE TABLE events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Context (ALL REQUIRED)
  bar_id UUID NOT NULL REFERENCES bars(id),
  device_id UUID NOT NULL REFERENCES devices(id),
  user_id UUID NOT NULL REFERENCES users(id),
  user_role user_role NOT NULL,
  shift_id UUID REFERENCES shifts(id),

  -- Event
  event_type event_type NOT NULL,

  -- Entity reference
  entity_type VARCHAR(50),            -- 'sale', 'stock_movement', 'shift', etc.
  entity_id UUID,

  -- Payload (full event data as JSON)
  payload JSONB NOT NULL DEFAULT '{}',

  -- Reason (for corrections, reversals, etc.)
  reason TEXT,

  -- Timestamps
  client_timestamp TIMESTAMPTZ NOT NULL,  -- When it happened on device
  server_timestamp TIMESTAMPTZ DEFAULT now(),  -- When server received it

  -- Sync
  sync_status sync_status DEFAULT 'committed',
  client_event_id UUID,               -- For offline dedup

  -- This table is APPEND-ONLY
  -- No UPDATE or DELETE triggers will be added
  created_at TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE events IS 'APPEND-ONLY audit log - every action is recorded here';
COMMENT ON COLUMN events.payload IS 'Full event data as JSON for complete traceability';
COMMENT ON COLUMN events.client_timestamp IS 'When the event occurred on the client device';

-- 2.3.16 Device Sessions (Lock/Unlock Tracking)
CREATE TABLE device_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id UUID NOT NULL REFERENCES devices(id),
  bar_id UUID NOT NULL REFERENCES bars(id),

  -- Session
  user_id UUID NOT NULL REFERENCES users(id),
  started_at TIMESTAMPTZ DEFAULT now(),
  ended_at TIMESTAMPTZ,

  -- How it ended
  end_reason VARCHAR(20),             -- 'logout', 'lock', 'timeout', 'forced'

  -- Actions count during session
  actions_count INT DEFAULT 0,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE device_sessions IS 'Tracks user sessions on each device';

-- ============================================
-- INDEXES for operational tables
-- ============================================

-- Days indexes
CREATE INDEX idx_days_bar ON days(bar_id);
CREATE INDEX idx_days_bar_date ON days(bar_id, business_date DESC);
CREATE INDEX idx_days_status ON days(bar_id, status);

-- Shifts indexes
CREATE INDEX idx_shifts_bar ON shifts(bar_id);
CREATE INDEX idx_shifts_day ON shifts(day_id);
CREATE INDEX idx_shifts_status ON shifts(bar_id, status);
CREATE INDEX idx_shifts_open ON shifts(bar_id, status) WHERE status = 'open';

-- Shift assignments indexes
CREATE INDEX idx_shift_assignments_shift ON shift_assignments(shift_id);
CREATE INDEX idx_shift_assignments_user ON shift_assignments(user_id);

-- Stock batches indexes
CREATE INDEX idx_stock_batches_bar ON stock_batches(bar_id);
CREATE INDEX idx_stock_batches_product ON stock_batches(product_id);
CREATE INDEX idx_stock_batches_date ON stock_batches(bar_id, created_at DESC);

-- Stock movements indexes
CREATE INDEX idx_stock_movements_bar ON stock_movements(bar_id);
CREATE INDEX idx_stock_movements_shift ON stock_movements(shift_id);
CREATE INDEX idx_stock_movements_product ON stock_movements(product_id);
CREATE INDEX idx_stock_movements_from ON stock_movements(from_user_id);
CREATE INDEX idx_stock_movements_to ON stock_movements(to_user_id);
CREATE INDEX idx_stock_movements_date ON stock_movements(bar_id, created_at DESC);
CREATE INDEX idx_stock_movements_sync ON stock_movements(sync_status) WHERE sync_status != 'committed';

-- Sales indexes
CREATE INDEX idx_sales_bar ON sales(bar_id);
CREATE INDEX idx_sales_shift ON sales(shift_id);
CREATE INDEX idx_sales_server ON sales(assigned_to_server_id);
CREATE INDEX idx_sales_bartender ON sales(assigned_by_bartender_id);
CREATE INDEX idx_sales_status ON sales(bar_id, status);
CREATE INDEX idx_sales_pending ON sales(bar_id, status) WHERE status = 'pending';
CREATE INDEX idx_sales_date ON sales(bar_id, created_at DESC);
CREATE INDEX idx_sales_sync ON sales(sync_status) WHERE sync_status != 'committed';

-- Credits indexes
CREATE INDEX idx_credits_bar ON credits(bar_id);
CREATE INDEX idx_credits_shift ON credits(shift_id);
CREATE INDEX idx_credits_uncollected ON credits(bar_id, is_collected) WHERE is_collected = false;

-- Disputes indexes
CREATE INDEX idx_disputes_bar ON disputes(bar_id);
CREATE INDEX idx_disputes_shift ON disputes(shift_id);
CREATE INDEX idx_disputes_status ON disputes(bar_id, status);
CREATE INDEX idx_disputes_open ON disputes(bar_id, status) WHERE status IN ('open', 'under_review');
CREATE INDEX idx_disputes_responsible ON disputes(responsible_user_id);

-- Events indexes
CREATE INDEX idx_events_bar ON events(bar_id);
CREATE INDEX idx_events_bar_date ON events(bar_id, server_timestamp DESC);
CREATE INDEX idx_events_device ON events(device_id);
CREATE INDEX idx_events_user ON events(user_id);
CREATE INDEX idx_events_shift ON events(shift_id);
CREATE INDEX idx_events_type ON events(bar_id, event_type);
CREATE INDEX idx_events_entity ON events(entity_type, entity_id);

-- Device sessions indexes
CREATE INDEX idx_device_sessions_device ON device_sessions(device_id);
CREATE INDEX idx_device_sessions_user ON device_sessions(user_id);
CREATE INDEX idx_device_sessions_active ON device_sessions(device_id, ended_at) WHERE ended_at IS NULL;
CREATE INDEX idx_device_sessions_date ON device_sessions(device_id, started_at DESC);
