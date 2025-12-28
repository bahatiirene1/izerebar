/**
 * Stock Service
 * @implements ARCHITECTURE.md Section 3.4 - Stock Custody Chain
 *
 * Handles the custody chain:
 * - Delivery: Supplier → Stock (Manager receives)
 * - Allocation: Stock → Bartender (Manager allocates)
 * - Assignment: Bartender → Server
 * - Return: Server → Bartender (unconsumed)
 * - Return to Stock: Bartender → Stock
 * - Adjustment/Damage/Loss: With reason required
 */

import { SupabaseClient } from '@supabase/supabase-js';
import {
  Product,
  StockBatch,
  StockMovement,
  MovementType,
  UserRole,
} from '../types/database';
import { StockError, StockErrors, AuthError, AuthErrors } from '../types/errors';
import { ServiceContext, Result, ok, err } from '../types/context';

// ============================================
// TYPES
// ============================================

export interface ReceiveDeliveryInput {
  productId: string;
  quantity: number;
  costPerUnit?: number;
  supplierName?: string;
  invoiceReference?: string;
  notes?: string;
}

export interface AllocateStockInput {
  productId: string;
  quantity: number;
  toBartenderId: string;
  notes?: string;
}

export interface AssignStockInput {
  productId: string;
  quantity: number;
  toServerId: string;
}

export interface ReturnStockInput {
  productId: string;
  quantity: number;
  fromUserId: string;
  reason?: string;
}

export interface AdjustStockInput {
  productId: string;
  quantity: number; // Positive for addition, negative for removal
  reason: string; // Required for adjustments
  movementType: 'adjustment' | 'damage' | 'loss';
}

export interface StockBalance {
  productId: string;
  productName: string;
  totalInStock: number;
  allocatedToBartenders: number;
  assignedToServers: number;
  available: number;
}

export interface UserStockBalance {
  userId: string;
  userName: string;
  role: UserRole;
  products: {
    productId: string;
    productName: string;
    quantity: number;
  }[];
}

// ============================================
// STOCK SERVICE
// ============================================

export class StockService {
  constructor(private supabase: SupabaseClient) {}

  // ============================================
  // STOCK RECEIPTS (DELIVERY)
  // ============================================

  /**
   * Receive stock delivery
   * @implements ARCHITECTURE.md Section 3.4 - Delivery movement
   *
   * Only owner/manager can receive deliveries
   */
  async receiveDelivery(
    ctx: ServiceContext,
    input: ReceiveDeliveryInput
  ): Promise<Result<StockBatch, StockError | AuthError>> {
    // Check permissions
    if (!['owner', 'manager'].includes(ctx.userRole)) {
      return err(AuthErrors.INSUFFICIENT_PERMISSIONS('owner or manager', ctx.userRole));
    }

    const { productId, quantity, costPerUnit, supplierName, invoiceReference, notes } =
      input;

    // Validate quantity
    if (quantity <= 0) {
      return err(
        new StockError('Quantity must be positive', 'STOCK_INVALID_QUANTITY', {
          quantity,
        })
      );
    }

    // Verify product exists and is active
    const { data: product } = await this.supabase
      .from('products')
      .select('*')
      .eq('id', productId)
      .eq('bar_id', ctx.barId)
      .eq('is_active', true)
      .single();

    if (!product) {
      return err(StockErrors.PRODUCT_NOT_FOUND(productId));
    }

    // Create stock batch
    const { data: batch, error: batchError } = await this.supabase
      .from('stock_batches')
      .insert({
        bar_id: ctx.barId,
        product_id: productId,
        quantity,
        cost_per_unit_rwf: costPerUnit || null,
        supplier_name: supplierName || null,
        invoice_reference: invoiceReference || null,
        received_by: ctx.userId,
        received_at: new Date().toISOString(),
        device_id: ctx.deviceId,
        notes: notes || null,
        sync_status: 'local',
        client_id: ctx.clientId || null,
      })
      .select()
      .single();

    if (batchError || !batch) {
      throw new Error(`Failed to create stock batch: ${batchError?.message}`);
    }

    // Create stock movement for the delivery
    const { error: movementError } = await this.supabase
      .from('stock_movements')
      .insert({
        bar_id: ctx.barId,
        shift_id: ctx.shiftId || null,
        product_id: productId,
        quantity,
        movement_type: 'delivery',
        from_user_id: null, // External supplier
        to_user_id: null, // Goes to stock (null = bar stock)
        performed_by: ctx.userId,
        performed_at: new Date().toISOString(),
        device_id: ctx.deviceId,
        reason: notes || 'Stock delivery',
        sync_status: 'local',
        client_id: ctx.clientId || null,
        client_timestamp: ctx.clientTimestamp || new Date().toISOString(),
      });

    if (movementError) {
      throw new Error(`Failed to create stock movement: ${movementError.message}`);
    }

    // Log event
    await this.logStockEvent(ctx, 'stock_delivery', 'stock_batch', batch.id, {
      product_id: productId,
      quantity,
      supplier: supplierName,
    });

    return ok(batch);
  }

