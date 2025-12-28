-- ============================================
-- IZEREBAR DATABASE SCHEMA
-- Migration: 00007_functions.sql
-- Description: Create database functions and triggers
-- Implements: ARCHITECTURE.md Section 2.7
-- ============================================

-- ============================================
-- UTILITY FUNCTIONS
-- ============================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION update_updated_at_column() IS 'Automatically update updated_at timestamp on row update';

-- Apply updated_at trigger to relevant tables
CREATE TRIGGER trg_bars_updated_at
  BEFORE UPDATE ON bars
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_products_updated_at
  BEFORE UPDATE ON products
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_credentials_updated_at
  BEFORE UPDATE ON auth_custom.credentials
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_agents_updated_at
  BEFORE UPDATE ON affiliate.agents
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- STOCK BALANCE FUNCTIONS
-- ============================================

-- 2.7.1 Calculate Stock Balance
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
      -- Incoming to user
      WHEN movement_type IN ('delivery', 'allocation', 'assignment', 'return')
           AND to_user_id = COALESCE(p_user_id, to_user_id) THEN quantity
      -- Outgoing from user
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

COMMENT ON FUNCTION get_stock_balance(UUID, UUID, UUID) IS 'Calculate current stock balance for a product, optionally filtered by user';

-- Get stock balance for a specific shift
CREATE OR REPLACE FUNCTION get_shift_stock_balance(
  p_shift_id UUID,
  p_product_id UUID,
  p_user_id UUID DEFAULT NULL
)
RETURNS DECIMAL AS $$
DECLARE
  v_balance DECIMAL;
BEGIN
  SELECT COALESCE(SUM(
    CASE
      WHEN to_user_id = COALESCE(p_user_id, to_user_id) THEN quantity
      WHEN from_user_id = COALESCE(p_user_id, from_user_id) THEN -quantity
      ELSE 0
    END
  ), 0) INTO v_balance
  FROM stock_movements
  WHERE shift_id = p_shift_id
    AND product_id = p_product_id
    AND (p_user_id IS NULL OR from_user_id = p_user_id OR to_user_id = p_user_id);

  RETURN v_balance;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION get_shift_stock_balance(UUID, UUID, UUID) IS 'Calculate stock balance for a product within a specific shift';

-- ============================================
-- EVENT LOGGING
-- ============================================

-- 2.7.2 Log Event
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

COMMENT ON FUNCTION log_event IS 'Insert an event into the append-only audit log';

-- ============================================
-- MATERIALIZED VIEW REFRESH
-- ============================================

-- Refresh server obligations on sales changes
CREATE OR REPLACE FUNCTION refresh_server_obligations()
RETURNS TRIGGER AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY server_obligations;
  RETURN NULL;
EXCEPTION
  WHEN OTHERS THEN
    -- Log error but don't fail the transaction
    RAISE WARNING 'Failed to refresh server_obligations: %', SQLERRM;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION refresh_server_obligations() IS 'Refresh server_obligations materialized view after sales changes';

-- Trigger to refresh on sales changes (deferred to avoid blocking)
CREATE TRIGGER trg_refresh_server_obligations
  AFTER INSERT OR UPDATE ON sales
  FOR EACH STATEMENT
  EXECUTE FUNCTION refresh_server_obligations();

-- Refresh bartender stock on movements
CREATE OR REPLACE FUNCTION refresh_bartender_stock()
RETURNS TRIGGER AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY bartender_stock_position;
  RETURN NULL;
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'Failed to refresh bartender_stock_position: %', SQLERRM;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_refresh_bartender_stock
  AFTER INSERT OR UPDATE ON stock_movements
  FOR EACH STATEMENT
  EXECUTE FUNCTION refresh_bartender_stock();

-- ============================================
-- VALIDATION FUNCTIONS
-- ============================================

-- Check if user has role in bar
CREATE OR REPLACE FUNCTION user_has_role(
  p_user_id UUID,
  p_bar_id UUID,
  p_roles user_role[] DEFAULT NULL
)
RETURNS BOOLEAN AS $$
DECLARE
  v_has_role BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = p_user_id
      AND bar_id = p_bar_id
      AND is_active = true
      AND (p_roles IS NULL OR role = ANY(p_roles))
  ) INTO v_has_role;

  RETURN v_has_role;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION user_has_role(UUID, UUID, user_role[]) IS 'Check if user has specific role(s) in a bar';

-- Get user's role in a bar
CREATE OR REPLACE FUNCTION get_user_role(
  p_user_id UUID,
  p_bar_id UUID
)
RETURNS user_role AS $$
DECLARE
  v_role user_role;
