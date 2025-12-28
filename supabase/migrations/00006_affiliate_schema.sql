-- ============================================
-- IZEREBAR DATABASE SCHEMA
-- Migration: 00006_affiliate_schema.sql
-- Description: Create affiliate/agent commission system
-- Implements: ARCHITECTURE.md Section 2.5
-- ============================================

-- Create separate schema for affiliate system
CREATE SCHEMA IF NOT EXISTS affiliate;

COMMENT ON SCHEMA affiliate IS 'Agent/affiliate commission tracking system';

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

  -- Payment info
  momo_number VARCHAR(20),
  bank_account VARCHAR(50),

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  -- Constraints
  CONSTRAINT agents_phone_format CHECK (phone ~ '^\+?[0-9]{10,15}$'),
  CONSTRAINT agents_name_not_empty CHECK (length(trim(full_name)) > 0),
  CONSTRAINT agents_commission_range CHECK (commission_rate >= 0 AND commission_rate <= 50)
);

COMMENT ON TABLE affiliate.agents IS 'Sales agents who onboard bars and earn commissions';
COMMENT ON COLUMN affiliate.agents.commission_rate IS 'Percentage of bar subscription paid as commission';

CREATE INDEX idx_agents_phone ON affiliate.agents(phone);
CREATE INDEX idx_agents_active ON affiliate.agents(is_active) WHERE is_active = true;

-- Agent-Bar mapping
CREATE TABLE affiliate.agent_bars (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES affiliate.agents(id),
  bar_id UUID NOT NULL REFERENCES public.bars(id),

  -- Onboarding
  onboarded_at TIMESTAMPTZ DEFAULT now(),

  -- Status
  is_active BOOLEAN DEFAULT true,

  -- Notes
  notes TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT now(),

  -- Constraints
  CONSTRAINT agent_bars_unique UNIQUE (agent_id, bar_id)
);

COMMENT ON TABLE affiliate.agent_bars IS 'Which agent onboarded which bar';

CREATE INDEX idx_agent_bars_agent ON affiliate.agent_bars(agent_id);
CREATE INDEX idx_agent_bars_bar ON affiliate.agent_bars(bar_id);

-- Commissions
CREATE TABLE affiliate.commissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES affiliate.agents(id),
  bar_id UUID NOT NULL REFERENCES public.bars(id),

  -- Period
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,

  -- Calculation
  bar_revenue_rwf DECIMAL(12,2) NOT NULL DEFAULT 0,
  commission_rate_applied DECIMAL(5,2) NOT NULL,
  amount_rwf DECIMAL(10,2) NOT NULL,

  -- Status
  is_paid BOOLEAN DEFAULT false,
  paid_at TIMESTAMPTZ,
  payout_id UUID,                     -- Reference to payouts table

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT now(),

  -- Constraints
  CONSTRAINT commissions_valid_period CHECK (period_start <= period_end),
  CONSTRAINT commissions_positive_amount CHECK (amount_rwf >= 0)
);

COMMENT ON TABLE affiliate.commissions IS 'Calculated commissions per bar per period';

CREATE INDEX idx_commissions_agent ON affiliate.commissions(agent_id);
CREATE INDEX idx_commissions_bar ON affiliate.commissions(bar_id);
CREATE INDEX idx_commissions_period ON affiliate.commissions(period_start, period_end);
CREATE INDEX idx_commissions_unpaid ON affiliate.commissions(is_paid) WHERE is_paid = false;

-- Payouts
CREATE TABLE affiliate.payouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES affiliate.agents(id),

  -- Amount
  amount_rwf DECIMAL(10,2) NOT NULL,

  -- Payment details
  payment_method VARCHAR(20),         -- 'momo', 'bank', 'cash'
  payment_reference VARCHAR(100),     -- Transaction ID

  -- Status
  status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'processing', 'completed', 'failed'

  -- Timestamps
  requested_at TIMESTAMPTZ DEFAULT now(),
  processed_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),

  -- Constraints
  CONSTRAINT payouts_positive_amount CHECK (amount_rwf > 0),
  CONSTRAINT payouts_valid_status CHECK (status IN ('pending', 'processing', 'completed', 'failed'))
);

COMMENT ON TABLE affiliate.payouts IS 'Payout requests and history for agents';

CREATE INDEX idx_payouts_agent ON affiliate.payouts(agent_id);
CREATE INDEX idx_payouts_status ON affiliate.payouts(status);
CREATE INDEX idx_payouts_pending ON affiliate.payouts(status) WHERE status IN ('pending', 'processing');

-- Agent performance view
CREATE VIEW affiliate.agent_performance AS
SELECT
  a.id AS agent_id,
  a.full_name AS agent_name,
  a.phone AS agent_phone,
  a.commission_rate,
  a.is_active,

  -- Bars
  COUNT(DISTINCT ab.bar_id) AS total_bars,
  COUNT(DISTINCT ab.bar_id) FILTER (WHERE ab.is_active) AS active_bars,

  -- Earnings
  COALESCE(SUM(c.amount_rwf), 0) AS total_earned_rwf,
  COALESCE(SUM(c.amount_rwf) FILTER (WHERE c.is_paid), 0) AS paid_rwf,
  COALESCE(SUM(c.amount_rwf) FILTER (WHERE NOT c.is_paid), 0) AS pending_rwf

FROM affiliate.agents a
LEFT JOIN affiliate.agent_bars ab ON a.id = ab.agent_id
LEFT JOIN affiliate.commissions c ON a.id = c.agent_id
GROUP BY a.id, a.full_name, a.phone, a.commission_rate, a.is_active;

COMMENT ON VIEW affiliate.agent_performance IS 'Summary view of agent performance and earnings';
