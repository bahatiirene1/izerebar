/**
 * Sales Service
 * @implements ARCHITECTURE.md Section 3.3 - Sale State Machine
 *
 * Handles the sale lifecycle:
 * - Create: Bartender creates sale, assigns to server
 * - Collect: Server collects payment from customer
 * - Confirm: Bartender/Manager confirms payment received
 * - Reverse: Undo a sale (with reason required)
 */

import { SupabaseClient } from '@supabase/supabase-js';
import {
  Sale,
  SaleStatus,
  PaymentMethod,
  Product,
  UserRole,
} from '../types/database';
import { SaleError, SaleErrors, StockErrors, AuthError, AuthErrors } from '../types/errors';
import { ServiceContext, Result, ok, err, PaginatedResult } from '../types/context';

// ============================================
// TYPES
// ============================================

export interface CreateSaleInput {
  productId: string;
  quantity: number;
  assignToServerId: string;
  unitPrice?: number; // Override product price if needed
}

export interface CreateSaleResult {
  sale: Sale;
  stockDeducted: boolean;
}

export interface CollectSaleInput {
  saleId: string;
  amountCollected: number;
  paymentMethod: PaymentMethod;
}

export interface ConfirmSaleInput {
  saleId: string;
}

export interface ReverseSaleInput {
  saleId: string;
  reason: string; // Required
}

export interface SaleWithDetails extends Sale {
  product?: Product;
  server?: { id: string; full_name: string };
  bartender?: { id: string; full_name: string };
}

export interface ServerObligationSummary {
  serverId: string;
  serverName: string;
  pendingCount: number;
  pendingAmount: number;
  collectedCount: number;
  collectedAmount: number;
  confirmedCount: number;
  confirmedAmount: number;
  owesAmount: number;
}

// ============================================
// CONSTANTS
// ============================================

const ALLOWED_SALE_TRANSITIONS: Record<SaleStatus, SaleStatus[]> = {
  pending: ['collected', 'reversed'],
  collected: ['confirmed', 'reversed', 'disputed'],
  confirmed: [], // Cannot transition from confirmed
  reversed: [], // Cannot transition from reversed
  disputed: ['confirmed', 'reversed'],
};

// ============================================
// SALES SERVICE
// ============================================

export class SalesService {
  constructor(private supabase: SupabaseClient) {}

  // ============================================
  // SALE CREATION
  // ============================================