BEGIN
  SELECT role INTO v_role
  FROM user_roles
  WHERE user_id = p_user_id
    AND bar_id = p_bar_id
    AND is_active = true;

  RETURN v_role;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION get_user_role(UUID, UUID) IS 'Get user''s active role in a specific bar';

-- Check if shift is open
CREATE OR REPLACE FUNCTION is_shift_open(p_shift_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  v_is_open BOOLEAN;
BEGIN
  SELECT status = 'open' INTO v_is_open
  FROM shifts
  WHERE id = p_shift_id;

  RETURN COALESCE(v_is_open, false);
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION is_shift_open(UUID) IS 'Check if a shift is currently open';

-- Check if day is open
CREATE OR REPLACE FUNCTION is_day_open(p_day_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  v_is_open BOOLEAN;
BEGIN
  SELECT status = 'open' INTO v_is_open
  FROM days
  WHERE id = p_day_id;

  RETURN COALESCE(v_is_open, false);
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION is_day_open(UUID) IS 'Check if a business day is currently open';

-- ============================================
-- SUMMARY GENERATION FUNCTIONS
-- ============================================

-- Generate shift summary
CREATE OR REPLACE FUNCTION generate_shift_summary(p_shift_id UUID)
RETURNS UUID AS $$
DECLARE
  v_bar_id UUID;
  v_summary_id UUID;
BEGIN
  -- Get bar_id from shift
  SELECT bar_id INTO v_bar_id FROM shifts WHERE id = p_shift_id;

  -- Upsert summary
  INSERT INTO shift_summaries (
    bar_id, shift_id,
    total_sales_count, total_sales_rwf,
    pending_sales_count, pending_sales_rwf,
    confirmed_sales_count, confirmed_sales_rwf,
    reversed_sales_count, reversed_sales_rwf,
    stock_allocated_count, stock_returned_count, stock_damaged_count,
    disputes_count, generated_at
  )
  SELECT
    v_bar_id,
    p_shift_id,
    COUNT(*),
    COALESCE(SUM(total_price_rwf), 0),
    COUNT(*) FILTER (WHERE status = 'pending'),
    COALESCE(SUM(total_price_rwf) FILTER (WHERE status = 'pending'), 0),
    COUNT(*) FILTER (WHERE status = 'confirmed'),
    COALESCE(SUM(total_price_rwf) FILTER (WHERE status = 'confirmed'), 0),
    COUNT(*) FILTER (WHERE status = 'reversed'),
    COALESCE(SUM(total_price_rwf) FILTER (WHERE status = 'reversed'), 0),
    (SELECT COUNT(*) FROM stock_movements WHERE shift_id = p_shift_id AND movement_type = 'allocation'),
    (SELECT COUNT(*) FROM stock_movements WHERE shift_id = p_shift_id AND movement_type IN ('return', 'return_to_stock')),
    (SELECT COUNT(*) FROM stock_movements WHERE shift_id = p_shift_id AND movement_type = 'damage'),
    (SELECT COUNT(*) FROM disputes WHERE shift_id = p_shift_id),
    now()
  FROM sales
  WHERE shift_id = p_shift_id
  ON CONFLICT (shift_id)
  DO UPDATE SET
    total_sales_count = EXCLUDED.total_sales_count,
    total_sales_rwf = EXCLUDED.total_sales_rwf,
    pending_sales_count = EXCLUDED.pending_sales_count,
    pending_sales_rwf = EXCLUDED.pending_sales_rwf,
    confirmed_sales_count = EXCLUDED.confirmed_sales_count,
    confirmed_sales_rwf = EXCLUDED.confirmed_sales_rwf,
    reversed_sales_count = EXCLUDED.reversed_sales_count,
    reversed_sales_rwf = EXCLUDED.reversed_sales_rwf,
    stock_allocated_count = EXCLUDED.stock_allocated_count,
    stock_returned_count = EXCLUDED.stock_returned_count,
    stock_damaged_count = EXCLUDED.stock_damaged_count,
    disputes_count = EXCLUDED.disputes_count,
    generated_at = now()
  RETURNING id INTO v_summary_id;

  RETURN v_summary_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION generate_shift_summary(UUID) IS 'Generate or update summary for a shift';

-- Generate daily summary
CREATE OR REPLACE FUNCTION generate_daily_summary(p_day_id UUID)
RETURNS UUID AS $$
DECLARE
  v_bar_id UUID;
  v_business_date DATE;
  v_summary_id UUID;
BEGIN
  -- Get bar_id and date from day
  SELECT bar_id, business_date INTO v_bar_id, v_business_date
  FROM days WHERE id = p_day_id;

  -- Upsert summary
  INSERT INTO daily_summaries (
    bar_id, day_id, business_date,
    total_sales_count, total_sales_rwf,
    cash_sales_rwf, momo_sales_rwf, credit_sales_rwf,
    stock_received_value_rwf, stock_damaged_value_rwf, stock_lost_value_rwf,
    disputes_count, missing_money_rwf,
    generated_at
  )
  SELECT
    v_bar_id,
    p_day_id,
    v_business_date,
    COUNT(*),
    COALESCE(SUM(s.total_price_rwf) FILTER (WHERE s.status = 'confirmed'), 0),
    COALESCE(SUM(s.total_price_rwf) FILTER (WHERE s.status = 'confirmed' AND s.payment_method = 'cash'), 0),
    COALESCE(SUM(s.total_price_rwf) FILTER (WHERE s.status = 'confirmed' AND s.payment_method = 'momo'), 0),
    COALESCE(SUM(s.total_price_rwf) FILTER (WHERE s.status = 'confirmed' AND s.payment_method = 'credit'), 0),
    (SELECT COALESCE(SUM(sb.quantity * COALESCE(sb.cost_per_unit_rwf, 0)), 0)
     FROM stock_batches sb
     JOIN shifts sh ON sb.bar_id = sh.bar_id
     JOIN days d ON sh.day_id = d.id
     WHERE d.id = p_day_id),
    (SELECT COALESCE(SUM(sm.quantity * p.selling_price_rwf), 0)
     FROM stock_movements sm
     JOIN products p ON sm.product_id = p.id
     JOIN shifts sh ON sm.shift_id = sh.id
     WHERE sh.day_id = p_day_id AND sm.movement_type = 'damage'),
    (SELECT COALESCE(SUM(sm.quantity * p.selling_price_rwf), 0)
     FROM stock_movements sm
     JOIN products p ON sm.product_id = p.id
     JOIN shifts sh ON sm.shift_id = sh.id
     WHERE sh.day_id = p_day_id AND sm.movement_type = 'loss'),
    (SELECT COUNT(*) FROM disputes d2
     JOIN shifts sh ON d2.shift_id = sh.id
     WHERE sh.day_id = p_day_id),
    0, -- missing_money calculated separately
    now()
  FROM sales s
  JOIN shifts sh ON s.shift_id = sh.id
  WHERE sh.day_id = p_day_id
  ON CONFLICT (bar_id, business_date)
  DO UPDATE SET
    total_sales_count = EXCLUDED.total_sales_count,
    total_sales_rwf = EXCLUDED.total_sales_rwf,
    cash_sales_rwf = EXCLUDED.cash_sales_rwf,
    momo_sales_rwf = EXCLUDED.momo_sales_rwf,
    credit_sales_rwf = EXCLUDED.credit_sales_rwf,
    stock_received_value_rwf = EXCLUDED.stock_received_value_rwf,
    stock_damaged_value_rwf = EXCLUDED.stock_damaged_value_rwf,
    stock_lost_value_rwf = EXCLUDED.stock_lost_value_rwf,
    disputes_count = EXCLUDED.disputes_count,
    generated_at = now()
  RETURNING id INTO v_summary_id;

  RETURN v_summary_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION generate_daily_summary(UUID) IS 'Generate or update summary for a business day';

-- ============================================
-- SERVER OBLIGATION CALCULATION
-- ============================================

-- Get what a server owes for a shift
CREATE OR REPLACE FUNCTION get_server_obligation(
  p_shift_id UUID,
  p_server_id UUID
)
RETURNS TABLE (
  pending_count BIGINT,
  pending_amount DECIMAL,
  collected_count BIGINT,
  collected_amount DECIMAL,
  total_owed DECIMAL
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(*) FILTER (WHERE status = 'pending'),
    COALESCE(SUM(total_price_rwf) FILTER (WHERE status = 'pending'), 0),
    COUNT(*) FILTER (WHERE status = 'collected'),
    COALESCE(SUM(collected_amount_rwf) FILTER (WHERE status = 'collected'), 0),
    COALESCE(SUM(total_price_rwf) FILTER (WHERE status IN ('pending', 'collected')), 0)
  FROM sales
  WHERE shift_id = p_shift_id
    AND assigned_to_server_id = p_server_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION get_server_obligation(UUID, UUID) IS 'Calculate what a server owes for a specific shift';
