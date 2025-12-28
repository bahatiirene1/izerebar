-- ============================================
-- IZEREBAR DATABASE SCHEMA
-- Migration: 00008_rls_policies.sql
-- Description: Row Level Security policies for all tables
-- Implements: ARCHITECTURE.md Section 2.6
-- ============================================

-- ============================================
-- ENABLE RLS ON ALL TABLES
-- ============================================

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

-- Auth schema
ALTER TABLE auth_custom.credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_custom.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_custom.otp_rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_custom.device_registrations ENABLE ROW LEVEL SECURITY;

-- Affiliate schema
ALTER TABLE affiliate.agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE affiliate.agent_bars ENABLE ROW LEVEL SECURITY;
ALTER TABLE affiliate.commissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE affiliate.payouts ENABLE ROW LEVEL SECURITY;

-- ============================================
-- HELPER: Get current user's bar access
-- We use session variables set by the API layer
-- app.current_user_id - UUID of current user
-- app.current_bar_id - UUID of current bar (if selected)
-- app.current_role - user_role of current user in current bar
-- ============================================

-- ============================================
-- PUBLIC SCHEMA POLICIES
-- ============================================

-- BARS: Users can only see bars they have a role in
CREATE POLICY bars_select ON bars
  FOR SELECT
  USING (
    id IN (
      SELECT bar_id FROM user_roles
      WHERE user_id = current_setting('app.current_user_id', true)::uuid
      AND is_active = true
    )
  );

-- Bars: Only owners can update their bar
CREATE POLICY bars_update ON bars
  FOR UPDATE
  USING (
    owner_id = current_setting('app.current_user_id', true)::uuid
  );

-- USERS: Users can see other users in their bars
CREATE POLICY users_select ON users
  FOR SELECT
  USING (
    -- Can always see yourself
    id = current_setting('app.current_user_id', true)::uuid
    OR
    -- Or users who share a bar with you
    id IN (
      SELECT ur2.user_id FROM user_roles ur1
      JOIN user_roles ur2 ON ur1.bar_id = ur2.bar_id
      WHERE ur1.user_id = current_setting('app.current_user_id', true)::uuid
      AND ur1.is_active = true
      AND ur2.is_active = true
    )
  );

-- Users can update their own profile
CREATE POLICY users_update ON users
  FOR UPDATE
  USING (id = current_setting('app.current_user_id', true)::uuid);

-- DEVICES: Users can see devices in their bars
CREATE POLICY devices_select ON devices
  FOR SELECT
  USING (
    bar_id IN (
      SELECT bar_id FROM user_roles
      WHERE user_id = current_setting('app.current_user_id', true)::uuid
      AND is_active = true
    )
  );

-- Only owner/manager can manage devices
CREATE POLICY devices_insert ON devices
  FOR INSERT
  WITH CHECK (
    bar_id IN (
      SELECT bar_id FROM user_roles
      WHERE user_id = current_setting('app.current_user_id', true)::uuid
      AND is_active = true
      AND role IN ('owner', 'manager')
    )
  );

CREATE POLICY devices_update ON devices
  FOR UPDATE
  USING (
    bar_id IN (
      SELECT bar_id FROM user_roles
      WHERE user_id = current_setting('app.current_user_id', true)::uuid
      AND is_active = true
      AND role IN ('owner', 'manager')
    )
  );

-- USER_ROLES: Users can see roles in their bars
CREATE POLICY user_roles_select ON user_roles
  FOR SELECT
  USING (
    bar_id IN (
      SELECT bar_id FROM user_roles ur
      WHERE ur.user_id = current_setting('app.current_user_id', true)::uuid
      AND ur.is_active = true
    )
  );

-- Only owner/manager can assign roles
CREATE POLICY user_roles_insert ON user_roles
  FOR INSERT
  WITH CHECK (
    bar_id IN (
      SELECT bar_id FROM user_roles
      WHERE user_id = current_setting('app.current_user_id', true)::uuid
      AND is_active = true
      AND role IN ('owner', 'manager')
    )
  );

-- PRODUCTS: Users can see products in their bars
CREATE POLICY products_select ON products
  FOR SELECT
  USING (
    bar_id IN (
      SELECT bar_id FROM user_roles
      WHERE user_id = current_setting('app.current_user_id', true)::uuid
      AND is_active = true
    )
  );