  /**
   * Create a new sale
   * @implements ARCHITECTURE.md Section 3.3 - Sale State Machine
   *
   * Only bartender can create sales
   * Automatically deducts from bartender's stock
   */
  async createSale(
    ctx: ServiceContext,
    input: CreateSaleInput
  ): Promise<Result<CreateSaleResult, SaleError | AuthError>> {
    // Check permissions
    if (ctx.userRole !== 'bartender') {
      return err(AuthErrors.INSUFFICIENT_PERMISSIONS('bartender', ctx.userRole));
    }

    // Must have an active shift
    if (!ctx.shiftId) {
      return err(
        new SaleError('No active shift. Open a shift first.', 'SALE_NO_ACTIVE_SHIFT')
      );
    }

    const { productId, quantity, assignToServerId, unitPrice } = input;

    // Validate quantity
    if (quantity <= 0) {
      return err(
        new SaleError('Quantity must be positive', 'SALE_INVALID_QUANTITY', {
          quantity,
        })
      );
    }

    // Get product
    const { data: product } = await this.supabase
      .from('products')
      .select('*')
      .eq('id', productId)
      .eq('bar_id', ctx.barId)
      .eq('is_active', true)
      .eq('is_saleable', true)
      .single();

    if (!product) {
      return err(
        new SaleError('Product not found or not saleable', 'SALE_PRODUCT_NOT_FOUND', {
          product_id: productId,
        })
      );
    }

    // Verify server exists and is active
    const { data: serverRole } = await this.supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', assignToServerId)
      .eq('bar_id', ctx.barId)
      .eq('is_active', true)
      .single();

    if (!serverRole || serverRole.role !== 'server') {
      return err(
        new SaleError(
          'Target user must be an active server',
          'SALE_INVALID_SERVER',
          { user_id: assignToServerId }
        )
      );
    }

    // Check bartender has enough stock
    const { data: stockBalance } = await this.supabase.rpc('calculate_user_stock', {
      p_bar_id: ctx.barId,
      p_user_id: ctx.userId,
      p_product_id: productId,
    });

    if (!stockBalance || stockBalance < quantity) {
      return err(
        StockErrors.INSUFFICIENT_STOCK(productId, stockBalance || 0, quantity)
      );
    }

    // Calculate prices
    const finalUnitPrice = unitPrice || product.selling_price_rwf;
    const totalPrice = finalUnitPrice * quantity;

    // Create sale
    const { data: sale, error: saleError } = await this.supabase
      .from('sales')
      .insert({
        bar_id: ctx.barId,
        shift_id: ctx.shiftId,
        product_id: productId,
        quantity,
        unit_price_rwf: finalUnitPrice,
        total_price_rwf: totalPrice,
        assigned_to_server_id: assignToServerId,
        assigned_by_bartender_id: ctx.userId,
        assigned_at: new Date().toISOString(),
        status: 'pending',
        created_device_id: ctx.deviceId,
        sync_status: 'local',
        client_id: ctx.clientId || null,
        client_timestamp: ctx.clientTimestamp || new Date().toISOString(),
      })
      .select()
      .single();

    if (saleError || !sale) {
      throw new Error(`Failed to create sale: ${saleError?.message}`);
    }

    // Deduct from bartender's stock (create assignment movement to server)
    const { error: stockError } = await this.supabase
      .from('stock_movements')
      .insert({
        bar_id: ctx.barId,
        shift_id: ctx.shiftId,
        product_id: productId,
        quantity,
        movement_type: 'assignment',
        from_user_id: ctx.userId,
        to_user_id: assignToServerId,
        performed_by: ctx.userId,
        performed_at: new Date().toISOString(),
        device_id: ctx.deviceId,
        reason: `Sale ${sale.id}`,
        sync_status: 'local',
        client_id: ctx.clientId || null,
      });

    const stockDeducted = !stockError;

    // Log event
    await this.logSaleEvent(ctx, 'sale_create', sale.id, {
      product_id: productId,
      quantity,
      unit_price: finalUnitPrice,
      total_price: totalPrice,
      server_id: assignToServerId,
    });

    return ok({ sale, stockDeducted });
  }

  // ============================================
  // SALE COLLECTION
  // ============================================

  /**
   * Record payment collection by server
   * @implements ARCHITECTURE.md Section 3.3 - Sale State Machine
   *
   * Only server assigned to the sale can collect
   */
  async collectSale(
    ctx: ServiceContext,
    input: CollectSaleInput
  ): Promise<Result<Sale, SaleError | AuthError>> {
    // Only servers can collect
    if (ctx.userRole !== 'server') {
      return err(AuthErrors.INSUFFICIENT_PERMISSIONS('server', ctx.userRole));
    }

    const { saleId, amountCollected, paymentMethod } = input;

    // Get sale
    const { data: sale } = await this.supabase
      .from('sales')
      .select('*')
      .eq('id', saleId)
      .eq('bar_id', ctx.barId)
      .single();

    if (!sale) {
      return err(SaleErrors.SALE_NOT_FOUND(saleId));
    }

    // Check server is assigned to this sale
    if (sale.assigned_to_server_id !== ctx.userId) {
      return err(SaleErrors.SERVER_NOT_ASSIGNED(ctx.userId, saleId));
    }

    // Check valid transition
    if (sale.status !== 'pending') {
      return err(SaleErrors.CANNOT_COLLECT_NON_PENDING(saleId, sale.status));
    }

    // Update sale
    const { data: updatedSale, error } = await this.supabase
      .from('sales')
      .update({
        status: 'collected',
        collected_at: new Date().toISOString(),
        collected_amount_rwf: amountCollected,
        payment_method: paymentMethod,
      })
      .eq('id', saleId)
      .select()
      .single();

    if (error || !updatedSale) {
      throw new Error(`Failed to collect sale: ${error?.message}`);
    }

    // Log event
    await this.logSaleEvent(ctx, 'sale_collect', saleId, {
      amount_collected: amountCollected,
      payment_method: paymentMethod,
    });

    return ok(updatedSale);
  }

  // ============================================
  // SALE CONFIRMATION
  // ============================================

