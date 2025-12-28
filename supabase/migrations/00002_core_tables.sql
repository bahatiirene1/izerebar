-- ============================================
-- IZEREBAR DATABASE SCHEMA
-- Migration: 00002_core_tables.sql
-- Description: Create core tables (bars, users, devices, products)
-- Implements: ARCHITECTURE.md Section 2.3.1 - 2.3.5
-- ============================================

-- 2.3.1 Bars
CREATE TABLE bars (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identity
  name VARCHAR(100) NOT NULL,
  tin VARCHAR(20),                    -- Tax ID (optional, for multi-bar grouping)
  location VARCHAR(200),
  phone VARCHAR(20),

  -- Ownership (will reference users, added after users table)
  owner_id UUID NOT NULL,

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

COMMENT ON TABLE bars IS 'Bar/venue establishments using Izerebar';
COMMENT ON COLUMN bars.owner_id IS 'References users.id - FK added after users table creation';
COMMENT ON COLUMN bars.tin IS 'Tax Identification Number for business grouping';
COMMENT ON COLUMN bars.credit_limit_rwf IS 'Maximum credit allowed for customers';

-- 2.3.3 Users
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
  suspended_by UUID,                  -- Self-reference, FK added later

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  -- Constraints
  CONSTRAINT users_phone_format CHECK (phone ~ '^\+?[0-9]{10,15}$'),
  CONSTRAINT users_name_not_empty CHECK (length(trim(full_name)) > 0)
);

COMMENT ON TABLE users IS 'All users of the Izerebar system';
COMMENT ON COLUMN users.phone IS 'Phone number in E.164 format (+250XXXXXXXXX)';
COMMENT ON COLUMN users.suspended_by IS 'Self-references users.id';

-- Add self-reference FK for suspended_by
ALTER TABLE users
  ADD CONSTRAINT fk_users_suspended_by
  FOREIGN KEY (suspended_by) REFERENCES users(id);

-- Add FK from bars to users now that users exists
ALTER TABLE bars
  ADD CONSTRAINT fk_bars_owner
  FOREIGN KEY (owner_id) REFERENCES users(id);

-- 2.3.2 Devices (Contoires)
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
  locked_by UUID REFERENCES users(id),

  -- Tracking
  last_seen_at TIMESTAMPTZ DEFAULT now(),
  last_user_id UUID REFERENCES users(id),

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT now(),
  registered_at TIMESTAMPTZ DEFAULT now(),

  -- Constraints
  CONSTRAINT devices_unique_fingerprint UNIQUE (bar_id, fingerprint)
);

COMMENT ON TABLE devices IS 'Registered devices (contoires) for each bar';
COMMENT ON COLUMN devices.fingerprint IS 'Unique browser/device fingerprint for identification';
COMMENT ON COLUMN devices.is_locked IS 'Device can be locked by manager to prevent use';

-- 2.3.5 Products
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
  CONSTRAINT products_name_not_empty CHECK (length(trim(name)) > 0),
  CONSTRAINT products_valid_category CHECK (category IN ('drinks', 'barbeque', 'food', 'other'))
);

COMMENT ON TABLE products IS 'Products sold at each bar';
COMMENT ON COLUMN products.is_saleable IS 'False for non-sellable items like cleaning supplies';

-- 2.3.4 User Roles (Per Bar)
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

COMMENT ON TABLE user_roles IS 'User role assignments per bar (a user can have one role per bar)';
COMMENT ON COLUMN user_roles.assigned_device_id IS 'Required for bartenders - their assigned contoire';

-- ============================================
-- INDEXES for core tables
-- ============================================

-- Bars indexes
CREATE INDEX idx_bars_owner ON bars(owner_id);
CREATE INDEX idx_bars_tin ON bars(tin) WHERE tin IS NOT NULL;
CREATE INDEX idx_bars_active ON bars(is_active) WHERE is_active = true;

-- Users indexes
CREATE INDEX idx_users_phone ON users(phone);
CREATE INDEX idx_users_active ON users(is_active) WHERE is_active = true;

-- Devices indexes
CREATE INDEX idx_devices_bar ON devices(bar_id);
CREATE INDEX idx_devices_active ON devices(bar_id, is_active) WHERE is_active = true;

-- Products indexes
CREATE INDEX idx_products_bar ON products(bar_id);
CREATE INDEX idx_products_bar_category ON products(bar_id, category);
CREATE INDEX idx_products_active ON products(bar_id, is_active) WHERE is_active = true;

-- User roles indexes
CREATE INDEX idx_user_roles_user ON user_roles(user_id);
CREATE INDEX idx_user_roles_bar ON user_roles(bar_id);
CREATE INDEX idx_user_roles_bar_role ON user_roles(bar_id, role);