-- Only owner/manager can manage products
CREATE POLICY products_insert ON products
  FOR INSERT
  WITH CHECK (
    bar_id IN (
      SELECT bar_id FROM user_roles
      WHERE user_id = current_setting('app.current_user_id', true)::uuid
      AND is_active = true
      AND role IN ('owner', 'manager')
    )
  );

CREATE POLICY products_update ON products
  FOR UPDATE
  USING (
    bar_id IN (
      SELECT bar_id FROM user_roles
      WHERE user_id = current_setting('app.current_user_id', true)::uuid
      AND is_active = true
      AND role IN ('owner', 'manager')
    )
  );

-- DAYS: Users can see days in their bars
CREATE POLICY days_select ON days
  FOR SELECT
  USING (
    bar_id IN (
      SELECT bar_id FROM user_roles
      WHERE user_id = current_setting('app.current_user_id', true)::uuid
      AND is_active = true
    )
  );

-- Only manager can open/close days
CREATE POLICY days_insert ON days
  FOR INSERT
  WITH CHECK (
    bar_id IN (
      SELECT bar_id FROM user_roles
      WHERE user_id = current_setting('app.current_user_id', true)::uuid
      AND is_active = true
      AND role IN ('owner', 'manager')
    )
  );

CREATE POLICY days_update ON days
  FOR UPDATE
  USING (
    bar_id IN (
      SELECT bar_id FROM user_roles
      WHERE user_id = current_setting('app.current_user_id', true)::uuid
      AND is_active = true
      AND role IN ('owner', 'manager')
    )
  );

-- SHIFTS: Users can see shifts in their bars
CREATE POLICY shifts_select ON shifts
  FOR SELECT
  USING (
    bar_id IN (
      SELECT bar_id FROM user_roles
      WHERE user_id = current_setting('app.current_user_id', true)::uuid
      AND is_active = true
    )
  );

-- Manager can create shifts
CREATE POLICY shifts_insert ON shifts
  FOR INSERT
  WITH CHECK (
    bar_id IN (
      SELECT bar_id FROM user_roles
      WHERE user_id = current_setting('app.current_user_id', true)::uuid
      AND is_active = true
      AND role IN ('owner', 'manager')
    )
  );

-- Manager/Bartender can update shifts (bartender can open/close)
CREATE POLICY shifts_update ON shifts
  FOR UPDATE
  USING (
    bar_id IN (
      SELECT bar_id FROM user_roles
      WHERE user_id = current_setting('app.current_user_id', true)::uuid
      AND is_active = true
      AND role IN ('owner', 'manager', 'bartender')
    )
  );

-- SHIFT_ASSIGNMENTS: Visible to bar members
CREATE POLICY shift_assignments_select ON shift_assignments
  FOR SELECT
  USING (
    shift_id IN (
      SELECT s.id FROM shifts s
      JOIN user_roles ur ON s.bar_id = ur.bar_id
      WHERE ur.user_id = current_setting('app.current_user_id', true)::uuid
      AND ur.is_active = true
    )
  );

CREATE POLICY shift_assignments_insert ON shift_assignments
  FOR INSERT
  WITH CHECK (
    shift_id IN (
      SELECT s.id FROM shifts s
      JOIN user_roles ur ON s.bar_id = ur.bar_id
      WHERE ur.user_id = current_setting('app.current_user_id', true)::uuid
      AND ur.is_active = true
      AND ur.role IN ('owner', 'manager')
    )
  );

-- STOCK_BATCHES: Visible to bar members
CREATE POLICY stock_batches_select ON stock_batches
  FOR SELECT
  USING (
    bar_id IN (
      SELECT bar_id FROM user_roles
      WHERE user_id = current_setting('app.current_user_id', true)::uuid
      AND is_active = true
    )
  );

-- Only manager can add stock
CREATE POLICY stock_batches_insert ON stock_batches
  FOR INSERT
  WITH CHECK (
    bar_id IN (
      SELECT bar_id FROM user_roles
      WHERE user_id = current_setting('app.current_user_id', true)::uuid
      AND is_active = true
      AND role IN ('owner', 'manager')
    )
  );

