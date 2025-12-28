/**
 * Sales Edge Function
 * @implements ARCHITECTURE.md Section 3.3 - Sale State Machine
 * @implements ARCHITECTURE.md Section 7 - API Layer
 */

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { handleCors } from '../_shared/cors.ts';
import { success, Errors } from '../_shared/response.ts';
import { createServiceClient } from '../_shared/supabase.ts';
import { authenticate, requireRole, ServiceContext } from '../_shared/auth.ts';
import { validate, ValidationSchema } from '../_shared/validation.ts';
import * as crypto from 'https://deno.land/std@0.208.0/crypto/mod.ts';

serve(async (req) => {
  // Handle CORS
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  // Authenticate
  const authResult = await authenticate(req);
  if (authResult instanceof Response) {
    return authResult;
  }
  const ctx: ServiceContext = authResult;

  const url = new URL(req.url);
  const path = url.pathname.replace('/sales', '');

  try {
    switch (path) {
      case '':
      case '/':
        if (req.method === 'GET') return await listSales(ctx, url);
        if (req.method === 'POST') return await createSale(ctx, req);
        return Errors.badRequest('Method not allowed');

      case '/collect':
        if (req.method === 'POST') return await collectPayment(ctx, req);
        return Errors.badRequest('Method not allowed');

      case '/confirm':
        if (req.method === 'POST') return await confirmSale(ctx, req);
        return Errors.badRequest('Method not allowed');

      case '/reverse':
        if (req.method === 'POST') return await reverseSale(ctx, req);
        return Errors.badRequest('Method not allowed');

      case '/summary':
        if (req.method === 'GET') return await getSalesSummary(ctx, url);
        return Errors.badRequest('Method not allowed');

      default:
        // Check for UUID pattern: /sales/{id}
        const saleIdMatch = path.match(/^\/([0-9a-f-]{36})$/i);
        if (saleIdMatch) {
          return await getSale(ctx, saleIdMatch[1]);
        }
        return Errors.notFound('Endpoint');
    }
  } catch (error) {
    console.error('Sales error:', error);
    return Errors.internal(error.message);
  }
});

/**
 * Generate a unique sale number for the day
 */
function generateSaleNumber(date: string, sequence: number): string {
  const dateStr = date.replace(/-/g, '');
  return `S${dateStr}-${String(sequence).padStart(4, '0')}`;
}

/**
 * Hash PIN for verification
 */