  // ============================================
  // STOCK ALLOCATION (Manager → Bartender)
  // ============================================

  /**
   * Allocate stock from bar inventory to a bartender
   * @implements ARCHITECTURE.md Section 3.4 - Allocation movement
   *
   * Only owner/manager can allocate stock
   */
  async allocateStock(
    ctx: ServiceContext,
    input: AllocateStockInput
  ): Promise<Result<StockMovement, StockError | AuthError>> {
    // Check permissions
    if (!['owner', 'manager'].includes(ctx.userRole)) {
      return err(AuthErrors.INSUFFICIENT_PERMISSIONS('owner or manager', ctx.userRole));
    }

    const { productId, quantity, toBartenderId, notes } = input;

    // Validate quantity
    if (quantity <= 0) {
      return err(
        new StockError('Quantity must be positive', 'STOCK_INVALID_QUANTITY', {
          quantity,
        })
      );
    }

    // Verify product
    const { data: product } = await this.supabase
      .from('products')
      .select('*')
      .eq('id', productId)
      .eq('bar_id', ctx.barId)
      .eq('is_active', true)
      .single();

    if (!product) {
      return err(StockErrors.PRODUCT_NOT_FOUND(productId));
    }

    // Verify target user is a bartender in this bar
    const { data: bartenderRole } = await this.supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', toBartenderId)
      .eq('bar_id', ctx.barId)
      .eq('is_active', true)
      .single();

    if (!bartenderRole || bartenderRole.role !== 'bartender') {
      return err(
        new StockError(
          'Target user must be an active bartender',
          'STOCK_INVALID_TARGET_ROLE',
          { user_id: toBartenderId, expected_role: 'bartender' }
        )
      );
    }

    // Check available stock
    const availableStock = await this.getAvailableStock(ctx.barId, productId);
    if (availableStock < quantity) {
      return err(StockErrors.INSUFFICIENT_STOCK(productId, availableStock, quantity));
    }

    // Create stock movement
    const { data: movement, error } = await this.supabase
      .from('stock_movements')
      .insert({
        bar_id: ctx.barId,
        shift_id: ctx.shiftId || null,
        product_id: productId,
        quantity,
        movement_type: 'allocation',
        from_user_id: null, // From bar stock
        to_user_id: toBartenderId,
        performed_by: ctx.userId,
        performed_at: new Date().toISOString(),
        device_id: ctx.deviceId,
        reason: notes || null,
        sync_status: 'local',
        client_id: ctx.clientId || null,
        client_timestamp: ctx.clientTimestamp || new Date().toISOString(),
      })
      .select()
      .single();

    if (error || !movement) {
      throw new Error(`Failed to allocate stock: ${error?.message}`);
    }

    // Log event
    await this.logStockEvent(ctx, 'stock_allocate', 'stock_movement', movement.id, {
      product_id: productId,
      quantity,
      to_bartender_id: toBartenderId,
    });

    return ok(movement);
  }

