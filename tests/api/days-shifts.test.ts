/**
 * Days & Shifts API Tests
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

describe('Days & Shifts API', () => {
  let supabase: SupabaseClient;
  let testBarId: string;
  let testUserId: string;
  let testToken: string;
  let testDayId: string;
  let testShiftId: string;
  const testDeviceId = 'test-device-002';
  const testPhone = `+2507${Date.now().toString().slice(-8)}`;
  const testPin = '1234';

  beforeAll(async () => {
    supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    if (!functionsAvailable) return;

    // Register and login
    const registerResponse = await fetch(`${FUNCTIONS_URL}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ownerPhone: testPhone,
        ownerName: 'Day Test Owner',
        ownerNationalId: '1199012345678904',
        ownerPin: testPin,
        barName: 'Day Test Bar',
        barTin: '234567890',
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
  });

  afterAll(async () => {
    if (testBarId && functionsAvailable) {
      const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
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

  describe('Days API', () => {
    describe('POST /days', () => {
      it('should open a new day', async () => {
        const today = new Date().toISOString().split('T')[0];

        const response = await fetch(`${FUNCTIONS_URL}/days`, {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ date: today }),
        });

        expect(response.status).toBe(201);
        const data = await response.json();
        expect(data.success).toBe(true);
        expect(data.data.day.status).toBe('open');
        expect(data.data.day.date).toBe(today);

        testDayId = data.data.day.id;
      });

      it('should reject opening a day when one is already open', async () => {
        const response = await fetch(`${FUNCTIONS_URL}/days`, {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({}),
        });

        expect(response.status).toBe(400);
        const data = await response.json();
        expect(data.error.message).toContain('already open');
      });
    });

    describe('GET /days/current', () => {
      it('should get the current open day', async () => {
        const response = await fetch(`${FUNCTIONS_URL}/days/current`, {
          method: 'GET',
          headers: authHeaders(),
        });

        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.success).toBe(true);
        expect(data.data.day.id).toBe(testDayId);
        expect(data.data.day.status).toBe('open');
      });
    });

    describe('GET /days', () => {
      it('should list days', async () => {
        const response = await fetch(`${FUNCTIONS_URL}/days`, {
          method: 'GET',
          headers: authHeaders(),
        });

        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.success).toBe(true);
        expect(Array.isArray(data.data.days)).toBe(true);
        expect(data.data.days.length).toBeGreaterThan(0);
      });
    });
  });

  describe('Shifts API', () => {
    describe('POST /shifts', () => {
      it('should start a new shift', async () => {
        const response = await fetch(`${FUNCTIONS_URL}/shifts`, {
          method: 'POST',
          headers: authHeaders(),
        });

        expect(response.status).toBe(201);
        const data = await response.json();
        expect(data.success).toBe(true);
        expect(data.data.shift.status).toBe('open');
        expect(data.data.shift.shift_number).toBe(1);

        testShiftId = data.data.shift.id;
      });

      it('should reject starting a shift when one is already open', async () => {
        const response = await fetch(`${FUNCTIONS_URL}/shifts`, {
          method: 'POST',
          headers: authHeaders(),
        });

        expect(response.status).toBe(400);
        const data = await response.json();
        expect(data.error.message).toContain('already open');
      });
    });

    describe('GET /shifts/current', () => {
      it('should get the current open shift', async () => {
        const response = await fetch(`${FUNCTIONS_URL}/shifts/current`, {
          method: 'GET',
          headers: authHeaders(),
        });

        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.success).toBe(true);
        expect(data.data.shift.id).toBe(testShiftId);
        expect(data.data.shift.status).toBe('open');
      });
    });

    describe('POST /shifts/end', () => {
      it('should end the current shift', async () => {
        const response = await fetch(`${FUNCTIONS_URL}/shifts/end`, {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ notes: 'Test shift ended' }),
        });

        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.success).toBe(true);
        expect(data.data.shift.status).toBe('closed');
      });
    });
  });

  describe('Close Day', () => {
    describe('POST /days/close', () => {
      it('should close the current day', async () => {
        const response = await fetch(`${FUNCTIONS_URL}/days/close`, {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ notes: 'Test day closed' }),
        });

        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.success).toBe(true);
        expect(data.data.day.status).toBe('closed');
      });

      it('should reject closing when no day is open', async () => {
        const response = await fetch(`${FUNCTIONS_URL}/days/close`, {
          method: 'POST',
          headers: authHeaders(),
        });

        expect(response.status).toBe(404);
      });
    });
  });
});
