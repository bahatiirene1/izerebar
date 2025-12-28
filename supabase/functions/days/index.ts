/**
 * Days Edge Function
 * @implements ARCHITECTURE.md Section 3.1 - Day Management
 * @implements ARCHITECTURE.md Section 7 - API Layer
 */

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { handleCors } from '../_shared/cors.ts';
import { success, Errors } from '../_shared/response.ts';
import { createServiceClient } from '../_shared/supabase.ts';
import { authenticate, requireRole, ServiceContext } from '../_shared/auth.ts';

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
  const path = url.pathname.replace('/days', '');

  try {
    switch (path) {
      case '':
      case '/':
        if (req.method === 'GET') return await listDays(ctx, url);
        if (req.method === 'POST') return await openDay(ctx, req);
        return Errors.badRequest('Method not allowed');

      case '/current':
        return await getCurrentDay(ctx);

      case '/close':
        if (req.method === 'POST') return await closeDay(ctx, req);
        return Errors.badRequest('Method not allowed');

      default:
        // Check for UUID pattern: /days/{id}
        const dayIdMatch = path.match(/^\/([0-9a-f-]{36})$/i);
        if (dayIdMatch) {
          return await getDay(ctx, dayIdMatch[1]);
        }
        return Errors.notFound('Endpoint');
    }
  } catch (error) {
    console.error('Days error:', error);
    return Errors.internal(error.message);
  }
});

/**
 * GET /days
 * List days for the bar
 */
async function listDays(ctx: ServiceContext, url: URL): Promise<Response> {
  const supabase = createServiceClient();

  const limit = Math.min(parseInt(url.searchParams.get('limit') || '10'), 100);
  const offset = parseInt(url.searchParams.get('offset') || '0');
  const status = url.searchParams.get('status');

  let query = supabase
    .from('days')
    .select('*, opened_by_user:users!days_opened_by_fkey(id, full_name)')
    .eq('bar_id', ctx.barId)
    .order('date', { ascending: false })
    .range(offset, offset + limit - 1);

  if (status) {
    query = query.eq('status', status);
  }

  const { data: days, error } = await query;

  if (error) {
    console.error('List days error:', error);
    return Errors.internal('Failed to fetch days');
  }

  return success({ days, limit, offset });
}

/**
 * GET /days/current
 * Get the current open day
 */
async function getCurrentDay(ctx: ServiceContext): Promise<Response> {
  const supabase = createServiceClient();

  const { data: day, error } = await supabase
    .from('days')
    .select(`
      *,
      opened_by_user:users!days_opened_by_fkey(id, full_name),
      shifts(
        id,
        shift_number,
        status,
        started_at,
        ended_at,
        started_by,
        started_by_user:users!shifts_started_by_fkey(id, full_name)
      )
    `)
    .eq('bar_id', ctx.barId)
    .eq('status', 'open')
    .single();

  if (error || !day) {
    return Errors.notFound('No open day');
  }

  return success({ day });
}

/**
 * GET /days/{id}
 * Get a specific day with details
 */
async function getDay(ctx: ServiceContext, dayId: string): Promise<Response> {
  const supabase = createServiceClient();

  const { data: day, error } = await supabase
    .from('days')
    .select(`
      *,
      opened_by_user:users!days_opened_by_fkey(id, full_name),
      closed_by_user:users!days_closed_by_fkey(id, full_name),
      shifts(
        id,
        shift_number,
        status,
        started_at,
        ended_at,
        started_by_user:users!shifts_started_by_fkey(id, full_name),
        ended_by_user:users!shifts_ended_by_fkey(id, full_name)
      )
    `)
    .eq('id', dayId)
    .eq('bar_id', ctx.barId)
    .single();

  if (error || !day) {
    return Errors.notFound('Day');
  }

  return success({ day });
}

/**
 * POST /days
 * Open a new day
 */
async function openDay(ctx: ServiceContext, req: Request): Promise<Response> {
  // Only owner/manager can open day
  const roleError = requireRole(ctx, ['owner', 'manager']);
  if (roleError) return roleError;

  const supabase = createServiceClient();

  // Check if there's already an open day
  const { data: existingDay } = await supabase
    .from('days')
    .select('id, date')
    .eq('bar_id', ctx.barId)
    .eq('status', 'open')
    .single();

  if (existingDay) {
    return Errors.badRequest(`Day ${existingDay.date} is already open`);
  }

  const body = await req.json().catch(() => ({}));
  const date = body.date || new Date().toISOString().split('T')[0];

  // Validate date format
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return Errors.badRequest('Invalid date format. Use YYYY-MM-DD');
  }

  // Check if day for this date already exists
  const { data: existingDate } = await supabase
    .from('days')
    .select('id')
    .eq('bar_id', ctx.barId)
    .eq('date', date)
    .single();

  if (existingDate) {
    return Errors.badRequest(`Day for ${date} already exists`);
  }

  // Create the day
  const { data: day, error } = await supabase
    .from('days')
    .insert({
      bar_id: ctx.barId,
      date,
      status: 'open',
      opened_by: ctx.userId,
    })
    .select('*')
    .single();

  if (error) {
    console.error('Open day error:', error);
    return Errors.internal('Failed to open day');
  }

  return success({ day }, 201);
}

/**
 * POST /days/close
 * Close the current open day
 */
async function closeDay(ctx: ServiceContext, req: Request): Promise<Response> {
  // Only owner/manager can close day
  const roleError = requireRole(ctx, ['owner', 'manager']);
  if (roleError) return roleError;

  const supabase = createServiceClient();

  // Get current open day
  const { data: day, error: dayError } = await supabase
    .from('days')
    .select('id, date')
    .eq('bar_id', ctx.barId)
    .eq('status', 'open')
    .single();

  if (dayError || !day) {
    return Errors.notFound('No open day');
  }

  // Check for open shifts
  const { data: openShifts } = await supabase
    .from('shifts')
    .select('id, shift_number')
    .eq('day_id', day.id)
    .eq('status', 'open');

  if (openShifts && openShifts.length > 0) {
    return Errors.badRequest(
      `Cannot close day: ${openShifts.length} shift(s) still open`
    );
  }

  // Check for unconfirmed sales
  const { data: pendingSales } = await supabase
    .from('sales')
    .select('id')
    .eq('day_id', day.id)
    .in('status', ['pending', 'collected']);

  if (pendingSales && pendingSales.length > 0) {
    return Errors.badRequest(
      `Cannot close day: ${pendingSales.length} unconfirmed sale(s)`
    );
  }

  const body = await req.json().catch(() => ({}));
  const notes = body.notes || null;

  // Close the day
  const { data: closedDay, error } = await supabase
    .from('days')
    .update({
      status: 'closed',
      closed_at: new Date().toISOString(),
      closed_by: ctx.userId,
      closing_notes: notes,
    })
    .eq('id', day.id)
    .select('*')
    .single();

  if (error) {
    console.error('Close day error:', error);
    return Errors.internal('Failed to close day');
  }

  return success({ day: closedDay });
}
