-- Migration: Grant API access to auth_custom and affiliate schemas
-- Required for PostgREST to access these schemas

-- Grant usage on auth_custom schema
GRANT USAGE ON SCHEMA auth_custom TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA auth_custom TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA auth_custom TO anon, authenticated, service_role;
GRANT ALL ON ALL ROUTINES IN SCHEMA auth_custom TO anon, authenticated, service_role;

-- Grant usage on affiliate schema
GRANT USAGE ON SCHEMA affiliate TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA affiliate TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA affiliate TO anon, authenticated, service_role;
GRANT ALL ON ALL ROUTINES IN SCHEMA affiliate TO anon, authenticated, service_role;

-- Set default privileges for future objects
ALTER DEFAULT PRIVILEGES IN SCHEMA auth_custom GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA auth_custom GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA affiliate GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA affiliate GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