-- STOCK_MOVEMENTS: Visible to bar members
CREATE POLICY stock_movements_select ON stock_movements
  FOR SELECT
  USING (
    bar_id IN (
      SELECT bar_id FROM user_roles
      WHERE user_id = current_setting('app.current_user_id', true)::uuid
      AND is_active = true
    )
  );

-- Manager/Bartender can create movements
CREATE POLICY stock_movements_insert ON stock_movements
  FOR INSERT
  WITH CHECK (
    bar_id IN (
      SELECT bar_id FROM user_roles
      WHERE user_id = current_setting('app.current_user_id', true)::uuid
      AND is_active = true
      AND role IN ('owner', 'manager', 'bartender')
    )
  );

-- SALES: Visible to bar members
CREATE POLICY sales_select ON sales
  FOR SELECT
  USING (
    bar_id IN (
      SELECT bar_id FROM user_roles
      WHERE user_id = current_setting('app.current_user_id', true)::uuid
      AND is_active = true
    )
  );

-- Bartender can create sales
CREATE POLICY sales_insert ON sales
  FOR INSERT
  WITH CHECK (
    bar_id IN (
      SELECT bar_id FROM user_roles
      WHERE user_id = current_setting('app.current_user_id', true)::uuid
      AND is_active = true
      AND role IN ('owner', 'manager', 'bartender')
    )
  );

-- Server can update (collect), Bartender can update (confirm)
CREATE POLICY sales_update ON sales
  FOR UPDATE
  USING (
    bar_id IN (
      SELECT bar_id FROM user_roles
      WHERE user_id = current_setting('app.current_user_id', true)::uuid
      AND is_active = true
      AND role IN ('owner', 'manager', 'bartender', 'server')
    )
  );

-- CREDITS: Visible to bar members
CREATE POLICY credits_select ON credits
  FOR SELECT
  USING (
    bar_id IN (
      SELECT bar_id FROM user_roles
      WHERE user_id = current_setting('app.current_user_id', true)::uuid
      AND is_active = true
    )
  );

CREATE POLICY credits_insert ON credits
  FOR INSERT
  WITH CHECK (
    bar_id IN (
      SELECT bar_id FROM user_roles
      WHERE user_id = current_setting('app.current_user_id', true)::uuid
      AND is_active = true
      AND role IN ('owner', 'manager', 'bartender', 'server')
    )
  );

CREATE POLICY credits_update ON credits
  FOR UPDATE
  USING (
    bar_id IN (
      SELECT bar_id FROM user_roles
      WHERE user_id = current_setting('app.current_user_id', true)::uuid
      AND is_active = true
    )
  );

-- DISPUTES: Visible to bar members
CREATE POLICY disputes_select ON disputes
  FOR SELECT
  USING (
    bar_id IN (
      SELECT bar_id FROM user_roles
      WHERE user_id = current_setting('app.current_user_id', true)::uuid
      AND is_active = true
    )
  );

-- Anyone in bar can open dispute
CREATE POLICY disputes_insert ON disputes
  FOR INSERT
  WITH CHECK (
    bar_id IN (
      SELECT bar_id FROM user_roles
      WHERE user_id = current_setting('app.current_user_id', true)::uuid
      AND is_active = true
    )
  );

-- Only manager can resolve
CREATE POLICY disputes_update ON disputes
  FOR UPDATE
  USING (
    bar_id IN (
      SELECT bar_id FROM user_roles
      WHERE user_id = current_setting('app.current_user_id', true)::uuid
      AND is_active = true
      AND role IN ('owner', 'manager')
    )
  );

-- EVENTS: Append-only, visible to bar members
CREATE POLICY events_select ON events
  FOR SELECT
  USING (
    bar_id IN (
      SELECT bar_id FROM user_roles
      WHERE user_id = current_setting('app.current_user_id', true)::uuid
      AND is_active = true
    )
  );

-- Anyone in bar can log events
CREATE POLICY events_insert ON events
  FOR INSERT
  WITH CHECK (
    bar_id IN (
      SELECT bar_id FROM user_roles
      WHERE user_id = current_setting('app.current_user_id', true)::uuid
      AND is_active = true
    )
  );

-- NO UPDATE or DELETE policy for events (append-only)

