-- Migration: Add service_role bypass for RLS policies
-- The service_role should bypass RLS for admin operations

-- Create a function to check if current user is service_role
CREATE OR REPLACE FUNCTION is_service_role()
RETURNS boolean AS $$
BEGIN
  RETURN current_setting('role', true) = 'service_role'
         OR current_setting('request.jwt.claims', true)::json->>'role' = 'service_role';
EXCEPTION
  WHEN OTHERS THEN
    RETURN false;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Add service_role bypass to all tables
-- This allows admin/testing operations to work without RLS restrictions

-- shift_assignments
CREATE POLICY shift_assignments_service_role ON shift_assignments
  FOR ALL
  USING (is_service_role())
  WITH CHECK (is_service_role());

-- Also add to auth_custom.sessions for session validation
CREATE POLICY sessions_service_role ON auth_custom.sessions
  FOR ALL
  USING (is_service_role())
  WITH CHECK (is_service_role());

-- auth_custom.credentials
CREATE POLICY credentials_service_role ON auth_custom.credentials
  FOR ALL
  USING (is_service_role())
  WITH CHECK (is_service_role());
