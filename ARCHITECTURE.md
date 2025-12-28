# Izerebar - Complete Architecture Specification

## Document Status: Implementation-Ready

This document provides the **complete, detailed architecture** for Izerebar (Rwandan Local Bar Management System). Every table, column, constraint, state machine, and protocol is defined to implementation-ready level.

---

# Table of Contents

1. [System Overview](#1-system-overview)
2. [Database Schema](#2-database-schema)
3. [State Machines](#3-state-machines)
4. [Authentication System](#4-authentication-system)
5. [Offline Sync Protocol](#5-offline-sync-protocol)
6. [Conflict Resolution](#6-conflict-resolution)
7. [API Endpoints](#7-api-endpoints)
8. [Domain Rules & Validations](#8-domain-rules--validations)
9. [Security & Fraud Prevention](#9-security--fraud-prevention)
10. [Reporting System](#10-reporting-system)
11. [Affiliate System](#11-affiliate-system)
12. [Infrastructure & Deployment](#12-infrastructure--deployment)

---

# 1. System Overview

## 1.1 Core Mission

An **accountability ledger** for Rwandan local bars that:
- Replaces paper & pen
- Tracks who did what, when, where, on which device
- Prevents fraud through visibility
- Works offline
- Remains extremely simple

## 1.2 Non-Negotiable Principles

| Principle | Implementation |
|-----------|----------------|
| Append-only | No DELETE, no UPDATE on core tables. Corrections are new records. |
| Full traceability | Every record has: user_id, role, device_id, timestamp, reason |
| Offline-tolerant | Queue locally, sync when online, flag conflicts |
| Extreme simplicity | Phone + PIN login, minimal screens |

## 1.3 Technology Stack

| Layer | Technology |
|-------|------------|
| Database | Supabase Postgres |
| Auth | Custom Phone + PIN (not Supabase Auth) |
| API | Supabase Edge Functions + RPC |
| UI | Web (PWA) - Phase 1, Flutter - Phase 2 |
| Offline Storage | IndexedDB (Dexie.js) |
| SMS/OTP | Pindo API (Rwanda) |

---

# 2. Database Schema

## 2.1 Schema Organization

```
schemas:
  - public          # Core bar operations
  - auth_custom     # Custom phone+PIN authentication
  - affiliate       # Agent/commission system
  - platform        # System admin
```

## 2.2 Enums

```sql
-- User roles within a bar
CREATE TYPE user_role AS ENUM (
  'owner',
  'manager',
  'bartender',
  'server',
  'kitchen'
);

-- Shift states
CREATE TYPE shift_status AS ENUM (
  'scheduled',    -- Created but not started
  'open',         -- Active, operations allowed
  'closing',      -- End initiated, reconciliation in progress
  'closed',       -- Fully closed, no more operations
  'reconciled'    -- Manager reviewed and approved
);

-- Day states
CREATE TYPE day_status AS ENUM (
  'open',         -- Day is active
  'closing',      -- End of day initiated
  'closed',       -- All shifts closed
  'reconciled'    -- Owner/manager reviewed
);

-- Stock movement types
CREATE TYPE movement_type AS ENUM (
  'delivery',         -- New stock from supplier
  'allocation',       -- Manager → Bartender
  'assignment',       -- Bartender → Server
  'return',           -- Server → Bartender (unconsumed)
  'return_to_stock',  -- Bartender → Stock (unsold)
  'adjustment',       -- Correction with reason
  'damage',           -- Broken/spoiled
  'loss'              -- Theft/missing
);

-- Sale states
CREATE TYPE sale_status AS ENUM (
  'pending',      -- Assigned to server, not paid
  'collected',    -- Server collected money
  'confirmed',    -- Bartender confirmed payment
  'reversed',     -- Sale reversed (with reason)
  'disputed'      -- Under review
);

-- Payment methods
CREATE TYPE payment_method AS ENUM (
  'cash',
  'momo',         -- Mobile Money
  'credit'        -- On credit (tracked separately)
);

-- Sync states for offline
CREATE TYPE sync_status AS ENUM (
  'local',        -- Created offline, not sent
  'pending',      -- Sent, awaiting acknowledgment
  'acknowledged', -- Server received
  'committed',    -- Fully synced
  'conflict'      -- Needs resolution
);

-- Event types for audit log
CREATE TYPE event_type AS ENUM (
  -- Auth events
  'login', 'logout', 'pin_change', 'device_lock', 'device_unlock',
  -- Shift events
  'shift_create', 'shift_open', 'shift_close', 'shift_reconcile',
  -- Day events
  'day_open', 'day_close', 'day_reconcile',
  -- Stock events
  'stock_delivery', 'stock_allocate', 'stock_assign', 'stock_return',
  'stock_adjust', 'stock_damage', 'stock_loss',
  -- Sale events
  'sale_create', 'sale_collect', 'sale_confirm', 'sale_reverse',
  -- Payment events
  'payment_record', 'payment_confirm', 'payment_dispute',
  -- Credit events
  'credit_issue', 'credit_collect',
  -- User events
  'user_create', 'user_suspend', 'user_reinstate', 'role_assign',
  -- Dispute events
  'dispute_open', 'dispute_resolve'
);

-- Dispute status
CREATE TYPE dispute_status AS ENUM (
  'open',
  'under_review',
  'resolved',
  'escalated'
);
```

## 2.3 Core Tables

### 2.3.1 Bars

```sql
CREATE TABLE bars (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identity
  name VARCHAR(100) NOT NULL,
  tin VARCHAR(20),                    -- Tax ID (optional, for multi-bar grouping)
  location VARCHAR(200),
  phone VARCHAR(20),

  -- Ownership
  owner_id UUID NOT NULL,             -- Links to users table

  -- Configuration
  credit_limit_rwf DECIMAL(12,2) DEFAULT 0,
  currency VARCHAR(3) DEFAULT 'RWF',
  timezone VARCHAR(50) DEFAULT 'Africa/Kigali',

  -- Subscription
  subscription_status VARCHAR(20) DEFAULT 'trial',
  subscription_expires_at TIMESTAMPTZ,

  -- Status
  is_active BOOLEAN DEFAULT true,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  -- Constraints
  CONSTRAINT bars_name_not_empty CHECK (length(trim(name)) > 0)
);

CREATE INDEX idx_bars_owner ON bars(owner_id);
CREATE INDEX idx_bars_tin ON bars(tin) WHERE tin IS NOT NULL;
CREATE INDEX idx_bars_active ON bars(is_active) WHERE is_active = true;
```

### 2.3.2 Devices (Contoires)

```sql
CREATE TABLE devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bar_id UUID NOT NULL REFERENCES bars(id),

  -- Identity
  name VARCHAR(50) NOT NULL,          -- e.g., "Contoire 1", "Kitchen"
  fingerprint VARCHAR(255) NOT NULL,  -- Browser/device fingerprint

  -- Status
  is_active BOOLEAN DEFAULT true,
  is_locked BOOLEAN DEFAULT false,
  locked_at TIMESTAMPTZ,
  locked_by UUID,                     -- User who locked it

  -- Tracking
  last_seen_at TIMESTAMPTZ DEFAULT now(),
  last_user_id UUID,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT now(),
  registered_at TIMESTAMPTZ DEFAULT now(),

  -- Constraints
  CONSTRAINT devices_unique_fingerprint UNIQUE (bar_id, fingerprint)
);

CREATE INDEX idx_devices_bar ON devices(bar_id);
CREATE INDEX idx_devices_active ON devices(bar_id, is_active) WHERE is_active = true;
```

### 2.3.3 Users

```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identity
  phone VARCHAR(20) NOT NULL UNIQUE,
  full_name VARCHAR(100) NOT NULL,
  profile_image_url VARCHAR(500),

  -- Status
  is_active BOOLEAN DEFAULT true,
  suspended_at TIMESTAMPTZ,
  suspended_reason TEXT,
  suspended_by UUID,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  -- Constraints
  CONSTRAINT users_phone_format CHECK (phone ~ '^\+?[0-9]{10,15}$'),
  CONSTRAINT users_name_not_empty CHECK (length(trim(full_name)) > 0)
);

CREATE INDEX idx_users_phone ON users(phone);
CREATE INDEX idx_users_active ON users(is_active) WHERE is_active = true;
```

### 2.3.4 User Roles (Per Bar)

```sql
CREATE TABLE user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Links
  user_id UUID NOT NULL REFERENCES users(id),
  bar_id UUID NOT NULL REFERENCES bars(id),

  -- Role
  role user_role NOT NULL,

  -- For bartenders: assigned device
  assigned_device_id UUID REFERENCES devices(id),

  -- Status
  is_active BOOLEAN DEFAULT true,

  -- Audit
  assigned_by UUID NOT NULL REFERENCES users(id),
  assigned_at TIMESTAMPTZ DEFAULT now(),

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT now(),

  -- Constraints
  CONSTRAINT user_roles_unique UNIQUE (user_id, bar_id),
  CONSTRAINT user_roles_bartender_device CHECK (
    (role = 'bartender' AND assigned_device_id IS NOT NULL) OR
    (role != 'bartender')
  )
);

CREATE INDEX idx_user_roles_user ON user_roles(user_id);
CREATE INDEX idx_user_roles_bar ON user_roles(bar_id);
CREATE INDEX idx_user_roles_bar_role ON user_roles(bar_id, role);
```

### 2.3.5 Products

```sql
CREATE TABLE products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bar_id UUID NOT NULL REFERENCES bars(id),

  -- Identity
  name VARCHAR(100) NOT NULL,
  category VARCHAR(50) NOT NULL,      -- 'drinks', 'barbeque', 'food', 'other'
  unit VARCHAR(20) DEFAULT 'piece',   -- 'piece', 'bottle', 'plate', 'kg'

  -- Pricing
  selling_price_rwf DECIMAL(10,2) NOT NULL,
  cost_price_rwf DECIMAL(10,2),       -- For profit calculation

  -- Status
  is_active BOOLEAN DEFAULT true,
  is_saleable BOOLEAN DEFAULT true,   -- False for tools/hygiene items

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  -- Constraints
  CONSTRAINT products_positive_price CHECK (selling_price_rwf >= 0),
  CONSTRAINT products_name_not_empty CHECK (length(trim(name)) > 0)
);

CREATE INDEX idx_products_bar ON products(bar_id);
CREATE INDEX idx_products_bar_category ON products(bar_id, category);
CREATE INDEX idx_products_active ON products(bar_id, is_active) WHERE is_active = true;
```

### 2.3.6 Days

```sql
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

CREATE INDEX idx_days_bar ON days(bar_id);
CREATE INDEX idx_days_bar_date ON days(bar_id, business_date DESC);
CREATE INDEX idx_days_status ON days(bar_id, status);
```

### 2.3.7 Shifts

```sql
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

CREATE INDEX idx_shifts_bar ON shifts(bar_id);
CREATE INDEX idx_shifts_day ON shifts(day_id);
CREATE INDEX idx_shifts_status ON shifts(bar_id, status);
CREATE INDEX idx_shifts_open ON shifts(bar_id, status) WHERE status = 'open';
```

### 2.3.8 Shift Assignments

```sql
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

CREATE INDEX idx_shift_assignments_shift ON shift_assignments(shift_id);
CREATE INDEX idx_shift_assignments_user ON shift_assignments(user_id);
```

### 2.3.9 Stock Batches (Incoming Stock)

```sql
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

CREATE INDEX idx_stock_batches_bar ON stock_batches(bar_id);
CREATE INDEX idx_stock_batches_product ON stock_batches(product_id);
CREATE INDEX idx_stock_batches_date ON stock_batches(bar_id, created_at DESC);
```

### 2.3.10 Stock Movements (Custody Transfers)

```sql
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

CREATE INDEX idx_stock_movements_bar ON stock_movements(bar_id);
CREATE INDEX idx_stock_movements_shift ON stock_movements(shift_id);
CREATE INDEX idx_stock_movements_product ON stock_movements(product_id);
CREATE INDEX idx_stock_movements_from ON stock_movements(from_user_id);
CREATE INDEX idx_stock_movements_to ON stock_movements(to_user_id);
CREATE INDEX idx_stock_movements_date ON stock_movements(bar_id, created_at DESC);
CREATE INDEX idx_stock_movements_sync ON stock_movements(sync_status) WHERE sync_status != 'committed';
```

### 2.3.11 Sales

```sql
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

CREATE INDEX idx_sales_bar ON sales(bar_id);
CREATE INDEX idx_sales_shift ON sales(shift_id);
CREATE INDEX idx_sales_server ON sales(assigned_to_server_id);
CREATE INDEX idx_sales_bartender ON sales(assigned_by_bartender_id);
CREATE INDEX idx_sales_status ON sales(bar_id, status);
CREATE INDEX idx_sales_pending ON sales(bar_id, status) WHERE status = 'pending';
CREATE INDEX idx_sales_date ON sales(bar_id, created_at DESC);
CREATE INDEX idx_sales_sync ON sales(sync_status) WHERE sync_status != 'committed';
```

### 2.3.12 Server Obligations (Materialized View)

```sql
-- This view calculates what each server owes at any point
CREATE MATERIALIZED VIEW server_obligations AS
SELECT
  s.bar_id,
  s.shift_id,
  s.assigned_to_server_id AS server_id,
  u.full_name AS server_name,

  -- Totals
  COUNT(*) FILTER (WHERE s.status = 'pending') AS pending_count,
  COALESCE(SUM(s.total_price_rwf) FILTER (WHERE s.status = 'pending'), 0) AS pending_amount_rwf,

  COUNT(*) FILTER (WHERE s.status = 'collected') AS collected_count,
  COALESCE(SUM(s.collected_amount_rwf) FILTER (WHERE s.status = 'collected'), 0) AS collected_amount_rwf,

  COUNT(*) FILTER (WHERE s.status = 'confirmed') AS confirmed_count,
  COALESCE(SUM(s.total_price_rwf) FILTER (WHERE s.status = 'confirmed'), 0) AS confirmed_amount_rwf,

  COUNT(*) FILTER (WHERE s.status = 'reversed') AS reversed_count,
  COUNT(*) FILTER (WHERE s.status = 'disputed') AS disputed_count,

  -- What server currently owes (pending + collected but not confirmed)
  COALESCE(SUM(s.total_price_rwf) FILTER (WHERE s.status IN ('pending', 'collected')), 0) AS owes_amount_rwf

FROM sales s
JOIN users u ON s.assigned_to_server_id = u.id
GROUP BY s.bar_id, s.shift_id, s.assigned_to_server_id, u.full_name;

CREATE UNIQUE INDEX idx_server_obligations_pk ON server_obligations(bar_id, shift_id, server_id);

-- Refresh function
CREATE OR REPLACE FUNCTION refresh_server_obligations()
RETURNS TRIGGER AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY server_obligations;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Trigger to refresh on sales changes
CREATE TRIGGER trg_refresh_server_obligations
AFTER INSERT OR UPDATE ON sales
FOR EACH STATEMENT
EXECUTE FUNCTION refresh_server_obligations();
```

### 2.3.13 Credits

```sql
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

CREATE INDEX idx_credits_bar ON credits(bar_id);
CREATE INDEX idx_credits_shift ON credits(shift_id);
CREATE INDEX idx_credits_uncollected ON credits(bar_id, is_collected) WHERE is_collected = false;
```

### 2.3.14 Disputes

```sql
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
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_disputes_bar ON disputes(bar_id);
CREATE INDEX idx_disputes_shift ON disputes(shift_id);
CREATE INDEX idx_disputes_status ON disputes(bar_id, status);
CREATE INDEX idx_disputes_open ON disputes(bar_id, status) WHERE status IN ('open', 'under_review');
CREATE INDEX idx_disputes_responsible ON disputes(responsible_user_id);
```

### 2.3.15 Events (Append-Only Audit Log)

```sql
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

-- Indexes for common queries
CREATE INDEX idx_events_bar ON events(bar_id);
CREATE INDEX idx_events_bar_date ON events(bar_id, server_timestamp DESC);
CREATE INDEX idx_events_device ON events(device_id);
CREATE INDEX idx_events_user ON events(user_id);
CREATE INDEX idx_events_shift ON events(shift_id);
CREATE INDEX idx_events_type ON events(bar_id, event_type);
CREATE INDEX idx_events_entity ON events(entity_type, entity_id);
```

### 2.3.16 Device Sessions (Lock/Unlock Tracking)

```sql
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

CREATE INDEX idx_device_sessions_device ON device_sessions(device_id);
CREATE INDEX idx_device_sessions_user ON device_sessions(user_id);
CREATE INDEX idx_device_sessions_active ON device_sessions(device_id, ended_at) WHERE ended_at IS NULL;
CREATE INDEX idx_device_sessions_date ON device_sessions(device_id, started_at DESC);
```

### 2.3.17 Daily Summaries

```sql
CREATE TABLE daily_summaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bar_id UUID NOT NULL REFERENCES bars(id),
  day_id UUID NOT NULL REFERENCES days(id),
  business_date DATE NOT NULL,

  -- Sales
  total_sales_count INT DEFAULT 0,
  total_sales_rwf DECIMAL(12,2) DEFAULT 0,

  -- By payment method
  cash_sales_rwf DECIMAL(12,2) DEFAULT 0,
  momo_sales_rwf DECIMAL(12,2) DEFAULT 0,
  credit_sales_rwf DECIMAL(12,2) DEFAULT 0,

  -- Stock
  stock_received_value_rwf DECIMAL(12,2) DEFAULT 0,
  stock_damaged_value_rwf DECIMAL(12,2) DEFAULT 0,
  stock_lost_value_rwf DECIMAL(12,2) DEFAULT 0,

  -- Issues
  disputes_count INT DEFAULT 0,
  missing_money_rwf DECIMAL(12,2) DEFAULT 0,

  -- Calculated
  gross_profit_rwf DECIMAL(12,2) DEFAULT 0,

  -- Generated
  generated_at TIMESTAMPTZ DEFAULT now(),
  generated_by UUID REFERENCES users(id),

  -- Constraints
  CONSTRAINT daily_summaries_unique UNIQUE (bar_id, business_date)
);

CREATE INDEX idx_daily_summaries_bar ON daily_summaries(bar_id);
CREATE INDEX idx_daily_summaries_date ON daily_summaries(bar_id, business_date DESC);
```

### 2.3.18 Shift Summaries

```sql
CREATE TABLE shift_summaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bar_id UUID NOT NULL REFERENCES bars(id),
  shift_id UUID NOT NULL REFERENCES shifts(id),

  -- Sales
  total_sales_count INT DEFAULT 0,
  total_sales_rwf DECIMAL(12,2) DEFAULT 0,

  -- By status
  pending_sales_count INT DEFAULT 0,
  pending_sales_rwf DECIMAL(12,2) DEFAULT 0,
  confirmed_sales_count INT DEFAULT 0,
  confirmed_sales_rwf DECIMAL(12,2) DEFAULT 0,
  reversed_sales_count INT DEFAULT 0,
  reversed_sales_rwf DECIMAL(12,2) DEFAULT 0,

  -- Stock movements
  stock_allocated_count INT DEFAULT 0,
  stock_returned_count INT DEFAULT 0,
  stock_damaged_count INT DEFAULT 0,

  -- Issues
  disputes_count INT DEFAULT 0,

  -- Generated
  generated_at TIMESTAMPTZ DEFAULT now(),

  -- Constraints
  CONSTRAINT shift_summaries_unique UNIQUE (shift_id)
);

CREATE INDEX idx_shift_summaries_bar ON shift_summaries(bar_id);
CREATE INDEX idx_shift_summaries_shift ON shift_summaries(shift_id);
```

---

## 2.4 Authentication Schema

```sql
-- Separate schema for auth
CREATE SCHEMA IF NOT EXISTS auth_custom;

-- PIN credentials
CREATE TABLE auth_custom.credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id),

  -- PIN (hashed with argon2)
  pin_hash VARCHAR(255) NOT NULL,

  -- OTP for PIN reset
  otp_code VARCHAR(6),
  otp_expires_at TIMESTAMPTZ,
  otp_attempts INT DEFAULT 0,

  -- Login tracking
  failed_attempts INT DEFAULT 0,
  locked_until TIMESTAMPTZ,
  last_login_at TIMESTAMPTZ,
  last_login_device_id UUID,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX idx_credentials_user ON auth_custom.credentials(user_id);

-- Active sessions
CREATE TABLE auth_custom.sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id),
  device_id UUID NOT NULL REFERENCES public.devices(id),
  bar_id UUID NOT NULL REFERENCES public.bars(id),

  -- Token
  token_hash VARCHAR(255) NOT NULL,

  -- Expiry
  expires_at TIMESTAMPTZ NOT NULL,

  -- Status
  is_active BOOLEAN DEFAULT true,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT now(),
  last_activity_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_sessions_user ON auth_custom.sessions(user_id);
CREATE INDEX idx_sessions_device ON auth_custom.sessions(device_id);
CREATE INDEX idx_sessions_token ON auth_custom.sessions(token_hash);
CREATE INDEX idx_sessions_active ON auth_custom.sessions(is_active, expires_at) WHERE is_active = true;
```

---

## 2.5 Affiliate Schema

```sql
CREATE SCHEMA IF NOT EXISTS affiliate;

-- Agents
CREATE TABLE affiliate.agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identity
  phone VARCHAR(20) NOT NULL UNIQUE,
  full_name VARCHAR(100) NOT NULL,

  -- Status
  is_active BOOLEAN DEFAULT true,

  -- Commission rate (percentage)
  commission_rate DECIMAL(5,2) DEFAULT 10.00,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Agent-Bar mapping
CREATE TABLE affiliate.agent_bars (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES affiliate.agents(id),
  bar_id UUID NOT NULL REFERENCES public.bars(id),

  -- Onboarding
  onboarded_at TIMESTAMPTZ DEFAULT now(),

  -- Status
  is_active BOOLEAN DEFAULT true,

  -- Constraints
  CONSTRAINT agent_bars_unique UNIQUE (agent_id, bar_id)
);

-- Commissions
CREATE TABLE affiliate.commissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES affiliate.agents(id),
  bar_id UUID NOT NULL REFERENCES public.bars(id),

  -- Period
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,

  -- Amount
  amount_rwf DECIMAL(10,2) NOT NULL,

  -- Status
  is_paid BOOLEAN DEFAULT false,
  paid_at TIMESTAMPTZ,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Payouts
CREATE TABLE affiliate.payouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES affiliate.agents(id),

  -- Amount
  amount_rwf DECIMAL(10,2) NOT NULL,

  -- Payment details
  payment_method VARCHAR(20),
  payment_reference VARCHAR(100),

  -- Timestamps
  paid_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);
```

---

## 2.6 Row Level Security (RLS)

```sql
-- Enable RLS on all tables
ALTER TABLE bars ENABLE ROW LEVEL SECURITY;
ALTER TABLE devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE days ENABLE ROW LEVEL SECURITY;
ALTER TABLE shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE shift_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE credits ENABLE ROW LEVEL SECURITY;
ALTER TABLE disputes ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE shift_summaries ENABLE ROW LEVEL SECURITY;

-- Example RLS policies (bar-scoped access)

-- Bars: users can only see bars they have a role in
CREATE POLICY bars_select ON bars
  FOR SELECT
  USING (
    id IN (
      SELECT bar_id FROM user_roles
      WHERE user_id = current_setting('app.current_user_id')::uuid
      AND is_active = true
    )
  );

-- Sales: users can only see sales from their bar
CREATE POLICY sales_select ON sales
  FOR SELECT
  USING (
    bar_id IN (
      SELECT bar_id FROM user_roles
      WHERE user_id = current_setting('app.current_user_id')::uuid
      AND is_active = true
    )
  );

-- Events: users can only see events from their bar
CREATE POLICY events_select ON events
  FOR SELECT
  USING (
    bar_id IN (
      SELECT bar_id FROM user_roles
      WHERE user_id = current_setting('app.current_user_id')::uuid
      AND is_active = true
    )
  );
```

---

## 2.7 Database Functions

### 2.7.1 Calculate Stock Balance

```sql
CREATE OR REPLACE FUNCTION get_stock_balance(
  p_bar_id UUID,
  p_product_id UUID,
  p_user_id UUID DEFAULT NULL
)
RETURNS DECIMAL AS $$
DECLARE
  v_balance DECIMAL;
BEGIN
  SELECT COALESCE(SUM(
    CASE
      WHEN movement_type IN ('delivery', 'allocation', 'assignment', 'return')
           AND to_user_id = COALESCE(p_user_id, to_user_id) THEN quantity
      WHEN movement_type IN ('allocation', 'assignment', 'return_to_stock', 'damage', 'loss')
           AND from_user_id = COALESCE(p_user_id, from_user_id) THEN -quantity
      ELSE 0
    END
  ), 0) INTO v_balance
  FROM stock_movements
  WHERE bar_id = p_bar_id
    AND product_id = p_product_id
    AND (p_user_id IS NULL OR from_user_id = p_user_id OR to_user_id = p_user_id);

  RETURN v_balance;
END;
$$ LANGUAGE plpgsql;
```

### 2.7.2 Log Event

```sql
CREATE OR REPLACE FUNCTION log_event(
  p_bar_id UUID,
  p_device_id UUID,
  p_user_id UUID,
  p_user_role user_role,
  p_shift_id UUID,
  p_event_type event_type,
  p_entity_type VARCHAR,
  p_entity_id UUID,
  p_payload JSONB,
  p_reason TEXT DEFAULT NULL,
  p_client_timestamp TIMESTAMPTZ DEFAULT now(),
  p_client_event_id UUID DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_event_id UUID;
BEGIN
  INSERT INTO events (
    bar_id, device_id, user_id, user_role, shift_id,
    event_type, entity_type, entity_id, payload, reason,
    client_timestamp, client_event_id
  ) VALUES (
    p_bar_id, p_device_id, p_user_id, p_user_role, p_shift_id,
    p_event_type, p_entity_type, p_entity_id, p_payload, p_reason,
    p_client_timestamp, p_client_event_id
  )
  RETURNING id INTO v_event_id;

  RETURN v_event_id;
END;
$$ LANGUAGE plpgsql;
```

---

# 3. State Machines

All state transitions are **append-only events**. The current state is derived from the event log.

## 3.1 Day State Machine

```
                    ┌─────────────┐
                    │   (start)   │
                    └──────┬──────┘
                           │ open_day()
                           ▼
                    ┌─────────────┐
              ┌────▶│    OPEN     │◀────┐
              │     └──────┬──────┘     │
              │            │            │
              │            │ close_day()│
              │            ▼            │
              │     ┌─────────────┐     │
              │     │   CLOSING   │     │
              │     └──────┬──────┘     │
              │            │            │
              │            │ [all shifts closed]
              │            ▼            │
              │     ┌─────────────┐     │
              │     │   CLOSED    │     │
              │     └──────┬──────┘     │
              │            │            │
              │            │ reconcile_day()
              │            ▼            │
              │     ┌─────────────┐     │
              └─────│ RECONCILED  │─────┘
                    └─────────────┘     (reopen with reason)
```

### Day Transition Rules

| From | To | Action | Who Can Do | Requirements |
|------|-----|--------|------------|--------------|
| - | OPEN | `open_day` | Manager | No open day exists for this date |
| OPEN | CLOSING | `close_day` | Manager | - |
| CLOSING | CLOSED | (automatic) | System | All shifts are closed |
| CLOSED | RECONCILED | `reconcile_day` | Manager/Owner | Review complete |
| RECONCILED | OPEN | `reopen_day` | Owner only | Reason required |

---

## 3.2 Shift State Machine

```
                    ┌─────────────┐
                    │   (start)   │
                    └──────┬──────┘
                           │ create_shift()
                           ▼
                    ┌─────────────┐
                    │  SCHEDULED  │
                    └──────┬──────┘
                           │ open_shift()
                           ▼
                    ┌─────────────┐
              ┌────▶│    OPEN     │◀────┐
              │     └──────┬──────┘     │
              │            │            │
              │            │ close_shift()
              │            ▼            │
              │     ┌─────────────┐     │
              │     │   CLOSING   │     │
              │     └──────┬──────┘     │
              │            │            │
              │            │ [all payments confirmed OR disputed]
              │            ▼            │
              │     ┌─────────────┐     │
              │     │   CLOSED    │     │
              │     └──────┬──────┘     │
              │            │            │
              │            │ reconcile_shift()
              │            ▼            │
              │     ┌─────────────┐     │
              └─────│ RECONCILED  │─────┘
                    └─────────────┘     (reopen with reason)
```

### Shift Transition Rules

| From | To | Action | Who Can Do | Requirements |
|------|-----|--------|------------|--------------|
| - | SCHEDULED | `create_shift` | Manager | Day must be OPEN |
| SCHEDULED | OPEN | `open_shift` | Manager | Day must be OPEN |
| OPEN | CLOSING | `close_shift` | Manager | - |
| CLOSING | CLOSED | (automatic) | System | No pending sales (all confirmed/disputed/reversed) |
| CLOSED | RECONCILED | `reconcile_shift` | Manager | - |
| RECONCILED | OPEN | `reopen_shift` | Manager/Owner | Reason required, creates new event |

### Shift Closure Checklist (Enforced)

Before a shift can move from CLOSING → CLOSED:
1. All sales must be: `confirmed`, `reversed`, or `disputed`
2. All stock assigned to servers must be: returned or accounted for
3. Bartender cash must match expected amount (or dispute created)

---

## 3.3 Sale State Machine

```
                    ┌─────────────┐
                    │   (start)   │
                    └──────┬──────┘
                           │ create_sale()
                           ▼
                    ┌─────────────┐
         ┌─────────▶│   PENDING   │◀─────────┐
         │          └──────┬──────┘          │
         │                 │                 │
         │    ┌────────────┼────────────┐    │
         │    │            │            │    │
         │    │ collect()  │ reverse()  │    │
         │    ▼            │            ▼    │
         │ ┌─────────┐     │     ┌──────────┐│
         │ │COLLECTED│     │     │ REVERSED ││
         │ └────┬────┘     │     └──────────┘│
         │      │          │                 │
         │      │ confirm()│                 │
         │      ▼          │                 │
         │ ┌─────────┐     │                 │
         │ │CONFIRMED│     │                 │
         │ └────┬────┘     │                 │
         │      │          │                 │
         │      │ dispute()│                 │
         │      ▼          ▼                 │
         │    ┌─────────────┐                │
         └────│  DISPUTED   │────────────────┘
              └─────────────┘   (resolve → back to appropriate state)
```

### Sale Transition Rules

| From | To | Action | Who Can Do | Requirements |
|------|-----|--------|------------|--------------|
| - | PENDING | `create_sale` | Bartender | Shift OPEN, server assigned to shift |
| PENDING | COLLECTED | `collect_payment` | Server (implicit) | Payment method & amount recorded |
| PENDING | REVERSED | `reverse_sale` | Bartender/Manager | Reason required |
| COLLECTED | CONFIRMED | `confirm_payment` | Bartender | Bartender received money |
| COLLECTED | REVERSED | `reverse_sale` | Manager only | Reason required (server already collected) |
| CONFIRMED | DISPUTED | `dispute_sale` | Manager | Creates dispute record |
| PENDING | DISPUTED | `dispute_sale` | Manager | Creates dispute record |
| DISPUTED | PENDING/CONFIRMED | `resolve_dispute` | Manager/Owner | Resolution recorded |

---

## 3.4 Stock Movement Flow

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   SUPPLIER   │────▶│   MANAGER    │────▶│  BARTENDER   │
│              │     │   (stock)    │     │  (contoire)  │
└──────────────┘     └──────┬───────┘     └──────┬───────┘
     delivery              │ allocation          │ assignment
                           │                     │
                           │                     ▼
                           │              ┌──────────────┐
                           │              │    SERVER    │
                           │              │  (serving)   │
                           │              └──────┬───────┘
                           │                     │
                           │      ┌──────────────┼──────────────┐
                           │      │              │              │
                           │      ▼              ▼              ▼
                           │ ┌────────┐    ┌─────────┐    ┌─────────┐
                           │ │ SOLD   │    │ RETURN  │    │  LOSS   │
                           │ │(sale)  │    │(reason) │    │(reason) │
                           │ └────────┘    └────┬────┘    └─────────┘
                           │                    │
                           │                    ▼
                           │              ┌──────────────┐
                           └──────────────│  BARTENDER   │
                                          │  (received)  │
                                          └──────────────┘
```

### Stock Custody Rules

| Movement | From | To | Performed By | Reason Required |
|----------|------|-----|--------------|-----------------|
| delivery | NULL (supplier) | Manager | Manager | No |
| allocation | Manager | Bartender | Manager | No |
| assignment | Bartender | Server | Bartender | No |
| return | Server | Bartender | Bartender | Yes |
| return_to_stock | Bartender | Manager | Manager | Yes |
| damage | Any holder | NULL | Holder/Manager | Yes |
| loss | Any holder | NULL | Manager | Yes |
| adjustment | - | - | Manager | Yes |

---

## 3.5 Dispute State Machine

```
                    ┌─────────────┐
                    │   (start)   │
                    └──────┬──────┘
                           │ open_dispute()
                           ▼
                    ┌─────────────┐
                    │    OPEN     │
                    └──────┬──────┘
                           │ review_dispute()
                           ▼
                    ┌─────────────┐
              ┌────▶│UNDER_REVIEW │
              │     └──────┬──────┘
              │            │
              │  ┌─────────┴─────────┐
              │  │                   │
              │  ▼                   ▼
              │ ┌────────┐    ┌───────────┐
              │ │RESOLVED│    │ ESCALATED │
              │ └────────┘    └─────┬─────┘
              │                     │
              │                     │ owner_resolve()
              │                     ▼
              │              ┌───────────┐
              └──────────────│ RESOLVED  │
                             └───────────┘
```

---

# 4. Authentication System

## 4.1 Overview

**NOT using Supabase Auth.** Custom phone + PIN system optimized for:
- Shared devices
- Low-literacy users
- Offline capability
- Rwanda phone numbers

## 4.2 Login Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                         LOGIN FLOW                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐  │
│  │  Enter   │───▶│  Enter   │───▶│  Verify  │───▶│  Select  │  │
│  │  Phone   │    │   PIN    │    │  Device  │    │   Bar    │  │
│  └──────────┘    └──────────┘    └──────────┘    └──────────┘  │
│       │               │               │               │         │
│       ▼               ▼               ▼               ▼         │
│  [Validate     [Hash & check   [Match device   [Load bar       │
│   format]       against DB]    fingerprint]    context]        │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 4.2.1 Phone Validation

```javascript
// Rwanda phone formats accepted:
// +250788123456 (international)
// 0788123456 (local)
// 788123456 (short)

function normalizePhone(phone) {
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.startsWith('250')) return '+' + cleaned;
  if (cleaned.startsWith('0')) return '+250' + cleaned.slice(1);
  return '+250' + cleaned;
}
```

### 4.2.2 PIN Rules

- Exactly 4 digits
- Hashed with Argon2id
- Max 5 failed attempts → 15 min lockout
- Stored in `auth_custom.credentials`

### 4.2.3 Device Verification

```javascript
// Generate device fingerprint
function getDeviceFingerprint() {
  return {
    userAgent: navigator.userAgent,
    screenResolution: `${screen.width}x${screen.height}`,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    language: navigator.language,
    // Hash these together
  };
}
```

**New device flow:**
1. User logs in on unknown device
2. System sends OTP to phone
3. User enters OTP
4. Device registered to bar
5. Manager must approve device (optional setting)

## 4.3 PIN Reset Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                       PIN RESET FLOW                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐  │
│  │  Enter   │───▶│  Send    │───▶│  Enter   │───▶│  Enter   │  │
│  │  Phone   │    │   OTP    │    │   OTP    │    │ New PIN  │  │
│  └──────────┘    └──────────┘    └──────────┘    └──────────┘  │
│       │               │               │               │         │
│       ▼               ▼               ▼               ▼         │
│  [Find user]   [Pindo SMS API] [Verify OTP]   [Hash & save]    │
│                 [6 digits]     [3 attempts]   [Log event]      │
│                 [5 min TTL]                                     │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 4.3.1 OTP via Pindo (Rwanda SMS Gateway)

```javascript
// Pindo API integration
async function sendOTP(phone) {
  const otp = generateOTP(); // 6 random digits

  await db.update('auth_custom.credentials', {
    otp_code: otp,
    otp_expires_at: new Date(Date.now() + 5 * 60 * 1000), // 5 minutes
    otp_attempts: 0
  }).where({ phone });

  await pindo.sendSMS({
    to: phone,
    text: `Your Izerebar code is: ${otp}. Valid for 5 minutes.`,
    sender: 'Izerebar'
  });
}
```

## 4.4 Session Management

```javascript
// Session token structure
{
  token: "random-256-bit-string",
  user_id: "uuid",
  bar_id: "uuid",
  device_id: "uuid",
  role: "bartender",
  expires_at: "2024-01-15T23:00:00Z",
  created_at: "2024-01-15T08:00:00Z"
}
```

### Session Rules

| Setting | Value | Reason |
|---------|-------|--------|
| Session duration | 12 hours | Full shift coverage |
| Idle timeout | 30 minutes | Shared device security |
| Max sessions per user | 2 | Allow bar + personal phone |
| Token storage | HttpOnly cookie + IndexedDB | Security + offline |

## 4.5 Lock Screen

For shared devices (contoires), bartenders can lock the screen:

```javascript
async function lockScreen(device_id, user_id) {
  // End current session
  await endDeviceSession(device_id, user_id, 'lock');

  // Mark device as locked
  await db.update('devices', {
    is_locked: true,
    locked_at: new Date(),
    locked_by: user_id
  }).where({ id: device_id });

  // Log event
  await logEvent({
    event_type: 'device_lock',
    device_id,
    user_id,
    // ...
  });

  // Show lock screen UI
  showLockScreen();
}
```

**Unlock requires:** PIN entry by any authorized user for that bar.

---

# 5. Offline Sync Protocol

## 5.1 Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         CLIENT                                   │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐         │
│  │    UI       │───▶│   Domain    │───▶│  Sync Queue │         │
│  │  (React)    │    │  (Actions)  │    │  (Dexie)    │         │
│  └─────────────┘    └─────────────┘    └──────┬──────┘         │
│                                               │                 │
│                                               ▼                 │
│                                        ┌─────────────┐         │
│                                        │  IndexedDB  │         │
│                                        │  (Dexie.js) │         │
│                                        └──────┬──────┘         │
│                                               │                 │
└───────────────────────────────────────────────┼─────────────────┘
                                                │
                                                │ (when online)
                                                ▼
┌───────────────────────────────────────────────┴─────────────────┐
│                         SERVER                                   │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐         │
│  │  Supabase   │───▶│   Domain    │───▶│  Postgres   │         │
│  │  Edge Fn    │    │   Logic     │    │  (Events)   │         │
│  └─────────────┘    └─────────────┘    └─────────────┘         │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## 5.2 Sync States

Every syncable record has a `sync_status`:

```typescript
type SyncStatus =
  | 'local'        // Created offline, never sent
  | 'pending'      // Sent to server, awaiting response
  | 'acknowledged' // Server received, processing
  | 'committed'    // Fully synced
  | 'conflict';    // Needs manual resolution
```

## 5.3 Offline Queue Structure

```typescript
// IndexedDB schema (Dexie.js)
const db = new Dexie('IzerebarOffline');

db.version(1).stores({
  // Sync queue
  syncQueue: '++id, entityType, entityId, action, status, createdAt',

  // Local cache of server data
  bars: 'id, name',
  users: 'id, phone',
  products: 'id, barId, name',
  shifts: 'id, barId, status',
  sales: 'id, barId, shiftId, status, syncStatus',
  stockMovements: 'id, barId, syncStatus',

  // Events (append-only locally too)
  localEvents: '++id, barId, eventType, clientTimestamp, syncStatus'
});
```

## 5.4 Sync Queue Entry

```typescript
interface SyncQueueEntry {
  id: number;                    // Auto-increment local ID
  clientId: string;              // UUID for deduplication
  entityType: string;            // 'sale', 'stock_movement', etc.
  entityId: string;              // Local UUID
  action: string;                // 'create', 'update_status', etc.
  payload: object;               // Full entity data
  status: SyncStatus;
  attempts: number;              // Retry count
  lastAttemptAt: Date | null;
  errorMessage: string | null;
  createdAt: Date;
  clientTimestamp: Date;         // When action happened
}
```

## 5.5 Sync Protocol

### 5.5.1 Creating Records Offline

```typescript
async function createSale(saleData: CreateSaleInput): Promise<Sale> {
  const clientId = generateUUID();
  const clientTimestamp = new Date();

  // 1. Create local record
  const sale: Sale = {
    id: clientId,
    ...saleData,
    status: 'pending',
    syncStatus: 'local',
    clientId,
    clientTimestamp,
    createdAt: clientTimestamp
  };

  await db.sales.add(sale);

  // 2. Add to sync queue
  await db.syncQueue.add({
    clientId,
    entityType: 'sale',
    entityId: clientId,
    action: 'create',
    payload: sale,
    status: 'local',
    attempts: 0,
    lastAttemptAt: null,
    errorMessage: null,
    createdAt: clientTimestamp,
    clientTimestamp
  });

  // 3. Log local event
  await db.localEvents.add({
    barId: sale.barId,
    eventType: 'sale_create',
    entityType: 'sale',
    entityId: clientId,
    payload: sale,
    clientTimestamp,
    syncStatus: 'local'
  });

  // 4. Trigger sync if online
  if (navigator.onLine) {
    syncManager.triggerSync();
  }

  return sale;
}
```

### 5.5.2 Sync Process

```typescript
class SyncManager {
  private isSyncing = false;
  private syncInterval = 30000; // 30 seconds

  async triggerSync() {
    if (this.isSyncing || !navigator.onLine) return;

    this.isSyncing = true;
    try {
      await this.processQueue();
      await this.pullServerChanges();
    } finally {
      this.isSyncing = false;
    }
  }

  private async processQueue() {
    const pendingItems = await db.syncQueue
      .where('status')
      .anyOf(['local', 'pending'])
      .sortBy('createdAt');

    for (const item of pendingItems) {
      try {
        // Update status to pending
        await db.syncQueue.update(item.id, {
          status: 'pending',
          attempts: item.attempts + 1,
          lastAttemptAt: new Date()
        });

        // Send to server
        const response = await this.sendToServer(item);

        if (response.success) {
          // Update local record with server ID if different
          if (response.serverId !== item.entityId) {
            await this.updateLocalId(item.entityType, item.entityId, response.serverId);
          }

          // Mark as committed
          await db.syncQueue.update(item.id, { status: 'committed' });
          await this.updateEntitySyncStatus(item.entityType, item.entityId, 'committed');

        } else if (response.conflict) {
          // Mark as conflict
          await db.syncQueue.update(item.id, {
            status: 'conflict',
            errorMessage: response.conflictReason
          });
          await this.updateEntitySyncStatus(item.entityType, item.entityId, 'conflict');

          // Notify user
          this.notifyConflict(item, response);
        }

      } catch (error) {
        // Network error - will retry
        await db.syncQueue.update(item.id, {
          errorMessage: error.message
        });

        // Stop processing if offline
        if (!navigator.onLine) break;
      }
    }
  }

  private async sendToServer(item: SyncQueueEntry) {
    return await supabase.rpc('sync_entity', {
      entity_type: item.entityType,
      action: item.action,
      client_id: item.clientId,
      payload: item.payload,
      client_timestamp: item.clientTimestamp
    });
  }
}
```

### 5.5.3 Server-Side Sync Handler

```sql
CREATE OR REPLACE FUNCTION sync_entity(
  p_entity_type VARCHAR,
  p_action VARCHAR,
  p_client_id UUID,
  p_payload JSONB,
  p_client_timestamp TIMESTAMPTZ
)
RETURNS JSONB AS $$
DECLARE
  v_result JSONB;
  v_existing_id UUID;
  v_conflict BOOLEAN := false;
  v_conflict_reason TEXT;
BEGIN
  -- Check for duplicate (idempotency)
  SELECT entity_id INTO v_existing_id
  FROM events
  WHERE client_event_id = p_client_id
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    -- Already processed, return success with existing ID
    RETURN jsonb_build_object(
      'success', true,
      'serverId', v_existing_id,
      'duplicate', true
    );
  END IF;

  -- Process based on entity type
  CASE p_entity_type
    WHEN 'sale' THEN
      v_result := process_sale_sync(p_action, p_payload, p_client_id, p_client_timestamp);
    WHEN 'stock_movement' THEN
      v_result := process_stock_sync(p_action, p_payload, p_client_id, p_client_timestamp);
    WHEN 'shift' THEN
      v_result := process_shift_sync(p_action, p_payload, p_client_id, p_client_timestamp);
    ELSE
      RAISE EXCEPTION 'Unknown entity type: %', p_entity_type;
  END CASE;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql;
```

## 5.6 Offline Indicators

```typescript
// React component for offline status
function OfflineIndicator() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Check pending sync items
    const checkPending = async () => {
      const count = await db.syncQueue
        .where('status')
        .anyOf(['local', 'pending'])
        .count();
      setPendingCount(count);
    };

    const interval = setInterval(checkPending, 5000);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      clearInterval(interval);
    };
  }, []);

  if (!isOnline) {
    return (
      <div className="offline-banner warning">
        ⚠️ Offline - Changes will sync when connected
        {pendingCount > 0 && ` (${pendingCount} pending)`}
      </div>
    );
  }

  if (pendingCount > 0) {
    return (
      <div className="offline-banner syncing">
        🔄 Syncing {pendingCount} changes...
      </div>
    );
  }

  return null;
}
```

## 5.7 Critical Offline Operations

These operations MUST work offline:

| Operation | Priority | Notes |
|-----------|----------|-------|
| Create sale | Critical | Core business operation |
| Confirm payment | Critical | Money tracking |
| Reverse sale | Critical | With reason |
| Assign stock to server | Critical | Accountability |
| Return stock | Critical | With reason |
| Lock/unlock device | Critical | Security |
| Open/close shift | High | Can queue if needed |
| View current shift sales | High | Read from local cache |
| View server obligations | High | Calculated locally |

---

# 6. Conflict Resolution

## 6.1 Conflict Types

| Type | Description | Resolution Strategy |
|------|-------------|---------------------|
| **Duplicate** | Same action sent twice | Server dedup by `client_id`, return existing |
| **Stale Update** | Entity changed on server since client read | Flag for review |
| **Constraint Violation** | e.g., negative stock, closed shift | Reject with error, create dispute |
| **Order Conflict** | Actions received out of order | Use `client_timestamp` for ordering |

## 6.2 Resolution Rules by Entity

### 6.2.1 Sales

| Scenario | Resolution |
|----------|------------|
| Same sale ID received twice | Deduplicate, return existing |
| Sale for closed shift | Reject, notify user to reopen shift |
| Sale confirmation conflict (two bartenders) | First write wins, second flagged |
| Payment amount mismatch | Create dispute, flag for manager |

### 6.2.2 Stock Movements

| Scenario | Resolution |
|----------|------------|
| Negative stock would result | Reject, notify insufficient stock |
| Allocation to offline bartender | Queue, process when they sync |
| Return for already-sold item | Reject, create dispute |

### 6.2.3 Shifts

| Scenario | Resolution |
|----------|------------|
| Two users open same shift | First wins, second notified |
| Close attempted while sales pending | Block until all confirmed/disputed |
| Shift reopened while other device cached closed | Notify other devices |

## 6.3 Conflict UI

```typescript
interface ConflictResolution {
  id: string;
  entityType: string;
  entityId: string;
  localVersion: object;
  serverVersion: object;
  conflictType: string;
  suggestedAction: 'keep_local' | 'keep_server' | 'merge' | 'manual';
  resolvedAt?: Date;
  resolvedBy?: string;
  resolution?: string;
}

// Conflict resolution screen
function ConflictResolutionScreen({ conflict }: { conflict: ConflictResolution }) {
  return (
    <div className="conflict-screen">
      <h2>⚠️ Sync Conflict</h2>
      <p>A conflict occurred while syncing. Please review:</p>

      <div className="versions">
        <div className="local">
          <h3>Your Version</h3>
          <pre>{JSON.stringify(conflict.localVersion, null, 2)}</pre>
        </div>
        <div className="server">
          <h3>Server Version</h3>
          <pre>{JSON.stringify(conflict.serverVersion, null, 2)}</pre>
        </div>
      </div>

      <div className="actions">
        <button onClick={() => resolve('keep_local')}>Keep Mine</button>
        <button onClick={() => resolve('keep_server')}>Keep Server</button>
        <button onClick={() => resolve('manual')}>Review Manually</button>
      </div>
    </div>
  );
}
```

## 6.4 Automatic Resolution (Where Safe)

```typescript
function attemptAutoResolve(conflict: ConflictResolution): boolean {
  // Auto-resolve only for non-financial, non-critical conflicts

  const safeToAutoResolve = [
    'shift_assignment',  // Last write wins
    'product_update',    // Last write wins
  ];

  if (!safeToAutoResolve.includes(conflict.entityType)) {
    return false; // Requires manual resolution
  }

  // For safe entities, use server version (most recent)
  applyServerVersion(conflict);
  return true;
}
```

---

# 7. API Endpoints

## 7.1 Authentication Endpoints

```typescript
// POST /api/auth/login
interface LoginRequest {
  phone: string;
  pin: string;
  deviceFingerprint: string;
}
interface LoginResponse {
  success: boolean;
  token?: string;
  user?: User;
  bars?: Bar[];         // Bars user has access to
  requiresOTP?: boolean; // New device
  error?: string;
}

// POST /api/auth/verify-otp
interface VerifyOTPRequest {
  phone: string;
  otp: string;
  deviceFingerprint: string;
}

// POST /api/auth/request-pin-reset
interface RequestPinResetRequest {
  phone: string;
}

// POST /api/auth/reset-pin
interface ResetPinRequest {
  phone: string;
  otp: string;
  newPin: string;
}

// POST /api/auth/logout
// (Invalidates current session)

// POST /api/auth/lock-device
interface LockDeviceRequest {
  deviceId: string;
}
```

## 7.2 Bar Management Endpoints

```typescript
// GET /api/bars
// Returns all bars user has access to

// GET /api/bars/:barId
// Returns bar details + current state

// POST /api/bars/:barId/select
// Sets active bar context for session
```

## 7.3 Day & Shift Endpoints

```typescript
// POST /api/bars/:barId/days/open
interface OpenDayRequest {
  businessDate: string; // YYYY-MM-DD
}

// POST /api/bars/:barId/days/:dayId/close
// Initiates day close process

// POST /api/bars/:barId/shifts/create
interface CreateShiftRequest {
  name?: string;
  scheduledStart?: string; // HH:MM
  scheduledEnd?: string;
}

// POST /api/bars/:barId/shifts/:shiftId/open

// POST /api/bars/:barId/shifts/:shiftId/close
interface CloseShiftRequest {
  reason?: string;
}

// POST /api/bars/:barId/shifts/:shiftId/assign
interface AssignToShiftRequest {
  userId: string;
  role: UserRole;
}
```

## 7.4 Stock Management Endpoints

```typescript
// POST /api/bars/:barId/stock/receive
interface ReceiveStockRequest {
  productId: string;
  quantity: number;
  costPerUnit?: number;
  supplierName?: string;
  invoiceReference?: string;
  notes?: string;
}

// POST /api/bars/:barId/stock/allocate
interface AllocateStockRequest {
  bartenderId: string;
  productId: string;
  quantity: number;
}

// POST /api/bars/:barId/stock/assign
interface AssignStockRequest {
  serverId: string;
  productId: string;
  quantity: number;
}

// POST /api/bars/:barId/stock/return
interface ReturnStockRequest {
  fromUserId: string;
  productId: string;
  quantity: number;
  reason: string; // Required
}

// POST /api/bars/:barId/stock/damage
interface ReportDamageRequest {
  productId: string;
  quantity: number;
  reason: string; // Required
}

// GET /api/bars/:barId/stock/balance
// Returns current stock levels by product and by user
```

## 7.5 Sales Endpoints

```typescript
// POST /api/bars/:barId/sales
interface CreateSaleRequest {
  shiftId: string;
  productId: string;
  quantity: number;
  serverId: string;
  // Price comes from product, not request (prevent manipulation)
}

// POST /api/bars/:barId/sales/:saleId/collect
interface CollectPaymentRequest {
  amount: number;
  paymentMethod: PaymentMethod;
}

// POST /api/bars/:barId/sales/:saleId/confirm
// Bartender confirms they received the money

// POST /api/bars/:barId/sales/:saleId/reverse
interface ReverseSaleRequest {
  reason: string; // Required
}

// POST /api/bars/:barId/sales/:saleId/dispute
interface DisputeSaleRequest {
  description: string;
}

// GET /api/bars/:barId/sales
// Query params: shiftId, serverId, status, dateFrom, dateTo

// GET /api/bars/:barId/sales/obligations
// Returns server obligations for current shift
```

## 7.6 Credit Endpoints

```typescript
// POST /api/bars/:barId/credits
interface CreateCreditRequest {
  shiftId: string;
  amount: number;
  customerDescription?: string;
  customerPhone?: string;
  notes?: string;
}

// POST /api/bars/:barId/credits/:creditId/collect
interface CollectCreditRequest {
  amount: number; // Can be partial
}

// GET /api/bars/:barId/credits
// Query params: isCollected, dateFrom, dateTo
```

## 7.7 Dispute Endpoints

```typescript
// POST /api/bars/:barId/disputes
interface CreateDisputeRequest {
  entityType: string;
  entityId?: string;
  amount?: number;
  description: string;
  responsibleUserId?: string;
}

// POST /api/bars/:barId/disputes/:disputeId/resolve
interface ResolveDisputeRequest {
  resolution: string;
}

// POST /api/bars/:barId/disputes/:disputeId/escalate

// GET /api/bars/:barId/disputes
// Query params: status, shiftId, dateFrom, dateTo
```

## 7.8 Reporting Endpoints

```typescript
// GET /api/bars/:barId/reports/daily
// Query params: date (YYYY-MM-DD)
interface DailyReportResponse {
  date: string;
  totalSales: number;
  salesByMethod: { cash: number; momo: number; credit: number };
  salesByCategory: Record<string, number>;
  topProducts: { productId: string; name: string; quantity: number; revenue: number }[];
  workerPerformance: { userId: string; name: string; sales: number; revenue: number }[];
  stockReceived: number;
  stockDamaged: number;
  stockLost: number;
  disputes: number;
  missingMoney: number;
}

// GET /api/bars/:barId/reports/weekly
// GET /api/bars/:barId/reports/monthly
// GET /api/bars/:barId/reports/custom
// Query params: dateFrom, dateTo

// GET /api/bars/:barId/reports/export
// Query params: format (xlsx, csv), dateFrom, dateTo
// Returns file download
```

## 7.9 Sync Endpoint

```typescript
// POST /api/sync
interface SyncRequest {
  barId: string;
  entities: SyncEntity[];
}

interface SyncEntity {
  entityType: string;
  action: string;
  clientId: string;
  payload: object;
  clientTimestamp: string;
}

interface SyncResponse {
  results: SyncResult[];
  serverTimestamp: string;
}

interface SyncResult {
  clientId: string;
  success: boolean;
  serverId?: string;
  conflict?: boolean;
  conflictReason?: string;
  error?: string;
}
```

---

# 8. Domain Rules & Validations

## 8.1 Universal Rules

```typescript
// Every mutating action must include:
interface ActionContext {
  barId: string;      // Required
  userId: string;     // Required
  userRole: UserRole; // Required
  deviceId: string;   // Required
  shiftId?: string;   // Required for operational actions
  timestamp: Date;    // Client timestamp
  reason?: string;    // Required for corrections/reversals
}

// Validate on every action
function validateActionContext(ctx: ActionContext, action: string): void {
  if (!ctx.barId) throw new Error('Bar context required');
  if (!ctx.userId) throw new Error('User context required');
  if (!ctx.deviceId) throw new Error('Device context required');

  // Check user has role in this bar
  const userRole = getUserRoleInBar(ctx.userId, ctx.barId);
  if (!userRole) throw new Error('User has no role in this bar');

  // Check device belongs to this bar
  const device = getDevice(ctx.deviceId);
  if (device.barId !== ctx.barId) throw new Error('Device not registered to this bar');

  // For operational actions, require open shift
  if (requiresOpenShift(action)) {
    if (!ctx.shiftId) throw new Error('Shift context required');
    const shift = getShift(ctx.shiftId);
    if (shift.status !== 'open') throw new Error('Shift is not open');
  }
}
```

## 8.2 Role-Based Permissions

```typescript
const PERMISSIONS: Record<UserRole, string[]> = {
  owner: [
    // All permissions
    '*'
  ],

  manager: [
    // Day & Shift
    'day:open', 'day:close', 'day:reconcile',
    'shift:create', 'shift:open', 'shift:close', 'shift:reconcile', 'shift:assign',
    // Stock
    'stock:receive', 'stock:allocate', 'stock:adjust', 'stock:damage', 'stock:loss',
    // Sales
    'sale:view', 'sale:reverse', 'sale:dispute',
    // Users
    'user:view', 'user:suspend',
    // Credits
    'credit:create', 'credit:collect',
    // Disputes
    'dispute:create', 'dispute:resolve',
    // Reports
    'report:view', 'report:export'
  ],

  bartender: [
    // Stock (at their contoire)
    'stock:view_own', 'stock:assign', 'stock:return', 'stock:damage',
    // Sales
    'sale:create', 'sale:view', 'sale:confirm', 'sale:reverse_pending',
    // Device
    'device:lock', 'device:unlock', 'device:view_sessions'
  ],

  server: [
    // Sales
    'sale:view_own', 'sale:collect'
  ],

  kitchen: [
    // Very limited - just view assigned orders
    'order:view'
  ]
};

function checkPermission(role: UserRole, action: string): boolean {
  const perms = PERMISSIONS[role];
  if (perms.includes('*')) return true;
  if (perms.includes(action)) return true;
  // Check wildcards like 'sale:*'
  const [resource] = action.split(':');
  if (perms.includes(`${resource}:*`)) return true;
  return false;
}
```

## 8.3 Stock Rules

```typescript
// Rule: Stock cannot go negative
function validateStockMovement(movement: StockMovement): void {
  if (movement.movementType === 'assignment' ||
      movement.movementType === 'allocation' ||
      movement.movementType === 'damage' ||
      movement.movementType === 'loss') {

    const currentBalance = getStockBalance(
      movement.barId,
      movement.productId,
      movement.fromUserId
    );

    if (currentBalance < movement.quantity) {
      throw new Error(
        `Insufficient stock. Available: ${currentBalance}, Requested: ${movement.quantity}`
      );
    }
  }
}

// Rule: Returns require reason
function validateReturn(movement: StockMovement): void {
  if (movement.movementType === 'return' && !movement.reason) {
    throw new Error('Reason required for stock return');
  }
}

// Rule: Only bartender can receive assignment
function validateAssignment(movement: StockMovement): void {
  if (movement.movementType === 'assignment') {
    const recipientRole = getUserRoleInBar(movement.toUserId, movement.barId);
    if (recipientRole !== 'server') {
      throw new Error('Stock can only be assigned to servers');
    }
  }
}
```

## 8.4 Sale Rules

```typescript
// Rule: Sales only during open shift
function validateSaleCreation(sale: Sale): void {
  const shift = getShift(sale.shiftId);
  if (shift.status !== 'open') {
    throw new Error('Cannot create sale: shift is not open');
  }
}

// Rule: Server must be assigned to shift
function validateServerAssignment(sale: Sale): void {
  const isAssigned = isUserAssignedToShift(sale.assignedToServerId, sale.shiftId);
  if (!isAssigned) {
    throw new Error('Server is not assigned to this shift');
  }
}

// Rule: Price comes from product, not request
function calculateSalePrice(productId: string, quantity: number): number {
  const product = getProduct(productId);
  return product.sellingPriceRwf * quantity;
}

// Rule: Reversal requires reason
function validateReversal(saleId: string, reason: string | undefined): void {
  if (!reason || reason.trim().length < 5) {
    throw new Error('Reversal requires a reason (minimum 5 characters)');
  }
}

// Rule: Only pending sales can be reversed by bartender
function validateBartenderReversal(sale: Sale, userRole: UserRole): void {
  if (userRole === 'bartender' && sale.status !== 'pending') {
    throw new Error('Bartenders can only reverse pending sales. Contact manager.');
  }
}
```

## 8.5 Payment Rules

```typescript
// Rule: Collected amount can differ from expected (tips, discounts with manager approval)
function validateCollection(sale: Sale, collectedAmount: number): void {
  const expectedAmount = sale.totalPriceRwf;
  const difference = Math.abs(expectedAmount - collectedAmount);
  const percentDiff = (difference / expectedAmount) * 100;

  // More than 10% difference requires note
  if (percentDiff > 10) {
    // This is allowed but should be flagged for review
    console.log(`Large payment difference: expected ${expectedAmount}, collected ${collectedAmount}`);
  }
}

// Rule: Confirmation means bartender received physical money
function validateConfirmation(sale: Sale, bartenderId: string): void {
  if (sale.status !== 'collected') {
    throw new Error('Can only confirm collected sales');
  }

  // Bartender confirming should be same as who created the sale
  // (or a manager)
  if (sale.assignedByBartenderId !== bartenderId) {
    const role = getUserRoleInBar(bartenderId, sale.barId);
    if (role !== 'manager' && role !== 'owner') {
      throw new Error('Only the original bartender or manager can confirm this sale');
    }
  }
}
```

## 8.6 Shift Closure Rules

```typescript
async function validateShiftClosure(shiftId: string): Promise<string[]> {
  const issues: string[] = [];

  // Check for pending sales
  const pendingSales = await db.sales
    .where({ shiftId, status: 'pending' })
    .count();
  if (pendingSales > 0) {
    issues.push(`${pendingSales} sales still pending`);
  }

  // Check for collected but unconfirmed sales
  const unconfirmedSales = await db.sales
    .where({ shiftId, status: 'collected' })
    .count();
  if (unconfirmedSales > 0) {
    issues.push(`${unconfirmedSales} sales collected but not confirmed`);
  }

  // Check for unresolved disputes
  const openDisputes = await db.disputes
    .where({ shiftId })
    .filter(d => d.status === 'open' || d.status === 'under_review')
    .count();
  if (openDisputes > 0) {
    issues.push(`${openDisputes} unresolved disputes`);
  }

  // Check stock assigned to servers not returned
  const outstandingStock = await getOutstandingServerStock(shiftId);
  if (outstandingStock.length > 0) {
    issues.push(`Stock still assigned to servers: ${outstandingStock.map(s => s.serverName).join(', ')}`);
  }

  return issues;
}

// Shift can close with issues, but they become disputes
async function closeShiftWithIssues(shiftId: string, issues: string[]): Promise<void> {
  for (const issue of issues) {
    await createDispute({
      shiftId,
      entityType: 'shift_closure',
      description: issue,
      status: 'open'
    });
  }

  await updateShiftStatus(shiftId, 'closed');
}
```

---

# 9. Security & Fraud Prevention

## 9.1 Security Layers

```
┌─────────────────────────────────────────────────────────────────┐
│                      SECURITY LAYERS                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. TRANSPORT        HTTPS only, TLS 1.3                        │
│  ─────────────────────────────────────────────────────────────  │
│                                                                  │
│  2. AUTHENTICATION   Phone + PIN, OTP for new devices           │
│  ─────────────────────────────────────────────────────────────  │
│                                                                  │
│  3. AUTHORIZATION    Role-based (RLS), per-bar isolation        │
│  ─────────────────────────────────────────────────────────────  │
│                                                                  │
│  4. DEVICE TRUST     Fingerprint, registration, lock/unlock     │
│  ─────────────────────────────────────────────────────────────  │
│                                                                  │
│  5. AUDIT TRAIL      Append-only events, full traceability      │
│  ─────────────────────────────────────────────────────────────  │
│                                                                  │
│  6. DATA INTEGRITY   Constraints, checksums, tamper detection   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## 9.2 Fraud Detection Patterns

### 9.2.1 Anomaly Detection

```typescript
interface FraudAlert {
  type: string;
  severity: 'low' | 'medium' | 'high';
  description: string;
  entities: string[];
  detectedAt: Date;
}

async function detectAnomalies(barId: string): Promise<FraudAlert[]> {
  const alerts: FraudAlert[] = [];

  // 1. High reversal rate
  const reversalRate = await calculateReversalRate(barId, 'today');
  if (reversalRate > 0.1) { // More than 10% reversed
    alerts.push({
      type: 'high_reversal_rate',
      severity: 'medium',
      description: `Reversal rate of ${(reversalRate * 100).toFixed(1)}% today`,
      entities: [],
      detectedAt: new Date()
    });
  }

  // 2. Sales outside shift hours
  const afterHoursSales = await findAfterHoursSales(barId);
  if (afterHoursSales.length > 0) {
    alerts.push({
      type: 'after_hours_sales',
      severity: 'high',
      description: `${afterHoursSales.length} sales recorded outside shift hours`,
      entities: afterHoursSales.map(s => s.id),
      detectedAt: new Date()
    });
  }

  // 3. Unusual stock movements
  const suspiciousReturns = await findSuspiciousReturns(barId);
  if (suspiciousReturns.length > 0) {
    alerts.push({
      type: 'suspicious_returns',
      severity: 'medium',
      description: `${suspiciousReturns.length} unusual stock returns`,
      entities: suspiciousReturns.map(s => s.id),
      detectedAt: new Date()
    });
  }

  // 4. Server with high missing money
  const serverDeficits = await calculateServerDeficits(barId, 'week');
  for (const [serverId, deficit] of Object.entries(serverDeficits)) {
    if (deficit > 50000) { // More than 50,000 RWF missing
      alerts.push({
        type: 'server_deficit',
        severity: 'high',
        description: `Server has ${deficit} RWF missing this week`,
        entities: [serverId],
        detectedAt: new Date()
      });
    }
  }

  return alerts;
}
```

### 9.2.2 Pattern Matching

```typescript
// Suspicious patterns to watch for
const FRAUD_PATTERNS = [
  {
    name: 'Void and Re-ring',
    description: 'Sale reversed then identical sale created (skimming)',
    detect: async (barId: string) => {
      return db.query(`
        SELECT s1.id as original, s2.id as new_sale
        FROM sales s1
        JOIN sales s2 ON s1.product_id = s2.product_id
          AND s1.quantity = s2.quantity
          AND s1.assigned_to_server_id = s2.assigned_to_server_id
        WHERE s1.bar_id = $1
          AND s1.status = 'reversed'
          AND s2.created_at > s1.reversed_at
          AND s2.created_at < s1.reversed_at + INTERVAL '10 minutes'
      `, [barId]);
    }
  },
  {
    name: 'Split Sales',
    description: 'Large orders split into small sales (avoiding oversight)',
    detect: async (barId: string) => {
      return db.query(`
        SELECT assigned_to_server_id, COUNT(*) as sale_count
        FROM sales
        WHERE bar_id = $1
          AND created_at > NOW() - INTERVAL '1 hour'
          AND total_price_rwf < 1000
        GROUP BY assigned_to_server_id
        HAVING COUNT(*) > 20
      `, [barId]);
    }
  },
  {
    name: 'End of Shift Reversals',
    description: 'Many reversals right before shift closes (hiding theft)',
    detect: async (barId: string) => {
      return db.query(`
        SELECT shift_id, COUNT(*) as reversal_count
        FROM sales s
        JOIN shifts sh ON s.shift_id = sh.id
        WHERE s.bar_id = $1
          AND s.status = 'reversed'
          AND s.reversed_at > sh.closed_at - INTERVAL '30 minutes'
        GROUP BY shift_id
        HAVING COUNT(*) > 5
      `, [barId]);
    }
  }
];
```

## 9.3 Audit Trail

```typescript
// Every action is logged with full context
async function logEvent(event: Event): Promise<void> {
  // Append-only - no way to delete
  await db.events.insert({
    id: generateUUID(),
    bar_id: event.barId,
    device_id: event.deviceId,  // ALWAYS required
    user_id: event.userId,      // ALWAYS required
    user_role: event.userRole,  // ALWAYS required
    shift_id: event.shiftId,
    event_type: event.eventType,
    entity_type: event.entityType,
    entity_id: event.entityId,
    payload: event.payload,     // Full data snapshot
    reason: event.reason,
    client_timestamp: event.clientTimestamp,
    server_timestamp: new Date()
  });
}

// Audit queries
async function getAuditTrail(entityType: string, entityId: string): Promise<Event[]> {
  return db.events
    .where({ entity_type: entityType, entity_id: entityId })
    .orderBy('server_timestamp', 'asc')
    .toArray();
}

async function getUserActions(userId: string, dateRange: DateRange): Promise<Event[]> {
  return db.events
    .where({ user_id: userId })
    .filter(e => e.server_timestamp >= dateRange.from && e.server_timestamp <= dateRange.to)
    .orderBy('server_timestamp', 'desc')
    .toArray();
}

async function getDeviceActions(deviceId: string, sessionId: string): Promise<Event[]> {
  // Get all actions on device during a specific session
  const session = await db.device_sessions.get(sessionId);
  return db.events
    .where({ device_id: deviceId })
    .filter(e =>
      e.server_timestamp >= session.started_at &&
      (!session.ended_at || e.server_timestamp <= session.ended_at)
    )
    .orderBy('server_timestamp', 'asc')
    .toArray();
}
```

## 9.4 Data Integrity

```sql
-- Prevent updates on events table
CREATE OR REPLACE FUNCTION prevent_event_update()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Events table is append-only. Updates not allowed.';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_prevent_event_update
BEFORE UPDATE ON events
FOR EACH ROW
EXECUTE FUNCTION prevent_event_update();

-- Prevent deletes on events table
CREATE OR REPLACE FUNCTION prevent_event_delete()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Events table is append-only. Deletes not allowed.';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_prevent_event_delete
BEFORE DELETE ON events
FOR EACH ROW
EXECUTE FUNCTION prevent_event_delete();

-- Same for sales, stock_movements, etc.
```

---

# 10. Reporting System

## 10.1 Report Types

| Report | Frequency | Who Can View | Data Source |
|--------|-----------|--------------|-------------|
| Shift Summary | Per shift | Manager, Owner | Real-time + shift_summaries |
| Daily Summary | Daily | Manager, Owner | daily_summaries |
| Weekly Report | Weekly | Owner | Aggregated daily_summaries |
| Monthly Report | Monthly | Owner | Aggregated daily_summaries |
| Worker Performance | On demand | Owner | sales + events |
| Stock Report | On demand | Manager, Owner | stock_movements |
| Profit Analysis | Weekly/Monthly | Owner | sales + stock_batches |

## 10.2 Report Generation

```typescript
interface DailyReport {
  barId: string;
  barName: string;
  businessDate: string;
  generatedAt: string;
  generatedBy: string;

  // Sales
  sales: {
    total: number;
    count: number;
    byMethod: {
      cash: number;
      momo: number;
      credit: number;
    };
    byCategory: Record<string, number>;
    byHour: Record<number, number>;
  };

  // Stock
  stock: {
    received: { count: number; value: number };
    damaged: { count: number; value: number };
    lost: { count: number; value: number };
  };

  // Workers
  workers: {
    userId: string;
    name: string;
    role: string;
    salesCount: number;
    salesValue: number;
    reversals: number;
    disputes: number;
  }[];

  // Issues
  issues: {
    disputes: number;
    missingMoney: number;
    unconfirmedSales: number;
  };

  // Checksum for tamper detection
  checksum: string;
}

async function generateDailyReport(barId: string, date: string): Promise<DailyReport> {
  const bar = await getBar(barId);
  const day = await getDay(barId, date);

  // Gather all data
  const sales = await getSalesForDay(barId, date);
  const stockMovements = await getStockMovementsForDay(barId, date);
  const disputes = await getDisputesForDay(barId, date);

  const report: DailyReport = {
    barId,
    barName: bar.name,
    businessDate: date,
    generatedAt: new Date().toISOString(),
    generatedBy: 'system',

    sales: aggregateSales(sales),
    stock: aggregateStock(stockMovements),
    workers: aggregateWorkerPerformance(sales),
    issues: {
      disputes: disputes.length,
      missingMoney: calculateMissingMoney(sales),
      unconfirmedSales: sales.filter(s => s.status === 'pending' || s.status === 'collected').length
    },

    checksum: '' // Calculated below
  };

  // Generate checksum for tamper detection
  report.checksum = generateChecksum(report);

  // Store in daily_summaries
  await storeDailySummary(report);

  return report;
}

function generateChecksum(report: DailyReport): string {
  const data = JSON.stringify({
    barId: report.barId,
    date: report.businessDate,
    totalSales: report.sales.total,
    salesCount: report.sales.count,
    generatedAt: report.generatedAt
  });
  return crypto.createHash('sha256').update(data).digest('hex').slice(0, 16);
}
```

## 10.3 Printable Reports

```typescript
interface PrintableReport {
  header: {
    barName: string;
    reportTitle: string;
    dateRange: string;
    generatedAt: string;
    reportId: string;
    checksum: string;
  };

  body: string; // HTML content

  footer: {
    signatureLines: { role: string; name: string }[];
    disclaimer: string;
  };
}

function generatePrintableHTML(report: DailyReport): string {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .header { border-bottom: 2px solid #000; padding-bottom: 10px; }
        .bar-name { font-size: 24px; font-weight: bold; }
        .report-id { font-size: 10px; color: #666; }
        table { width: 100%; border-collapse: collapse; margin: 20px 0; }
        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
        th { background-color: #f4f4f4; }
        .signature-line { margin-top: 50px; border-top: 1px solid #000; width: 200px; }
        .checksum { font-family: monospace; font-size: 10px; }
        @media print {
          .no-print { display: none; }
        }
      </style>
    </head>
    <body>
      <div class="header">
        <div class="bar-name">${report.barName}</div>
        <div>Daily Report - ${report.businessDate}</div>
        <div class="report-id">Report ID: ${generateReportId(report)}</div>
      </div>

      <h2>Sales Summary</h2>
      <table>
        <tr><th>Total Sales</th><td>${formatMoney(report.sales.total)} RWF</td></tr>
        <tr><th>Number of Sales</th><td>${report.sales.count}</td></tr>
        <tr><th>Cash</th><td>${formatMoney(report.sales.byMethod.cash)} RWF</td></tr>
        <tr><th>Mobile Money</th><td>${formatMoney(report.sales.byMethod.momo)} RWF</td></tr>
        <tr><th>Credit</th><td>${formatMoney(report.sales.byMethod.credit)} RWF</td></tr>
      </table>

      <h2>Worker Performance</h2>
      <table>
        <tr>
          <th>Name</th>
          <th>Role</th>
          <th>Sales</th>
          <th>Revenue</th>
        </tr>
        ${report.workers.map(w => `
          <tr>
            <td>${w.name}</td>
            <td>${w.role}</td>
            <td>${w.salesCount}</td>
            <td>${formatMoney(w.salesValue)} RWF</td>
          </tr>
        `).join('')}
      </table>

      <h2>Issues</h2>
      <table>
        <tr><th>Disputes</th><td>${report.issues.disputes}</td></tr>
        <tr><th>Missing Money</th><td>${formatMoney(report.issues.missingMoney)} RWF</td></tr>
      </table>

      <div class="footer">
        <p>Generated by Izerebar System at ${report.generatedAt}</p>
        <p class="checksum">Checksum: ${report.checksum}</p>

        <div style="display: flex; gap: 100px; margin-top: 50px;">
          <div>
            <div class="signature-line"></div>
            <p>Manager Signature</p>
          </div>
          <div>
            <div class="signature-line"></div>
            <p>Owner Signature</p>
          </div>
        </div>
      </div>
    </body>
    </html>
  `;
}
```

## 10.4 Export Formats

```typescript
async function exportReport(
  barId: string,
  dateFrom: string,
  dateTo: string,
  format: 'xlsx' | 'csv' | 'pdf'
): Promise<Buffer> {
  const data = await getReportData(barId, dateFrom, dateTo);

  switch (format) {
    case 'xlsx':
      return generateExcel(data);
    case 'csv':
      return generateCSV(data);
    case 'pdf':
      return generatePDF(data);
  }
}

function generateExcel(data: ReportData): Buffer {
  const workbook = new ExcelJS.Workbook();

  // Summary sheet
  const summary = workbook.addWorksheet('Summary');
  summary.addRow(['Date Range', `${data.dateFrom} to ${data.dateTo}`]);
  summary.addRow(['Total Sales', data.totalSales]);
  // ... more rows

  // Daily breakdown sheet
  const daily = workbook.addWorksheet('Daily Breakdown');
  daily.addRow(['Date', 'Sales Count', 'Revenue', 'Cash', 'MoMo', 'Credit']);
  for (const day of data.dailyBreakdown) {
    daily.addRow([day.date, day.count, day.revenue, day.cash, day.momo, day.credit]);
  }

  // Worker performance sheet
  const workers = workbook.addWorksheet('Worker Performance');
  // ...

  return workbook.xlsx.writeBuffer();
}
```

---

# 11. Affiliate System

## 11.1 Agent Structure

```sql
-- Agent can only see bars they onboarded
-- Agent cannot see operational or financial details

CREATE TABLE affiliate.agents (
  id UUID PRIMARY KEY,
  phone VARCHAR(20) NOT NULL UNIQUE,
  full_name VARCHAR(100) NOT NULL,
  commission_rate DECIMAL(5,2) DEFAULT 10.00, -- Percentage
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE affiliate.agent_bars (
  id UUID PRIMARY KEY,
  agent_id UUID NOT NULL REFERENCES affiliate.agents(id),
  bar_id UUID NOT NULL REFERENCES public.bars(id),
  onboarded_at TIMESTAMPTZ DEFAULT now(),
  is_active BOOLEAN DEFAULT true,
  UNIQUE (agent_id, bar_id)
);
```

## 11.2 Commission Calculation

```typescript
async function calculateCommissions(periodStart: Date, periodEnd: Date): Promise<void> {
  const agents = await db.query('SELECT * FROM affiliate.agents WHERE is_active = true');

  for (const agent of agents) {
    const bars = await db.query(`
      SELECT ab.bar_id, b.subscription_status
      FROM affiliate.agent_bars ab
      JOIN bars b ON ab.bar_id = b.id
      WHERE ab.agent_id = $1 AND ab.is_active = true
    `, [agent.id]);

    let totalCommission = 0;

    for (const bar of bars) {
      if (bar.subscription_status === 'active') {
        // Get subscription payment for period
        const payment = await getSubscriptionPayment(bar.bar_id, periodStart, periodEnd);
        if (payment) {
          const commission = payment.amount * (agent.commission_rate / 100);
          totalCommission += commission;

          // Record commission
          await db.query(`
            INSERT INTO affiliate.commissions (agent_id, bar_id, period_start, period_end, amount_rwf)
            VALUES ($1, $2, $3, $4, $5)
          `, [agent.id, bar.bar_id, periodStart, periodEnd, commission]);
        }
      }
    }
  }
}
```

## 11.3 Agent Dashboard (Separate UI)

```typescript
// Agent can only see:
// - List of bars they onboarded
// - Subscription status of each bar
// - Their commission history
// - Total pending/paid commissions

interface AgentDashboard {
  agent: {
    id: string;
    name: string;
    phone: string;
    commissionRate: number;
  };

  bars: {
    id: string;
    name: string;
    onboardedAt: string;
    subscriptionStatus: string;
    lastActive: string; // Last time bar used system
  }[];

  commissions: {
    pending: number;
    paid: number;
    history: {
      period: string;
      amount: number;
      status: string;
    }[];
  };
}

// Agent CANNOT see:
// - Bar revenue
// - Bar sales details
// - Employee information
// - Any operational data
```

---

# 12. Infrastructure & Deployment

## 12.1 Supabase Project Structure

```
izerebar-production/
├── Database
│   ├── public schema (bar operations)
│   ├── auth_custom schema (authentication)
│   ├── affiliate schema (agents)
│   └── platform schema (admin)
│
├── Edge Functions
│   ├── auth/
│   │   ├── login.ts
│   │   ├── verify-otp.ts
│   │   └── reset-pin.ts
│   ├── sync/
│   │   └── sync-entities.ts
│   ├── reports/
│   │   └── generate-report.ts
│   └── sms/
│       └── send-otp.ts
│
├── Storage (Supabase Storage)
│   ├── profile-images/
│   └── exported-reports/
│
└── Realtime
    └── Enabled for: shifts, sales (for live updates)
```

## 12.2 Environment Configuration

```bash
# .env.production
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_ANON_KEY=xxx
SUPABASE_SERVICE_KEY=xxx  # Server-side only

PINDO_API_KEY=xxx
PINDO_SENDER_ID=Izerebar

# Feature flags
ENABLE_OFFLINE_MODE=true
ENABLE_REALTIME_UPDATES=true
MAX_OFFLINE_HOURS=24

# Limits
MAX_BARS_PER_OWNER=10
MAX_DEVICES_PER_BAR=5
SESSION_DURATION_HOURS=12
```

## 12.3 Backup Strategy

```typescript
// Daily automated backups via Supabase
// Additional backup to external storage

async function dailyBackup(): Promise<void> {
  // 1. Supabase handles automatic backups

  // 2. Export critical tables to external storage (optional)
  const tables = ['events', 'sales', 'stock_movements', 'daily_summaries'];

  for (const table of tables) {
    const data = await db.query(`SELECT * FROM ${table} WHERE created_at > NOW() - INTERVAL '1 day'`);
    await uploadToBackupStorage(`${table}_${new Date().toISOString()}.json`, data);
  }
}

// Recovery procedure
async function restoreBar(barId: string, backupDate: string): Promise<void> {
  // Events are source of truth - rebuild state from events
  const events = await getEventsFromBackup(barId, backupDate);

  for (const event of events) {
    await replayEvent(event);
  }
}
```

## 12.4 Monitoring

```typescript
// Key metrics to monitor
const METRICS = {
  // System health
  apiLatency: 'p95 response time',
  errorRate: 'errors per minute',
  activeUsers: 'users active in last 5 minutes',

  // Business metrics
  activeBars: 'bars with activity today',
  syncQueueDepth: 'pending sync items',
  conflictRate: 'sync conflicts per hour',

  // Fraud indicators
  reversalRate: 'reversals as % of sales',
  afterHoursActivity: 'actions outside normal hours',
  largeTransactions: 'transactions > 100,000 RWF'
};

// Alert thresholds
const ALERTS = {
  errorRate: { threshold: 10, window: '5m', severity: 'critical' },
  syncQueueDepth: { threshold: 1000, window: '1h', severity: 'warning' },
  reversalRate: { threshold: 0.15, window: '1d', severity: 'warning' }
};
```

## 12.5 Scaling Considerations

| Scale | Bars | Plan | Monthly Cost | Notes |
|-------|------|------|--------------|-------|
| MVP | 1-50 | Supabase Free/Pro | $0-25 | Sufficient for launch |
| Growth | 50-200 | Supabase Pro | $25-100 | Add read replicas if needed |
| Scale | 200-1000 | Supabase Team | $599 | Dedicated resources |
| Enterprise | 1000+ | Supabase Enterprise | Custom | Custom scaling |

**Optimization strategies:**
1. Partition events table by month
2. Use materialized views for reports
3. Implement read replicas for reporting queries
4. Cache frequently accessed data (products, users)
5. Lazy load historical data

---

# Appendix A: Glossary

| Term | Definition |
|------|------------|
| Contoire | Bar counter/station with a device for operations |
| RWF | Rwandan Franc (currency) |
| MoMo | Mobile Money (e.g., MTN Mobile Money) |
| Shift | Time-bound work period with assigned staff |
| Day | Business day (may span midnight) |
| Custody | Responsibility for stock items |
| Reversal | Cancellation of a sale with reason |
| Dispute | Flagged issue requiring review |

---

# Appendix B: Quick Reference

## State Transitions

```
Day:      open → closing → closed → reconciled
Shift:    scheduled → open → closing → closed → reconciled
Sale:     pending → collected → confirmed (or reversed/disputed)
Dispute:  open → under_review → resolved (or escalated)
```

## Permission Quick Reference

| Action | Owner | Manager | Bartender | Server |
|--------|-------|---------|-----------|--------|
| Open/Close Day | - | ✓ | - | - |
| Open/Close Shift | - | ✓ | - | - |
| Receive Stock | - | ✓ | - | - |
| Allocate Stock | - | ✓ | - | - |
| Assign to Server | - | - | ✓ | - |
| Create Sale | - | - | ✓ | - |
| Collect Payment | - | - | - | ✓ |
| Confirm Payment | - | - | ✓ | - |
| Reverse Sale | - | ✓ | ✓* | - |
| View Reports | ✓ | ✓ | - | - |
| Export Reports | ✓ | - | - | - |

*Bartender can only reverse pending sales

---

*End of Izerebar Architecture Specification*

*Version: 1.0*
*Last Updated: 2024*
*Status: Implementation-Ready*