  // ============================================
  // STOCK ASSIGNMENT (Bartender → Server)
  // ============================================

  /**
   * Assign stock from bartender to server
   * @implements ARCHITECTURE.md Section 3.4 - Assignment movement
   *
   * Only bartender can assign their stock to servers
   */
  async assignStock(
    ctx: ServiceContext,
    input: AssignStockInput
  ): Promise<Result<StockMovement, StockError | AuthError>> {
    // Check permissions - only bartender can assign
    if (ctx.userRole !== 'bartender') {
      return err(AuthErrors.INSUFFICIENT_PERMISSIONS('bartender', ctx.userRole));
    }

    const { productId, quantity, toServerId } = input;

    // Cannot assign to self
    if (toServerId === ctx.userId) {
      return err(StockErrors.CANNOT_ALLOCATE_TO_SELF());
    }

    // Validate quantity
    if (quantity <= 0) {
      return err(
        new StockError('Quantity must be positive', 'STOCK_INVALID_QUANTITY', {
          quantity,
        })
      );
    }

    // Verify target user is a server in this bar
    const { data: serverRole } = await this.supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', toServerId)
      .eq('bar_id', ctx.barId)
      .eq('is_active', true)
      .single();

    if (!serverRole || serverRole.role !== 'server') {
      return err(
        new StockError(
          'Target user must be an active server',
          'STOCK_INVALID_TARGET_ROLE',
          { user_id: toServerId, expected_role: 'server' }
        )
      );
    }

    // Check bartender has enough stock
    const bartenderStock = await this.getUserStock(ctx.barId, ctx.userId, productId);
    if (bartenderStock < quantity) {
      return err(StockErrors.INSUFFICIENT_STOCK(productId, bartenderStock, quantity));
    }

    // Create stock movement
    const { data: movement, error } = await this.supabase
      .from('stock_movements')
      .insert({
        bar_id: ctx.barId,
        shift_id: ctx.shiftId || null,
        product_id: productId,
        quantity,
        movement_type: 'assignment',
        from_user_id: ctx.userId,
        to_user_id: toServerId,
        performed_by: ctx.userId,
        performed_at: new Date().toISOString(),
        device_id: ctx.deviceId,
        sync_status: 'local',
        client_id: ctx.clientId || null,
        client_timestamp: ctx.clientTimestamp || new Date().toISOString(),
      })
      .select()
      .single();

    if (error || !movement) {
      throw new Error(`Failed to assign stock: ${error?.message}`);
    }

    // Log event
    await this.logStockEvent(ctx, 'stock_assign', 'stock_movement', movement.id, {
      product_id: productId,
      quantity,
      to_server_id: toServerId,
    });

    return ok(movement);
  }

  // ============================================
  // STOCK RETURNS
  // ============================================

