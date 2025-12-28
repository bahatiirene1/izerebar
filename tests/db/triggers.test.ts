/**
 * Database Trigger Tests
 * @implements ARCHITECTURE.md Section 2.7 - Database Functions
 * @implements CLAUDE.md - Trigger tests requirement
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Use environment variables with fallbacks for local development
const SUPABASE_URL = process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

let supabase: SupabaseClient;

// Test fixtures
let testUserId: string;
let testBarId: string;
let testDeviceId: string;

beforeAll(async () => {
  supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Create test user
  const { data: user } = await supabase
    .from('users')
    .insert({ phone: '+250788400001', full_name: 'Trigger Test User' })
    .select()
    .single();
  testUserId = user?.id;

  // Create test bar
  const { data: bar } = await supabase
    .from('bars')
    .insert({ name: 'Trigger Test Bar', owner_id: testUserId })
    .select()
    .single();
  testBarId = bar?.id;

  // Create test device
  const { data: device } = await supabase
    .from('devices')
    .insert({ bar_id: testBarId, name: 'Trigger Device', fingerprint: 'trigger-fp-001' })
    .select()
    .single();
  testDeviceId = device?.id;
});

afterAll(async () => {
  if (testDeviceId) await supabase.from('devices').delete().eq('id', testDeviceId);
  if (testBarId) await supabase.from('bars').delete().eq('id', testBarId);
  if (testUserId) await supabase.from('users').delete().eq('id', testUserId);
});

describe('Trigger - updated_at Auto-Update', () => {
  it('bars.updated_at should auto-update on modification', async () => {
    // Get original updated_at
    const { data: before } = await supabase
      .from('bars')
      .select('updated_at')
      .eq('id', testBarId)
      .single();

    const originalUpdatedAt = before?.updated_at;

    // Wait a moment to ensure timestamp differs
    await new Promise(resolve => setTimeout(resolve, 100));

    // Update the bar
    await supabase
      .from('bars')
      .update({ name: 'Trigger Test Bar Updated' })
      .eq('id', testBarId);

    // Get new updated_at
    const { data: after } = await supabase
      .from('bars')
      .select('updated_at')
      .eq('id', testBarId)
      .single();

    expect(new Date(after!.updated_at).getTime()).toBeGreaterThan(
      new Date(originalUpdatedAt!).getTime()
    );

    // Restore original name
    await supabase
      .from('bars')
      .update({ name: 'Trigger Test Bar' })
      .eq('id', testBarId);
  });

  it('users.updated_at should auto-update on modification', async () => {
    const { data: before } = await supabase
      .from('users')
      .select('updated_at')
      .eq('id', testUserId)
      .single();

    await new Promise(resolve => setTimeout(resolve, 100));

    await supabase
      .from('users')
      .update({ full_name: 'Trigger Test User Updated' })
      .eq('id', testUserId);

    const { data: after } = await supabase
      .from('users')
      .select('updated_at')
      .eq('id', testUserId)
      .single();

    expect(new Date(after!.updated_at).getTime()).toBeGreaterThan(
      new Date(before!.updated_at).getTime()
    );

    // Restore
    await supabase
      .from('users')
      .update({ full_name: 'Trigger Test User' })
      .eq('id', testUserId);
  });

  it('products.updated_at should auto-update on modification', async () => {
    // Create a product
    const { data: product } = await supabase
      .from('products')
      .insert({
        bar_id: testBarId,
        name: 'Trigger Product',
        category: 'drinks',
        selling_price_rwf: 1000,
      })
      .select()
      .single();

    const originalUpdatedAt = product?.updated_at;

    await new Promise(resolve => setTimeout(resolve, 100));

    // Update product
    await supabase
      .from('products')
      .update({ selling_price_rwf: 1200 })
      .eq('id', product!.id);

    const { data: after } = await supabase
      .from('products')
      .select('updated_at')
      .eq('id', product!.id)
      .single();

    expect(new Date(after!.updated_at).getTime()).toBeGreaterThan(
      new Date(originalUpdatedAt!).getTime()
    );

    // Cleanup
    await supabase.from('products').delete().eq('id', product!.id);
  });
});

describe('Database Functions - Stock Balance', () => {
  let productId: string;

  beforeAll(async () => {
    const { data: product } = await supabase
      .from('products')
      .insert({
        bar_id: testBarId,
        name: 'Balance Test Product',
        category: 'drinks',
        selling_price_rwf: 500,
      })
      .select()
      .single();
    productId = product?.id;
  });

  afterAll(async () => {
    await supabase.from('stock_movements').delete().eq('product_id', productId);
    await supabase.from('products').delete().eq('id', productId);
  });

  it('get_stock_balance should calculate correctly after delivery', async () => {
    // Add a delivery
    await supabase.from('stock_movements').insert({
      bar_id: testBarId,
      product_id: productId,
      quantity: 24,
      movement_type: 'delivery',
      from_user_id: null,
      to_user_id: testUserId,
      performed_by: testUserId,
      device_id: testDeviceId,
    });

    // Check balance using function
    const { data, error } = await supabase.rpc('get_stock_balance', {
      p_bar_id: testBarId,
      p_product_id: productId,
      p_user_id: testUserId,
    });

    expect(error).toBeNull();
    expect(data).toBe(24);
  });

  it('get_stock_balance should decrease after allocation', async () => {
    // Create another user for allocation
    const { data: serverUser } = await supabase
      .from('users')
      .insert({ phone: '+250788400002', full_name: 'Server User' })
      .select()
      .single();

    // Allocate stock from testUserId to server
    await supabase.from('stock_movements').insert({
      bar_id: testBarId,
      product_id: productId,
      quantity: 6,
      movement_type: 'allocation',
      from_user_id: testUserId,
      to_user_id: serverUser!.id,
      performed_by: testUserId,
      device_id: testDeviceId,
    });

    // Check testUser's balance (should be 24 - 6 = 18)
    const { data: ownerBalance } = await supabase.rpc('get_stock_balance', {
      p_bar_id: testBarId,
      p_product_id: productId,
      p_user_id: testUserId,
    });

    expect(ownerBalance).toBe(18);

    // Check server's balance (should be 6)
    const { data: serverBalance } = await supabase.rpc('get_stock_balance', {
      p_bar_id: testBarId,
      p_product_id: productId,
      p_user_id: serverUser!.id,
    });

    expect(serverBalance).toBe(6);

    // Cleanup
    await supabase.from('stock_movements').delete().eq('to_user_id', serverUser!.id);
    await supabase.from('users').delete().eq('id', serverUser!.id);
  });
});

describe('Database Functions - User Role Check', () => {
  it('user_has_role should return true for valid role', async () => {
    // First assign a role
    await supabase.from('user_roles').insert({
      user_id: testUserId,
      bar_id: testBarId,
      role: 'owner',
      assigned_by: testUserId,
    });

    const { data, error } = await supabase.rpc('user_has_role', {
      p_user_id: testUserId,
      p_bar_id: testBarId,
    });

    expect(error).toBeNull();
    expect(data).toBe(true);

    // Cleanup
    await supabase.from('user_roles').delete()
      .eq('user_id', testUserId)
      .eq('bar_id', testBarId);
  });

  it('user_has_role should return false for no role', async () => {
    // Create a user with no roles
    const { data: noRoleUser } = await supabase
      .from('users')
      .insert({ phone: '+250788400003', full_name: 'No Role User' })
      .select()
      .single();

    const { data, error } = await supabase.rpc('user_has_role', {
      p_user_id: noRoleUser!.id,
      p_bar_id: testBarId,
    });

    expect(error).toBeNull();
    expect(data).toBe(false);

    // Cleanup
    await supabase.from('users').delete().eq('id', noRoleUser!.id);
  });

  it('get_user_role should return correct role', async () => {
    // Assign role
    await supabase.from('user_roles').insert({
      user_id: testUserId,
      bar_id: testBarId,
      role: 'manager',
      assigned_by: testUserId,
    });

    const { data, error } = await supabase.rpc('get_user_role', {
      p_user_id: testUserId,
      p_bar_id: testBarId,
    });

    expect(error).toBeNull();
    expect(data).toBe('manager');

    // Cleanup
    await supabase.from('user_roles').delete()
      .eq('user_id', testUserId)
      .eq('bar_id', testBarId);
  });
});

describe('Database Functions - Day/Shift Status', () => {
  let dayId: string;
  let shiftId: string;

  beforeAll(async () => {
    const { data: day } = await supabase
      .from('days')
      .insert({
        bar_id: testBarId,
        business_date: '2024-04-01',
        status: 'open',
        opened_by: testUserId,
        opened_device_id: testDeviceId,
      })
      .select()
      .single();
    dayId = day?.id;

    const { data: shift } = await supabase
      .from('shifts')
      .insert({
        bar_id: testBarId,
        day_id: dayId,
        name: 'Function Test Shift',
        status: 'open',
      })
      .select()
      .single();
    shiftId = shift?.id;
  });

  afterAll(async () => {
    if (shiftId) await supabase.from('shifts').delete().eq('id', shiftId);
    if (dayId) await supabase.from('days').delete().eq('id', dayId);
  });

  it('is_day_open should return true for open day', async () => {
    const { data, error } = await supabase.rpc('is_day_open', {
      p_day_id: dayId,
    });

    expect(error).toBeNull();
    expect(data).toBe(true);
  });

  it('is_shift_open should return true for open shift', async () => {
    const { data, error } = await supabase.rpc('is_shift_open', {
      p_shift_id: shiftId,
    });

    expect(error).toBeNull();
    expect(data).toBe(true);
  });

  it('is_shift_open should return false for closed shift', async () => {
    // Close the shift
    await supabase
      .from('shifts')
      .update({ status: 'closed' })
      .eq('id', shiftId);

    const { data, error } = await supabase.rpc('is_shift_open', {
      p_shift_id: shiftId,
    });

    expect(error).toBeNull();
    expect(data).toBe(false);

    // Reopen for other tests
    await supabase
      .from('shifts')
      .update({ status: 'open' })
      .eq('id', shiftId);
  });
});

describe('Database Functions - Event Logging', () => {
  let dayId: string;
  let shiftId: string;

  beforeAll(async () => {
    // Assign role first
    await supabase.from('user_roles').insert({
      user_id: testUserId,
      bar_id: testBarId,
      role: 'owner',
      assigned_by: testUserId,
    });

    const { data: day } = await supabase
      .from('days')
      .insert({
        bar_id: testBarId,
        business_date: '2024-04-02',
        opened_by: testUserId,
        opened_device_id: testDeviceId,
      })
      .select()
      .single();
    dayId = day?.id;

    const { data: shift } = await supabase
      .from('shifts')
      .insert({
        bar_id: testBarId,
        day_id: dayId,
        name: 'Log Event Test Shift',
        status: 'open',
      })
      .select()
      .single();
    shiftId = shift?.id;
  });

  afterAll(async () => {
    await supabase.from('events').delete().eq('shift_id', shiftId);
    if (shiftId) await supabase.from('shifts').delete().eq('id', shiftId);
    if (dayId) await supabase.from('days').delete().eq('id', dayId);
    await supabase.from('user_roles').delete()
      .eq('user_id', testUserId)
      .eq('bar_id', testBarId);
  });

  it('log_event should create event and return ID', async () => {
    const { data: eventId, error } = await supabase.rpc('log_event', {
      p_bar_id: testBarId,
      p_device_id: testDeviceId,
      p_user_id: testUserId,
      p_user_role: 'owner',
      p_shift_id: shiftId,
      p_event_type: 'login',
      p_entity_type: 'session',
      p_entity_id: null,
      p_payload: { action: 'test_login', ip: '127.0.0.1' },
      p_reason: null,
      p_client_timestamp: new Date().toISOString(),
    });

    expect(error).toBeNull();
    expect(eventId).toBeDefined();

    // Verify event was created
    const { data: event } = await supabase
      .from('events')
      .select('*')
      .eq('id', eventId)
      .single();

    expect(event?.event_type).toBe('login');
    expect(event?.payload).toEqual({ action: 'test_login', ip: '127.0.0.1' });
  });
});
