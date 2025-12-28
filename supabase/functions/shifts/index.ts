/**
 * Shifts Edge Function
 * @implements ARCHITECTURE.md Section 3.2 - Shift Management
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
  const path = url.pathname.replace('/shifts', '');

  try {
    switch (path) {
      case '':
      case '/':
        if (req.method === 'GET') return await listShifts(ctx, url);
        if (req.method === 'POST') return await startShift(ctx, req);
        return Errors.badRequest('Method not allowed');

      case '/current':
        return await getCurrentShift(ctx);

      case '/end':
        if (req.method === 'POST') return await endShift(ctx, req);
        return Errors.badRequest('Method not allowed');

      case '/assign':
        if (req.method === 'POST') return await assignStaff(ctx, req);
        return Errors.badRequest('Method not allowed');

      case '/unassign':
        if (req.method === 'POST') return await unassignStaff(ctx, req);
        return Errors.badRequest('Method not allowed');

      default:
        // Check for UUID pattern: /shifts/{id}
        const shiftIdMatch = path.match(/^\/([0-9a-f-]{36})$/i);
        if (shiftIdMatch) {
          return await getShift(ctx, shiftIdMatch[1]);
        }

        // /shifts/{id}/staff
        const staffMatch = path.match(/^\/([0-9a-f-]{36})\/staff$/i);
        if (staffMatch) {
          return await getShiftStaff(ctx, staffMatch[1]);
        }

        return Errors.notFound('Endpoint');
    }
  } catch (error) {
    console.error('Shifts error:', error);
    return Errors.internal(error.message);
  }
});

/**
 * GET /shifts
 * List shifts for the current day or specified day
 */
async function listShifts(ctx: ServiceContext, url: URL): Promise<Response> {
  const supabase = createServiceClient();

  const dayId = url.searchParams.get('day_id');
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '10'), 100);
  const offset = parseInt(url.searchParams.get('offset') || '0');

  let query = supabase
    .from('shifts')
    .select(`
      *,
      started_by_user:users!shifts_started_by_fkey(id, full_name),
      ended_by_user:users!shifts_ended_by_fkey(id, full_name),
      day:days(id, date)
    `)
    .eq('bar_id', ctx.barId)
    .order('started_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (dayId) {
    query = query.eq('day_id', dayId);
  }

  const { data: shifts, error } = await query;

  if (error) {
    console.error('List shifts error:', error);
    return Errors.internal('Failed to fetch shifts');
  }

  return success({ shifts, limit, offset });
}

/**
 * GET /shifts/current
 * Get the current open shift
 */
async function getCurrentShift(ctx: ServiceContext): Promise<Response> {
  const supabase = createServiceClient();

  const { data: shift, error } = await supabase
    .from('shifts')
    .select(`
      *,
      started_by_user:users!shifts_started_by_fkey(id, full_name),
      day:days(id, date),
      shift_assignments(
        id,
        role,
        user:users(id, full_name)
      )
    `)
    .eq('bar_id', ctx.barId)
    .eq('status', 'open')
    .single();

  if (error || !shift) {
    return Errors.notFound('No open shift');
  }

  return success({ shift });
}

/**
 * GET /shifts/{id}
 * Get a specific shift with details
 */
async function getShift(ctx: ServiceContext, shiftId: string): Promise<Response> {
  const supabase = createServiceClient();

  const { data: shift, error } = await supabase
    .from('shifts')
    .select(`
      *,
      started_by_user:users!shifts_started_by_fkey(id, full_name),
      ended_by_user:users!shifts_ended_by_fkey(id, full_name),
      day:days(id, date),
      shift_assignments(
        id,
        role,
        user:users(id, full_name)
      )
    `)
    .eq('id', shiftId)
    .eq('bar_id', ctx.barId)
    .single();

  if (error || !shift) {
    return Errors.notFound('Shift');
  }

  return success({ shift });
}

/**
 * GET /shifts/{id}/staff
 * Get staff assigned to a shift
 */
async function getShiftStaff(ctx: ServiceContext, shiftId: string): Promise<Response> {
  const supabase = createServiceClient();

  const { data: assignments, error } = await supabase
    .from('shift_assignments')
    .select(`
      id,
      role,
      assigned_at,
      user:users(id, full_name, phone)
    `)
    .eq('shift_id', shiftId);

  if (error) {
    console.error('Get shift staff error:', error);
    return Errors.internal('Failed to fetch staff');
  }

  return success({ staff: assignments });
}

/**
 * POST /shifts
 * Start a new shift
 */
async function startShift(ctx: ServiceContext, req: Request): Promise<Response> {
  // Only owner/manager can start shift
  const roleError = requireRole(ctx, ['owner', 'manager']);
  if (roleError) return roleError;

  const supabase = createServiceClient();

  // Check if there's an open day
  const { data: day, error: dayError } = await supabase
    .from('days')
    .select('id, date')
    .eq('bar_id', ctx.barId)
    .eq('status', 'open')
    .single();

  if (dayError || !day) {
    return Errors.badRequest('No open day. Please open a day first.');
  }

  // Check if there's already an open shift
  const { data: existingShift } = await supabase
    .from('shifts')
    .select('id, shift_number')
    .eq('bar_id', ctx.barId)
    .eq('status', 'open')
    .single();

  if (existingShift) {
    return Errors.badRequest(`Shift #${existingShift.shift_number} is already open`);
  }

  // Get next shift number for this day
  const { data: lastShift } = await supabase
    .from('shifts')
    .select('shift_number')
    .eq('day_id', day.id)
    .order('shift_number', { ascending: false })
    .limit(1)
    .single();

  const shiftNumber = (lastShift?.shift_number || 0) + 1;

  // Create the shift
  const { data: shift, error } = await supabase
    .from('shifts')
    .insert({
      bar_id: ctx.barId,
      day_id: day.id,
      shift_number: shiftNumber,
      status: 'open',
      started_by: ctx.userId,
    })
    .select('*')
    .single();

  if (error) {
    console.error('Start shift error:', error);
    return Errors.internal('Failed to start shift');
  }

  return success({ shift }, 201);
}

