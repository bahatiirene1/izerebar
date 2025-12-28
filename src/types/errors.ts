/**
 * Domain Error Types
 * @implements CLAUDE.md Section 13 - Error Handling Pattern
 */

/**
 * Base domain error class with structured error information
 */
export class DomainError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly context?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'DomainError';
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      context: this.context,
    };
  }
}

// ============================================
// AUTH ERRORS
// ============================================

export class AuthError extends DomainError {
  constructor(message: string, code: string, context?: Record<string, unknown>) {
    super(message, code, context);
    this.name = 'AuthError';
  }
}

export const AuthErrors = {
  INVALID_PHONE: (phone: string) =>
    new AuthError('Invalid phone number format', 'AUTH_INVALID_PHONE', { phone }),

  INVALID_PIN: () =>
    new AuthError('Invalid PIN', 'AUTH_INVALID_PIN'),

  USER_NOT_FOUND: (phone: string) =>
    new AuthError('User not found', 'AUTH_USER_NOT_FOUND', { phone }),

  ACCOUNT_LOCKED: (until: string) =>
    new AuthError('Account is locked', 'AUTH_ACCOUNT_LOCKED', { locked_until: until }),

  SESSION_EXPIRED: () =>
    new AuthError('Session has expired', 'AUTH_SESSION_EXPIRED'),

  INVALID_SESSION: () =>
    new AuthError('Invalid session', 'AUTH_INVALID_SESSION'),

  OTP_EXPIRED: () =>
    new AuthError('OTP has expired', 'AUTH_OTP_EXPIRED'),

  OTP_INVALID: () =>
    new AuthError('Invalid OTP code', 'AUTH_OTP_INVALID'),

  OTP_MAX_ATTEMPTS: () =>
    new AuthError('Maximum OTP attempts exceeded', 'AUTH_OTP_MAX_ATTEMPTS'),

  DEVICE_NOT_REGISTERED: (fingerprint: string) =>
    new AuthError('Device not registered', 'AUTH_DEVICE_NOT_REGISTERED', { fingerprint }),

  DEVICE_LOCKED: (deviceId: string) =>
    new AuthError('Device is locked', 'AUTH_DEVICE_LOCKED', { device_id: deviceId }),

  NO_ROLE_IN_BAR: (userId: string, barId: string) =>
    new AuthError('User has no role in this bar', 'AUTH_NO_ROLE', { user_id: userId, bar_id: barId }),

  INSUFFICIENT_PERMISSIONS: (required: string, actual: string) =>
    new AuthError('Insufficient permissions', 'AUTH_INSUFFICIENT_PERMISSIONS', { required, actual }),
};

// ============================================
// DAY/SHIFT ERRORS
// ============================================

export class ShiftError extends DomainError {
  constructor(message: string, code: string, context?: Record<string, unknown>) {
    super(message, code, context);
    this.name = 'ShiftError';
  }
}

export const ShiftErrors = {
  DAY_NOT_OPEN: (dayId: string) =>
    new ShiftError('Day is not open', 'SHIFT_DAY_NOT_OPEN', { day_id: dayId }),

  DAY_ALREADY_EXISTS: (date: string, barId: string) =>
    new ShiftError('Day already exists for this date', 'SHIFT_DAY_EXISTS', { date, bar_id: barId }),

  SHIFT_NOT_OPEN: (shiftId: string) =>
    new ShiftError('Shift is not open', 'SHIFT_NOT_OPEN', { shift_id: shiftId }),

  SHIFT_ALREADY_OPEN: (shiftId: string) =>
    new ShiftError('Shift is already open', 'SHIFT_ALREADY_OPEN', { shift_id: shiftId }),

  CANNOT_CLOSE_WITH_PENDING: (pendingCount: number) =>
    new ShiftError('Cannot close shift with pending sales', 'SHIFT_HAS_PENDING', { pending_count: pendingCount }),

  INVALID_STATUS_TRANSITION: (from: string, to: string) =>
    new ShiftError('Invalid status transition', 'SHIFT_INVALID_TRANSITION', { from, to }),
};