async function hashPin(pin: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(pin);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * GET /sales
 * List sales with filters
 */
async function listSales(ctx: ServiceContext, url: URL): Promise<Response> {
  const supabase = createServiceClient();

  const dayId = url.searchParams.get('day_id');
  const shiftId = url.searchParams.get('shift_id');
  const status = url.searchParams.get('status');
  const serverId = url.searchParams.get('server_id');
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 100);
  const offset = parseInt(url.searchParams.get('offset') || '0');

  let query = supabase
    .from('sales')
    .select(`
      *,
      created_by_user:users!sales_created_by_fkey(id, full_name),
      server:users!sales_server_id_fkey(id, full_name),
      confirmed_by_user:users!sales_confirmed_by_fkey(id, full_name),
      sale_items(
        id,
        quantity,
        unit_price,
        total_price,
        product:products(id, name, category)
      )
    `)
    .eq('bar_id', ctx.barId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (dayId) query = query.eq('day_id', dayId);
  if (shiftId) query = query.eq('shift_id', shiftId);
  if (status) query = query.eq('status', status);
  if (serverId) query = query.eq('server_id', serverId);

  const { data: sales, error } = await query;

  if (error) {
    console.error('List sales error:', error);
    return Errors.internal('Failed to fetch sales');
  }

  return success({ sales, limit, offset });
}

/**
 * GET /sales/{id}
 * Get a specific sale with details
 */
async function getSale(ctx: ServiceContext, saleId: string): Promise<Response> {
  const supabase = createServiceClient();

  const { data: sale, error } = await supabase
    .from('sales')
    .select(`
      *,
      created_by_user:users!sales_created_by_fkey(id, full_name),
      server:users!sales_server_id_fkey(id, full_name),
      confirmed_by_user:users!sales_confirmed_by_fkey(id, full_name),
      sale_items(
        id,
        quantity,
        unit_price,
        total_price,
        product:products(id, name, category, unit)
      )
    `)
    .eq('id', saleId)
    .eq('bar_id', ctx.barId)
    .single();

  if (error || !sale) {
    return Errors.notFound('Sale');
  }

  return success({ sale });
}

/**
 * POST /sales
 * Create a new sale (pending status)
 */
async function createSale(ctx: ServiceContext, req: Request): Promise<Response> {
  // Bartenders, servers, and managers can create sales
  const roleError = requireRole(ctx, ['owner', 'manager', 'bartender', 'server']);
  if (roleError) return roleError;

  const body = await req.json();

  if (!Array.isArray(body.items) || body.items.length === 0) {
    return Errors.badRequest('items must be a non-empty array');
  }

  const supabase = createServiceClient();

  // Check for open day and shift
  const { data: day } = await supabase
    .from('days')
    .select('id, date')
    .eq('bar_id', ctx.barId)
    .eq('status', 'open')
    .single();

  if (!day) {
    return Errors.badRequest('No open day');
  }

  if (!ctx.shiftId) {
    return Errors.badRequest('No open shift');
  }

  // Get next sale sequence for the day
  const { count } = await supabase
    .from('sales')
    .select('*', { count: 'exact', head: true })
    .eq('day_id', day.id);

  const saleNumber = generateSaleNumber(day.date, (count || 0) + 1);

  // Process items and calculate totals
  const processedItems: {
    productId: string;
    quantity: number;
    unitPrice: number;
    totalPrice: number;
  }[] = [];
  let totalAmount = 0;

  for (const item of body.items) {
    if (!item.productId || !item.quantity || item.quantity <= 0) {
      return Errors.badRequest(`Invalid item: ${JSON.stringify(item)}`);
    }

    // Get product price
    const { data: product } = await supabase
      .from('products')
      .select('id, selling_price')
      .eq('id', item.productId)
      .single();

    if (!product) {
      return Errors.badRequest(`Product not found: ${item.productId}`);
    }

    const unitPrice = item.unitPrice || product.selling_price;
    const itemTotal = unitPrice * item.quantity;

    processedItems.push({
      productId: item.productId,
      quantity: item.quantity,
      unitPrice,
      totalPrice: itemTotal,
    });

    totalAmount += itemTotal;
  }

  // Create sale
  const { data: sale, error: saleError } = await supabase
    .from('sales')
    .insert({
      bar_id: ctx.barId,
      day_id: day.id,
      shift_id: ctx.shiftId,
      sale_number: saleNumber,
      server_id: body.serverId || ctx.userId,
      payment_method: body.paymentMethod || 'cash',
      total_amount: totalAmount,
      status: 'pending',
      created_by: ctx.userId,
      table_number: body.tableNumber || null,
      customer_note: body.customerNote || null,
    })
    .select('*')
    .single();

  if (saleError) {
    console.error('Create sale error:', saleError);
    return Errors.internal('Failed to create sale');
  }

  // Create sale items
  const saleItems = processedItems.map(item => ({
    sale_id: sale.id,
    product_id: item.productId,
    quantity: item.quantity,
    unit_price: item.unitPrice,
    total_price: item.totalPrice,
  }));

  const { error: itemsError } = await supabase
    .from('sale_items')
    .insert(saleItems);

  if (itemsError) {
    console.error('Create sale items error:', itemsError);
    // Rollback sale
    await supabase.from('sales').delete().eq('id', sale.id);
    return Errors.internal('Failed to create sale items');
  }

  // Update stock assignments (mark sold)
  for (const item of processedItems) {
    // Find active stock assignment for this product
    const { data: assignment } = await supabase
      .from('stock_assignments')
      .select('id, quantity_sold')
      .eq('shift_id', ctx.shiftId)
      .eq('product_id', item.productId)
      .eq('assigned_to', body.serverId || ctx.userId)
      .is('returned_at', null)
      .single();

    if (assignment) {
      await supabase
        .from('stock_assignments')
        .update({
          quantity_sold: assignment.quantity_sold + item.quantity,
        })
        .eq('id', assignment.id);
    }
  }

  return success({
    sale: { ...sale, items: processedItems },
  }, 201);
}

/**
 * POST /sales/collect
 * Mark payment as collected (server collected from customer)
 */
async function collectPayment(ctx: ServiceContext, req: Request): Promise<Response> {
  const body = await req.json();

  const schema: ValidationSchema = {
    saleId: { required: true, type: 'uuid' },
  };

  const validation = validate(body, schema);
  if (!validation.valid) {
    return Errors.validationError(validation.errors);
  }

  const supabase = createServiceClient();

  // Get sale
  const { data: sale, error: saleError } = await supabase
    .from('sales')
    .select('*')
    .eq('id', body.saleId)
    .eq('bar_id', ctx.barId)
    .single();

  if (saleError || !sale) {
    return Errors.notFound('Sale');
  }

  if (sale.status !== 'pending') {
    return Errors.badRequest(`Sale is already ${sale.status}`);
  }

  // Verify user is the server or a manager
  if (sale.server_id !== ctx.userId && !['owner', 'manager'].includes(ctx.userRole)) {
    return Errors.forbidden();
  }

  // Update sale
  const { data: updatedSale, error } = await supabase
    .from('sales')
    .update({
      status: 'collected',
      collected_at: new Date().toISOString(),
      collected_amount: body.collectedAmount || sale.total_amount,
    })
    .eq('id', body.saleId)
    .select('*')
    .single();

  if (error) {
    console.error('Collect payment error:', error);
    return Errors.internal('Failed to update sale');
  }

  return success({ sale: updatedSale });
}

/**
 * POST /sales/confirm
 * Confirm payment received (manager confirms server handed over money)
 */
async function confirmSale(ctx: ServiceContext, req: Request): Promise<Response> {
  // Only owner/manager can confirm
  const roleError = requireRole(ctx, ['owner', 'manager']);
  if (roleError) return roleError;

  const body = await req.json();

  const schema: ValidationSchema = {
    saleId: { required: true, type: 'uuid' },
    pin: { required: true, type: 'pin' },
  };

  const validation = validate(body, schema);
  if (!validation.valid) {
    return Errors.validationError(validation.errors);
  }

  const supabase = createServiceClient();

  // Verify PIN
  const { data: credentials } = await supabase
    .schema('auth_custom')
    .from('credentials')
    .select('pin_hash')
    .eq('user_id', ctx.userId)
    .single();

  if (!credentials) {
    return Errors.unauthorized();
  }

  const pinHash = await hashPin(body.pin);
  if (pinHash !== credentials.pin_hash) {
    return Errors.badRequest('Invalid PIN');
  }

  // Get sale
  const { data: sale, error: saleError } = await supabase
    .from('sales')
    .select('*')
    .eq('id', body.saleId)
    .eq('bar_id', ctx.barId)
    .single();

  if (saleError || !sale) {
    return Errors.notFound('Sale');
  }

  if (sale.status !== 'collected') {
    return Errors.badRequest(`Sale must be collected first (current: ${sale.status})`);
  }

  // Update sale
  const { data: updatedSale, error } = await supabase
    .from('sales')
    .update({
      status: 'confirmed',
      confirmed_at: new Date().toISOString(),
      confirmed_by: ctx.userId,
    })
    .eq('id', body.saleId)
    .select('*')
    .single();

  if (error) {
    console.error('Confirm sale error:', error);
    return Errors.internal('Failed to confirm sale');
  }

  return success({ sale: updatedSale });
}

/**
 * POST /sales/reverse
 * Reverse a sale (creates correction record)
 */
async function reverseSale(ctx: ServiceContext, req: Request): Promise<Response> {
  // Only owner/manager can reverse
  const roleError = requireRole(ctx, ['owner', 'manager']);
  if (roleError) return roleError;

  const body = await req.json();

  const schema: ValidationSchema = {
    saleId: { required: true, type: 'uuid' },
    reason: { required: true, type: 'string', minLength: 10 },
    pin: { required: true, type: 'pin' },
  };

  const validation = validate(body, schema);
  if (!validation.valid) {
    return Errors.validationError(validation.errors);
  }

  const supabase = createServiceClient();

  // Verify PIN
  const { data: credentials } = await supabase
    .schema('auth_custom')
    .from('credentials')
    .select('pin_hash')
    .eq('user_id', ctx.userId)
    .single();

  if (!credentials) {
    return Errors.unauthorized();
  }

  const pinHash = await hashPin(body.pin);
  if (pinHash !== credentials.pin_hash) {
    return Errors.badRequest('Invalid PIN');
  }

  // Get sale
  const { data: sale, error: saleError } = await supabase
    .from('sales')
    .select(`
      *,
      sale_items(*)
    `)
    .eq('id', body.saleId)
    .eq('bar_id', ctx.barId)
    .single();

  if (saleError || !sale) {
    return Errors.notFound('Sale');
  }

  if (sale.status === 'reversed') {
    return Errors.badRequest('Sale is already reversed');
  }

  // Update original sale
  const { error: updateError } = await supabase
    .from('sales')
    .update({
      status: 'reversed',
      reversal_reason: body.reason,
      reversed_at: new Date().toISOString(),
      reversed_by: ctx.userId,
    })
    .eq('id', body.saleId);

  if (updateError) {
    console.error('Reverse sale error:', updateError);
    return Errors.internal('Failed to reverse sale');
  }

  // Restore stock if needed
  for (const item of sale.sale_items || []) {
    // Find active stock assignment
    const { data: assignment } = await supabase
      .from('stock_assignments')
      .select('id, quantity_sold')
      .eq('shift_id', sale.shift_id)
      .eq('product_id', item.product_id)
      .eq('assigned_to', sale.server_id)
      .single();

    if (assignment) {
      await supabase
        .from('stock_assignments')
        .update({
          quantity_sold: Math.max(0, assignment.quantity_sold - item.quantity),
        })
        .eq('id', assignment.id);
    }
  }

  return success({
    message: 'Sale reversed successfully',
    saleId: body.saleId,
    reason: body.reason,
  });
}

/**
 * GET /sales/summary
 * Get sales summary for day/shift
 */
async function getSalesSummary(ctx: ServiceContext, url: URL): Promise<Response> {
  const supabase = createServiceClient();

  const dayId = url.searchParams.get('day_id');
  const shiftId = url.searchParams.get('shift_id');

  let query = supabase
    .from('sales')
    .select('status, total_amount, payment_method')
    .eq('bar_id', ctx.barId);

  if (dayId) query = query.eq('day_id', dayId);
  if (shiftId) query = query.eq('shift_id', shiftId);

  const { data: sales, error } = await query;

  if (error) {
    console.error('Sales summary error:', error);
    return Errors.internal('Failed to generate summary');
  }

  // Calculate summary
  const summary = {
    total: 0,
    confirmed: 0,
    collected: 0,
    pending: 0,
    reversed: 0,
    byPaymentMethod: {} as Record<string, number>,
    count: {
      total: sales?.length || 0,
      confirmed: 0,
      collected: 0,
      pending: 0,
      reversed: 0,
    },
  };

  for (const sale of sales || []) {
    const amount = sale.total_amount || 0;

    if (sale.status !== 'reversed') {
      summary.total += amount;
      summary.byPaymentMethod[sale.payment_method] =
        (summary.byPaymentMethod[sale.payment_method] || 0) + amount;
    }

    switch (sale.status) {
      case 'confirmed':
        summary.confirmed += amount;
        summary.count.confirmed++;
        break;
      case 'collected':
        summary.collected += amount;
        summary.count.collected++;
        break;
      case 'pending':
        summary.pending += amount;
        summary.count.pending++;
        break;
      case 'reversed':
        summary.reversed += amount;
        summary.count.reversed++;
        break;
    }
  }

  return success({ summary });
}
