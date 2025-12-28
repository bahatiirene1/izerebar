/**
 * Stock Edge Function
 * @implements ARCHITECTURE.md Section 3.4 - Stock Management
 * @implements ARCHITECTURE.md Section 7 - API Layer
 */

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { handleCors } from '../_shared/cors.ts';
import { success, Errors } from '../_shared/response.ts';
import { createServiceClient } from '../_shared/supabase.ts';
import { authenticate, requireRole, ServiceContext } from '../_shared/auth.ts';
import { validate, ValidationSchema } from '../_shared/validation.ts';

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
  const path = url.pathname.replace('/stock', '');

  try {
    switch (path) {
      case '':
      case '/':
        if (req.method === 'GET') return await getStockLevels(ctx, url);
        return Errors.badRequest('Method not allowed');

      case '/receive':
        if (req.method === 'POST') return await receiveStock(ctx, req);
        return Errors.badRequest('Method not allowed');

      case '/assign':
        if (req.method === 'POST') return await assignStock(ctx, req);
        return Errors.badRequest('Method not allowed');

      case '/return':
        if (req.method === 'POST') return await returnStock(ctx, req);
        return Errors.badRequest('Method not allowed');

      case '/adjust':
        if (req.method === 'POST') return await adjustStock(ctx, req);
        return Errors.badRequest('Method not allowed');

      case '/movements':
        if (req.method === 'GET') return await getStockMovements(ctx, url);
        return Errors.badRequest('Method not allowed');

      case '/assignments':
        if (req.method === 'GET') return await getAssignments(ctx, url);
        return Errors.badRequest('Method not allowed');

      default:
        return Errors.notFound('Endpoint');
    }
  } catch (error) {
    console.error('Stock error:', error);
    return Errors.internal(error.message);
  }
});

/**
 * GET /stock
 * Get current stock levels
 */
async function getStockLevels(ctx: ServiceContext, url: URL): Promise<Response> {
  const supabase = createServiceClient();

  const productId = url.searchParams.get('product_id');
  const category = url.searchParams.get('category');

  let query = supabase
    .from('stock_levels')
    .select(`
      *,
      product:products(id, name, category, unit, selling_price)
    `)
    .eq('bar_id', ctx.barId);

  if (productId) {
    query = query.eq('product_id', productId);
  }

  const { data: levels, error } = await query;

  if (error) {
    console.error('Get stock levels error:', error);
    return Errors.internal('Failed to fetch stock levels');
  }

  // Filter by category if specified (through product join)
  let result = levels || [];
  if (category) {
    result = result.filter((l: { product: { category: string } }) => l.product?.category === category);
  }

  return success({ stockLevels: result });
}

/**
 * POST /stock/receive
 * Record stock receipt (manager receives from supplier)
 */
async function receiveStock(ctx: ServiceContext, req: Request): Promise<Response> {
  // Only owner/manager can receive stock
  const roleError = requireRole(ctx, ['owner', 'manager']);
  if (roleError) return roleError;

  const body = await req.json();

  // Validate input
  const schema: ValidationSchema = {
    productId: { required: true, type: 'uuid' },
    quantity: { required: true, type: 'number', min: 1 },
    unitCost: { required: false, type: 'number', min: 0 },
    supplierName: { required: false, type: 'string' },
    invoiceNumber: { required: false, type: 'string' },
    notes: { required: false, type: 'string' },
  };

  const validation = validate(body, schema);
  if (!validation.valid) {
    return Errors.validationError(validation.errors);
  }

  const supabase = createServiceClient();

  // Verify product exists
  const { data: product } = await supabase
    .from('products')
    .select('id, name')
    .eq('id', body.productId)
    .single();

  if (!product) {
    return Errors.notFound('Product');
  }

  // Get current day and shift
  const { data: day } = await supabase
    .from('days')
    .select('id')
    .eq('bar_id', ctx.barId)
    .eq('status', 'open')
    .single();

  if (!day) {
    return Errors.badRequest('No open day');
  }

  // Create stock movement
  const { data: movement, error } = await supabase
    .from('stock_movements')
    .insert({
      bar_id: ctx.barId,
      day_id: day.id,
      shift_id: ctx.shiftId || null,
      product_id: body.productId,
      movement_type: 'receipt',
      quantity: body.quantity,
      unit_cost: body.unitCost || null,
      reference_type: 'purchase',
      created_by: ctx.userId,
      notes: body.notes || null,
    })
    .select('*')
    .single();

  if (error) {
    console.error('Receive stock error:', error);
    return Errors.internal('Failed to record stock receipt');
  }

  // Update stock level
  const { data: currentLevel } = await supabase
    .from('stock_levels')
    .select('quantity')
    .eq('bar_id', ctx.barId)
    .eq('product_id', body.productId)
    .single();

  if (currentLevel) {
    await supabase
      .from('stock_levels')
      .update({
        quantity: currentLevel.quantity + body.quantity,
        last_updated: new Date().toISOString(),
      })
      .eq('bar_id', ctx.barId)
      .eq('product_id', body.productId);
  } else {
    await supabase
      .from('stock_levels')
      .insert({
        bar_id: ctx.barId,
        product_id: body.productId,
        quantity: body.quantity,
      });
  }

  return success({
    movement,
    message: `Received ${body.quantity} units of ${product.name}`,
  }, 201);
}

