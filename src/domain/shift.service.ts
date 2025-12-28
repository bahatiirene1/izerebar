/**
 * Day/Shift Service
 * @implements ARCHITECTURE.md Section 3.1 - Day State Machine
 * @implements ARCHITECTURE.md Section 3.2 - Shift State Machine
 *
 * Handles:
 * - Day lifecycle (open, close, reconcile)
 * - Shift lifecycle (create, open, close, reconcile)
 * - Staff assignment to shifts
 */

import { SupabaseClient } from '@supabase/supabase-js';
import {
  Day,
  Shift,
  ShiftAssignment,
  DayStatus,
  ShiftStatus,
  UserRole,
} from '../types/database';
import { ShiftError, ShiftErrors, AuthError, AuthErrors } from '../types/errors';
import { ServiceContext, Result, ok, err } from '../types/context';

// ============================================
// TYPES
// ============================================

export interface OpenDayInput {
  businessDate: string; // YYYY-MM-DD format
}

export interface CloseDayInput {
  dayId: string;
  notes?: string;
}

export interface ReconcileDayInput {
  dayId: string;
  notes?: string;
}

export interface CreateShiftInput {
  dayId: string;
  name?: string;
  scheduledStart?: string; // HH:MM format
  scheduledEnd?: string; // HH:MM format
}

export interface OpenShiftInput {
  shiftId: string;
}

export interface CloseShiftInput {
  shiftId: string;
  reason?: string;
}

export interface ReconcileShiftInput {
  shiftId: string;
  notes?: string;
}

export interface AssignToShiftInput {
  shiftId: string;
  userId: string;
  role: UserRole;
}

export interface DayWithShifts extends Day {
  shifts: Shift[];
}

// ============================================
// CONSTANTS
// ============================================

const ALLOWED_DAY_TRANSITIONS: Record<DayStatus, DayStatus[]> = {
  open: ['closing'],
  closing: ['closed', 'open'], // Can reopen if needed
  closed: ['reconciled', 'open'], // Can reopen with reason
  reconciled: ['open'], // Can reopen for corrections
};

const ALLOWED_SHIFT_TRANSITIONS: Record<ShiftStatus, ShiftStatus[]> = {
  scheduled: ['open'],
  open: ['closing'],
  closing: ['closed', 'open'], // Can reopen if issues
  closed: ['reconciled', 'open'], // Can reopen with reason
  reconciled: ['open'], // Can reopen for corrections
};

// ============================================
// SHIFT SERVICE
// ============================================

export class ShiftService {
  constructor(private supabase: SupabaseClient) {}

  // ============================================
  // DAY OPERATIONS
  // ============================================

  /**
   * Open a new business day
   * @implements ARCHITECTURE.md Section 3.1 - Day State Machine
   *
   * Only owner/manager can open a day
   * Cannot open if a day already exists for this date
   */
  async openDay(
    ctx: ServiceContext,
    input: OpenDayInput
  ): Promise<Result<Day, ShiftError | AuthError>> {
    // Check permissions
    if (!['owner', 'manager'].includes(ctx.userRole)) {
      return err(AuthErrors.INSUFFICIENT_PERMISSIONS('owner or manager', ctx.userRole));
    }

    const { businessDate } = input;

    // Validate date format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(businessDate)) {
      return err(
        new ShiftError('Invalid date format. Use YYYY-MM-DD', 'SHIFT_INVALID_DATE', {
          date: businessDate,
        })
      );
    }

    // Check if day already exists for this bar and date
    const { data: existingDay } = await this.supabase
      .from('days')
      .select('id')
      .eq('bar_id', ctx.barId)
      .eq('business_date', businessDate)
      .single();

    if (existingDay) {
      return err(ShiftErrors.DAY_ALREADY_EXISTS(businessDate, ctx.barId));
    }

    // Create the day
    const { data: day, error } = await this.supabase
      .from('days')
      .insert({
        bar_id: ctx.barId,
        business_date: businessDate,
        status: 'open',
        opened_at: new Date().toISOString(),
        opened_by: ctx.userId,
        opened_device_id: ctx.deviceId,
      })
      .select()
      .single();