// ============================================
// STOCK ERRORS
// ============================================

export class StockError extends DomainError {
  constructor(message: string, code: string, context?: Record<string, unknown>) {
    super(message, code, context);
    this.name = 'StockError';
  }
}

export const StockErrors = {
  INSUFFICIENT_STOCK: (productId: string, available: number, requested: number) =>
    new StockError('Insufficient stock', 'STOCK_INSUFFICIENT', { product_id: productId, available, requested }),

  PRODUCT_NOT_FOUND: (productId: string) =>
    new StockError('Product not found', 'STOCK_PRODUCT_NOT_FOUND', { product_id: productId }),

  REASON_REQUIRED: (movementType: string) =>
    new StockError('Reason is required for this movement type', 'STOCK_REASON_REQUIRED', { movement_type: movementType }),

  INVALID_CUSTODY_TRANSFER: (from: string | null, to: string | null, type: string) =>
    new StockError('Invalid custody transfer', 'STOCK_INVALID_CUSTODY', { from, to, movement_type: type }),

  CANNOT_ALLOCATE_TO_SELF: () =>
    new StockError('Cannot allocate stock to yourself', 'STOCK_SELF_ALLOCATION'),
};

// ============================================
// SALE ERRORS
// ============================================

export class SaleError extends DomainError {
  constructor(message: string, code: string, context?: Record<string, unknown>) {
    super(message, code, context);
    this.name = 'SaleError';
  }
}

export const SaleErrors = {
  SALE_NOT_FOUND: (saleId: string) =>
    new SaleError('Sale not found', 'SALE_NOT_FOUND', { sale_id: saleId }),

  CANNOT_COLLECT_NON_PENDING: (saleId: string, status: string) =>
    new SaleError('Can only collect pending sales', 'SALE_NOT_PENDING', { sale_id: saleId, status }),

  CANNOT_CONFIRM_NON_COLLECTED: (saleId: string, status: string) =>
    new SaleError('Can only confirm collected sales', 'SALE_NOT_COLLECTED', { sale_id: saleId, status }),

  CANNOT_REVERSE_CONFIRMED: (saleId: string) =>
    new SaleError('Cannot reverse a confirmed sale', 'SALE_ALREADY_CONFIRMED', { sale_id: saleId }),

  REVERSAL_REASON_REQUIRED: () =>
    new SaleError('Reason is required for sale reversal', 'SALE_REVERSAL_REASON_REQUIRED'),

  SERVER_NOT_ASSIGNED: (serverId: string, saleId: string) =>
    new SaleError('Server is not assigned to this sale', 'SALE_SERVER_NOT_ASSIGNED', { server_id: serverId, sale_id: saleId }),

  INVALID_STATUS_TRANSITION: (from: string, to: string) =>
    new SaleError('Invalid sale status transition', 'SALE_INVALID_TRANSITION', { from, to }),

  QUANTITY_MISMATCH: (expected: number, actual: number) =>
    new SaleError('Sale total does not match quantity * price', 'SALE_TOTAL_MISMATCH', { expected, actual }),
};

// ============================================
// VALIDATION ERRORS
// ============================================

export class ValidationError extends DomainError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'VALIDATION_ERROR', context);
    this.name = 'ValidationError';
  }
}

export const ValidationErrors = {
  REQUIRED_FIELD: (field: string) =>
    new ValidationError(`${field} is required`, { field }),

  INVALID_FORMAT: (field: string, expected: string) =>
    new ValidationError(`Invalid format for ${field}`, { field, expected }),

  OUT_OF_RANGE: (field: string, min?: number, max?: number) =>
    new ValidationError(`${field} is out of valid range`, { field, min, max }),
};
