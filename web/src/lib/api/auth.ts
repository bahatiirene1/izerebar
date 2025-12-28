/**
 * Auth API
 * @implements ARCHITECTURE.md Section 8 - UI Layer
 *
 * Authentication endpoints
 */

import { api, type ApiResponse } from './client';
import { useAuthStore, type User, type Bar } from '@/lib/store/auth';

// Request types
export interface RegisterRequest {
  ownerPhone: string;
  ownerName: string;
  ownerNationalId: string;
  ownerPin: string;
  barName: string;
  barTin: string;
  barLocation?: string;
}

export interface LoginRequest {
  phone: string;
  pin: string;
}

// Response types
export interface RegisterResponse {
  userId: string;
  barId: string;
  message: string;
}

export interface LoginResponse {
  token: string;
  user: User;
  bar: Bar;
}

export interface VerifyPinResponse {
  valid: boolean;
}

// API functions
export async function register(
  data: RegisterRequest
): Promise<ApiResponse<RegisterResponse>> {
  return api.post<RegisterResponse>('/auth/register', data, { skipAuth: true });
}

export async function login(
  data: LoginRequest,
  barId: string
): Promise<ApiResponse<LoginResponse>> {
  const { deviceId } = useAuthStore.getState();

  const response = await api.post<LoginResponse>('/auth/login', data, {
    skipAuth: true,
    headers: {
      'X-Device-ID': deviceId,
      'X-Bar-ID': barId,
    },
  });

  // If successful, update auth store
  if (response.success && response.data) {
    useAuthStore.getState().login(
      response.data.user,
      response.data.bar,
      response.data.token
    );
  }

  return response;
}

export async function logout(): Promise<ApiResponse<void>> {
  const response = await api.post<void>('/auth/logout');

  // Clear auth store regardless of response
  useAuthStore.getState().logout();

  return response;
}

export async function verifyPin(
  userId: string,
  pin: string
): Promise<ApiResponse<VerifyPinResponse>> {
  return api.post<VerifyPinResponse>('/auth/verify-pin', { userId, pin });
}