/**
 * POST /stock/assign
 * Assign stock to bartender (custody transfer)
 */
async function assignStock(ctx: ServiceContext, req: Request): Promise<Response> {
  // Only owner/manager can assign stock
  const roleError = requireRole(ctx, ['owner', 'manager']);
  if (roleError) return roleError;

  const body = await req.json();

  // Validate input
  const schema: ValidationSchema = {
    assigneeId: { required: true, type: 'uuid' },
    items: { required: true },
  };

  const validation = validate(body, schema);
  if (!validation.valid) {
    return Errors.validationError(validation.errors);
  }

  if (!Array.isArray(body.items) || body.items.length === 0) {
    return Errors.badRequest('items must be a non-empty array');
  }

  const supabase = createServiceClient();

  // Check current shift
  if (!ctx.shiftId) {
    return Errors.badRequest('No open shift');
  }

  // Check assignee is assigned to shift
  const { data: assignment } = await supabase
    .from('shift_assignments')
    .select('id, role')
    .eq('shift_id', ctx.shiftId)
    .eq('user_id', body.assigneeId)
    .single();

  if (!assignment) {
    return Errors.badRequest('User not assigned to current shift');
  }

  // Get current day
  const { data: day } = await supabase
    .from('days')
    .select('id')
    .eq('bar_id', ctx.barId)
    .eq('status', 'open')
    .single();

  if (!day) {
    return Errors.badRequest('No open day');
  }

  const assignedItems: { productId: string; quantity: number }[] = [];
  const errors: string[] = [];

  // Process each item
  for (const item of body.items) {
    if (!item.productId || !item.quantity || item.quantity <= 0) {
      errors.push(`Invalid item: ${JSON.stringify(item)}`);
      continue;
    }

    // Check available stock
    const { data: level } = await supabase
      .from('stock_levels')
      .select('quantity')
      .eq('bar_id', ctx.barId)
      .eq('product_id', item.productId)
      .single();

    if (!level || level.quantity < item.quantity) {
      const { data: product } = await supabase
        .from('products')
        .select('name')
        .eq('id', item.productId)
        .single();
      errors.push(`Insufficient stock for ${product?.name || item.productId}`);
      continue;
    }

    // Create stock movement (out from manager)
    await supabase
      .from('stock_movements')
      .insert({
        bar_id: ctx.barId,
        day_id: day.id,
        shift_id: ctx.shiftId,
        product_id: item.productId,
        movement_type: 'assignment_out',
        quantity: -item.quantity,
        reference_type: 'assignment',
        created_by: ctx.userId,
      });

    // Create stock assignment
    await supabase
      .from('stock_assignments')
      .insert({
        bar_id: ctx.barId,
        shift_id: ctx.shiftId,
        product_id: item.productId,
        assigned_to: body.assigneeId,
        assigned_by: ctx.userId,
        quantity_assigned: item.quantity,
        quantity_sold: 0,
        quantity_returned: 0,
      });

    // Update stock level
    await supabase
      .from('stock_levels')
      .update({
        quantity: level.quantity - item.quantity,
        last_updated: new Date().toISOString(),
      })
      .eq('bar_id', ctx.barId)
      .eq('product_id', item.productId);

    assignedItems.push({ productId: item.productId, quantity: item.quantity });
  }

  if (errors.length > 0 && assignedItems.length === 0) {
    return Errors.badRequest(errors.join('; '));
  }

  return success({
    assigned: assignedItems,
    errors: errors.length > 0 ? errors : undefined,
  }, 201);
}

