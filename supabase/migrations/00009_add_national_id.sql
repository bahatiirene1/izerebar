-- Migration: Add national_id column to users table
-- Required for business owner registration (Rwanda compliance)

-- Add national_id column to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS national_id VARCHAR(16);

-- Add unique constraint (each national ID should be unique)
ALTER TABLE users ADD CONSTRAINT users_national_id_unique UNIQUE (national_id);

-- Add check constraint for Rwanda National ID format (16 digits, starts with 1)
ALTER TABLE users ADD CONSTRAINT users_national_id_format
  CHECK (national_id IS NULL OR national_id ~ '^1[0-9]{15}$');

-- Add index for lookups
CREATE INDEX IF NOT EXISTS idx_users_national_id ON users(national_id) WHERE national_id IS NOT NULL;

-- Comment
COMMENT ON COLUMN users.national_id IS 'Rwanda National ID (16 digits, starts with 1)';
