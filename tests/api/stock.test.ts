/**
 * Stock API Tests
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

beforeAll(async () => {
  functionsAvailable = await checkFunctionsAvailable();
});

describe('Stock API', () => {
  let supabase: SupabaseClient;
  let serviceClient: SupabaseClient;
  let testBarId: string;
  let testUserId: string;
  let testToken: string;
  let testProductId: string;
  const testDeviceId = 'test-device-004';
  const testPhone = `+2507${Date.now().toString().slice(-8)}`;
  const testPin = '1234';

  beforeAll(async () => {
    supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    if (!functionsAvailable) return;

    // Register and login
    const registerResponse = await fetch(`${FUNCTIONS_URL}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ownerPhone: testPhone,
        ownerName: 'Stock Test Owner',
        ownerNationalId: '1199012345678906',
        ownerPin: testPin,
        barName: 'Stock Test Bar',
        barTin: '456789012',
        barLocation: 'Kigali',
      }),
    });

    const registerData = await registerResponse.json();
    testBarId = registerData.data?.barId;
    testUserId = registerData.data?.userId;

    const loginResponse = await fetch(`${FUNCTIONS_URL}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Device-ID': testDeviceId,
        'X-Bar-ID': testBarId,
      },
      body: JSON.stringify({ phone: testPhone, pin: testPin }),
    });

    const loginData = await loginResponse.json();
    testToken = loginData.data?.token;

    // Open day
    await fetch(`${FUNCTIONS_URL}/days`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({}),
    });

    // Start shift
    await fetch(`${FUNCTIONS_URL}/shifts`, {
      method: 'POST',
      headers: authHeaders(),
    });

    // Create test product
    const productResponse = await fetch(`${FUNCTIONS_URL}/products`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        name: 'Stock Test Beer',
        category: 'beer',
        unit: 'bottle',
        sellingPrice: 1500,
        costPrice: 1000,
      }),
    });
    const productData = await productResponse.json();
    testProductId = productData.data?.product?.id;
  });

  afterAll(async () => {
    if (testBarId && functionsAvailable) {
      await serviceClient.from('stock_movements').delete().eq('bar_id', testBarId);
      await serviceClient.from('stock_assignments').delete().eq('bar_id', testBarId);
      await serviceClient.from('stock_levels').delete().eq('bar_id', testBarId);
      await serviceClient.from('products').delete().eq('bar_id', testBarId);
      await serviceClient.from('shifts').delete().eq('bar_id', testBarId);
      await serviceClient.from('days').delete().eq('bar_id', testBarId);
      await serviceClient.from('user_roles').delete().eq('bar_id', testBarId);
      await serviceClient.from('bars').delete().eq('id', testBarId);
      if (testUserId) {
        await serviceClient.schema('auth_custom').from('credentials').delete().eq('user_id', testUserId);
        await serviceClient.schema('auth_custom').from('sessions').delete().eq('user_id', testUserId);
        await serviceClient.from('users').delete().eq('id', testUserId);
      }
    }
  });

  beforeEach(({ skip }) => {
    if (!functionsAvailable) skip();
  });

  function authHeaders() {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${testToken}`,
      'X-Device-ID': testDeviceId,
      'X-Bar-ID': testBarId,
    };
  }

  describe('POST /stock/receive', () => {
    it('should receive stock', async () => {
      const response = await fetch(`${FUNCTIONS_URL}/stock/receive`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          productId: testProductId,
          quantity: 50,
          unitCost: 1000,
          notes: 'Initial stock',
        }),
      });

      expect(response.status).toBe(201);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data.movement.quantity).toBe(50);
    });

    it('should reject zero quantity', async () => {
      const response = await fetch(`${FUNCTIONS_URL}/stock/receive`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          productId: testProductId,
          quantity: 0,
        }),
      });

      expect(response.status).toBe(400);
    });
  });

  describe('GET /stock', () => {
    it('should get stock levels', async () => {
      const response = await fetch(`${FUNCTIONS_URL}/stock`, {
        method: 'GET',
        headers: authHeaders(),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(Array.isArray(data.data.stockLevels)).toBe(true);

      const productStock = data.data.stockLevels.find(
        (s: { product: { id: string } }) => s.product?.id === testProductId
      );
      expect(productStock).toBeDefined();
      expect(productStock.quantity).toBe(50);
    });
  });

  describe('POST /stock/adjust', () => {
    it('should adjust stock with reason', async () => {
      const response = await fetch(`${FUNCTIONS_URL}/stock/adjust`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          productId: testProductId,
          quantity: -5,
          reason: 'breakage',
          notes: 'Bottles broke during transport',
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data.previousQuantity).toBe(50);
      expect(data.data.newQuantity).toBe(45);
    });

    it('should reject adjustment without reason', async () => {
      const response = await fetch(`${FUNCTIONS_URL}/stock/adjust`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          productId: testProductId,
          quantity: -5,
        }),
      });

      expect(response.status).toBe(400);
    });

    it('should reject adjustment that would make stock negative', async () => {
      const response = await fetch(`${FUNCTIONS_URL}/stock/adjust`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          productId: testProductId,
          quantity: -100,
          reason: 'correction',
          notes: 'This should fail',
        }),
      });

      expect(response.status).toBe(400);
    });
  });

  describe('GET /stock/movements', () => {
    it('should list stock movements', async () => {
      const response = await fetch(`${FUNCTIONS_URL}/stock/movements`, {
        method: 'GET',
        headers: authHeaders(),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(Array.isArray(data.data.movements)).toBe(true);
      expect(data.data.movements.length).toBeGreaterThan(0);
    });

    it('should filter movements by type', async () => {
      const response = await fetch(`${FUNCTIONS_URL}/stock/movements?type=receipt`, {
        method: 'GET',
        headers: authHeaders(),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      data.data.movements.forEach((m: { movement_type: string }) => {
        expect(m.movement_type).toBe('receipt');
      });
    });
  });
});