-- DEVICE_SESSIONS: Visible to bar members
CREATE POLICY device_sessions_select ON device_sessions
  FOR SELECT
  USING (
    bar_id IN (
      SELECT bar_id FROM user_roles
      WHERE user_id = current_setting('app.current_user_id', true)::uuid
      AND is_active = true
    )
  );

CREATE POLICY device_sessions_insert ON device_sessions
  FOR INSERT
  WITH CHECK (
    bar_id IN (
      SELECT bar_id FROM user_roles
      WHERE user_id = current_setting('app.current_user_id', true)::uuid
      AND is_active = true
    )
  );

CREATE POLICY device_sessions_update ON device_sessions
  FOR UPDATE
  USING (
    bar_id IN (
      SELECT bar_id FROM user_roles
      WHERE user_id = current_setting('app.current_user_id', true)::uuid
      AND is_active = true
    )
  );

-- DAILY_SUMMARIES: Visible to bar members
CREATE POLICY daily_summaries_select ON daily_summaries
  FOR SELECT
  USING (
    bar_id IN (
      SELECT bar_id FROM user_roles
      WHERE user_id = current_setting('app.current_user_id', true)::uuid
      AND is_active = true
    )
  );

-- SHIFT_SUMMARIES: Visible to bar members
CREATE POLICY shift_summaries_select ON shift_summaries
  FOR SELECT
  USING (
    bar_id IN (
      SELECT bar_id FROM user_roles
      WHERE user_id = current_setting('app.current_user_id', true)::uuid
      AND is_active = true
    )
  );

-- ============================================
-- AUTH_CUSTOM SCHEMA POLICIES
-- ============================================

-- Credentials: Only own credentials
CREATE POLICY credentials_select ON auth_custom.credentials
  FOR SELECT
  USING (user_id = current_setting('app.current_user_id', true)::uuid);

CREATE POLICY credentials_update ON auth_custom.credentials
  FOR UPDATE
  USING (user_id = current_setting('app.current_user_id', true)::uuid);

-- Sessions: Only own sessions
CREATE POLICY sessions_select ON auth_custom.sessions
  FOR SELECT
  USING (user_id = current_setting('app.current_user_id', true)::uuid);

-- Device registrations: Only manager/owner in bar
CREATE POLICY device_registrations_select ON auth_custom.device_registrations
  FOR SELECT
  USING (
    bar_id IN (
      SELECT bar_id FROM user_roles
      WHERE user_id = current_setting('app.current_user_id', true)::uuid
      AND is_active = true
      AND role IN ('owner', 'manager')
    )
  );

CREATE POLICY device_registrations_insert ON auth_custom.device_registrations
  FOR INSERT
  WITH CHECK (
    bar_id IN (
      SELECT bar_id FROM user_roles
      WHERE user_id = current_setting('app.current_user_id', true)::uuid
      AND is_active = true
      AND role IN ('owner', 'manager')
    )
  );

-- ============================================
-- AFFILIATE SCHEMA POLICIES
-- (Admin-only, managed through service role)
-- ============================================

-- Agents can see their own data
CREATE POLICY agents_select ON affiliate.agents
  FOR SELECT
  USING (
    phone = current_setting('app.current_phone', true)
  );

-- Agent bars - agents can see their bars
CREATE POLICY agent_bars_select ON affiliate.agent_bars
  FOR SELECT
  USING (
    agent_id IN (
      SELECT id FROM affiliate.agents
      WHERE phone = current_setting('app.current_phone', true)
    )
  );

-- Commissions - agents can see their commissions
CREATE POLICY commissions_select ON affiliate.commissions
  FOR SELECT
  USING (
    agent_id IN (
      SELECT id FROM affiliate.agents
      WHERE phone = current_setting('app.current_phone', true)
    )
  );

-- Payouts - agents can see their payouts
CREATE POLICY payouts_select ON affiliate.payouts
  FOR SELECT
  USING (
    agent_id IN (
      SELECT id FROM affiliate.agents
      WHERE phone = current_setting('app.current_phone', true)
    )
  );

-- ============================================
-- BYPASS POLICIES FOR SERVICE ROLE
-- ============================================

-- Service role bypasses all RLS by default in Supabase
-- These are for edge functions and admin operations
