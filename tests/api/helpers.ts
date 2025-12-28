/**
 * API Test Helpers
 * @implements ARCHITECTURE.md Section 7 - API Layer
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

export const SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
export const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
export const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
export const FUNCTIONS_URL = `${SUPABASE_URL}/functions/v1`;

/**
 * Check if edge functions are available
 */
export async function checkFunctionsAvailable(): Promise<boolean> {
  try {
    const response = await fetch(`${FUNCTIONS_URL}/auth`, {
      method: 'OPTIONS',
    });
    return response.ok || response.status === 204 || response.status === 400;
  } catch {
    return false;
  }
}

/**
 * Create service client for test cleanup
 */
export function createServiceClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

/**
 * Test context for API tests
 */
export interface TestContext {
  barId: string;
  userId: string;
  token: string;
  deviceId: string;
}

/**
 * Generate unique test phone number
 */
export function generateTestPhone(): string {
  return `+2507${Date.now().toString().slice(-8)}`;
}

/**
 * Generate unique national ID
 */
export function generateNationalId(): string {
  return `1${Date.now().toString().slice(-15)}`;
}

/**
 * Generate unique TIN
 */
export function generateTin(): string {
  return Date.now().toString().slice(-9);
}

/**
 * Register a test business and return context
 */
export async function registerTestBusiness(
  phone: string = generateTestPhone(),
  deviceId: string = `test-device-${Date.now()}`
): Promise<TestContext | null> {
  try {
    const registerResponse = await fetch(`${FUNCTIONS_URL}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ownerPhone: phone,
        ownerName: 'Test Owner',
        ownerNationalId: generateNationalId(),
        ownerPin: '1234',
        barName: 'Test Bar',
        barTin: generateTin(),
        barLocation: 'Kigali',
      }),
    });

    if (!registerResponse.ok) {
      return null;
    }

    const registerData = await registerResponse.json();
    const barId = registerData.data.barId;
    const userId = registerData.data.userId;

    const loginResponse = await fetch(`${FUNCTIONS_URL}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Device-ID': deviceId,
        'X-Bar-ID': barId,
      },
      body: JSON.stringify({ phone, pin: '1234' }),
    });

    if (!loginResponse.ok) {
      return null;
    }

    const loginData = await loginResponse.json();

    return {
      barId,
      userId,
      token: loginData.data.token,
      deviceId,
    };
  } catch {
    return null;
  }
}

/**
 * Create auth headers for API requests
 */
export function createAuthHeaders(ctx: TestContext): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${ctx.token}`,
    'X-Device-ID': ctx.deviceId,
    'X-Bar-ID': ctx.barId,
  };
}

/**
 * Cleanup test data
 */
export async function cleanupTestData(ctx: TestContext): Promise<void> {
  const serviceClient = createServiceClient();

  try {
    // Clean in order (respect foreign keys)
    await serviceClient.from('sale_items').delete().eq('sale_id', ctx.barId);
    await serviceClient.from('sales').delete().eq('bar_id', ctx.barId);
    await serviceClient.from('stock_movements').delete().eq('bar_id', ctx.barId);
    await serviceClient.from('stock_assignments').delete().eq('bar_id', ctx.barId);
    await serviceClient.from('stock_levels').delete().eq('bar_id', ctx.barId);
    await serviceClient.from('products').delete().eq('bar_id', ctx.barId);
    await serviceClient.from('shift_assignments').delete().match({ shift_id: ctx.barId });
    await serviceClient.from('shifts').delete().eq('bar_id', ctx.barId);
    await serviceClient.from('days').delete().eq('bar_id', ctx.barId);
    await serviceClient.from('user_roles').delete().eq('bar_id', ctx.barId);
    await serviceClient.from('bars').delete().eq('id', ctx.barId);
    await serviceClient.from('users').delete().eq('id', ctx.userId);
  } catch (error) {
    console.error('Cleanup error:', error);
  }
}