/**
 * POST /stock/return
 * Return unsold stock from bartender to manager
 */
async function returnStock(ctx: ServiceContext, req: Request): Promise<Response> {
  const body = await req.json();

  // Validate input
  const schema: ValidationSchema = {
    assignmentId: { required: true, type: 'uuid' },
    quantityReturned: { required: true, type: 'number', min: 0 },
  };

  const validation = validate(body, schema);
  if (!validation.valid) {
    return Errors.validationError(validation.errors);
  }

  const supabase = createServiceClient();

  // Get assignment
  const { data: assignment, error: assignmentError } = await supabase
    .from('stock_assignments')
    .select('*')
    .eq('id', body.assignmentId)
    .eq('bar_id', ctx.barId)
    .single();

  if (assignmentError || !assignment) {
    return Errors.notFound('Stock assignment');
  }

  if (assignment.returned_at) {
    return Errors.badRequest('Stock already returned');
  }

  // Verify user is the assignee or a manager
  if (assignment.assigned_to !== ctx.userId && !['owner', 'manager'].includes(ctx.userRole)) {
    return Errors.forbidden();
  }

  // Validate return quantity
  const expectedReturnable = assignment.quantity_assigned - assignment.quantity_sold;
  if (body.quantityReturned > expectedReturnable) {
    return Errors.badRequest(`Maximum returnable quantity is ${expectedReturnable}`);
  }

  // Get current day
  const { data: day } = await supabase
    .from('days')
    .select('id')
    .eq('bar_id', ctx.barId)
    .eq('status', 'open')
    .single();

  // Record stock movement (return to manager)
  if (body.quantityReturned > 0 && day) {
    await supabase
      .from('stock_movements')
      .insert({
        bar_id: ctx.barId,
        day_id: day.id,
        shift_id: ctx.shiftId || null,
        product_id: assignment.product_id,
        movement_type: 'return',
        quantity: body.quantityReturned,
        reference_type: 'return',
        reference_id: assignment.id,
        created_by: ctx.userId,
      });

    // Update stock level
    const { data: level } = await supabase
      .from('stock_levels')
      .select('quantity')
      .eq('bar_id', ctx.barId)
      .eq('product_id', assignment.product_id)
      .single();

    if (level) {
      await supabase
        .from('stock_levels')
        .update({
          quantity: level.quantity + body.quantityReturned,
          last_updated: new Date().toISOString(),
        })
        .eq('bar_id', ctx.barId)
        .eq('product_id', assignment.product_id);
    }
  }

  // Update assignment
  const { data: updatedAssignment, error } = await supabase
    .from('stock_assignments')
    .update({
      quantity_returned: body.quantityReturned,
      returned_at: new Date().toISOString(),
      returned_to: ctx.userId,
    })
    .eq('id', body.assignmentId)
    .select('*')
    .single();

  if (error) {
    console.error('Return stock error:', error);
    return Errors.internal('Failed to return stock');
  }

  return success({ assignment: updatedAssignment });
}

/**
 * POST /stock/adjust
 * Make stock adjustment (breakage, loss, correction)
 */
