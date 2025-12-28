/**
 * Test setup for Izerebar database tests
 * @implements ARCHITECTURE.md - Database testing requirements
 */
import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Local Supabase connection
const SUPABASE_URL = 'http://127.0.0.1:54321';
const SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

export let supabase: SupabaseClient;

beforeAll(async () => {
  supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
});

afterAll(async () => {
  // Cleanup if needed
});

// Helper to execute raw SQL
export async function executeSql(sql: string): Promise<any> {
  const { data, error } = await supabase.rpc('exec_sql', { sql_query: sql });
  if (error) throw error;
  return data;
}

// Helper to clean test data
export async function cleanTestData() {
  // Delete in reverse order of dependencies
  const tables = [
    'events',
    'device_sessions',
    'shift_summaries',
    'daily_summaries',
    'disputes',
    'credits',
    'sales',
    'stock_movements',
    'stock_batches',
    'shift_assignments',
    'shifts',
    'days',
    'user_roles',
    'products',
    'devices',
    'users',
    'bars',
  ];

  for (const table of tables) {
    await supabase.from(table).delete().neq('id', '00000000-0000-0000-0000-000000000000');
  }
}
