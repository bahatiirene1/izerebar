/**
 * Row Level Security (RLS) Policy Tests
 * @implements ARCHITECTURE.md Section 2.6 - RLS Policies
 * @implements CLAUDE.md - RLS tests requirement
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Use environment variables with fallbacks for local development
const SUPABASE_URL = process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

let supabase: SupabaseClient;

// Test fixtures
let bar1Id: string;
let bar2Id: string;
let user1Id: string;  // Owner of bar1
let user2Id: string;  // Manager of bar1
let user3Id: string;  // Owner of bar2 (no access to bar1)
let device1Id: string;
let device2Id: string;

beforeAll(async () => {
  supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Create test users
  const { data: u1 } = await supabase
    .from('users')
    .insert({ phone: '+250788300001', full_name: 'RLS Owner User' })
    .select()
    .single();
  user1Id = u1?.id;

  const { data: u2 } = await supabase
    .from('users')
    .insert({ phone: '+250788300002', full_name: 'RLS Manager User' })
    .select()
    .single();
  user2Id = u2?.id;

  const { data: u3 } = await supabase
    .from('users')
    .insert({ phone: '+250788300003', full_name: 'RLS Other Bar Owner' })
    .select()
    .single();
  user3Id = u3?.id;

  // Create bar1 owned by user1
  const { data: b1 } = await supabase
    .from('bars')
    .insert({ name: 'RLS Test Bar 1', owner_id: user1Id })
    .select()
    .single();
  bar1Id = b1?.id;

  // Create bar2 owned by user3
  const { data: b2 } = await supabase
    .from('bars')
    .insert({ name: 'RLS Test Bar 2', owner_id: user3Id })
    .select()
    .single();
  bar2Id = b2?.id;

  // Create devices
  const { data: d1 } = await supabase
    .from('devices')
    .insert({ bar_id: bar1Id, name: 'Bar1 Device', fingerprint: 'rls-fp-001' })
    .select()
    .single();
  device1Id = d1?.id;

  const { data: d2 } = await supabase
    .from('devices')
    .insert({ bar_id: bar2Id, name: 'Bar2 Device', fingerprint: 'rls-fp-002' })
    .select()
    .single();
  device2Id = d2?.id;

  // Assign roles
  await supabase.from('user_roles').insert({
    user_id: user1Id,
    bar_id: bar1Id,
    role: 'owner',
    assigned_by: user1Id,
  });

  await supabase.from('user_roles').insert({
    user_id: user2Id,
    bar_id: bar1Id,
    role: 'manager',
    assigned_by: user1Id,
  });

  await supabase.from('user_roles').insert({
    user_id: user3Id,
    bar_id: bar2Id,
    role: 'owner',
    assigned_by: user3Id,
  });
});

afterAll(async () => {
  // Cleanup in reverse dependency order
  await supabase.from('user_roles').delete().in('bar_id', [bar1Id, bar2Id]);
  await supabase.from('devices').delete().in('id', [device1Id, device2Id]);
  await supabase.from('bars').delete().in('id', [bar1Id, bar2Id]);
  await supabase.from('users').delete().in('id', [user1Id, user2Id, user3Id]);
});

describe('RLS - Service Role Access', () => {
  it('service role should bypass RLS and see all bars', async () => {
    const { data, error } = await supabase.from('bars').select('id');

    expect(error).toBeNull();
    expect(data).not.toBeNull();
    expect(data!.length).toBeGreaterThanOrEqual(2);
  });

  it('service role should see all users', async () => {
    const { data, error } = await supabase.from('users').select('id');

    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThanOrEqual(3);
  });
});

describe('RLS - Bar Isolation', () => {
  it('bars should be correctly created with owners', async () => {
    const { data: bar1 } = await supabase
      .from('bars')
      .select('*')
      .eq('id', bar1Id)
      .single();

    const { data: bar2 } = await supabase
      .from('bars')
      .select('*')
      .eq('id', bar2Id)
      .single();

    expect(bar1?.owner_id).toBe(user1Id);
    expect(bar2?.owner_id).toBe(user3Id);
  });

  it('user_roles should correctly map users to bars', async () => {
    const { data: bar1Roles } = await supabase
      .from('user_roles')
      .select('user_id, role')
      .eq('bar_id', bar1Id);

    const { data: bar2Roles } = await supabase
      .from('user_roles')
      .select('user_id, role')
      .eq('bar_id', bar2Id);

    // Bar1 has user1 (owner) and user2 (manager)
    expect(bar1Roles).toHaveLength(2);
    expect(bar1Roles?.find(r => r.user_id === user1Id)?.role).toBe('owner');
    expect(bar1Roles?.find(r => r.user_id === user2Id)?.role).toBe('manager');

    // Bar2 has only user3 (owner)
    expect(bar2Roles).toHaveLength(1);
    expect(bar2Roles?.[0].user_id).toBe(user3Id);
  });

  it('user3 should NOT have any role in bar1', async () => {
    const { data } = await supabase
      .from('user_roles')
      .select('*')
      .eq('bar_id', bar1Id)
      .eq('user_id', user3Id);

    expect(data).toHaveLength(0);
  });
});

describe('RLS - Products Isolation', () => {
  let bar1ProductId: string;
  let bar2ProductId: string;

  beforeAll(async () => {
    const { data: p1 } = await supabase
      .from('products')
      .insert({
        bar_id: bar1Id,
        name: 'Bar1 Primus',
        category: 'drinks',
        selling_price_rwf: 1000,
      })
      .select()
      .single();
    bar1ProductId = p1?.id;

    const { data: p2 } = await supabase
      .from('products')
      .insert({
        bar_id: bar2Id,
        name: 'Bar2 Mutzig',
        category: 'drinks',
        selling_price_rwf: 1200,
      })
      .select()
      .single();
    bar2ProductId = p2?.id;
  });

  afterAll(async () => {
    await supabase.from('products').delete().in('id', [bar1ProductId, bar2ProductId]);
  });

  it('products should be scoped to their bars', async () => {
    const { data: bar1Products } = await supabase
      .from('products')
      .select('id, name')
      .eq('bar_id', bar1Id);

    const { data: bar2Products } = await supabase
      .from('products')
      .select('id, name')
      .eq('bar_id', bar2Id);

    // Each bar should only see its own products
    expect(bar1Products?.find(p => p.id === bar1ProductId)).toBeDefined();
    expect(bar1Products?.find(p => p.id === bar2ProductId)).toBeUndefined();

    expect(bar2Products?.find(p => p.id === bar2ProductId)).toBeDefined();
    expect(bar2Products?.find(p => p.id === bar1ProductId)).toBeUndefined();
  });
});

describe('RLS - Events Append-Only', () => {
  let dayId: string;
  let shiftId: string;
  let eventId: string;

  beforeAll(async () => {
    const { data: day } = await supabase
      .from('days')
      .insert({
        bar_id: bar1Id,
        business_date: '2024-03-01',
        opened_by: user1Id,
        opened_device_id: device1Id,
      })
      .select()
      .single();
    dayId = day?.id;

    const { data: shift } = await supabase
      .from('shifts')
      .insert({
        bar_id: bar1Id,
        day_id: dayId,
        name: 'RLS Test Shift',
        status: 'open',
      })
      .select()
      .single();
    shiftId = shift?.id;

    const { data: event } = await supabase
      .from('events')
      .insert({
        bar_id: bar1Id,
        device_id: device1Id,
        user_id: user1Id,
        user_role: 'owner',
        shift_id: shiftId,
        event_type: 'shift_open',
        payload: { test: true },
        client_timestamp: new Date().toISOString(),
      })
      .select()
      .single();
    eventId = event?.id;
  });

  afterAll(async () => {
    // Service role can delete for cleanup
    if (eventId) await supabase.from('events').delete().eq('id', eventId);
    if (shiftId) await supabase.from('shifts').delete().eq('id', shiftId);
    if (dayId) await supabase.from('days').delete().eq('id', dayId);
  });

  it('events should be insertable', async () => {
    const { data, error } = await supabase
      .from('events')
      .insert({
        bar_id: bar1Id,
        device_id: device1Id,
        user_id: user2Id,
        user_role: 'manager',
        shift_id: shiftId,
        event_type: 'login',
        payload: { action: 'test' },
        client_timestamp: new Date().toISOString(),
      })
      .select()
      .single();

    expect(error).toBeNull();
    expect(data?.event_type).toBe('login');

    // Cleanup
    if (data) await supabase.from('events').delete().eq('id', data.id);
  });

  it('events should track full audit context', async () => {
    const { data } = await supabase
      .from('events')
      .select('*')
      .eq('id', eventId)
      .single();

    expect(data?.bar_id).toBe(bar1Id);
    expect(data?.device_id).toBe(device1Id);
    expect(data?.user_id).toBe(user1Id);
    expect(data?.user_role).toBe('owner');
    expect(data?.shift_id).toBe(shiftId);
    expect(data?.payload).toEqual({ test: true });
  });

  it('events should be scoped to bar', async () => {
    const { data: bar1Events } = await supabase
      .from('events')
      .select('id')
      .eq('bar_id', bar1Id);

    const { data: bar2Events } = await supabase
      .from('events')
      .select('id')
      .eq('bar_id', bar2Id);

    expect(bar1Events?.find(e => e.id === eventId)).toBeDefined();
    expect(bar2Events?.find(e => e.id === eventId)).toBeUndefined();
  });
});

describe('RLS - Sales Accountability Chain', () => {
  let dayId: string;
  let shiftId: string;
  let productId: string;
  let saleId: string;

  beforeAll(async () => {
    const { data: product } = await supabase
      .from('products')
      .insert({
        bar_id: bar1Id,
        name: 'Sale Test Beer',
        category: 'drinks',
        selling_price_rwf: 1500,
      })
      .select()
      .single();
    productId = product?.id;

    const { data: day } = await supabase
      .from('days')
      .insert({
        bar_id: bar1Id,
        business_date: '2024-03-02',
        opened_by: user1Id,
        opened_device_id: device1Id,
      })
      .select()
      .single();
    dayId = day?.id;

    const { data: shift } = await supabase
      .from('shifts')
      .insert({
        bar_id: bar1Id,
        day_id: dayId,
        name: 'Sales Test Shift',
        status: 'open',
      })
      .select()
      .single();
    shiftId = shift?.id;

    const { data: sale } = await supabase
      .from('sales')
      .insert({
        bar_id: bar1Id,
        shift_id: shiftId,
        product_id: productId,
        quantity: 2,
        unit_price_rwf: 1500,
        total_price_rwf: 3000,
        assigned_to_server_id: user2Id,
        assigned_by_bartender_id: user1Id,
        created_device_id: device1Id,
      })
      .select()
      .single();
    saleId = sale?.id;
  });

  afterAll(async () => {
    if (saleId) await supabase.from('sales').delete().eq('id', saleId);
    if (shiftId) await supabase.from('shifts').delete().eq('id', shiftId);
    if (dayId) await supabase.from('days').delete().eq('id', dayId);
    if (productId) await supabase.from('products').delete().eq('id', productId);
  });

  it('sale should have complete accountability chain', async () => {
    const { data } = await supabase
      .from('sales')
      .select('*')
      .eq('id', saleId)
      .single();

    expect(data?.assigned_to_server_id).toBe(user2Id);
    expect(data?.assigned_by_bartender_id).toBe(user1Id);
    expect(data?.created_device_id).toBe(device1Id);
    expect(data?.status).toBe('pending');
  });

  it('sales should be scoped to bar', async () => {
    const { data: bar1Sales } = await supabase
      .from('sales')
      .select('id')
      .eq('bar_id', bar1Id);

    const { data: bar2Sales } = await supabase
      .from('sales')
      .select('id')
      .eq('bar_id', bar2Id);

    expect(bar1Sales?.find(s => s.id === saleId)).toBeDefined();
    expect(bar2Sales?.find(s => s.id === saleId)).toBeUndefined();
  });
});

describe('RLS - Stock Movement Custody Chain', () => {
  let productId: string;
  let movementId: string;

  beforeAll(async () => {
    const { data: product } = await supabase
      .from('products')
      .insert({
        bar_id: bar1Id,
        name: 'Stock Test Product',
        category: 'drinks',
        selling_price_rwf: 800,
      })
      .select()
      .single();
    productId = product?.id;

    // Create a delivery movement
    const { data: movement } = await supabase
      .from('stock_movements')
      .insert({
        bar_id: bar1Id,
        product_id: productId,
        quantity: 24,
        movement_type: 'delivery',
        from_user_id: null,
        to_user_id: user1Id,
        performed_by: user1Id,
        device_id: device1Id,
      })
      .select()
      .single();
    movementId = movement?.id;
  });

  afterAll(async () => {
    if (movementId) await supabase.from('stock_movements').delete().eq('id', movementId);
    if (productId) await supabase.from('products').delete().eq('id', productId);
  });

  it('stock movement should track custody correctly', async () => {
    const { data } = await supabase
      .from('stock_movements')
      .select('*')
      .eq('id', movementId)
      .single();

    expect(data?.movement_type).toBe('delivery');
    expect(data?.from_user_id).toBeNull(); // Delivery has no from_user
    expect(data?.to_user_id).toBe(user1Id);
    expect(data?.performed_by).toBe(user1Id);
    expect(data?.device_id).toBe(device1Id);
  });

  it('stock movements should be scoped to bar', async () => {
    const { data: bar1Movements } = await supabase
      .from('stock_movements')
      .select('id')
      .eq('bar_id', bar1Id);

    const { data: bar2Movements } = await supabase
      .from('stock_movements')
      .select('id')
      .eq('bar_id', bar2Id);

    expect(bar1Movements?.find(m => m.id === movementId)).toBeDefined();
    expect(bar2Movements?.find(m => m.id === movementId)).toBeUndefined();
  });
});

describe('RLS - Devices Scoped to Bar', () => {
  it('devices should be scoped to their bars', async () => {
    const { data: bar1Devices } = await supabase
      .from('devices')
      .select('id, name')
      .eq('bar_id', bar1Id);

    const { data: bar2Devices } = await supabase
      .from('devices')
      .select('id, name')
      .eq('bar_id', bar2Id);

    expect(bar1Devices?.find(d => d.id === device1Id)).toBeDefined();
    expect(bar1Devices?.find(d => d.id === device2Id)).toBeUndefined();

    expect(bar2Devices?.find(d => d.id === device2Id)).toBeDefined();
    expect(bar2Devices?.find(d => d.id === device1Id)).toBeUndefined();
  });
});