    if (error || !day) {
      throw new Error(`Failed to open day: ${error?.message}`);
    }

    // Log event
    await this.logShiftEvent(ctx, 'day_open', 'day', day.id, {
      business_date: businessDate,
    });

    return ok(day);
  }

  /**
   * Get the current open day for a bar
   */
  async getCurrentDay(
    ctx: ServiceContext
  ): Promise<Result<Day | null, ShiftError>> {
    const { data: day } = await this.supabase
      .from('days')
      .select('*')
      .eq('bar_id', ctx.barId)
      .eq('status', 'open')
      .order('business_date', { ascending: false })
      .limit(1)
      .single();

    return ok(day || null);
  }

  /**
   * Get day with all its shifts
   */
  async getDayWithShifts(
    ctx: ServiceContext,
    dayId: string
  ): Promise<Result<DayWithShifts | null, ShiftError>> {
    const { data: day } = await this.supabase
      .from('days')
      .select('*, shifts(*)')
      .eq('id', dayId)
      .eq('bar_id', ctx.barId)
      .single();

    return ok(day as DayWithShifts | null);
  }

  /**
   * Initiate day closing process
   * @implements ARCHITECTURE.md Section 3.1 - Day State Machine
   *
   * Only owner/manager can close a day
   * All shifts must be closed first
   */
  async closeDay(
    ctx: ServiceContext,
    input: CloseDayInput
  ): Promise<Result<Day, ShiftError | AuthError>> {
    // Check permissions
    if (!['owner', 'manager'].includes(ctx.userRole)) {
      return err(AuthErrors.INSUFFICIENT_PERMISSIONS('owner or manager', ctx.userRole));
    }

    const { dayId, notes } = input;

    // Get the day
    const { data: day } = await this.supabase
      .from('days')
      .select('*')
      .eq('id', dayId)
      .eq('bar_id', ctx.barId)
      .single();

    if (!day) {
      return err(new ShiftError('Day not found', 'SHIFT_DAY_NOT_FOUND', { day_id: dayId }));
    }

    // Check valid transition
    if (!ALLOWED_DAY_TRANSITIONS[day.status as DayStatus]?.includes('closing')) {
      return err(ShiftErrors.INVALID_STATUS_TRANSITION(day.status, 'closing'));
    }

    // Check all shifts are closed or reconciled
    const { data: openShifts } = await this.supabase
      .from('shifts')
      .select('id, status')
      .eq('day_id', dayId)
      .in('status', ['scheduled', 'open', 'closing']);

    if (openShifts && openShifts.length > 0) {
      return err(
        new ShiftError(
          'Cannot close day with open shifts. Close all shifts first.',
          'SHIFT_DAY_HAS_OPEN_SHIFTS',
          { open_shift_count: openShifts.length }
        )
      );
    }

    // Update day to closing, then closed
    const { data: updatedDay, error } = await this.supabase
      .from('days')
      .update({
        status: 'closed',
        closed_at: new Date().toISOString(),
        closed_by: ctx.userId,
        closed_device_id: ctx.deviceId,
      })
      .eq('id', dayId)
      .select()
      .single();

    if (error || !updatedDay) {
      throw new Error(`Failed to close day: ${error?.message}`);
    }

    // Log event
    await this.logShiftEvent(ctx, 'day_close', 'day', dayId, {
      notes,
    });

    return ok(updatedDay);
  }

  /**
   * Reconcile a closed day (final review by owner/manager)
   * @implements ARCHITECTURE.md Section 3.1 - Day State Machine
   */
  async reconcileDay(
    ctx: ServiceContext,
    input: ReconcileDayInput
  ): Promise<Result<Day, ShiftError | AuthError>> {
    // Check permissions
    if (!['owner', 'manager'].includes(ctx.userRole)) {
      return err(AuthErrors.INSUFFICIENT_PERMISSIONS('owner or manager', ctx.userRole));
    }

    const { dayId, notes } = input;

    // Get the day
    const { data: day } = await this.supabase
      .from('days')
      .select('*')
      .eq('id', dayId)
      .eq('bar_id', ctx.barId)
      .single();

    if (!day) {
      return err(new ShiftError('Day not found', 'SHIFT_DAY_NOT_FOUND', { day_id: dayId }));
    }

    // Check valid transition
    if (day.status !== 'closed') {
      return err(ShiftErrors.INVALID_STATUS_TRANSITION(day.status, 'reconciled'));
    }

    // Update day
    const { data: updatedDay, error } = await this.supabase
      .from('days')
      .update({
        status: 'reconciled',
        reconciled_at: new Date().toISOString(),
        reconciled_by: ctx.userId,
        reconciliation_notes: notes,
      })
      .eq('id', dayId)
      .select()
      .single();

    if (error || !updatedDay) {
      throw new Error(`Failed to reconcile day: ${error?.message}`);
    }

    // Log event
    await this.logShiftEvent(ctx, 'day_reconcile', 'day', dayId, {
      notes,
    });

    return ok(updatedDay);
  }

  // ============================================
  // SHIFT OPERATIONS
  // ============================================

  /**
   * Create a new shift for a day
   * @implements ARCHITECTURE.md Section 3.2 - Shift State Machine
   *
   * Only owner/manager can create shifts
   * Day must be open
   */
  async createShift(
    ctx: ServiceContext,
    input: CreateShiftInput
  ): Promise<Result<Shift, ShiftError | AuthError>> {
    // Check permissions
    if (!['owner', 'manager'].includes(ctx.userRole)) {
      return err(AuthErrors.INSUFFICIENT_PERMISSIONS('owner or manager', ctx.userRole));
    }

    const { dayId, name, scheduledStart, scheduledEnd } = input;

    // Get the day and verify it's open
    const { data: day } = await this.supabase
      .from('days')
      .select('*')
      .eq('id', dayId)
      .eq('bar_id', ctx.barId)
      .single();

    if (!day) {
      return err(new ShiftError('Day not found', 'SHIFT_DAY_NOT_FOUND', { day_id: dayId }));
    }

    if (day.status !== 'open') {
      return err(ShiftErrors.DAY_NOT_OPEN(dayId));
    }

    // Create shift
    const { data: shift, error } = await this.supabase
      .from('shifts')
      .insert({
        bar_id: ctx.barId,
        day_id: dayId,
        name: name || null,
        scheduled_start: scheduledStart || null,
        scheduled_end: scheduledEnd || null,
        status: 'scheduled',
      })
      .select()
      .single();

    if (error || !shift) {
      throw new Error(`Failed to create shift: ${error?.message}`);
    }

    // Log event
    await this.logShiftEvent(ctx, 'shift_create', 'shift', shift.id, {
      name,
      scheduled_start: scheduledStart,
      scheduled_end: scheduledEnd,
    });

    return ok(shift);
  }

  /**
   * Open a scheduled shift
   * @implements ARCHITECTURE.md Section 3.2 - Shift State Machine
   *
   * Only owner/manager can open shifts
   */
  async openShift(
    ctx: ServiceContext,
    input: OpenShiftInput
  ): Promise<Result<Shift, ShiftError | AuthError>> {
    // Check permissions
    if (!['owner', 'manager'].includes(ctx.userRole)) {
      return err(AuthErrors.INSUFFICIENT_PERMISSIONS('owner or manager', ctx.userRole));
    }

    const { shiftId } = input;

    // Get shift
    const { data: shift } = await this.supabase
      .from('shifts')
      .select('*, day:days(*)')
      .eq('id', shiftId)
      .eq('bar_id', ctx.barId)
      .single();

    if (!shift) {
      return err(new ShiftError('Shift not found', 'SHIFT_NOT_FOUND', { shift_id: shiftId }));
    }

    // Check day is open
    if (shift.day?.status !== 'open') {
      return err(ShiftErrors.DAY_NOT_OPEN(shift.day_id));
    }

    // Check valid transition
    if (shift.status !== 'scheduled') {
      return err(ShiftErrors.SHIFT_ALREADY_OPEN(shiftId));
    }

    // Update shift
    const { data: updatedShift, error } = await this.supabase
      .from('shifts')
      .update({
        status: 'open',
        opened_at: new Date().toISOString(),
        opened_by: ctx.userId,
        opened_device_id: ctx.deviceId,
      })
      .eq('id', shiftId)
      .select()
      .single();

    if (error || !updatedShift) {
      throw new Error(`Failed to open shift: ${error?.message}`);
    }

    // Log event
    await this.logShiftEvent(ctx, 'shift_open', 'shift', shiftId, {});

    return ok(updatedShift);
  }

  /**
   * Get the current open shift for the bar
   */
  async getCurrentShift(
    ctx: ServiceContext
  ): Promise<Result<Shift | null, ShiftError>> {
    const { data: shift } = await this.supabase
      .from('shifts')
      .select('*')
      .eq('bar_id', ctx.barId)
      .eq('status', 'open')
      .order('opened_at', { ascending: false })
      .limit(1)
      .single();

    return ok(shift || null);
  }

  /**
   * Close an open shift
   * @implements ARCHITECTURE.md Section 3.2 - Shift State Machine
   *
   * Only owner/manager can close shifts
   * All sales must be confirmed or disputed
   */
  async closeShift(
    ctx: ServiceContext,
    input: CloseShiftInput
  ): Promise<Result<Shift, ShiftError | AuthError>> {
    // Check permissions
    if (!['owner', 'manager'].includes(ctx.userRole)) {
      return err(AuthErrors.INSUFFICIENT_PERMISSIONS('owner or manager', ctx.userRole));
    }

    const { shiftId, reason } = input;

    // Get shift
    const { data: shift } = await this.supabase
      .from('shifts')
      .select('*')
      .eq('id', shiftId)
      .eq('bar_id', ctx.barId)
      .single();

    if (!shift) {
      return err(new ShiftError('Shift not found', 'SHIFT_NOT_FOUND', { shift_id: shiftId }));
    }

    // Check valid transition
    if (shift.status !== 'open') {
      return err(ShiftErrors.SHIFT_NOT_OPEN(shiftId));
    }

    // Check for pending sales
    const { count: pendingCount } = await this.supabase
      .from('sales')
      .select('id', { count: 'exact', head: true })
      .eq('shift_id', shiftId)
      .in('status', ['pending', 'collected']);

    if (pendingCount && pendingCount > 0) {
      return err(ShiftErrors.CANNOT_CLOSE_WITH_PENDING(pendingCount));
    }

    // Update shift
    const { data: updatedShift, error } = await this.supabase
      .from('shifts')
      .update({
        status: 'closed',
        closed_at: new Date().toISOString(),
        closed_by: ctx.userId,
        closed_device_id: ctx.deviceId,
        close_reason: reason || null,
      })
      .eq('id', shiftId)
      .select()
      .single();

    if (error || !updatedShift) {
      throw new Error(`Failed to close shift: ${error?.message}`);
    }

    // Log event
    await this.logShiftEvent(ctx, 'shift_close', 'shift', shiftId, {
      reason,
    });

    return ok(updatedShift);
  }

  /**
   * Reconcile a closed shift
   * @implements ARCHITECTURE.md Section 3.2 - Shift State Machine
   */
  async reconcileShift(
    ctx: ServiceContext,
    input: ReconcileShiftInput
  ): Promise<Result<Shift, ShiftError | AuthError>> {
    // Check permissions
    if (!['owner', 'manager'].includes(ctx.userRole)) {
      return err(AuthErrors.INSUFFICIENT_PERMISSIONS('owner or manager', ctx.userRole));
    }

    const { shiftId, notes } = input;

    // Get shift
    const { data: shift } = await this.supabase
      .from('shifts')
      .select('*')
      .eq('id', shiftId)
      .eq('bar_id', ctx.barId)
      .single();

    if (!shift) {
      return err(new ShiftError('Shift not found', 'SHIFT_NOT_FOUND', { shift_id: shiftId }));
    }

    // Check valid transition
    if (shift.status !== 'closed') {
      return err(ShiftErrors.INVALID_STATUS_TRANSITION(shift.status, 'reconciled'));
    }

    // Update shift
    const { data: updatedShift, error } = await this.supabase
      .from('shifts')
      .update({
        status: 'reconciled',
        reconciled_at: new Date().toISOString(),
        reconciled_by: ctx.userId,
        reconciliation_notes: notes || null,
      })
      .eq('id', shiftId)
      .select()
      .single();

    if (error || !updatedShift) {
      throw new Error(`Failed to reconcile shift: ${error?.message}`);
    }

    // Log event
    await this.logShiftEvent(ctx, 'shift_reconcile', 'shift', shiftId, {
      notes,
    });

    return ok(updatedShift);
  }

  // ============================================
  // SHIFT ASSIGNMENTS
  // ============================================

  /**
   * Assign a user to a shift
   * @implements ARCHITECTURE.md Section 8.2 - Role Permissions
   *
   * Only owner/manager can assign users to shifts
   */
  async assignToShift(
    ctx: ServiceContext,
    input: AssignToShiftInput
  ): Promise<Result<ShiftAssignment, ShiftError | AuthError>> {
    // Check permissions
    if (!['owner', 'manager'].includes(ctx.userRole)) {
      return err(AuthErrors.INSUFFICIENT_PERMISSIONS('owner or manager', ctx.userRole));
    }

    const { shiftId, userId, role } = input;

    // Get shift and verify it's open or scheduled
    const { data: shift } = await this.supabase
      .from('shifts')
      .select('*')
      .eq('id', shiftId)
      .eq('bar_id', ctx.barId)
      .single();

    if (!shift) {
      return err(new ShiftError('Shift not found', 'SHIFT_NOT_FOUND', { shift_id: shiftId }));
    }

    if (!['scheduled', 'open'].includes(shift.status)) {
      return err(
        new ShiftError(
          'Can only assign to scheduled or open shifts',
          'SHIFT_CANNOT_ASSIGN',
          { shift_id: shiftId, status: shift.status }
        )
      );
    }

    // Verify user has the specified role in this bar
    const { data: userRole } = await this.supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', userId)
      .eq('bar_id', ctx.barId)
      .eq('is_active', true)
      .single();

    if (!userRole) {
      return err(
        new ShiftError('User has no active role in this bar', 'SHIFT_USER_NO_ROLE', {
          user_id: userId,
        })
      );
    }

    // Check if already assigned
    const { data: existingAssignment } = await this.supabase
      .from('shift_assignments')
      .select('id')
      .eq('shift_id', shiftId)
      .eq('user_id', userId)
      .single();

    if (existingAssignment) {
      return err(
        new ShiftError('User already assigned to this shift', 'SHIFT_ALREADY_ASSIGNED', {
          user_id: userId,
          shift_id: shiftId,
        })
      );
    }

    // Create assignment
    const { data: assignment, error } = await this.supabase
      .from('shift_assignments')
      .insert({
        shift_id: shiftId,
        user_id: userId,
        role,
        assigned_by: ctx.userId,
        assigned_at: new Date().toISOString(),
        device_id: ctx.deviceId,
      })
      .select()
      .single();

    if (error || !assignment) {
      throw new Error(`Failed to assign user to shift: ${error?.message}`);
    }

    // Log event
    await this.logShiftEvent(ctx, 'shift_create', 'shift_assignment', assignment.id, {
      user_id: userId,
      role,
      shift_id: shiftId,
    });

    return ok(assignment);
  }

  /**
   * Get all assignments for a shift
   */
  async getShiftAssignments(
    ctx: ServiceContext,
    shiftId: string
  ): Promise<Result<ShiftAssignment[], ShiftError>> {
    const { data: assignments } = await this.supabase
      .from('shift_assignments')
      .select('*, user:users(*)')
      .eq('shift_id', shiftId);

    return ok(assignments || []);
  }

  // ============================================
  // PRIVATE HELPERS
  // ============================================

  private async logShiftEvent(
    ctx: ServiceContext,
    eventType: string,
    entityType: string,
    entityId: string,
    payload: Record<string, unknown>
  ): Promise<void> {
    await this.supabase.from('events').insert({
      bar_id: ctx.barId,
      device_id: ctx.deviceId,
      user_id: ctx.userId,
      user_role: ctx.userRole,
      shift_id: ctx.shiftId || null,
      event_type: eventType,
      entity_type: entityType,
      entity_id: entityId,
      payload,
      client_timestamp: ctx.clientTimestamp || new Date().toISOString(),
    });
  }
}
