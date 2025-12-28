/**
 * Auth Edge Function
 * @implements ARCHITECTURE.md Section 4 - Authentication System
 * @implements ARCHITECTURE.md Section 7 - API Layer
 */

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { handleCors, corsHeaders } from '../_shared/cors.ts';
import { success, Errors } from '../_shared/response.ts';
import { createServiceClient } from '../_shared/supabase.ts';
import { validate, ValidationSchema, isValidPhone, isValidPin, isValidNationalId, isValidTin } from '../_shared/validation.ts';
import * as crypto from 'https://deno.land/std@0.208.0/crypto/mod.ts';

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
 * Generate a secure session token
 */
function generateToken(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Hash a token for storage
 */
function hashToken(token: string): string {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hashBuffer = crypto.subtle.digestSync('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

serve(async (req) => {
  // Handle CORS
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const url = new URL(req.url);
  const path = url.pathname.replace('/auth', '');

  try {
    // Route to appropriate handler
    switch (path) {
      case '/register':
        return await handleRegister(req);
      case '/login':
        return await handleLogin(req);
      case '/logout':
        return await handleLogout(req);
      case '/verify-pin':
        return await handleVerifyPin(req);
      default:
        return Errors.notFound('Endpoint');
    }
  } catch (error) {
    console.error('Auth error:', error);
    return Errors.internal(error.message);
  }
});

/**
 * POST /auth/register
 * Register a new business owner with their bar
 */
async function handleRegister(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return Errors.badRequest('Method not allowed');
  }

  const body = await req.json();

  // Validate input
  const schema: ValidationSchema = {
    ownerPhone: { required: true, type: 'phone' },
    ownerName: { required: true, type: 'string', minLength: 2 },
    ownerNationalId: { required: true, type: 'nationalId' },
    ownerPin: { required: true, type: 'pin' },
    barName: { required: true, type: 'string', minLength: 2 },
    barTin: { required: true, type: 'tin' },
    barLocation: { required: false, type: 'string' },
    barPhone: { required: false, type: 'phone' },
    agentReferralCode: { required: false, type: 'string' },
  };

  const validation = validate(body, schema);
  if (!validation.valid) {
    return Errors.validationError(validation.errors);
  }

  const supabase = createServiceClient();

  // Check if phone already exists
  const { data: existingUser } = await supabase
    .from('users')
    .select('id')
    .eq('phone', body.ownerPhone)
    .single();

  if (existingUser) {
    return Errors.badRequest('Phone number already registered');
  }

  // Check if national ID already exists
  const { data: existingNationalId } = await supabase
    .from('users')
    .select('id')
    .eq('national_id', body.ownerNationalId)
    .single();

  if (existingNationalId) {
    return Errors.badRequest('National ID already registered');
  }

  // Check if TIN already exists
  const { data: existingTin } = await supabase
    .from('bars')
    .select('id')
    .eq('tin', body.barTin)
    .single();

  if (existingTin) {
    return Errors.badRequest('TIN already registered');
  }

  // Validate agent referral code if provided
  let agentId: string | null = null;
  if (body.agentReferralCode) {
    const { data: agent } = await supabase
      .schema('affiliate')
      .from('agents')
      .select('id, status')
      .eq('referral_code', body.agentReferralCode)
      .single();

    if (!agent) {
      return Errors.badRequest('Invalid agent referral code');
    }

    if (agent.status !== 'active') {
      return Errors.badRequest('Agent is not active');
    }

    agentId = agent.id;
  }

  // Create user
  const { data: user, error: userError } = await supabase
    .from('users')
    .insert({
      phone: body.ownerPhone,
      full_name: body.ownerName,
      national_id: body.ownerNationalId,
    })
    .select('id')
    .single();

  if (userError) {
    console.error('User creation error:', userError);
    return Errors.internal('Failed to create user');
  }

  // Create credentials
  const pinHash = await hashPin(body.ownerPin);
  const { error: credError } = await supabase
    .schema('auth_custom')
    .from('credentials')
    .insert({
      user_id: user.id,
      pin_hash: pinHash,
    });

  if (credError) {
    console.error('Credentials creation error:', credError);
    // Rollback user
    await supabase.from('users').delete().eq('id', user.id);
    return Errors.internal('Failed to create credentials');
  }

  // Create bar
  const { data: bar, error: barError } = await supabase
    .from('bars')
    .insert({
      name: body.barName,
      tin: body.barTin,
      location: body.barLocation || null,
      phone: body.barPhone || null,
      owner_id: user.id,
      agent_id: agentId,
    })
    .select('id')
    .single();

  if (barError) {
    console.error('Bar creation error:', barError);
    // Rollback
    await supabase.schema('auth_custom').from('credentials').delete().eq('user_id', user.id);
    await supabase.from('users').delete().eq('id', user.id);
    return Errors.internal('Failed to create bar');
  }

  // Assign owner role
  const { error: roleError } = await supabase
    .from('user_roles')
    .insert({
      user_id: user.id,
      bar_id: bar.id,
      role: 'owner',
      assigned_by: user.id,
    });

  if (roleError) {
    console.error('Role assignment error:', roleError);
    // Rollback
    await supabase.from('bars').delete().eq('id', bar.id);
    await supabase.schema('auth_custom').from('credentials').delete().eq('user_id', user.id);
    await supabase.from('users').delete().eq('id', user.id);
    return Errors.internal('Failed to assign role');
  }

  // Record agent referral if applicable
  if (agentId) {
    await supabase
      .schema('affiliate')
      .from('referrals')
      .insert({
        agent_id: agentId,
        bar_id: bar.id,
        status: 'pending',
      });
  }

  return success({
    userId: user.id,
    barId: bar.id,
    message: 'Business registered successfully',
  }, 201);
}

/**
 * POST /auth/login
 * Login with phone and PIN, returns session token
 */
async function handleLogin(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return Errors.badRequest('Method not allowed');
  }

  const body = await req.json();

  // Validate input
  if (!isValidPhone(body.phone)) {
    return Errors.badRequest('Invalid phone number');
  }
  if (!isValidPin(body.pin)) {
    return Errors.badRequest('Invalid PIN format');
  }

  const deviceId = req.headers.get('X-Device-ID');
  const barId = req.headers.get('X-Bar-ID');

  if (!deviceId || !barId) {
    return Errors.badRequest('Missing X-Device-ID or X-Bar-ID header');
  }

  const supabase = createServiceClient();

  // Get user
  const { data: user, error: userError } = await supabase
    .from('users')
    .select('id, full_name, is_active')
    .eq('phone', body.phone)
    .single();

  if (userError || !user) {
    return Errors.unauthorized();
  }

  if (!user.is_active) {
    return Errors.forbidden();
  }

  // Verify PIN
  const { data: credentials } = await supabase
    .schema('auth_custom')
    .from('credentials')
    .select('pin_hash, failed_attempts, locked_until')
    .eq('user_id', user.id)
    .single();

  if (!credentials) {
    return Errors.unauthorized();
  }

  // Check if locked
  if (credentials.locked_until && new Date(credentials.locked_until) > new Date()) {
    return Errors.badRequest('Account temporarily locked. Try again later.');
  }

  const pinHash = await hashPin(body.pin);
  if (pinHash !== credentials.pin_hash) {
    // Increment failed attempts
    const failedAttempts = (credentials.failed_attempts || 0) + 1;
    const lockUntil = failedAttempts >= 5
      ? new Date(Date.now() + 15 * 60 * 1000).toISOString() // Lock for 15 minutes
      : null;

    await supabase
      .schema('auth_custom')
      .from('credentials')
      .update({
        failed_attempts: failedAttempts,
        locked_until: lockUntil,
      })
      .eq('user_id', user.id);

    return Errors.unauthorized();
  }

  // Reset failed attempts on successful login
  await supabase
    .schema('auth_custom')
    .from('credentials')
    .update({
      failed_attempts: 0,
      locked_until: null,
    })
    .eq('user_id', user.id);

  // Check user has role in this bar
  const { data: roleData } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', user.id)
    .eq('bar_id', barId)
    .eq('is_active', true)
    .single();

  if (!roleData) {
    return Errors.forbidden();
  }

  // Create session
  const token = generateToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

  const { data: session, error: sessionError } = await supabase
    .schema('auth_custom')
    .from('sessions')
    .insert({
      user_id: user.id,
      bar_id: barId,
      device_id: deviceId,
      token_hash: tokenHash,
      expires_at: expiresAt.toISOString(),
    })
    .select('id')
    .single();

  if (sessionError) {
    console.error('Session creation error:', sessionError);
    return Errors.internal('Failed to create session');
  }

  return success({
    token,
    expiresAt: expiresAt.toISOString(),
    user: {
      id: user.id,
      name: user.full_name,
      role: roleData.role,
    },
  });
}

/**
 * POST /auth/logout
 * Invalidate current session
 */
async function handleLogout(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return Errors.badRequest('Method not allowed');
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return Errors.unauthorized();
  }

  const token = authHeader.replace('Bearer ', '');
  const tokenHash = hashToken(token);

  const supabase = createServiceClient();

  const { error } = await supabase
    .schema('auth_custom')
    .from('sessions')
    .update({ is_active: false })
    .eq('token_hash', tokenHash);

  if (error) {
    console.error('Logout error:', error);
    return Errors.internal('Failed to logout');
  }

  return success({ message: 'Logged out successfully' });
}

/**
 * POST /auth/verify-pin
 * Verify PIN without creating a session (for confirmations)
 */
async function handleVerifyPin(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return Errors.badRequest('Method not allowed');
  }

  const body = await req.json();

  if (!body.userId || !isValidPin(body.pin)) {
    return Errors.badRequest('Invalid input');
  }

  const supabase = createServiceClient();

  const { data: credentials } = await supabase
    .schema('auth_custom')
    .from('credentials')
    .select('pin_hash')
    .eq('user_id', body.userId)
    .single();

  if (!credentials) {
    return Errors.notFound('User');
  }

  const pinHash = await hashPin(body.pin);
  const valid = pinHash === credentials.pin_hash;

  return success({ valid });
}