  /**
   * Return stock (Server → Bartender or Bartender → Stock)
   * @implements ARCHITECTURE.md Section 3.4 - Return movements
   */
  async returnStock(
    ctx: ServiceContext,
    input: ReturnStockInput
  ): Promise<Result<StockMovement, StockError | AuthError>> {
    const { productId, quantity, fromUserId, reason } = input;

    // Validate quantity
    if (quantity <= 0) {
      return err(
        new StockError('Quantity must be positive', 'STOCK_INVALID_QUANTITY', {
          quantity,
        })
      );
    }

    // Determine movement type based on roles
    let movementType: MovementType;
    let toUserId: string | null;

    if (ctx.userRole === 'bartender') {
      // Bartender returning to stock
      if (fromUserId !== ctx.userId) {
        return err(
          new StockError(
            'Bartenders can only return their own stock',
            'STOCK_NOT_OWN_STOCK',
            { from_user_id: fromUserId }
          )
        );
      }
      movementType = 'return_to_stock';
      toUserId = null; // Back to bar stock
    } else if (ctx.userRole === 'manager' || ctx.userRole === 'owner') {
      // Manager accepting return from anyone
      movementType = fromUserId ? 'return' : 'return_to_stock';
      toUserId = fromUserId ? ctx.userId : null;
    } else {
      return err(
        AuthErrors.INSUFFICIENT_PERMISSIONS('bartender, manager, or owner', ctx.userRole)
      );
    }

    // Check the user has enough stock to return
    const userStock = await this.getUserStock(ctx.barId, fromUserId, productId);
    if (userStock < quantity) {
      return err(StockErrors.INSUFFICIENT_STOCK(productId, userStock, quantity));
    }

    // Create stock movement
    const { data: movement, error } = await this.supabase
      .from('stock_movements')
      .insert({
        bar_id: ctx.barId,
        shift_id: ctx.shiftId || null,
        product_id: productId,
        quantity,
        movement_type: movementType,
        from_user_id: fromUserId,
        to_user_id: toUserId,
        performed_by: ctx.userId,
        performed_at: new Date().toISOString(),
        device_id: ctx.deviceId,
        reason: reason || null,
        sync_status: 'local',
        client_id: ctx.clientId || null,
        client_timestamp: ctx.clientTimestamp || new Date().toISOString(),
      })
      .select()
      .single();

    if (error || !movement) {
      throw new Error(`Failed to return stock: ${error?.message}`);
    }

    // Log event
    await this.logStockEvent(ctx, 'stock_return', 'stock_movement', movement.id, {
      product_id: productId,
      quantity,
      from_user_id: fromUserId,
      movement_type: movementType,
    });

    return ok(movement);
  }

  // ============================================
  // STOCK ADJUSTMENTS
  // ============================================

  /**
   * Adjust stock (damage, loss, correction)
   * @implements ARCHITECTURE.md Section 3.4 - Adjustment movements
   *
   * Reason is required for all adjustments
   */
  async adjustStock(
    ctx: ServiceContext,
    input: AdjustStockInput
  ): Promise<Result<StockMovement, StockError | AuthError>> {
    // Check permissions
    if (!['owner', 'manager', 'bartender'].includes(ctx.userRole)) {
      return err(
        AuthErrors.INSUFFICIENT_PERMISSIONS('owner, manager, or bartender', ctx.userRole)
      );
    }

    const { productId, quantity, reason, movementType } = input;

    // Reason is required
    if (!reason || reason.trim().length < 3) {
      return err(StockErrors.REASON_REQUIRED(movementType));
    }

    // Validate movement type
    if (!['adjustment', 'damage', 'loss'].includes(movementType)) {
      return err(
        new StockError('Invalid movement type', 'STOCK_INVALID_MOVEMENT_TYPE', {
          movement_type: movementType,
        })
      );
    }

    // For negative adjustments, check stock availability
    if (quantity < 0) {
      const available = await this.getAvailableStock(ctx.barId, productId);
      if (available < Math.abs(quantity)) {
        return err(
          StockErrors.INSUFFICIENT_STOCK(productId, available, Math.abs(quantity))
        );
      }
    }

    // Create stock movement
    const { data: movement, error } = await this.supabase
      .from('stock_movements')
      .insert({
        bar_id: ctx.barId,
        shift_id: ctx.shiftId || null,
        product_id: productId,
        quantity: Math.abs(quantity), // Store absolute value
        movement_type: movementType,
        from_user_id: quantity < 0 ? null : null, // Adjustments don't have from/to
        to_user_id: null,
        performed_by: ctx.userId,
        performed_at: new Date().toISOString(),
        device_id: ctx.deviceId,
        reason: reason.trim(),
        sync_status: 'local',
        client_id: ctx.clientId || null,
        client_timestamp: ctx.clientTimestamp || new Date().toISOString(),
      })
      .select()
      .single();

    if (error || !movement) {
      throw new Error(`Failed to adjust stock: ${error?.message}`);
    }

    // Log event
    const eventType =
      movementType === 'damage'
        ? 'stock_damage'
        : movementType === 'loss'
          ? 'stock_loss'
          : 'stock_adjust';

    await this.logStockEvent(ctx, eventType, 'stock_movement', movement.id, {
      product_id: productId,
      quantity,
      reason,
      movement_type: movementType,
    });

    return ok(movement);
  }

