/**
 * Database Types - Generated from ARCHITECTURE.md Section 2
 * @implements ARCHITECTURE.md Section 2.2 - Enums
 * @implements ARCHITECTURE.md Section 2.3 - Core Tables
 */

// ============================================
// ENUMS
// ============================================

export type UserRole = 'owner' | 'manager' | 'bartender' | 'server' | 'kitchen';

export type ShiftStatus = 'scheduled' | 'open' | 'closing' | 'closed' | 'reconciled';

export type DayStatus = 'open' | 'closing' | 'closed' | 'reconciled';

export type MovementType =
  | 'delivery'
  | 'allocation'
  | 'assignment'
  | 'return'
  | 'return_to_stock'
  | 'adjustment'
  | 'damage'
  | 'loss';

export type SaleStatus = 'pending' | 'collected' | 'confirmed' | 'reversed' | 'disputed';

export type PaymentMethod = 'cash' | 'momo' | 'credit';

export type SyncStatus = 'local' | 'pending' | 'acknowledged' | 'committed' | 'conflict';

export type EventType =
  | 'login' | 'logout' | 'pin_change' | 'device_lock' | 'device_unlock'
  | 'shift_create' | 'shift_open' | 'shift_close' | 'shift_reconcile'
  | 'day_open' | 'day_close' | 'day_reconcile'
  | 'stock_delivery' | 'stock_allocate' | 'stock_assign' | 'stock_return'
  | 'stock_adjust' | 'stock_damage' | 'stock_loss'
  | 'sale_create' | 'sale_collect' | 'sale_confirm' | 'sale_reverse'
  | 'payment_record' | 'payment_confirm' | 'payment_dispute'
  | 'credit_issue' | 'credit_collect'
  | 'user_create' | 'user_suspend' | 'user_reinstate' | 'role_assign'
  | 'dispute_open' | 'dispute_resolve';

export type DisputeStatus = 'open' | 'under_review' | 'resolved' | 'escalated';

// ============================================
// CORE ENTITIES
// ============================================

