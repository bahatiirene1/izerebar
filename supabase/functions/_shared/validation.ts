/**
 * Input Validation Utilities
 * @implements ARCHITECTURE.md Section 8 - Domain Rules & Validations
 */

export interface ValidationResult {
  valid: boolean;
  errors: Record<string, string>;
}

/**
 * Validate phone number format (Rwanda)
 */
export function isValidPhone(phone: string): boolean {
  return /^\+?[0-9]{10,15}$/.test(phone);
}

/**
 * Validate PIN format (4-6 digits)
 */
export function isValidPin(pin: string): boolean {
  return /^[0-9]{4,6}$/.test(pin);
}

/**
 * Validate National ID (Rwanda: 16 digits, starts with 1)
 */
export function isValidNationalId(nationalId: string): boolean {
  return /^1[0-9]{15}$/.test(nationalId);
}

/**
 * Validate TIN (Rwanda: 9 digits)
 */
export function isValidTin(tin: string): boolean {
  return /^[0-9]{9}$/.test(tin);
}

/**
 * Validate UUID format
 */
export function isValidUuid(uuid: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid);
}

/**
 * Validate date format (YYYY-MM-DD)
 */
export function isValidDate(date: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date);
}

/**
 * Validate positive integer
 */
export function isPositiveInt(value: unknown): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

/**
 * Validate positive number (allows decimals)
 */
export function isPositiveNumber(value: unknown): boolean {
  return typeof value === 'number' && value > 0;
}

/**
 * Validate non-empty string
 */
export function isNonEmptyString(value: unknown, minLength = 1): boolean {
  return typeof value === 'string' && value.trim().length >= minLength;
}

/**
 * Schema-based validation
 */
export type ValidationSchema = Record<string, {
  required?: boolean;
  type?: 'string' | 'number' | 'boolean' | 'uuid' | 'phone' | 'pin' | 'nationalId' | 'tin' | 'date';
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  enum?: string[];
}>;

export function validate(data: Record<string, unknown>, schema: ValidationSchema): ValidationResult {
  const errors: Record<string, string> = {};

  for (const [field, rules] of Object.entries(schema)) {
    const value = data[field];

    // Check required
    if (rules.required && (value === undefined || value === null || value === '')) {
      errors[field] = `${field} is required`;
      continue;
    }

    // Skip further validation if not required and not provided
    if (value === undefined || value === null) {
      continue;
    }

    // Type validation
    switch (rules.type) {
      case 'string':
        if (typeof value !== 'string') {
          errors[field] = `${field} must be a string`;
        } else {
          if (rules.minLength && value.length < rules.minLength) {
            errors[field] = `${field} must be at least ${rules.minLength} characters`;
          }
          if (rules.maxLength && value.length > rules.maxLength) {
            errors[field] = `${field} must be at most ${rules.maxLength} characters`;
          }
        }
        break;

      case 'number':
        if (typeof value !== 'number') {
          errors[field] = `${field} must be a number`;
        } else {
          if (rules.min !== undefined && value < rules.min) {
            errors[field] = `${field} must be at least ${rules.min}`;
          }
          if (rules.max !== undefined && value > rules.max) {
            errors[field] = `${field} must be at most ${rules.max}`;
          }
        }
        break;

      case 'boolean':
        if (typeof value !== 'boolean') {
          errors[field] = `${field} must be a boolean`;
        }
        break;

      case 'uuid':
        if (!isValidUuid(String(value))) {
          errors[field] = `${field} must be a valid UUID`;
        }
        break;

      case 'phone':
        if (!isValidPhone(String(value))) {
          errors[field] = `${field} must be a valid phone number`;
        }
        break;

      case 'pin':
        if (!isValidPin(String(value))) {
          errors[field] = `${field} must be 4-6 digits`;
        }
        break;

      case 'nationalId':
        if (!isValidNationalId(String(value))) {
          errors[field] = `${field} must be a valid 16-digit National ID`;
        }
        break;

      case 'tin':
        if (!isValidTin(String(value))) {
          errors[field] = `${field} must be a valid 9-digit TIN`;
        }
        break;

      case 'date':
        if (!isValidDate(String(value))) {
          errors[field] = `${field} must be in YYYY-MM-DD format`;
        }
        break;
    }

    // Enum validation
    if (rules.enum && !rules.enum.includes(String(value))) {
      errors[field] = `${field} must be one of: ${rules.enum.join(', ')}`;
    }
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
  };
}
