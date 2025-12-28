/**
 * Authentication Service
 * @implements ARCHITECTURE.md Section 4 - Authentication System
 *
 * Handles:
 * - Business owner registration (account creation)
 * - Phone + PIN login
 * - OTP generation and verification
 * - Session management
 * - Device registration
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as crypto from 'crypto';
import {
  User,
  Bar,
  Device,
  UserRole,
  Session,
  Credentials,
  UserRoleAssignment,
} from '../types/database';
import {
  AuthError,
  AuthErrors,
  ValidationError,
  ValidationErrors,
} from '../types/errors';
import {
  UnauthenticatedContext,
  ServiceContext,
  Result,
  ok,
  err,
} from '../types/context';

// ============================================
// TYPES
// ============================================

export interface LoginInput {
  phone: string;
  pin: string;
  deviceFingerprint: string;
  barId: string;
}

export interface LoginResult {
  user: User;
  session: Session;
  role: UserRole;
  device: Device;
}

export interface RegisterDeviceInput {
  barId: string;
  registrationCode: string;
  deviceFingerprint: string;
  deviceName: string;
}

export interface RequestOtpInput {
  phone: string;
}

export interface ResetPinInput {
  phone: string;
  otpCode: string;
  newPin: string;
}

export interface RegisterBusinessInput {
  // Owner details
  ownerPhone: string;
  ownerName: string;
  ownerNationalId: string; // Required: Rwanda National ID
  ownerPin: string;

  // Bar details
  barName: string;
  barTin: string; // Required: Tax Identification Number
  barLocation?: string;
  barPhone?: string;

  // Optional: Agent referral code (for future affiliate integration)
  agentReferralCode?: string;
}

export interface RegisterBusinessResult {
  user: User;
  bar: Bar;
  message: string;
}

// ============================================
// CONSTANTS
// ============================================

const PIN_MIN_LENGTH = 4;
const PIN_MAX_LENGTH = 6;
const OTP_LENGTH = 6;
const OTP_EXPIRY_MINUTES = 10;
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION_MINUTES = 30;
const SESSION_DURATION_HOURS = 12;

// ============================================
// AUTH SERVICE
// ============================================

export class AuthService {
  constructor(private supabase: SupabaseClient) {}

  /**
   * Register a new business owner and their bar
   * @implements ARCHITECTURE.md Section 4 - Authentication System
   *
   * Creates:
   * - User account for the owner
   * - Bar record
   * - Owner role assignment
   * - PIN credentials
   *
   * Optional: Records agent referral for future affiliate commission
   */
  async registerBusiness(
    input: RegisterBusinessInput
  ): Promise<Result<RegisterBusinessResult, AuthError>> {
    const {
      ownerPhone,
      ownerName,
      ownerNationalId,
      ownerPin,
      barName,
      barTin,
      barLocation,
      barPhone,
      agentReferralCode,
    } = input;

    // Validate phone format
    if (!this.isValidPhone(ownerPhone)) {
      return err(AuthErrors.INVALID_PHONE(ownerPhone));
    }

    // Validate National ID (Rwanda: 16 digits, starts with 1)
    if (!this.isValidNationalId(ownerNationalId)) {
      return err(
        new AuthError(
          'Invalid National ID format. Must be 16 digits.',
          'AUTH_INVALID_NATIONAL_ID',
          { national_id: ownerNationalId }
        )
      );
    }

    // Validate TIN (Rwanda: 9 digits)
    if (!this.isValidTin(barTin)) {
      return err(
        new AuthError(
          'Invalid TIN format. Must be 9 digits.',
          'AUTH_INVALID_TIN',
          { tin: barTin }
        )
      );
    }

    // Validate PIN format
    if (!this.isValidPin(ownerPin)) {
      return err(
        new AuthError(
          `PIN must be ${PIN_MIN_LENGTH}-${PIN_MAX_LENGTH} digits`,
          'AUTH_INVALID_PIN_FORMAT'
        )
      );
    }

    // Validate name
    if (!ownerName || ownerName.trim().length < 2) {
      return err(
        new AuthError('Owner name must be at least 2 characters', 'AUTH_INVALID_NAME')
      );
    }

    // Validate bar name
    if (!barName || barName.trim().length < 2) {
      return err(
        new AuthError('Bar name must be at least 2 characters', 'AUTH_INVALID_BAR_NAME')
      );
    }

    // Check if phone already exists
    const { data: existingUser } = await this.supabase
      .from('users')
      .select('id')
      .eq('phone', ownerPhone)
      .single();

    if (existingUser) {
      return err(
        new AuthError(
          'A user with this phone number already exists',
          'AUTH_PHONE_EXISTS',
          { phone: ownerPhone }
        )
      );
    }

    // Optional: Validate agent referral code if provided
    let agentId: string | null = null;
    if (agentReferralCode) {
      const { data: agent } = await this.supabase
        .schema('affiliate').from('agents')
        .select('id, is_active')
        .eq('referral_code', agentReferralCode)
        .single();

      if (agent && agent.is_active) {
        agentId = agent.id;
      }
      // Silently ignore invalid codes - don't block registration
    }

    // Create user
    const { data: user, error: userError } = await this.supabase
      .from('users')
      .insert({
        phone: ownerPhone,
        full_name: ownerName.trim(),
        national_id: ownerNationalId,
        is_active: true,
      })
      .select()
      .single();

    if (userError || !user) {
      throw new Error(`Failed to create user: ${userError?.message}`);
    }

    // Create bar with owner reference
    const { data: bar, error: barError } = await this.supabase
      .from('bars')
      .insert({
        name: barName.trim(),
        tin: barTin,
        location: barLocation?.trim() || null,
        phone: barPhone?.trim() || null,
        owner_id: user.id,
        credit_limit_rwf: 0,
        currency: 'RWF',
        timezone: 'Africa/Kigali',
        subscription_status: 'trial',
        is_active: true,
      })
      .select()
      .single();

    if (barError || !bar) {
      // Rollback: delete the user we just created
      await this.supabase.from('users').delete().eq('id', user.id);
      throw new Error(`Failed to create bar: ${barError?.message}`);
    }

    // Assign owner role
    const { error: roleError } = await this.supabase.from('user_roles').insert({
      user_id: user.id,
      bar_id: bar.id,
      role: 'owner',
      is_active: true,
      assigned_by: user.id, // Self-assigned during registration
    });

    if (roleError) {
      // Rollback
      await this.supabase.from('bars').delete().eq('id', bar.id);
      await this.supabase.from('users').delete().eq('id', user.id);
      throw new Error(`Failed to assign owner role: ${roleError.message}`);
    }

    // Create PIN credentials
    const pinHash = await this.hashPin(ownerPin);
    const { error: credError } = await this.supabase
      .schema('auth_custom').from('credentials')
      .insert({
        user_id: user.id,
        pin_hash: pinHash,
        failed_attempts: 0,
        otp_attempts: 0,
      });

    if (credError) {
      // Rollback
      await this.supabase.from('user_roles').delete().eq('user_id', user.id);
      await this.supabase.from('bars').delete().eq('id', bar.id);
      await this.supabase.from('users').delete().eq('id', user.id);
      throw new Error(`Failed to create credentials: ${credError.message}`);
    }

    // Optional: Record agent referral for future commission tracking
    if (agentId) {
      await this.supabase.schema('affiliate').from('referrals').insert({
        agent_id: agentId,
        bar_id: bar.id,
        status: 'pending', // Will be activated when bar subscribes
      });
    }

    // Log registration event
    await this.supabase.from('events').insert({
      bar_id: bar.id,
      device_id: '00000000-0000-0000-0000-000000000000', // System placeholder
      user_id: user.id,
      user_role: 'owner',
      event_type: 'user_create',
      entity_type: 'user',
      entity_id: user.id,
      payload: {
        action: 'business_registration',
        bar_name: bar.name,
        referred_by_agent: agentId ? true : false,
      },
      client_timestamp: new Date().toISOString(),
    });

    return ok({
      user,
      bar,
      message:
        'Business registered successfully. Please register a device to start using the system.',
    });
  }

  /**
   * Login with phone + PIN
   * @implements ARCHITECTURE.md Section 4.3 - Login Flow
   */
  async login(input: LoginInput): Promise<Result<LoginResult, AuthError>> {
    const { phone, pin, deviceFingerprint, barId } = input;

    // Validate phone format
    if (!this.isValidPhone(phone)) {
      return err(AuthErrors.INVALID_PHONE(phone));
    }

    // Find user by phone
    const { data: user, error: userError } = await this.supabase
      .from('users')
      .select('*')
      .eq('phone', phone)
      .eq('is_active', true)
      .single();

    if (userError || !user) {
      return err(AuthErrors.USER_NOT_FOUND(phone));
    }

    // Check if user has role in this bar
    const { data: roleData } = await this.supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .eq('bar_id', barId)
      .eq('is_active', true)
      .single();

    if (!roleData) {
      return err(AuthErrors.NO_ROLE_IN_BAR(user.id, barId));
    }

    // Get credentials
    const { data: credentials } = await this.supabase
      .schema('auth_custom').from('credentials')
      .select('*')
      .eq('user_id', user.id)
      .single();

    if (!credentials) {
      return err(AuthErrors.USER_NOT_FOUND(phone));
    }

    // Check if account is locked
    if (credentials.locked_until && new Date(credentials.locked_until) > new Date()) {
      return err(AuthErrors.ACCOUNT_LOCKED(credentials.locked_until));
    }

    // Verify PIN
    const pinValid = await this.verifyPin(pin, credentials.pin_hash);
    if (!pinValid) {
      // Increment failed attempts
      await this.incrementFailedAttempts(user.id, credentials.failed_attempts);
      return err(AuthErrors.INVALID_PIN());
    }

    // Check device
    const { data: device } = await this.supabase
      .from('devices')
      .select('*')
      .eq('bar_id', barId)
      .eq('fingerprint', deviceFingerprint)
      .eq('is_active', true)
      .single();

    if (!device) {
      return err(AuthErrors.DEVICE_NOT_REGISTERED(deviceFingerprint));
    }

    if (device.is_locked) {
      return err(AuthErrors.DEVICE_LOCKED(device.id));
    }

    // Create session
    const sessionToken = this.generateSessionToken();
    const tokenHash = this.hashToken(sessionToken);
    const expiresAt = new Date(Date.now() + SESSION_DURATION_HOURS * 60 * 60 * 1000);

    const { data: session, error: sessionError } = await this.supabase
      .schema('auth_custom').from('sessions')
      .insert({
        user_id: user.id,
        device_id: device.id,
        bar_id: barId,
        token_hash: tokenHash,
        expires_at: expiresAt.toISOString(),
        is_active: true,
      })
      .select()
      .single();

    if (sessionError || !session) {
      throw new Error('Failed to create session');
    }

    // Reset failed attempts and update last login
    await this.supabase
      .schema('auth_custom').from('credentials')
      .update({
        failed_attempts: 0,
        last_login_at: new Date().toISOString(),
        last_login_device_id: device.id,
      })
      .eq('user_id', user.id);

    // Update device last seen
    await this.supabase
      .from('devices')
      .update({
        last_seen_at: new Date().toISOString(),
        last_user_id: user.id,
      })
      .eq('id', device.id);

    // Log event
    await this.logAuthEvent(barId, device.id, user.id, roleData.role, 'login', {
      session_id: session.id,
    });

    return ok({
      user,
      session: { ...session, token_hash: sessionToken }, // Return plain token, not hash
      role: roleData.role,
      device,
    });
  }

  /**
   * Validate an existing session
   */
  async validateSession(token: string): Promise<Result<ServiceContext, AuthError>> {
    const tokenHash = this.hashToken(token);

    const { data: session } = await this.supabase
      .schema('auth_custom').from('sessions')
      .select('*, user:users(*), device:devices(*)')
      .eq('token_hash', tokenHash)
      .eq('is_active', true)
      .single();

    if (!session) {
      return err(AuthErrors.INVALID_SESSION());
    }

    if (new Date(session.expires_at) < new Date()) {
      // Expire the session
      await this.supabase
        .schema('auth_custom').from('sessions')
        .update({ is_active: false })
        .eq('id', session.id);

      return err(AuthErrors.SESSION_EXPIRED());
    }

    // Get user's role in this bar
    const { data: roleData } = await this.supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', session.user_id)
      .eq('bar_id', session.bar_id)
      .eq('is_active', true)
      .single();

    if (!roleData) {
      return err(AuthErrors.NO_ROLE_IN_BAR(session.user_id, session.bar_id));
    }

    // Update last activity
    await this.supabase
      .schema('auth_custom').from('sessions')
      .update({ last_activity_at: new Date().toISOString() })
      .eq('id', session.id);

    return ok({
      userId: session.user_id,
      userRole: roleData.role,
      barId: session.bar_id,
      deviceId: session.device_id,
    });
  }

  /**
   * Logout - invalidate session
   */
  async logout(ctx: ServiceContext): Promise<Result<void, AuthError>> {
    await this.supabase
      .schema('auth_custom').from('sessions')
      .update({ is_active: false })
      .eq('user_id', ctx.userId)
      .eq('device_id', ctx.deviceId)
      .eq('bar_id', ctx.barId)
      .eq('is_active', true);

    await this.logAuthEvent(ctx.barId, ctx.deviceId, ctx.userId, ctx.userRole, 'logout', {});

    return ok(undefined);
  }

  /**
   * Request OTP for PIN reset
   */
  async requestOtp(input: RequestOtpInput): Promise<Result<{ expiresAt: string }, AuthError>> {
    const { phone } = input;

    if (!this.isValidPhone(phone)) {
      return err(AuthErrors.INVALID_PHONE(phone));
    }

    // Find user
    const { data: user } = await this.supabase
      .from('users')
      .select('id')
      .eq('phone', phone)
      .eq('is_active', true)
      .single();

    if (!user) {
      return err(AuthErrors.USER_NOT_FOUND(phone));
    }

    // Generate OTP
    const otpCode = this.generateOtp();
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

    // Store OTP
    await this.supabase
      .schema('auth_custom').from('credentials')
      .update({
        otp_code: otpCode,
        otp_expires_at: expiresAt.toISOString(),
        otp_attempts: 0,
      })
      .eq('user_id', user.id);

    // TODO: Send OTP via SMS (Pindo API)
    // For now, log it (remove in production!)
    console.log(`OTP for ${phone}: ${otpCode}`);

    return ok({ expiresAt: expiresAt.toISOString() });
  }

  /**
   * Reset PIN using OTP
   */
  async resetPin(input: ResetPinInput): Promise<Result<void, AuthError>> {
    const { phone, otpCode, newPin } = input;

    // Validate new PIN
    if (!this.isValidPin(newPin)) {
      return err(new AuthError(
        `PIN must be ${PIN_MIN_LENGTH}-${PIN_MAX_LENGTH} digits`,
        'AUTH_INVALID_PIN_FORMAT'
      ));
    }

    // Find user
    const { data: user } = await this.supabase
      .from('users')
      .select('id')
      .eq('phone', phone)
      .single();

    if (!user) {
      return err(AuthErrors.USER_NOT_FOUND(phone));
    }

    // Get credentials with OTP
    const { data: credentials } = await this.supabase
      .schema('auth_custom').from('credentials')
      .select('*')
      .eq('user_id', user.id)
      .single();

    if (!credentials) {
      return err(AuthErrors.USER_NOT_FOUND(phone));
    }

    // Check OTP attempts
    if (credentials.otp_attempts >= 5) {
      return err(AuthErrors.OTP_MAX_ATTEMPTS());
    }

    // Check OTP expiry
    if (!credentials.otp_expires_at || new Date(credentials.otp_expires_at) < new Date()) {
      return err(AuthErrors.OTP_EXPIRED());
    }

    // Verify OTP
    if (credentials.otp_code !== otpCode) {
      // Increment attempts
      await this.supabase
        .schema('auth_custom').from('credentials')
        .update({ otp_attempts: credentials.otp_attempts + 1 })
        .eq('user_id', user.id);

      return err(AuthErrors.OTP_INVALID());
    }

    // Hash new PIN and update
    const pinHash = await this.hashPin(newPin);

    await this.supabase
      .schema('auth_custom').from('credentials')
      .update({
        pin_hash: pinHash,
        otp_code: null,
        otp_expires_at: null,
        otp_attempts: 0,
        failed_attempts: 0,
        locked_until: null,
      })
      .eq('user_id', user.id);

    return ok(undefined);
  }

  /**
   * Register a new device to a bar
   */
  async registerDevice(input: RegisterDeviceInput): Promise<Result<Device, AuthError>> {
    const { barId, registrationCode, deviceFingerprint, deviceName } = input;

    // Verify registration code
    const { data: registration } = await this.supabase
      .schema('auth_custom').from('device_registrations')
      .select('*')
      .eq('bar_id', barId)
      .eq('registration_code', registrationCode)
      .is('used_at', null)
      .single();

    if (!registration) {
      return err(new AuthError('Invalid or expired registration code', 'AUTH_INVALID_REG_CODE'));
    }

    if (new Date(registration.expires_at) < new Date()) {
      return err(new AuthError('Registration code has expired', 'AUTH_REG_CODE_EXPIRED'));
    }

    // Check if device already exists
    const { data: existingDevice } = await this.supabase
      .from('devices')
      .select('id')
      .eq('bar_id', barId)
      .eq('fingerprint', deviceFingerprint)
      .single();

    if (existingDevice) {
      return err(new AuthError('Device already registered', 'AUTH_DEVICE_EXISTS'));
    }

    // Create device
    const { data: device, error } = await this.supabase
      .from('devices')
      .insert({
        bar_id: barId,
        name: deviceName,
        fingerprint: deviceFingerprint,
        is_active: true,
        is_locked: false,
      })
      .select()
      .single();

    if (error || !device) {
      throw new Error('Failed to register device');
    }

    // Mark registration code as used
    await this.supabase
      .schema('auth_custom').from('device_registrations')
      .update({
        used_at: new Date().toISOString(),
        used_by_device_id: device.id,
      })
      .eq('id', registration.id);

    return ok(device);
  }

  /**
   * Generate a device registration code (for owner/manager)
   */
  async generateRegistrationCode(ctx: ServiceContext): Promise<Result<{ code: string; expiresAt: string }, AuthError>> {
    // Only owner/manager can generate codes
    if (!['owner', 'manager'].includes(ctx.userRole)) {
      return err(AuthErrors.INSUFFICIENT_PERMISSIONS('owner or manager', ctx.userRole));
    }

    const code = this.generateAlphanumericCode(6);
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes

    const { error } = await this.supabase
      .schema('auth_custom').from('device_registrations')
      .insert({
        bar_id: ctx.barId,
        registration_code: code,
        expires_at: expiresAt.toISOString(),
        created_by: ctx.userId,
      });

    if (error) {
      throw new Error('Failed to generate registration code');
    }

    return ok({ code, expiresAt: expiresAt.toISOString() });
  }

  // ============================================
  // PRIVATE HELPERS
  // ============================================

  private isValidPhone(phone: string): boolean {
    return /^\+?[0-9]{10,15}$/.test(phone);
  }

  private isValidPin(pin: string): boolean {
    return /^[0-9]{4,6}$/.test(pin);
  }

  private isValidNationalId(nationalId: string): boolean {
    // Rwanda National ID: 16 digits, starts with 1
    return /^1[0-9]{15}$/.test(nationalId);
  }

  private isValidTin(tin: string): boolean {
    // Rwanda TIN: 9 digits
    return /^[0-9]{9}$/.test(tin);
  }

  private async hashPin(pin: string): Promise<string> {
    // Using crypto.scrypt for PIN hashing (simpler than argon2 for this use case)
    return new Promise((resolve, reject) => {
      const salt = crypto.randomBytes(16).toString('hex');
      crypto.scrypt(pin, salt, 64, (err, derivedKey) => {
        if (err) reject(err);
        resolve(salt + ':' + derivedKey.toString('hex'));
      });
    });
  }

  private async verifyPin(pin: string, hash: string): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const [salt, key] = hash.split(':');
      crypto.scrypt(pin, salt, 64, (err, derivedKey) => {
        if (err) reject(err);
        resolve(key === derivedKey.toString('hex'));
      });
    });
  }

  private generateSessionToken(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  private generateOtp(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  private generateAlphanumericCode(length: number): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Excluding confusing chars
    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  private async incrementFailedAttempts(userId: string, currentAttempts: number): Promise<void> {
    const newAttempts = currentAttempts + 1;
    const update: Record<string, unknown> = { failed_attempts: newAttempts };

    if (newAttempts >= MAX_LOGIN_ATTEMPTS) {
      update.locked_until = new Date(Date.now() + LOCKOUT_DURATION_MINUTES * 60 * 1000).toISOString();
    }

    await this.supabase
      .schema('auth_custom').from('credentials')
      .update(update)
      .eq('user_id', userId);
  }

  private async logAuthEvent(
    barId: string,
    deviceId: string,
    userId: string,
    userRole: UserRole,
    eventType: 'login' | 'logout' | 'pin_change',
    payload: Record<string, unknown>
  ): Promise<void> {
    await this.supabase.from('events').insert({
      bar_id: barId,
      device_id: deviceId,
      user_id: userId,
      user_role: userRole,
      event_type: eventType,
      entity_type: 'session',
      payload,
      client_timestamp: new Date().toISOString(),
    });
  }
}