export interface Bar {
  id: string;
  name: string;
  tin?: string;
  location?: string;
  phone?: string;
  owner_id: string;
  credit_limit_rwf: number;
  currency: string;
  timezone: string;
  subscription_status: string;
  subscription_expires_at?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface User {
  id: string;
  phone: string;
  full_name: string;
  national_id?: string; // Rwanda National ID (16 digits)
  profile_image_url?: string;
  is_active: boolean;
  suspended_at?: string;
  suspended_reason?: string;
  suspended_by?: string;
  created_at: string;
  updated_at: string;
}

export interface Device {
  id: string;
  bar_id: string;
  name: string;
  fingerprint: string;
  is_active: boolean;
  is_locked: boolean;
  locked_at?: string;
  locked_by?: string;
  last_seen_at: string;
  last_user_id?: string;
  created_at: string;
  registered_at: string;
}

export interface Product {
  id: string;
  bar_id: string;
  name: string;
  category: 'drinks' | 'barbeque' | 'food' | 'other';
  unit: string;
  selling_price_rwf: number;
  cost_price_rwf?: number;
  is_active: boolean;
  is_saleable: boolean;
  created_at: string;
  updated_at: string;
}

export interface UserRoleAssignment {
  id: string;
  user_id: string;
  bar_id: string;
  role: UserRole;
  assigned_device_id?: string;
  is_active: boolean;
  assigned_by: string;
  assigned_at: string;
  created_at: string;
}

// ============================================
// OPERATIONAL ENTITIES
// ============================================

export interface Day {
  id: string;
  bar_id: string;
  business_date: string;
  status: DayStatus;
  opened_at: string;
  opened_by: string;
  opened_device_id: string;
  closed_at?: string;
  closed_by?: string;
  closed_device_id?: string;
  reconciled_at?: string;
  reconciled_by?: string;
  reconciliation_notes?: string;
  created_at: string;
}

export interface Shift {
  id: string;
  bar_id: string;
  day_id: string;
  name?: string;
  scheduled_start?: string;
  scheduled_end?: string;
  status: ShiftStatus;
  opened_at?: string;
  opened_by?: string;
  opened_device_id?: string;
  closed_at?: string;
  closed_by?: string;
  closed_device_id?: string;
  close_reason?: string;
  reconciled_at?: string;
  reconciled_by?: string;
  reconciliation_notes?: string;
  created_at: string;
}

export interface ShiftAssignment {
  id: string;
  shift_id: string;
  user_id: string;
  role: UserRole;
  assigned_by: string;
  assigned_at: string;
  device_id: string;
}

export interface StockBatch {
  id: string;
  bar_id: string;
  product_id: string;
  quantity: number;
  cost_per_unit_rwf?: number;
  supplier_name?: string;
  invoice_reference?: string;
  received_by: string;
  received_at: string;
  device_id: string;
  notes?: string;
  sync_status: SyncStatus;
  client_id?: string;
  created_at: string;
}

export interface StockMovement {
  id: string;
  bar_id: string;
  shift_id?: string;
  product_id: string;
  quantity: number;
  movement_type: MovementType;
  from_user_id?: string;
  to_user_id?: string;
  reference_movement_id?: string;
  performed_by: string;
  performed_at: string;
  device_id: string;
  reason?: string;
  sync_status: SyncStatus;
  client_id?: string;
  client_timestamp?: string;
  created_at: string;
}

export interface Sale {
  id: string;
  bar_id: string;
  shift_id: string;
  product_id: string;
  quantity: number;
  unit_price_rwf: number;
  total_price_rwf: number;
  assigned_to_server_id: string;
  assigned_by_bartender_id: string;
  assigned_at: string;
  status: SaleStatus;
  collected_at?: string;
  collected_amount_rwf?: number;
  payment_method?: PaymentMethod;
  confirmed_at?: string;
  confirmed_by?: string;
  confirmed_device_id?: string;
  reversed_at?: string;
  reversed_by?: string;
  reversal_reason?: string;
  reversal_device_id?: string;
  created_device_id: string;
  sync_status: SyncStatus;
  client_id?: string;
  client_timestamp?: string;
  created_at: string;
}

export interface Credit {
  id: string;
  bar_id: string;
  shift_id: string;
  amount_rwf: number;
  customer_description?: string;
  customer_phone?: string;
  is_collected: boolean;
  collected_at?: string;
  collected_by?: string;
  collected_device_id?: string;
  issued_by: string;
  issued_at: string;
  device_id: string;
  notes?: string;
  sync_status: SyncStatus;
  client_id?: string;
  created_at: string;
}

export interface Dispute {
  id: string;
  bar_id: string;
  shift_id?: string;
  entity_type: 'sale' | 'payment' | 'stock' | 'missing_money' | 'other';
  entity_id?: string;
  amount_rwf?: number;
  status: DisputeStatus;
  description: string;
  responsible_user_id?: string;
  resolution?: string;
  resolved_at?: string;
  resolved_by?: string;
  opened_by: string;
  opened_at: string;
  device_id: string;
  sync_status: SyncStatus;
  client_id?: string;
  created_at: string;
}

export interface Event {
  id: string;
  bar_id: string;
  device_id: string;
  user_id: string;
  user_role: UserRole;
  shift_id?: string;
  event_type: EventType;
  entity_type?: string;
  entity_id?: string;
  payload: Record<string, unknown>;
  reason?: string;
  client_timestamp: string;
  server_timestamp: string;
  sync_status: SyncStatus;
  client_event_id?: string;
  created_at: string;
}

export interface DeviceSession {
  id: string;
  device_id: string;
  bar_id: string;
  user_id: string;
  started_at: string;
  ended_at?: string;
  end_reason?: 'logout' | 'lock' | 'timeout' | 'forced';
  actions_count: number;
  created_at: string;
}

// ============================================
// AUTH SCHEMA
// ============================================

export interface Credentials {
  id: string;
  user_id: string;
  pin_hash: string;
  otp_code?: string;
  otp_expires_at?: string;
  otp_attempts: number;
  failed_attempts: number;
  locked_until?: string;
  last_login_at?: string;
  last_login_device_id?: string;
  created_at: string;
  updated_at: string;
}

export interface Session {
  id: string;
  user_id: string;
  device_id: string;
  bar_id: string;
  token_hash: string;
  expires_at: string;
  is_active: boolean;
  created_at: string;
  last_activity_at: string;
}

// ============================================
// SUMMARIES
// ============================================

export interface DailySummary {
  id: string;
  bar_id: string;
  day_id: string;
  business_date: string;
  total_sales_count: number;
  total_sales_rwf: number;
  cash_sales_rwf: number;
  momo_sales_rwf: number;
  credit_sales_rwf: number;
  stock_received_value_rwf: number;
  stock_damaged_value_rwf: number;
  stock_lost_value_rwf: number;
  disputes_count: number;
  missing_money_rwf: number;
  gross_profit_rwf: number;
  generated_at: string;
  generated_by?: string;
}

export interface ShiftSummary {
  id: string;
  bar_id: string;
  shift_id: string;
  total_sales_count: number;
  total_sales_rwf: number;
  pending_sales_count: number;
  pending_sales_rwf: number;
  confirmed_sales_count: number;
  confirmed_sales_rwf: number;
  reversed_sales_count: number;
  reversed_sales_rwf: number;
  stock_allocated_count: number;
  stock_returned_count: number;
  stock_damaged_count: number;
  disputes_count: number;
  generated_at: string;
}

export interface ServerObligation {
  bar_id: string;
  shift_id: string;
  server_id: string;
  server_name: string;
  pending_count: number;
  pending_amount_rwf: number;
  collected_count: number;
  collected_amount_rwf: number;
  confirmed_count: number;
  confirmed_amount_rwf: number;
  reversed_count: number;
  disputed_count: number;
  owes_amount_rwf: number;
}
