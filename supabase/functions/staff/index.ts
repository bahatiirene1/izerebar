/**
 * Staff Edge Function
 * @implements ARCHITECTURE.md Section 2.3.2 - User Roles
 * @implements ARCHITECTURE.md Section 7 - API Layer
 */

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { handleCors } from '../_shared/cors.ts';
import { success, Errors } from '../_shared/response.ts';
import { createServiceClient } from '../_shared/supabase.ts';
import { authenticate, requireRole, ServiceContext } from '../_shared/auth.ts';
import { validate, ValidationSchema, isValidPhone, isValidPin } from '../_shared/validation.ts';
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
  const path = url.pathname.replace('/staff', '');

  try {
    switch (path) {
      case '':
      case '/':
        if (req.method === 'GET') return await listStaff(ctx, url);
        if (req.method === 'POST') return await addStaff(ctx, req);
        return Errors.badRequest('Method not allowed');

      case '/roles':
        return await listRoles();

      default:
        // Check for UUID pattern: /staff/{id}
        const staffIdMatch = path.match(/^\/([0-9a-f-]{36})$/i);
        if (staffIdMatch) {
          if (req.method === 'GET') return await getStaffMember(ctx, staffIdMatch[1]);
          if (req.method === 'PUT') return await updateStaff(ctx, req, staffIdMatch[1]);
          if (req.method === 'DELETE') return await removeStaff(ctx, staffIdMatch[1]);
          return Errors.badRequest('Method not allowed');
        }

        // /staff/{id}/reset-pin
        const resetMatch = path.match(/^\/([0-9a-f-]{36})\/reset-pin$/i);
        if (resetMatch) {
          if (req.method === 'POST') return await resetPin(ctx, req, resetMatch[1]);
          return Errors.badRequest('Method not allowed');
        }

        return Errors.notFound('Endpoint');
    }
  } catch (error) {
    console.error('Staff error:', error);
    return Errors.internal(error.message);
  }
});

/**
 * Hash a PIN for storage
 */