  /**
   * Confirm payment received
   * @implements ARCHITECTURE.md Section 3.3 - Sale State Machine
   *
   * Bartender or manager can confirm
   */
  async confirmSale(
    ctx: ServiceContext,
    input: ConfirmSaleInput
  ): Promise<Result<Sale, SaleError | AuthError>> {
    // Check permissions
    if (!['bartender', 'manager', 'owner'].includes(ctx.userRole)) {
      return err(
        AuthErrors.INSUFFICIENT_PERMISSIONS('bartender, manager, or owner', ctx.userRole)
      );
    }

    const { saleId } = input;

    // Get sale
    const { data: sale } = await this.supabase
      .from('sales')
      .select('*')
      .eq('id', saleId)
      .eq('bar_id', ctx.barId)
      .single();

    if (!sale) {
      return err(SaleErrors.SALE_NOT_FOUND(saleId));
    }

    // Check valid transition
    if (sale.status !== 'collected' && sale.status !== 'disputed') {
      return err(SaleErrors.CANNOT_CONFIRM_NON_COLLECTED(saleId, sale.status));
    }

    // Update sale
    const { data: updatedSale, error } = await this.supabase
      .from('sales')
      .update({
        status: 'confirmed',
        confirmed_at: new Date().toISOString(),
        confirmed_by: ctx.userId,
        confirmed_device_id: ctx.deviceId,
      })
      .eq('id', saleId)
      .select()
      .single();

    if (error || !updatedSale) {
      throw new Error(`Failed to confirm sale: ${error?.message}`);
    }

    // Log event
    await this.logSaleEvent(ctx, 'sale_confirm', saleId, {
      previous_status: sale.status,
    });

    return ok(updatedSale);
  }

  // ============================================
  // SALE REVERSAL
  // ============================================

  /**
   * Reverse a sale
   * @implements ARCHITECTURE.md Section 3.3 - Sale State Machine
   *
   * Can only reverse pending or collected sales
   * Reason is required
   */
  async reverseSale(
    ctx: ServiceContext,
    input: ReverseSaleInput
  ): Promise<Result<Sale, SaleError | AuthError>> {
    // Check permissions
    if (!['bartender', 'manager', 'owner'].includes(ctx.userRole)) {
      return err(
        AuthErrors.INSUFFICIENT_PERMISSIONS('bartender, manager, or owner', ctx.userRole)
      );
    }

    const { saleId, reason } = input;

    // Reason is required
    if (!reason || reason.trim().length < 3) {
      return err(SaleErrors.REVERSAL_REASON_REQUIRED());
    }

    // Get sale
    const { data: sale } = await this.supabase
      .from('sales')
      .select('*')
      .eq('id', saleId)
      .eq('bar_id', ctx.barId)
      .single();

    if (!sale) {
      return err(SaleErrors.SALE_NOT_FOUND(saleId));
    }

    // Check valid transition
    if (!['pending', 'collected', 'disputed'].includes(sale.status)) {
      return err(SaleErrors.CANNOT_REVERSE_CONFIRMED(saleId));
    }

    // Update sale
    const { data: updatedSale, error } = await this.supabase
      .from('sales')
      .update({
        status: 'reversed',
        reversed_at: new Date().toISOString(),
        reversed_by: ctx.userId,
        reversal_reason: reason.trim(),
        reversal_device_id: ctx.deviceId,
      })
      .eq('id', saleId)
      .select()
      .single();

    if (error || !updatedSale) {
      throw new Error(`Failed to reverse sale: ${error?.message}`);
    }

    // Return stock to bartender (reverse the assignment)
    await this.supabase.from('stock_movements').insert({
      bar_id: ctx.barId,
      shift_id: ctx.shiftId || sale.shift_id,
      product_id: sale.product_id,
      quantity: sale.quantity,
      movement_type: 'return',
      from_user_id: sale.assigned_to_server_id,
      to_user_id: sale.assigned_by_bartender_id,
      reference_movement_id: null,
      performed_by: ctx.userId,
      performed_at: new Date().toISOString(),
      device_id: ctx.deviceId,
      reason: `Reversal of sale ${saleId}: ${reason}`,
      sync_status: 'local',
    });

    // Log event
    await this.logSaleEvent(ctx, 'sale_reverse', saleId, {
      reason,
      previous_status: sale.status,
      amount: sale.total_price_rwf,
    });

    return ok(updatedSale);
  }

  // ============================================
  // SALE QUERIES
  // ============================================

