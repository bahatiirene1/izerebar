-- ============================================
-- IZEREBAR DATABASE SCHEMA
-- Migration: 00005_auth_schema.sql
-- Description: Create custom authentication schema (Phone + PIN)
-- Implements: ARCHITECTURE.md Section 2.4
-- ============================================

-- Create separate schema for auth
CREATE SCHEMA IF NOT EXISTS auth_custom;

COMMENT ON SCHEMA auth_custom IS 'Custom phone+PIN authentication (not Supabase Auth)';

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
  last_login_device_id UUID REFERENCES public.devices(id),

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  -- Constraints
  CONSTRAINT credentials_max_otp_attempts CHECK (otp_attempts <= 5),
  CONSTRAINT credentials_max_failed_attempts CHECK (failed_attempts <= 10)
);

COMMENT ON TABLE auth_custom.credentials IS 'User PIN credentials and login state';
COMMENT ON COLUMN auth_custom.credentials.pin_hash IS 'Argon2-hashed 4-6 digit PIN';
COMMENT ON COLUMN auth_custom.credentials.otp_code IS 'One-time password for PIN reset (SMS via Pindo)';
COMMENT ON COLUMN auth_custom.credentials.locked_until IS 'Account locked until this time after too many failed attempts';

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

COMMENT ON TABLE auth_custom.sessions IS 'Active user sessions tied to specific devices';
COMMENT ON COLUMN auth_custom.sessions.token_hash IS 'Hashed session token for validation';

CREATE INDEX idx_sessions_user ON auth_custom.sessions(user_id);
CREATE INDEX idx_sessions_device ON auth_custom.sessions(device_id);
CREATE INDEX idx_sessions_token ON auth_custom.sessions(token_hash);
CREATE INDEX idx_sessions_active ON auth_custom.sessions(is_active, expires_at) WHERE is_active = true;

-- OTP rate limiting
CREATE TABLE auth_custom.otp_rate_limits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone VARCHAR(20) NOT NULL,

  -- Rate limiting
  requests_count INT DEFAULT 1,
  window_start TIMESTAMPTZ DEFAULT now(),

  -- Constraints
  CONSTRAINT otp_rate_limits_phone UNIQUE (phone)
);

COMMENT ON TABLE auth_custom.otp_rate_limits IS 'Rate limiting for OTP requests per phone number';

-- Device registration tokens
CREATE TABLE auth_custom.device_registrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bar_id UUID NOT NULL REFERENCES public.bars(id),

  -- Registration code (6 alphanumeric)
  registration_code VARCHAR(6) NOT NULL,

  -- Expiry
  expires_at TIMESTAMPTZ NOT NULL,

  -- Usage
  used_at TIMESTAMPTZ,
  used_by_device_id UUID REFERENCES public.devices(id),

  -- Created by
  created_by UUID NOT NULL REFERENCES public.users(id),
  created_at TIMESTAMPTZ DEFAULT now(),

  -- Constraints
  CONSTRAINT device_registrations_code_unique UNIQUE (registration_code)
);

COMMENT ON TABLE auth_custom.device_registrations IS 'One-time codes for registering new devices to a bar';
COMMENT ON COLUMN auth_custom.device_registrations.registration_code IS '6-character code displayed to owner/manager';

CREATE INDEX idx_device_registrations_bar ON auth_custom.device_registrations(bar_id);
CREATE INDEX idx_device_registrations_code ON auth_custom.device_registrations(registration_code) WHERE used_at IS NULL;
