/**
 * Authentication Middleware for Edge Functions
 * @implements ARCHITECTURE.md Section 4 - Authentication System
 */

import { createServiceClient } from './supabase.ts';
import { Errors } from './response.ts';
import * as crypto from 'https://deno.land/std@0.208.0/crypto/mod.ts';

/**
 * Service context extracted from authenticated request
 */
export interface ServiceContext {
  userId: string;
  userRole: 'owner' | 'manager' | 'bartender' | 'server' | 'kitchen';
  barId: string;
  deviceId: string;
  shiftId?: string;
  clientTimestamp?: string;
  clientId?: string;
}

/**
 * Hash a session token for lookup
 */
function hashToken(token: string): string {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hashBuffer = crypto.subtle.digestSync('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Extract and validate session from request
 * Returns ServiceContext if valid, or an error Response
 */
export async function authenticate(
  req: Request
): Promise<ServiceContext | Response> {
  // Get authorization header
  const authHeader = req.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return Errors.unauthorized();
  }

  const token = authHeader.replace('Bearer ', '');
  if (!token) {
    return Errors.unauthorized();
  }

  // Get device and bar IDs from headers
  const deviceId = req.headers.get('X-Device-ID');
  const barId = req.headers.get('X-Bar-ID');

  if (!deviceId || !barId) {
    return Errors.badRequest('Missing X-Device-ID or X-Bar-ID header');
  }

  const supabase = createServiceClient();

  // Hash the token and look up the session
  const tokenHash = hashToken(token);

  const { data: session, error: sessionError } = await supabase
    .schema('auth_custom')
    .from('sessions')
    .select('*')
    .eq('token_hash', tokenHash)
    .eq('is_active', true)
    .single();

  if (sessionError || !session) {
    return Errors.unauthorized();
  }

  // Check session expiry
  if (new Date(session.expires_at) < new Date()) {
    // Expire the session
    await supabase
      .schema('auth_custom')
      .from('sessions')
      .update({ is_active: false })
      .eq('id', session.id);

    return Errors.unauthorized();
  }

  // Verify bar and device match session
  if (session.bar_id !== barId || session.device_id !== deviceId) {
    return Errors.forbidden();
  }

  // Get user's role in this bar
  const { data: roleData } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', session.user_id)
    .eq('bar_id', barId)
    .eq('is_active', true)
    .single();

  if (!roleData) {
    return Errors.forbidden();
  }

  // Update last activity
  await supabase
    .schema('auth_custom')
    .from('sessions')
    .update({ last_activity_at: new Date().toISOString() })
    .eq('id', session.id);

  // Extract optional headers
  const clientTimestamp = req.headers.get('X-Client-Timestamp') || undefined;
  const clientId = req.headers.get('X-Client-ID') || undefined;

  // Get current shift if available
  const { data: currentShift } = await supabase
    .from('shifts')
    .select('id')
    .eq('bar_id', barId)
    .eq('status', 'open')
    .limit(1)
    .single();

  return {
    userId: session.user_id,
    userRole: roleData.role,
    barId,
    deviceId,
    shiftId: currentShift?.id,
    clientTimestamp,
    clientId,
  };
}

/**
 * Check if context has required role
 */
export function requireRole(
  ctx: ServiceContext,
  allowedRoles: string[]
): Response | null {
  if (!allowedRoles.includes(ctx.userRole)) {
    return Errors.forbidden();
  }
  return null;
}
