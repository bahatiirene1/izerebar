/**
 * Sales API Tests
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

describe('Sales API', () => {
  let supabase: SupabaseClient;
  let serviceClient: SupabaseClient;
  let testBarId: string;
  let testUserId: string;
  let testToken: string;
  let testDayId: string;
  let testShiftId: string;
  let testProductId: string;
  let testSaleId: string;
  const testDeviceId = 'test-device-003';
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
        ownerName: 'Sales Test Owner',
        ownerNationalId: '1199012345678905',
        ownerPin: testPin,
        barName: 'Sales Test Bar',
        barTin: '345678901',
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
    const dayResponse = await fetch(`${FUNCTIONS_URL}/days`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({}),
    });
    const dayData = await dayResponse.json();
    testDayId = dayData.data?.day?.id;

    // Start shift
    const shiftResponse = await fetch(`${FUNCTIONS_URL}/shifts`, {
      method: 'POST',
      headers: authHeaders(),
    });
    const shiftData = await shiftResponse.json();
    testShiftId = shiftData.data?.shift?.id;

    // Create test product
    const productResponse = await fetch(`${FUNCTIONS_URL}/products`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        name: 'Test Beer',
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
      await serviceClient.from('sale_items').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      await serviceClient.from('sales').delete().eq('bar_id', testBarId);
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

  describe('POST /sales', () => {
    it('should create a new sale', async () => {
      const response = await fetch(`${FUNCTIONS_URL}/sales`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          items: [
            { productId: testProductId, quantity: 2 },
          ],
          paymentMethod: 'cash',
          tableNumber: '5',
        }),
      });

      expect(response.status).toBe(201);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data.sale.status).toBe('pending');
      expect(data.data.sale.total_amount).toBe(3000); // 2 * 1500

      testSaleId = data.data.sale.id;
    });

    it('should reject empty items array', async () => {
      const response = await fetch(`${FUNCTIONS_URL}/sales`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          items: [],
          paymentMethod: 'cash',
        }),
      });

      expect(response.status).toBe(400);
    });
  });

  describe('GET /sales', () => {
    it('should list sales', async () => {
      const response = await fetch(`${FUNCTIONS_URL}/sales`, {
        method: 'GET',
        headers: authHeaders(),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(Array.isArray(data.data.sales)).toBe(true);
      expect(data.data.sales.length).toBeGreaterThan(0);
    });

    it('should filter by status', async () => {
      const response = await fetch(`${FUNCTIONS_URL}/sales?status=pending`, {
        method: 'GET',
        headers: authHeaders(),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      data.data.sales.forEach((sale: { status: string }) => {
        expect(sale.status).toBe('pending');
      });
    });
  });

  describe('POST /sales/collect', () => {
    it('should mark payment as collected', async () => {
      const response = await fetch(`${FUNCTIONS_URL}/sales/collect`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          saleId: testSaleId,
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data.sale.status).toBe('collected');
    });

    it('should reject collecting an already collected sale', async () => {
      const response = await fetch(`${FUNCTIONS_URL}/sales/collect`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          saleId: testSaleId,
        }),
      });

      expect(response.status).toBe(400);
    });
  });

  describe('POST /sales/confirm', () => {
    it('should confirm sale with PIN', async () => {
      const response = await fetch(`${FUNCTIONS_URL}/sales/confirm`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          saleId: testSaleId,
          pin: testPin,
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data.sale.status).toBe('confirmed');
    });

    it('should reject invalid PIN', async () => {
      // Create another sale first
      const saleResponse = await fetch(`${FUNCTIONS_URL}/sales`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          items: [{ productId: testProductId, quantity: 1 }],
          paymentMethod: 'cash',
        }),
      });
      const saleData = await saleResponse.json();
      const newSaleId = saleData.data?.sale?.id;

      if (!newSaleId) return;

      // Collect it
      await fetch(`${FUNCTIONS_URL}/sales/collect`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ saleId: newSaleId }),
      });

      // Try to confirm with wrong PIN
      const response = await fetch(`${FUNCTIONS_URL}/sales/confirm`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          saleId: newSaleId,
          pin: '9999',
        }),
      });

      expect(response.status).toBe(400);
    });
  });

  describe('GET /sales/summary', () => {
    it('should return sales summary', async () => {
      const response = await fetch(`${FUNCTIONS_URL}/sales/summary`, {
        method: 'GET',
        headers: authHeaders(),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data.summary).toBeDefined();
      expect(data.data.summary.total).toBeGreaterThan(0);
    });
  });
});