  /**
   * Get sales for current shift
   */
  async getShiftSales(
    ctx: ServiceContext,
    options?: {
      status?: SaleStatus;
      serverId?: string;
      limit?: number;
      offset?: number;
    }
  ): Promise<Result<PaginatedResult<SaleWithDetails>, SaleError>> {
    if (!ctx.shiftId) {
      return err(
        new SaleError('No active shift', 'SALE_NO_ACTIVE_SHIFT')
      );
    }

    let query = this.supabase
      .from('sales')
      .select('*, product:products(*), server:users!assigned_to_server_id(*)', {
        count: 'exact',
      })
      .eq('shift_id', ctx.shiftId)
      .eq('bar_id', ctx.barId);

    if (options?.status) {
      query = query.eq('status', options.status);
    }

    if (options?.serverId) {
      query = query.eq('assigned_to_server_id', options.serverId);
    }

    const limit = options?.limit || 50;
    const offset = options?.offset || 0;

    query = query
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    const { data, count, error } = await query;

    if (error) {
      throw new Error(`Failed to fetch sales: ${error.message}`);
    }

    return ok({
      data: (data as SaleWithDetails[]) || [],
      total: count || 0,
      limit,
      offset,
      hasMore: (count || 0) > offset + limit,
    });
  }

  /**
   * Get sales assigned to current user (for servers)
   */
  async getMySales(
    ctx: ServiceContext,
    options?: {
      status?: SaleStatus;
      limit?: number;
      offset?: number;
    }
  ): Promise<Result<PaginatedResult<SaleWithDetails>, SaleError>> {
    let query = this.supabase
      .from('sales')
      .select('*, product:products(*)', { count: 'exact' })
      .eq('assigned_to_server_id', ctx.userId)
      .eq('bar_id', ctx.barId);

    if (ctx.shiftId) {
      query = query.eq('shift_id', ctx.shiftId);
    }

    if (options?.status) {
      query = query.eq('status', options.status);
    }

    const limit = options?.limit || 50;
    const offset = options?.offset || 0;

    query = query
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    const { data, count, error } = await query;

    if (error) {
      throw new Error(`Failed to fetch sales: ${error.message}`);
    }

    return ok({
      data: (data as SaleWithDetails[]) || [],
      total: count || 0,
      limit,
      offset,
      hasMore: (count || 0) > offset + limit,
    });
  }

  /**
   * Get server obligation summary
   */
  async getServerObligations(
    ctx: ServiceContext,
    shiftId?: string
  ): Promise<Result<ServerObligationSummary[], SaleError>> {
    const targetShiftId = shiftId || ctx.shiftId;

    if (!targetShiftId) {
      return err(new SaleError('No shift specified', 'SALE_NO_SHIFT'));
    }

    // Use database view or aggregate query
    const { data } = await this.supabase
      .from('server_obligations')
      .select('*')
      .eq('shift_id', targetShiftId)
      .eq('bar_id', ctx.barId);

    if (!data) {
      return ok([]);
    }

    return ok(
      data.map((row) => ({
        serverId: row.server_id,
        serverName: row.server_name,
        pendingCount: row.pending_count || 0,
        pendingAmount: row.pending_amount_rwf || 0,
        collectedCount: row.collected_count || 0,
        collectedAmount: row.collected_amount_rwf || 0,
        confirmedCount: row.confirmed_count || 0,
        confirmedAmount: row.confirmed_amount_rwf || 0,
        owesAmount: row.owes_amount_rwf || 0,
      }))
    );
  }

  /**
   * Get single sale with details
   */
  async getSale(
    ctx: ServiceContext,
    saleId: string
  ): Promise<Result<SaleWithDetails | null, SaleError>> {
    const { data: sale } = await this.supabase
      .from('sales')
      .select(
        '*, product:products(*), server:users!assigned_to_server_id(*), bartender:users!assigned_by_bartender_id(*)'
      )
      .eq('id', saleId)
      .eq('bar_id', ctx.barId)
      .single();

    return ok(sale as SaleWithDetails | null);
  }

  // ============================================
  // PRIVATE HELPERS
  // ============================================

  private async logSaleEvent(
    ctx: ServiceContext,
    eventType: string,
    saleId: string,
    payload: Record<string, unknown>
  ): Promise<void> {
    await this.supabase.from('events').insert({
      bar_id: ctx.barId,
      device_id: ctx.deviceId,
      user_id: ctx.userId,
      user_role: ctx.userRole,
      shift_id: ctx.shiftId || null,
      event_type: eventType,
      entity_type: 'sale',
      entity_id: saleId,
      payload,
      client_timestamp: ctx.clientTimestamp || new Date().toISOString(),
    });
  }
}