/**
 * POST /shifts/end
 * End the current shift
 */
async function endShift(ctx: ServiceContext, req: Request): Promise<Response> {
  // Only owner/manager can end shift
  const roleError = requireRole(ctx, ['owner', 'manager']);
  if (roleError) return roleError;

  const supabase = createServiceClient();

  // Get current open shift
  const { data: shift, error: shiftError } = await supabase
    .from('shifts')
    .select('id, shift_number')
    .eq('bar_id', ctx.barId)
    .eq('status', 'open')
    .single();

  if (shiftError || !shift) {
    return Errors.notFound('No open shift');
  }

  // Check for unconfirmed sales in this shift
  const { data: pendingSales } = await supabase
    .from('sales')
    .select('id')
    .eq('shift_id', shift.id)
    .in('status', ['pending', 'collected']);

  if (pendingSales && pendingSales.length > 0) {
    return Errors.badRequest(
      `Cannot end shift: ${pendingSales.length} unconfirmed sale(s)`
    );
  }

  // Check for unreturned stock assignments
  const { data: unreturned } = await supabase
    .from('stock_assignments')
    .select('id')
    .eq('shift_id', shift.id)
    .is('returned_at', null);

  if (unreturned && unreturned.length > 0) {
    return Errors.badRequest(
      `Cannot end shift: ${unreturned.length} unreturned stock assignment(s)`
    );
  }

  const body = await req.json().catch(() => ({}));
  const notes = body.notes || null;

  // End the shift
  const { data: endedShift, error } = await supabase
    .from('shifts')
    .update({
      status: 'closed',
      ended_at: new Date().toISOString(),
      ended_by: ctx.userId,
      closing_notes: notes,
    })
    .eq('id', shift.id)
    .select('*')
    .single();

  if (error) {
    console.error('End shift error:', error);
    return Errors.internal('Failed to end shift');
  }

  return success({ shift: endedShift });
}

/**
 * POST /shifts/assign
 * Assign staff to current shift
 */
async function assignStaff(ctx: ServiceContext, req: Request): Promise<Response> {
  // Only owner/manager can assign staff
  const roleError = requireRole(ctx, ['owner', 'manager']);
  if (roleError) return roleError;

  const body = await req.json();

  // Validate input
  const schema: ValidationSchema = {
    userId: { required: true, type: 'uuid' },
    role: { required: true, type: 'string', enum: ['bartender', 'server', 'kitchen'] },
  };

  const validation = validate(body, schema);
  if (!validation.valid) {
    return Errors.validationError(validation.errors);
  }

  const supabase = createServiceClient();

  // Get current open shift
  const { data: shift } = await supabase
    .from('shifts')
    .select('id')
    .eq('bar_id', ctx.barId)
    .eq('status', 'open')
    .single();

  if (!shift) {
    return Errors.badRequest('No open shift');
  }

  // Check user has the role in this bar
  const { data: userRole } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', body.userId)
    .eq('bar_id', ctx.barId)
    .eq('is_active', true)
    .single();

  if (!userRole) {
    return Errors.badRequest('User does not have a role in this bar');
  }

  // Check if already assigned
  const { data: existingAssignment } = await supabase
    .from('shift_assignments')
    .select('id')
    .eq('shift_id', shift.id)
    .eq('user_id', body.userId)
    .single();

  if (existingAssignment) {
    return Errors.badRequest('User already assigned to this shift');
  }

  // Create assignment
  const { data: assignment, error } = await supabase
    .from('shift_assignments')
    .insert({
      shift_id: shift.id,
      user_id: body.userId,
      role: body.role,
      assigned_by: ctx.userId,
    })
    .select(`
      id,
      role,
      user:users(id, full_name)
    `)
    .single();

  if (error) {
    console.error('Assign staff error:', error);
    return Errors.internal('Failed to assign staff');
  }

  return success({ assignment }, 201);
}

/**
 * POST /shifts/unassign
 * Remove staff from current shift
 */
async function unassignStaff(ctx: ServiceContext, req: Request): Promise<Response> {
  // Only owner/manager can unassign staff
  const roleError = requireRole(ctx, ['owner', 'manager']);
  if (roleError) return roleError;

  const body = await req.json();

  if (!body.userId) {
    return Errors.badRequest('userId is required');
  }

  const supabase = createServiceClient();

  // Get current open shift
  const { data: shift } = await supabase
    .from('shifts')
    .select('id')
    .eq('bar_id', ctx.barId)
    .eq('status', 'open')
    .single();

  if (!shift) {
    return Errors.badRequest('No open shift');
  }

  // Check for active stock assignments
  const { data: stockAssignment } = await supabase
    .from('stock_assignments')
    .select('id')
    .eq('shift_id', shift.id)
    .eq('assigned_to', body.userId)
    .is('returned_at', null)
    .single();

  if (stockAssignment) {
    return Errors.badRequest('Cannot unassign: user has unreturned stock');
  }

  // Remove assignment
  const { error } = await supabase
    .from('shift_assignments')
    .delete()
    .eq('shift_id', shift.id)
    .eq('user_id', body.userId);

  if (error) {
    console.error('Unassign staff error:', error);
    return Errors.internal('Failed to unassign staff');
  }

  return success({ message: 'Staff unassigned' });
}
