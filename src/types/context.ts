/**
 * Service Context Types
 * @implements ARCHITECTURE.md - Full traceability requirement
 *
 * Every operation must track: user_id, role, device_id, bar_id, timestamp
 */

import type { UserRole } from './database';

/**
 * Context passed to all domain operations
 * Contains everything needed for audit trail
 */
export interface ServiceContext {
  /** Current authenticated user ID */
  userId: string;

  /** User's role in the current bar */
  userRole: UserRole;

  /** Current bar ID */
  barId: string;

  /** Device performing the operation */
  deviceId: string;

  /** Current shift ID (if applicable) */
  shiftId?: string;

  /** Client-side timestamp for offline operations */
  clientTimestamp?: string;

  /** Client-generated ID for offline dedup */
  clientId?: string;
}

/**
 * Minimal context for unauthenticated operations (login, device registration)
 */
export interface UnauthenticatedContext {
  /** Device fingerprint */
  deviceFingerprint: string;

  /** Client timestamp */
  clientTimestamp: string;
}

/**
 * Context for system operations (cron jobs, migrations)
 */
export interface SystemContext {
  /** System identifier */
  systemId: 'scheduler' | 'migration' | 'admin';

  /** Reason for system operation */
  reason: string;
}

/**
 * Result wrapper for operations that can fail
 */
export type Result<T, E = Error> =
  | { success: true; data: T }
  | { success: false; error: E };

/**
 * Create a success result
 */
export function ok<T>(data: T): Result<T, never> {
  return { success: true, data };
}

/**
 * Create a failure result
 */
export function err<E>(error: E): Result<never, E> {
  return { success: false, error };
}

/**
 * Pagination parameters
 */
export interface PaginationParams {
  limit?: number;
  offset?: number;
}

/**
 * Paginated result
 */
export interface PaginatedResult<T> {
  data: T[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}
