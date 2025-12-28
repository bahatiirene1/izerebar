/**
 * Auth API Tests
 * @implements ARCHITECTURE.md Section 7 - API Layer
 *
 * NOTE: These tests require edge functions to be running.
 * Run: supabase functions serve
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import {
  checkFunctionsAvailable,
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  FUNCTIONS_URL,
  SUPABASE_SERVICE_ROLE_KEY,
} from './helpers';

let functionsAvailable = false;

// Check before all tests
beforeAll(async () => {
  functionsAvailable = await checkFunctionsAvailable();
  if (!functionsAvailable) {
    console.log('⚠️  Edge functions not available - skipping API tests');
    console.log('   Run: supabase functions serve');
  }
});

describe('Auth API', () => {
  let supabase: SupabaseClient;
  let testBarId: string;
  let testUserId: string;
  let testToken: string;
  const testDeviceId = 'test-device-001';
  const testPhone = `+2507${Date.now().toString().slice(-8)}`;
  const testPin = '1234';

  beforeAll(async () => {
    supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  });

  afterAll(async () => {
    if (testBarId && functionsAvailable) {
      const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      await serviceClient.from('user_roles').delete().eq('bar_id', testBarId);
      await serviceClient.from('bars').delete().eq('id', testBarId);
      if (testUserId) {
        await serviceClient.schema('auth_custom').from('credentials').delete().eq('user_id', testUserId);
        await serviceClient.schema('auth_custom').from('sessions').delete().eq('user_id', testUserId);
        await serviceClient.from('users').delete().eq('id', testUserId);
      }
    }
  });

  // Skip condition for all tests in this file
  beforeEach(({ skip }) => {
    if (!functionsAvailable) skip();
  });

  describe('POST /auth/register', () => {
    it('should register a new business successfully', async () => {
      const response = await fetch(`${FUNCTIONS_URL}/auth/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ownerPhone: testPhone,
          ownerName: 'Test Owner',
          ownerNationalId: '1199012345678901',
          ownerPin: testPin,
          barName: 'Test Bar',
          barTin: '123456789',
          barLocation: 'Kigali',
        }),
      });

      expect(response.status).toBe(201);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data.userId).toBeDefined();
      expect(data.data.barId).toBeDefined();

      testBarId = data.data.barId;
      testUserId = data.data.userId;
    });

    it('should reject duplicate phone number', async () => {
      const response = await fetch(`${FUNCTIONS_URL}/auth/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ownerPhone: testPhone,
          ownerName: 'Another Owner',
          ownerNationalId: '1199012345678902',
          ownerPin: '5678',
          barName: 'Another Bar',
          barTin: '987654321',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error.message).toContain('already registered');
    });

    it('should reject invalid National ID', async () => {
      const response = await fetch(`${FUNCTIONS_URL}/auth/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ownerPhone: '+250799999999',
          ownerName: 'Invalid ID Owner',
          ownerNationalId: '2199012345678901', // Should start with 1
          ownerPin: '1234',
          barName: 'Invalid Bar',
          barTin: '111111111',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
    });

    it('should reject invalid TIN', async () => {
      const response = await fetch(`${FUNCTIONS_URL}/auth/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ownerPhone: '+250799999998',
          ownerName: 'Invalid TIN Owner',
          ownerNationalId: '1199012345678903',
          ownerPin: '1234',
          barName: 'Invalid TIN Bar',
          barTin: '12345', // Should be 9 digits
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
    });
  });

  describe('POST /auth/login', () => {
    it('should login successfully with valid credentials', async () => {
      const response = await fetch(`${FUNCTIONS_URL}/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Device-ID': testDeviceId,
          'X-Bar-ID': testBarId,
        },
        body: JSON.stringify({
          phone: testPhone,
          pin: testPin,
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data.token).toBeDefined();
      expect(data.data.user).toBeDefined();
      expect(data.data.user.role).toBe('owner');

      testToken = data.data.token;
    });

    it('should reject invalid PIN', async () => {
      const response = await fetch(`${FUNCTIONS_URL}/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Device-ID': testDeviceId,
          'X-Bar-ID': testBarId,
        },
        body: JSON.stringify({
          phone: testPhone,
          pin: '9999',
        }),
      });

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.success).toBe(false);
    });

    it('should reject missing device ID', async () => {
      const response = await fetch(`${FUNCTIONS_URL}/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Bar-ID': testBarId,
        },
        body: JSON.stringify({
          phone: testPhone,
          pin: testPin,
        }),
      });

      expect(response.status).toBe(400);
    });
  });

  describe('POST /auth/logout', () => {
    it('should logout successfully', async () => {
      // First login to get a token
      const loginResponse = await fetch(`${FUNCTIONS_URL}/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Device-ID': testDeviceId,
          'X-Bar-ID': testBarId,
        },
        body: JSON.stringify({
          phone: testPhone,
          pin: testPin,
        }),
      });

      const loginData = await loginResponse.json();
      const token = loginData.data.token;

      // Now logout
      const response = await fetch(`${FUNCTIONS_URL}/auth/logout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
    });

    it('should reject logout without token', async () => {
      const response = await fetch(`${FUNCTIONS_URL}/auth/logout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      expect(response.status).toBe(401);
    });
  });

  describe('POST /auth/verify-pin', () => {
    it('should verify correct PIN', async () => {
      const response = await fetch(`${FUNCTIONS_URL}/auth/verify-pin`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId: testUserId,
          pin: testPin,
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data.valid).toBe(true);
    });

    it('should reject incorrect PIN', async () => {
      const response = await fetch(`${FUNCTIONS_URL}/auth/verify-pin`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId: testUserId,
          pin: '9999',
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data.valid).toBe(false);
    });
  });
});