async function adjustStock(ctx: ServiceContext, req: Request): Promise<Response> {
  // Only owner/manager can adjust stock
  const roleError = requireRole(ctx, ['owner', 'manager']);
  if (roleError) return roleError;

  const body = await req.json();

  // Validate input
  const schema: ValidationSchema = {
    productId: { required: true, type: 'uuid' },
    quantity: { required: true, type: 'number' },
    reason: { required: true, type: 'string', enum: ['breakage', 'loss', 'correction', 'wastage'] },
    notes: { required: true, type: 'string', minLength: 5 },
  };

  const validation = validate(body, schema);
  if (!validation.valid) {
    return Errors.validationError(validation.errors);
  }

  const supabase = createServiceClient();

  // Verify product exists
  const { data: product } = await supabase
    .from('products')
    .select('id, name')
    .eq('id', body.productId)
    .single();

  if (!product) {
    return Errors.notFound('Product');
  }

  // Get current stock level
  const { data: level } = await supabase
    .from('stock_levels')
    .select('quantity')
    .eq('bar_id', ctx.barId)
    .eq('product_id', body.productId)
    .single();

  const currentQty = level?.quantity || 0;
  const newQty = currentQty + body.quantity;

  if (newQty < 0) {
    return Errors.badRequest(`Adjustment would result in negative stock (${newQty})`);
  }

  // Get current day
  const { data: day } = await supabase
    .from('days')
    .select('id')
    .eq('bar_id', ctx.barId)
    .eq('status', 'open')
    .single();

  if (!day) {
    return Errors.badRequest('No open day');
  }

  // Create stock movement
  const { data: movement, error: movementError } = await supabase
    .from('stock_movements')
    .insert({
      bar_id: ctx.barId,
      day_id: day.id,
      shift_id: ctx.shiftId || null,
      product_id: body.productId,
      movement_type: 'adjustment',
      quantity: body.quantity,
      reference_type: body.reason,
      created_by: ctx.userId,
      notes: body.notes,
    })
    .select('*')
    .single();

  if (movementError) {
    console.error('Adjust stock error:', movementError);
    return Errors.internal('Failed to record adjustment');
  }

  // Update stock level
  if (level) {
    await supabase
      .from('stock_levels')
      .update({
        quantity: newQty,
        last_updated: new Date().toISOString(),
      })
      .eq('bar_id', ctx.barId)
      .eq('product_id', body.productId);
  } else {
    await supabase
      .from('stock_levels')
      .insert({
        bar_id: ctx.barId,
        product_id: body.productId,
        quantity: newQty,
      });
  }

  return success({
    movement,
    previousQuantity: currentQty,
    newQuantity: newQty,
  });
}

/**
 * GET /stock/movements
 * Get stock movement history
 */
async function getStockMovements(ctx: ServiceContext, url: URL): Promise<Response> {
  const supabase = createServiceClient();

  const productId = url.searchParams.get('product_id');
  const dayId = url.searchParams.get('day_id');
  const movementType = url.searchParams.get('type');
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 100);
  const offset = parseInt(url.searchParams.get('offset') || '0');

  let query = supabase
    .from('stock_movements')
    .select(`
      *,
      product:products(id, name),
      created_by_user:users!stock_movements_created_by_fkey(id, full_name)
    `)
    .eq('bar_id', ctx.barId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (productId) {
    query = query.eq('product_id', productId);
  }
  if (dayId) {
    query = query.eq('day_id', dayId);
  }
  if (movementType) {
    query = query.eq('movement_type', movementType);
  }

  const { data: movements, error } = await query;

  if (error) {
    console.error('Get stock movements error:', error);
    return Errors.internal('Failed to fetch movements');
  }

  return success({ movements, limit, offset });
}

/**
 * GET /stock/assignments
 * Get stock assignments for current shift
 */
async function getAssignments(ctx: ServiceContext, url: URL): Promise<Response> {
  const supabase = createServiceClient();

  const shiftId = url.searchParams.get('shift_id') || ctx.shiftId;
  const userId = url.searchParams.get('user_id');
  const returnedFilter = url.searchParams.get('returned');

  let query = supabase
    .from('stock_assignments')
    .select(`
      *,
      product:products(id, name, selling_price),
      assignee:users!stock_assignments_assigned_to_fkey(id, full_name),
      assigner:users!stock_assignments_assigned_by_fkey(id, full_name)
    `)
    .eq('bar_id', ctx.barId);

  if (shiftId) {
    query = query.eq('shift_id', shiftId);
  }
  if (userId) {
    query = query.eq('assigned_to', userId);
  }
  if (returnedFilter === 'true') {
    query = query.not('returned_at', 'is', null);
  } else if (returnedFilter === 'false') {
    query = query.is('returned_at', null);
  }

  const { data: assignments, error } = await query;

  if (error) {
    console.error('Get assignments error:', error);
    return Errors.internal('Failed to fetch assignments');
  }

  return success({ assignments });
}
