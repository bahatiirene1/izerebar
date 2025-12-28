-- ============================================
-- IZEREBAR DATABASE SCHEMA
-- Migration: 00004_summaries.sql
-- Description: Create summary tables and materialized views
-- Implements: ARCHITECTURE.md Section 2.3.12, 2.3.17, 2.3.18
-- ============================================

-- 2.3.17 Daily Summaries
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

COMMENT ON TABLE daily_summaries IS 'Daily financial summaries for each bar';

-- 2.3.18 Shift Summaries
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

COMMENT ON TABLE shift_summaries IS 'Shift-level financial summaries';

-- Daily summaries indexes
CREATE INDEX idx_daily_summaries_bar ON daily_summaries(bar_id);
CREATE INDEX idx_daily_summaries_date ON daily_summaries(bar_id, business_date DESC);

-- Shift summaries indexes
CREATE INDEX idx_shift_summaries_bar ON shift_summaries(bar_id);
CREATE INDEX idx_shift_summaries_shift ON shift_summaries(shift_id);

-- 2.3.12 Server Obligations (Materialized View)
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

COMMENT ON MATERIALIZED VIEW server_obligations IS 'Real-time view of what each server owes per shift';

CREATE UNIQUE INDEX idx_server_obligations_pk ON server_obligations(bar_id, shift_id, server_id);

-- Bartender Stock Position (Materialized View)
-- Shows current stock held by each bartender
CREATE MATERIALIZED VIEW bartender_stock_position AS
SELECT
  sm.bar_id,
  sm.shift_id,
  u.id AS bartender_id,
  u.full_name AS bartender_name,
  p.id AS product_id,
  p.name AS product_name,
  p.selling_price_rwf,

  -- Calculate balance: received - given out
  COALESCE(SUM(
    CASE
      WHEN sm.to_user_id = u.id THEN sm.quantity
      WHEN sm.from_user_id = u.id THEN -sm.quantity
      ELSE 0
    END
  ), 0) AS current_quantity,

  -- Value of stock held
  COALESCE(SUM(
    CASE
      WHEN sm.to_user_id = u.id THEN sm.quantity * p.selling_price_rwf
      WHEN sm.from_user_id = u.id THEN -sm.quantity * p.selling_price_rwf
      ELSE 0
    END
  ), 0) AS current_value_rwf

FROM stock_movements sm
JOIN users u ON (sm.from_user_id = u.id OR sm.to_user_id = u.id)
JOIN user_roles ur ON u.id = ur.user_id AND ur.bar_id = sm.bar_id AND ur.role = 'bartender'
JOIN products p ON sm.product_id = p.id
GROUP BY sm.bar_id, sm.shift_id, u.id, u.full_name, p.id, p.name, p.selling_price_rwf
HAVING COALESCE(SUM(
  CASE
    WHEN sm.to_user_id = u.id THEN sm.quantity
    WHEN sm.from_user_id = u.id THEN -sm.quantity
    ELSE 0
  END
), 0) != 0;

COMMENT ON MATERIALIZED VIEW bartender_stock_position IS 'Current stock held by each bartender per shift';

CREATE UNIQUE INDEX idx_bartender_stock_pk ON bartender_stock_position(bar_id, shift_id, bartender_id, product_id);
CREATE INDEX idx_bartender_stock_bartender ON bartender_stock_position(bartender_id);
