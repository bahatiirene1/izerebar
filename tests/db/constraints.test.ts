/**
 * Database Constraint Tests
 * @implements ARCHITECTURE.md Section 2 - Table constraints
 * @implements CLAUDE.md - Constraint tests requirement
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'http://127.0.0.1:54321';
const SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

let supabase: SupabaseClient;
let testUserId: string;
let testBarId: string;
let testDeviceId: string;

beforeAll(async () => {
  supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Create test fixtures
  const { data: user } = await supabase
    .from('users')
    .insert({ phone: '+250788100001', full_name: 'Constraint Test User' })
    .select()
    .single();
  testUserId = user?.id;

  const { data: bar } = await supabase
    .from('bars')
    .insert({ name: 'Constraint Test Bar', owner_id: testUserId })
    .select()
    .single();
  testBarId = bar?.id;

  const { data: device } = await supabase
    .from('devices')
    .insert({ bar_id: testBarId, name: 'Test Device', fingerprint: 'test-fp-001' })
    .select()
    .single();
  testDeviceId = device?.id;
});

afterAll(async () => {
  // Cleanup in reverse order
  if (testDeviceId) await supabase.from('devices').delete().eq('id', testDeviceId);
  if (testBarId) await supabase.from('bars').delete().eq('id', testBarId);
  if (testUserId) await supabase.from('users').delete().eq('id', testUserId);
});

describe('Users Constraints', () => {
  it('should reject invalid phone format', async () => {
    const { error } = await supabase
      .from('users')
      .insert({ phone: 'invalid-phone', full_name: 'Test' });

    expect(error).not.toBeNull();
    expect(error?.message).toContain('users_phone_format');
  });

  it('should reject empty name', async () => {
    const { error } = await supabase
      .from('users')
      .insert({ phone: '+250788100002', full_name: '   ' });

    expect(error).not.toBeNull();
    expect(error?.message).toContain('users_name_not_empty');
  });

  it('should enforce unique phone', async () => {
    // First insert
    const { data: user1 } = await supabase
      .from('users')
      .insert({ phone: '+250788100003', full_name: 'User 1' })
      .select()
      .single();

    // Duplicate insert
    const { error } = await supabase
      .from('users')
      .insert({ phone: '+250788100003', full_name: 'User 2' });

    expect(error).not.toBeNull();
    expect(error?.code).toBe('23505'); // Unique violation

    // Cleanup
    if (user1) await supabase.from('users').delete().eq('id', user1.id);
  });
});

describe('Bars Constraints', () => {
  it('should reject empty bar name', async () => {
    const { error } = await supabase
      .from('bars')
      .insert({ name: '  ', owner_id: testUserId });

    expect(error).not.toBeNull();
    expect(error?.message).toContain('bars_name_not_empty');
  });

  it('should require owner_id', async () => {
    const { error } = await supabase
      .from('bars')
      .insert({ name: 'Test Bar No Owner' });

    expect(error).not.toBeNull();
  });
});

describe('Products Constraints', () => {
  it('should reject negative price', async () => {
    const { error } = await supabase
      .from('products')
      .insert({
        bar_id: testBarId,
        name: 'Test Product',
        category: 'drinks',
        selling_price_rwf: -100,
      });

    expect(error).not.toBeNull();
    expect(error?.message).toContain('products_positive_price');
  });

  it('should reject invalid category', async () => {
    const { error } = await supabase
      .from('products')
      .insert({
        bar_id: testBarId,
        name: 'Test Product',
        category: 'invalid_category',
        selling_price_rwf: 1000,
      });

    expect(error).not.toBeNull();
    expect(error?.message).toContain('products_valid_category');
  });

  it('should accept valid product', async () => {
    const { data, error } = await supabase
      .from('products')
      .insert({
        bar_id: testBarId,
        name: 'Primus Beer',
        category: 'drinks',
        selling_price_rwf: 1500,
      })
      .select()
      .single();

    expect(error).toBeNull();
    expect(data?.name).toBe('Primus Beer');

    // Cleanup
    if (data) await supabase.from('products').delete().eq('id', data.id);
  });
});

describe('Sales Constraints', () => {
  let testProductId: string;
  let testDayId: string;
  let testShiftId: string;

  beforeAll(async () => {
    // Create required fixtures
    const { data: product } = await supabase
      .from('products')
      .insert({
        bar_id: testBarId,
        name: 'Sales Test Product',
        category: 'drinks',
        selling_price_rwf: 1000,
      })
      .select()
      .single();
    testProductId = product?.id;

    const { data: day } = await supabase
      .from('days')
      .insert({
        bar_id: testBarId,
        business_date: new Date().toISOString().split('T')[0],
        opened_by: testUserId,
        opened_device_id: testDeviceId,
      })
      .select()
      .single();
    testDayId = day?.id;

    const { data: shift } = await supabase
      .from('shifts')
      .insert({
        bar_id: testBarId,
        day_id: testDayId,
        name: 'Morning',
        status: 'open',
      })
      .select()
      .single();
    testShiftId = shift?.id;
  });

  afterAll(async () => {
    if (testShiftId) await supabase.from('shifts').delete().eq('id', testShiftId);
    if (testDayId) await supabase.from('days').delete().eq('id', testDayId);
    if (testProductId) await supabase.from('products').delete().eq('id', testProductId);
  });

  it('should reject zero quantity', async () => {
    const { error } = await supabase
      .from('sales')
      .insert({
        bar_id: testBarId,
        shift_id: testShiftId,
        product_id: testProductId,
        quantity: 0,
        unit_price_rwf: 1000,
        total_price_rwf: 0,
        assigned_to_server_id: testUserId,
        assigned_by_bartender_id: testUserId,
        created_device_id: testDeviceId,
      });

    expect(error).not.toBeNull();
    expect(error?.message).toContain('sales_positive_qty');
  });

  it('should enforce total = quantity * unit_price', async () => {
    const { error } = await supabase
      .from('sales')
      .insert({
        bar_id: testBarId,
        shift_id: testShiftId,
        product_id: testProductId,
        quantity: 2,
        unit_price_rwf: 1000,
        total_price_rwf: 1500, // Wrong: should be 2000
        assigned_to_server_id: testUserId,
        assigned_by_bartender_id: testUserId,
        created_device_id: testDeviceId,
      });

    expect(error).not.toBeNull();
    expect(error?.message).toContain('sales_total_matches');
  });

  it('should accept valid sale', async () => {
    const { data, error } = await supabase
      .from('sales')
      .insert({
        bar_id: testBarId,
        shift_id: testShiftId,
        product_id: testProductId,
        quantity: 2,
        unit_price_rwf: 1000,
        total_price_rwf: 2000,
        assigned_to_server_id: testUserId,
        assigned_by_bartender_id: testUserId,
        created_device_id: testDeviceId,
      })
      .select()
      .single();

    expect(error).toBeNull();
    expect(data?.status).toBe('pending');

    // Cleanup
    if (data) await supabase.from('sales').delete().eq('id', data.id);
  });
});

describe('Stock Movements Constraints', () => {
  let testProductId: string;

  beforeAll(async () => {
    const { data: product } = await supabase
      .from('products')
      .insert({
        bar_id: testBarId,
        name: 'Stock Test Product',
        category: 'drinks',
        selling_price_rwf: 1000,
      })
      .select()
      .single();
    testProductId = product?.id;
  });

  afterAll(async () => {
    if (testProductId) await supabase.from('products').delete().eq('id', testProductId);
  });

  it('should require reason for adjustments', async () => {
    const { error } = await supabase
      .from('stock_movements')
      .insert({
        bar_id: testBarId,
        product_id: testProductId,
        quantity: 5,
        movement_type: 'adjustment',
        from_user_id: testUserId,
        to_user_id: testUserId,
        performed_by: testUserId,
        device_id: testDeviceId,
        // Missing reason!
      });

    expect(error).not.toBeNull();
    expect(error?.message).toContain('stock_movements_reason_required');
  });

  it('should require reason for damage', async () => {
    const { error } = await supabase
      .from('stock_movements')
      .insert({
        bar_id: testBarId,
        product_id: testProductId,
        quantity: 1,
        movement_type: 'damage',
        from_user_id: testUserId,
        performed_by: testUserId,
        device_id: testDeviceId,
        // Missing reason!
      });

    expect(error).not.toBeNull();
    expect(error?.message).toContain('stock_movements_reason_required');
  });

  it('should validate custody for delivery (no from_user)', async () => {
    const { error } = await supabase
      .from('stock_movements')
      .insert({
        bar_id: testBarId,
        product_id: testProductId,
        quantity: 10,
        movement_type: 'delivery',
        from_user_id: testUserId, // Should be NULL for delivery
        to_user_id: testUserId,
        performed_by: testUserId,
        device_id: testDeviceId,
      });

    expect(error).not.toBeNull();
    expect(error?.message).toContain('stock_movements_custody_valid');
  });

  it('should accept valid delivery', async () => {
    const { data, error } = await supabase
      .from('stock_movements')
      .insert({
        bar_id: testBarId,
        product_id: testProductId,
        quantity: 10,
        movement_type: 'delivery',
        from_user_id: null,
        to_user_id: testUserId,
        performed_by: testUserId,
        device_id: testDeviceId,
      })
      .select()
      .single();

    expect(error).toBeNull();
    expect(data?.quantity).toBe(10);

    // Cleanup
    if (data) await supabase.from('stock_movements').delete().eq('id', data.id);
  });
});

describe('Days Constraints', () => {
  it('should enforce unique business_date per bar', async () => {
    const today = new Date().toISOString().split('T')[0];

    const { data: day1 } = await supabase
      .from('days')
      .insert({
        bar_id: testBarId,
        business_date: today,
        opened_by: testUserId,
        opened_device_id: testDeviceId,
      })
      .select()
      .single();

    // Duplicate
    const { error } = await supabase
      .from('days')
      .insert({
        bar_id: testBarId,
        business_date: today,
        opened_by: testUserId,
        opened_device_id: testDeviceId,
      });

    expect(error).not.toBeNull();
    expect(error?.code).toBe('23505'); // Unique violation

    // Cleanup
    if (day1) await supabase.from('days').delete().eq('id', day1.id);
  });
});

describe('Credits Constraints', () => {
  let testShiftId: string;
  let testDayId: string;

  beforeAll(async () => {
    const { data: day } = await supabase
      .from('days')
      .insert({
        bar_id: testBarId,
        business_date: '2024-01-15',
        opened_by: testUserId,
        opened_device_id: testDeviceId,
      })
      .select()
      .single();
    testDayId = day?.id;

    const { data: shift } = await supabase
      .from('shifts')
      .insert({
        bar_id: testBarId,
        day_id: testDayId,
        name: 'Credit Test Shift',
        status: 'open',
      })
      .select()
      .single();
    testShiftId = shift?.id;
  });

  afterAll(async () => {
    if (testShiftId) await supabase.from('shifts').delete().eq('id', testShiftId);
    if (testDayId) await supabase.from('days').delete().eq('id', testDayId);
  });

  it('should reject zero or negative credit amount', async () => {
    const { error } = await supabase
      .from('credits')
      .insert({
        bar_id: testBarId,
        shift_id: testShiftId,
        amount_rwf: 0,
        issued_by: testUserId,
        device_id: testDeviceId,
      });

    expect(error).not.toBeNull();
    expect(error?.message).toContain('credits_positive_amount');
  });

  it('should accept valid credit', async () => {
    const { data, error } = await supabase
      .from('credits')
      .insert({
        bar_id: testBarId,
        shift_id: testShiftId,
        amount_rwf: 5000,
        customer_description: 'Regular customer with blue hat',
        issued_by: testUserId,
        device_id: testDeviceId,
      })
      .select()
      .single();

    expect(error).toBeNull();
    expect(data?.is_collected).toBe(false);

    // Cleanup
    if (data) await supabase.from('credits').delete().eq('id', data.id);
  });
});
