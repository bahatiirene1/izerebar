-- ============================================
-- IZEREBAR DATABASE SCHEMA
-- Migration: 00001_enums.sql
-- Description: Create all enum types
-- Implements: ARCHITECTURE.md Section 2.2
-- ============================================

-- User roles within a bar
CREATE TYPE user_role AS ENUM (
  'owner',
  'manager',
  'bartender',
  'server',
  'kitchen'
);

COMMENT ON TYPE user_role IS 'Roles a user can have within a bar';

-- Shift states
CREATE TYPE shift_status AS ENUM (
  'scheduled',    -- Created but not started
  'open',         -- Active, operations allowed
  'closing',      -- End initiated, reconciliation in progress
  'closed',       -- Fully closed, no more operations
  'reconciled'    -- Manager reviewed and approved
);

COMMENT ON TYPE shift_status IS 'State machine states for shifts';

-- Day states
CREATE TYPE day_status AS ENUM (
  'open',         -- Day is active
  'closing',      -- End of day initiated
  'closed',       -- All shifts closed
  'reconciled'    -- Owner/manager reviewed
);

COMMENT ON TYPE day_status IS 'State machine states for business days';

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

COMMENT ON TYPE movement_type IS 'Types of stock movements for custody tracking';

-- Sale states
CREATE TYPE sale_status AS ENUM (
  'pending',      -- Assigned to server, not paid
  'collected',    -- Server collected money
  'confirmed',    -- Bartender confirmed payment
  'reversed',     -- Sale reversed (with reason)
  'disputed'      -- Under review
);

COMMENT ON TYPE sale_status IS 'State machine states for sales';

-- Payment methods
CREATE TYPE payment_method AS ENUM (
  'cash',
  'momo',         -- Mobile Money (MTN, Airtel)
  'credit'        -- On credit (tracked separately)
);

COMMENT ON TYPE payment_method IS 'Accepted payment methods';

-- Sync states for offline operations
CREATE TYPE sync_status AS ENUM (
  'local',        -- Created offline, never sent
  'pending',      -- Sent to server, awaiting response
  'acknowledged', -- Server received, processing
  'committed',    -- Fully synced
  'conflict'      -- Needs manual resolution
);

COMMENT ON TYPE sync_status IS 'Sync states for offline-first operations';

-- Event types for audit log
CREATE TYPE event_type AS ENUM (
  -- Auth events
  'login',
  'logout',
  'pin_change',
  'device_lock',
  'device_unlock',
  -- Shift events
  'shift_create',
  'shift_open',
  'shift_close',
  'shift_reconcile',
  -- Day events
  'day_open',
  'day_close',
  'day_reconcile',
  -- Stock events
  'stock_delivery',
  'stock_allocate',
  'stock_assign',
  'stock_return',
  'stock_adjust',
  'stock_damage',
  'stock_loss',
  -- Sale events
  'sale_create',
  'sale_collect',
  'sale_confirm',
  'sale_reverse',
  -- Payment events
  'payment_record',
  'payment_confirm',
  'payment_dispute',
  -- Credit events
  'credit_issue',
  'credit_collect',
  -- User events
  'user_create',
  'user_suspend',
  'user_reinstate',
  'role_assign',
  -- Dispute events
  'dispute_open',
  'dispute_resolve'
);

COMMENT ON TYPE event_type IS 'All possible event types for the audit log';

-- Dispute status
CREATE TYPE dispute_status AS ENUM (
  'open',
  'under_review',
  'resolved',
  'escalated'
);

COMMENT ON TYPE dispute_status IS 'State machine states for disputes';