async function hashPin(pin: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(pin);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * GET /staff
 * List staff members for the bar
 */
async function listStaff(ctx: ServiceContext, url: URL): Promise<Response> {
  // Only owner/manager can list staff
  const roleError = requireRole(ctx, ['owner', 'manager']);
  if (roleError) return roleError;

  const supabase = createServiceClient();

  const role = url.searchParams.get('role');
  const active = url.searchParams.get('active');

  let query = supabase
    .from('user_roles')
    .select(`
      id,
      role,
      is_active,
      assigned_at,
      user:users(id, full_name, phone, is_active)
    `)
    .eq('bar_id', ctx.barId);

  if (role) {
    query = query.eq('role', role);
  }

  if (active === 'true') {
    query = query.eq('is_active', true);
  } else if (active === 'false') {
    query = query.eq('is_active', false);
  }

  const { data: staff, error } = await query;

  if (error) {
    console.error('List staff error:', error);
    return Errors.internal('Failed to fetch staff');
  }

  return success({ staff });
}

/**
 * GET /staff/roles
 * List available roles
 */
async function listRoles(): Promise<Response> {
  const roles = [
    { value: 'manager', label: 'Manager', description: 'Can manage shifts, stock, and confirm sales' },
    { value: 'bartender', label: 'Bartender', description: 'Can receive stock assignments and create sales' },
    { value: 'server', label: 'Server', description: 'Can create sales and collect payments' },
    { value: 'kitchen', label: 'Kitchen', description: 'Can view food orders' },
  ];

  return success({ roles });
}

/**
 * GET /staff/{id}
 * Get a specific staff member
 */
async function getStaffMember(ctx: ServiceContext, roleId: string): Promise<Response> {
  // Only owner/manager can view staff details
  const roleError = requireRole(ctx, ['owner', 'manager']);
  if (roleError) return roleError;

  const supabase = createServiceClient();

  const { data: staffRole, error } = await supabase
    .from('user_roles')
    .select(`
      id,
      role,
      is_active,
      assigned_at,
      user:users(id, full_name, phone, is_active, created_at)
    `)
    .eq('id', roleId)
    .eq('bar_id', ctx.barId)
    .single();

  if (error || !staffRole) {
    return Errors.notFound('Staff member');
  }

  return success({ staff: staffRole });
}

/**
 * POST /staff
 * Add a new staff member
 */
async function addStaff(ctx: ServiceContext, req: Request): Promise<Response> {
  // Only owner/manager can add staff
  const roleError = requireRole(ctx, ['owner', 'manager']);
  if (roleError) return roleError;

  const body = await req.json();

  // Validate input
  const schema: ValidationSchema = {
    phone: { required: true, type: 'phone' },
    name: { required: true, type: 'string', minLength: 2 },
    pin: { required: true, type: 'pin' },
    role: {
      required: true,
      type: 'string',
      enum: ['manager', 'bartender', 'server', 'kitchen'],
    },
  };

  const validation = validate(body, schema);
  if (!validation.valid) {
    return Errors.validationError(validation.errors);
  }

  // Manager can't add another manager (only owner can)
  if (body.role === 'manager' && ctx.userRole !== 'owner') {
    return Errors.forbidden();
  }

  const supabase = createServiceClient();

  // Check if phone already exists
  let userId: string;
  const { data: existingUser } = await supabase
    .from('users')
    .select('id')
    .eq('phone', body.phone)
    .single();

  if (existingUser) {
    // Check if already has role in this bar
    const { data: existingRole } = await supabase
      .from('user_roles')
      .select('id')
      .eq('user_id', existingUser.id)
      .eq('bar_id', ctx.barId)
      .single();

    if (existingRole) {
      return Errors.badRequest('User already has a role in this bar');
    }

    userId = existingUser.id;
  } else {
    // Create new user
    const { data: newUser, error: userError } = await supabase
      .from('users')
      .insert({
        phone: body.phone,
        full_name: body.name,
      })
      .select('id')
      .single();

    if (userError) {
      console.error('Create user error:', userError);
      return Errors.internal('Failed to create user');
    }

    userId = newUser.id;

    // Create credentials
    const pinHash = await hashPin(body.pin);
    const { error: credError } = await supabase
      .schema('auth_custom')
      .from('credentials')
      .insert({
        user_id: userId,
        pin_hash: pinHash,
      });

    if (credError) {
      console.error('Create credentials error:', credError);
      // Rollback user
      await supabase.from('users').delete().eq('id', userId);
      return Errors.internal('Failed to create credentials');
    }
  }

  // Assign role
  const { data: role, error: roleError } = await supabase
    .from('user_roles')
    .insert({
      user_id: userId,
      bar_id: ctx.barId,
      role: body.role,
      assigned_by: ctx.userId,
    })
    .select(`
      id,
      role,
      is_active,
      assigned_at,
      user:users(id, full_name, phone)
    `)
    .single();

  if (roleError) {
    console.error('Assign role error:', roleError);
    return Errors.internal('Failed to assign role');
  }

  return success({ staff: role }, 201);
}

/**
 * PUT /staff/{id}
 * Update a staff member's role
 */
async function updateStaff(
  ctx: ServiceContext,
  req: Request,
  roleId: string
): Promise<Response> {
  // Only owner/manager can update staff
  const roleError = requireRole(ctx, ['owner', 'manager']);
  if (roleError) return roleError;

  const body = await req.json();

  const supabase = createServiceClient();

  // Get existing role
  const { data: existing } = await supabase
    .from('user_roles')
    .select('id, role, user_id')
    .eq('id', roleId)
    .eq('bar_id', ctx.barId)
    .single();

  if (!existing) {
    return Errors.notFound('Staff member');
  }

  // Can't modify owner role
  if (existing.role === 'owner') {
    return Errors.forbidden();
  }

  // Manager can't modify another manager
  if (existing.role === 'manager' && ctx.userRole !== 'owner') {
    return Errors.forbidden();
  }

  // Build update
  const updates: Record<string, unknown> = {};

  if (body.role !== undefined) {
    // Validate role
    if (!['manager', 'bartender', 'server', 'kitchen'].includes(body.role)) {
      return Errors.badRequest('Invalid role');
    }
    // Manager can't promote to manager
    if (body.role === 'manager' && ctx.userRole !== 'owner') {
      return Errors.forbidden();
    }
    updates.role = body.role;
  }

  if (body.isActive !== undefined) {
    updates.is_active = body.isActive;
  }

  const { data: updated, error } = await supabase
    .from('user_roles')
    .update(updates)
    .eq('id', roleId)
    .select(`
      id,
      role,
      is_active,
      assigned_at,
      user:users(id, full_name, phone)
    `)
    .single();

  if (error) {
    console.error('Update staff error:', error);
    return Errors.internal('Failed to update staff');
  }

  return success({ staff: updated });
}

/**
 * DELETE /staff/{id}
 * Remove a staff member (deactivate role)
 */
async function removeStaff(ctx: ServiceContext, roleId: string): Promise<Response> {
  // Only owner/manager can remove staff
  const roleError = requireRole(ctx, ['owner', 'manager']);
  if (roleError) return roleError;

  const supabase = createServiceClient();

  // Get existing role
  const { data: existing } = await supabase
    .from('user_roles')
    .select('id, role, user:users(full_name)')
    .eq('id', roleId)
    .eq('bar_id', ctx.barId)
    .single();

  if (!existing) {
    return Errors.notFound('Staff member');
  }

  // Can't remove owner
  if (existing.role === 'owner') {
    return Errors.forbidden();
  }

  // Manager can't remove another manager
  if (existing.role === 'manager' && ctx.userRole !== 'owner') {
    return Errors.forbidden();
  }

  // Deactivate (soft delete)
  const { error } = await supabase
    .from('user_roles')
    .update({ is_active: false })
    .eq('id', roleId);

  if (error) {
    console.error('Remove staff error:', error);
    return Errors.internal('Failed to remove staff');
  }

  return success({
    message: `Staff member "${existing.user?.full_name}" has been removed`,
  });
}

/**
 * POST /staff/{id}/reset-pin
 * Reset a staff member's PIN
 */
async function resetPin(
  ctx: ServiceContext,
  req: Request,
  roleId: string
): Promise<Response> {
  // Only owner/manager can reset PINs
  const roleError = requireRole(ctx, ['owner', 'manager']);
  if (roleError) return roleError;

  const body = await req.json();

  if (!isValidPin(body.newPin)) {
    return Errors.badRequest('New PIN must be 4-6 digits');
  }

  const supabase = createServiceClient();

  // Get the user from the role
  const { data: roleData } = await supabase
    .from('user_roles')
    .select('user_id, role')
    .eq('id', roleId)
    .eq('bar_id', ctx.barId)
    .single();

  if (!roleData) {
    return Errors.notFound('Staff member');
  }

  // Can't reset owner's PIN unless you're the owner
  if (roleData.role === 'owner' && ctx.userRole !== 'owner') {
    return Errors.forbidden();
  }

  // Manager can't reset another manager's PIN
  if (roleData.role === 'manager' && ctx.userRole !== 'owner') {
    return Errors.forbidden();
  }

  // Update PIN
  const pinHash = await hashPin(body.newPin);
  const { error } = await supabase
    .schema('auth_custom')
    .from('credentials')
    .update({
      pin_hash: pinHash,
      failed_attempts: 0,
      locked_until: null,
    })
    .eq('user_id', roleData.user_id);

  if (error) {
    console.error('Reset PIN error:', error);
    return Errors.internal('Failed to reset PIN');
  }

  return success({ message: 'PIN has been reset successfully' });
}