  // ============================================
  // STOCK QUERIES
  // ============================================

  /**
   * Get overall stock balance for a product
   */
  async getStockBalance(
    ctx: ServiceContext,
    productId: string
  ): Promise<Result<StockBalance, StockError>> {
    // Get product info
    const { data: product } = await this.supabase
      .from('products')
      .select('id, name')
      .eq('id', productId)
      .eq('bar_id', ctx.barId)
      .single();

    if (!product) {
      return err(StockErrors.PRODUCT_NOT_FOUND(productId));
    }

    // Calculate balances using the database function
    const { data: balance } = await this.supabase.rpc('calculate_stock_balance', {
      p_bar_id: ctx.barId,
      p_product_id: productId,
    });

    const totalInStock = balance?.total_in_stock || 0;
    const allocatedToBartenders = balance?.allocated_to_bartenders || 0;
    const assignedToServers = balance?.assigned_to_servers || 0;

    return ok({
      productId,
      productName: product.name,
      totalInStock,
      allocatedToBartenders,
      assignedToServers,
      available: totalInStock - allocatedToBartenders,
    });
  }

  /**
   * Get all stock balances for the bar
   */
  async getAllStockBalances(
    ctx: ServiceContext
  ): Promise<Result<StockBalance[], StockError>> {
    // Get all active products
    const { data: products } = await this.supabase
      .from('products')
      .select('id, name')
      .eq('bar_id', ctx.barId)
      .eq('is_active', true);

    if (!products) {
      return ok([]);
    }

    const balances: StockBalance[] = [];

    for (const product of products) {
      const result = await this.getStockBalance(ctx, product.id);
      if (result.success) {
        balances.push(result.data);
      }
    }

    return ok(balances);
  }

  /**
   * Get stock held by a specific user
   */
  async getUserStockBalance(
    ctx: ServiceContext,
    userId: string
  ): Promise<Result<UserStockBalance, StockError>> {
    // Get user info
    const { data: user } = await this.supabase
      .from('users')
      .select('id, full_name')
      .eq('id', userId)
      .single();

    if (!user) {
      return err(new StockError('User not found', 'STOCK_USER_NOT_FOUND', { user_id: userId }));
    }

    // Get user's role
    const { data: roleData } = await this.supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', userId)
      .eq('bar_id', ctx.barId)
      .eq('is_active', true)
      .single();

    // Get all products and calculate user's balance for each
    const { data: products } = await this.supabase
      .from('products')
      .select('id, name')
      .eq('bar_id', ctx.barId)
      .eq('is_active', true);

    const productBalances: UserStockBalance['products'] = [];

    if (products) {
      for (const product of products) {
        const qty = await this.getUserStock(ctx.barId, userId, product.id);
        if (qty > 0) {
          productBalances.push({
            productId: product.id,
            productName: product.name,
            quantity: qty,
          });
        }
      }
    }

    return ok({
      userId,
      userName: user.full_name,
      role: roleData?.role || 'server',
      products: productBalances,
    });
  }

  // ============================================
  // PRIVATE HELPERS
  // ============================================

  /**
   * Get available stock in bar inventory (not allocated)
   */
  private async getAvailableStock(barId: string, productId: string): Promise<number> {
    // Use database function for accurate calculation
    const { data } = await this.supabase.rpc('calculate_stock_balance', {
      p_bar_id: barId,
      p_product_id: productId,
    });

    return data?.available || 0;
  }

  /**
   * Get stock held by a specific user
   */
  private async getUserStock(
    barId: string,
    userId: string,
    productId: string
  ): Promise<number> {
    // Use database function for accurate calculation
    const { data } = await this.supabase.rpc('calculate_user_stock', {
      p_bar_id: barId,
      p_user_id: userId,
      p_product_id: productId,
    });

    return data || 0;
  }

  private async logStockEvent(
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
