/**
 * Standardized API Response Utilities
 * @implements ARCHITECTURE.md Section 7 - API Layer
 */

import { corsHeaders } from './cors.ts';

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

/**
 * Create a successful JSON response
 */
export function success<T>(data: T, status = 200): Response {
  const body: ApiResponse<T> = {
    success: true,
    data,
  };

  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  });
}

/**
 * Create an error JSON response
 */
export function error(
  code: string,
  message: string,
  status = 400,
  details?: Record<string, unknown>
): Response {
  const body: ApiResponse = {
    success: false,
    error: {
      code,
      message,
      details,
    },
  };

  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  });
}

/**
 * Common error responses
 */
export const Errors = {
  unauthorized: () => error('UNAUTHORIZED', 'Authentication required', 401),
  forbidden: () => error('FORBIDDEN', 'Insufficient permissions', 403),
  notFound: (resource: string) => error('NOT_FOUND', `${resource} not found`, 404),
  badRequest: (message: string) => error('BAD_REQUEST', message, 400),
  internal: (message = 'Internal server error') => error('INTERNAL_ERROR', message, 500),
  validationError: (details: Record<string, string>) =>
    error('VALIDATION_ERROR', 'Validation failed', 400, details),
};
