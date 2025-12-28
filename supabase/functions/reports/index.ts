/**
 * Reports Edge Function
 * @implements ARCHITECTURE.md Section 6 - Reporting
 * @implements ARCHITECTURE.md Section 7 - API Layer
 */

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { handleCors } from '../_shared/cors.ts';
import { success, Errors } from '../_shared/response.ts';
import { createServiceClient } from '../_shared/supabase.ts';
import { authenticate, requireRole, ServiceContext } from '../_shared/auth.ts';

serve(async (req) => {
  // Handle CORS
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  // Authenticate
  const authResult = await authenticate(req);
  if (authResult instanceof Response) {
    return authResult;
  }
  const ctx: ServiceContext = authResult;

  // Only owner/manager can access reports
  const roleError = requireRole(ctx, ['owner', 'manager']);
  if (roleError) return roleError;

  const url = new URL(req.url);
  const path = url.pathname.replace('/reports', '');

  try {
    switch (path) {
      case '/daily':
        return await dailyReport(ctx, url);

      case '/shift':
        return await shiftReport(ctx, url);

      case '/staff-performance':
        return await staffPerformanceReport(ctx, url);

      case '/stock-summary':
        return await stockSummaryReport(ctx, url);

      case '/product-sales':
        return await productSalesReport(ctx, url);

      case '/accountability':
        return await accountabilityReport(ctx, url);

      default:
        return Errors.notFound('Report type');
    }
  } catch (error) {
    console.error('Reports error:', error);
    return Errors.internal(error.message);
  }
});

/**
 * GET /reports/daily
 * Daily summary report
 */
async function dailyReport(ctx: ServiceContext, url: URL): Promise<Response> {
  const supabase = createServiceClient();

  const dateParam = url.searchParams.get('date');
  const date = dateParam || new Date().toISOString().split('T')[0];

  // Get day
  const { data: day } = await supabase
    .from('days')
    .select(`
      *,
      opened_by_user:users!days_opened_by_fkey(id, full_name),
      closed_by_user:users!days_closed_by_fkey(id, full_name)
    `)
    .eq('bar_id', ctx.barId)
    .eq('date', date)
    .single();

  if (!day) {
    return Errors.notFound(`No data for ${date}`);
  }

  // Get shifts
  const { data: shifts } = await supabase
    .from('shifts')
    .select(`
      id,
      shift_number,
      status,
      started_at,
      ended_at,
      started_by_user:users!shifts_started_by_fkey(id, full_name)
    `)
    .eq('day_id', day.id);

  // Get sales summary
  const { data: sales } = await supabase
    .from('sales')
    .select('status, total_amount, payment_method')
    .eq('day_id', day.id);

  // Calculate sales totals
  const salesSummary = {
    total: 0,
    confirmed: 0,
    pending: 0,
    reversed: 0,
    byPaymentMethod: {} as Record<string, number>,
    count: { total: 0, confirmed: 0, pending: 0, reversed: 0 },
  };

  for (const sale of sales || []) {
    salesSummary.count.total++;
    if (sale.status !== 'reversed') {
      salesSummary.total += sale.total_amount;
      salesSummary.byPaymentMethod[sale.payment_method] =
        (salesSummary.byPaymentMethod[sale.payment_method] || 0) + sale.total_amount;
    }

    switch (sale.status) {
      case 'confirmed':
        salesSummary.confirmed += sale.total_amount;
        salesSummary.count.confirmed++;
        break;
      case 'pending':
      case 'collected':
        salesSummary.pending += sale.total_amount;
        salesSummary.count.pending++;
        break;
      case 'reversed':
        salesSummary.reversed += sale.total_amount;
        salesSummary.count.reversed++;
        break;
    }
  }

  // Get stock movements
  const { data: movements } = await supabase
    .from('stock_movements')
    .select('movement_type, quantity')
    .eq('day_id', day.id);

  const stockSummary = {
    received: 0,
    assigned: 0,
    returned: 0,
    adjusted: 0,
  };

  for (const m of movements || []) {
    switch (m.movement_type) {
      case 'receipt':
        stockSummary.received += m.quantity;
        break;
      case 'assignment_out':
        stockSummary.assigned += Math.abs(m.quantity);
        break;
      case 'return':
        stockSummary.returned += m.quantity;
        break;
      case 'adjustment':
        stockSummary.adjusted += m.quantity;
        break;
    }
  }

  return success({
    date,
    day: {
      id: day.id,
      status: day.status,
      openedAt: day.opened_at,
      closedAt: day.closed_at,
      openedBy: day.opened_by_user?.full_name,
      closedBy: day.closed_by_user?.full_name,
    },
    shifts: shifts?.map(s => ({
      id: s.id,
      number: s.shift_number,
      status: s.status,
      startedAt: s.started_at,
      endedAt: s.ended_at,
      startedBy: s.started_by_user?.full_name,
    })),
    sales: salesSummary,
    stock: stockSummary,
  });
}

/**
 * GET /reports/shift
 * Shift-specific report
 */
async function shiftReport(ctx: ServiceContext, url: URL): Promise<Response> {
  const supabase = createServiceClient();

  const shiftId = url.searchParams.get('shift_id');
  if (!shiftId) {
    return Errors.badRequest('shift_id is required');
  }

  // Get shift
  const { data: shift } = await supabase
    .from('shifts')
    .select(`
      *,
      started_by_user:users!shifts_started_by_fkey(id, full_name),
      ended_by_user:users!shifts_ended_by_fkey(id, full_name),
      day:days(id, date)
    `)
    .eq('id', shiftId)
    .eq('bar_id', ctx.barId)
    .single();

  if (!shift) {
    return Errors.notFound('Shift');
  }

  // Get staff assignments
  const { data: staff } = await supabase
    .from('shift_assignments')
    .select(`
      role,
      user:users(id, full_name)
    `)
    .eq('shift_id', shiftId);

  // Get sales by server
  const { data: sales } = await supabase
    .from('sales')
    .select(`
      server_id,
      status,
      total_amount,
      server:users!sales_server_id_fkey(id, full_name)
    `)
    .eq('shift_id', shiftId);

  const salesByServer: Record<string, {
    name: string;
    total: number;
    confirmed: number;
    pending: number;
    count: number;
  }> = {};

  for (const sale of sales || []) {
    const serverId = sale.server_id;
    if (!salesByServer[serverId]) {
      salesByServer[serverId] = {
        name: sale.server?.full_name || 'Unknown',
        total: 0,
        confirmed: 0,
        pending: 0,
        count: 0,
      };
    }

    if (sale.status !== 'reversed') {
      salesByServer[serverId].total += sale.total_amount;
      salesByServer[serverId].count++;
    }

    if (sale.status === 'confirmed') {
      salesByServer[serverId].confirmed += sale.total_amount;
    } else if (sale.status === 'pending' || sale.status === 'collected') {
      salesByServer[serverId].pending += sale.total_amount;
    }
  }

  // Get stock assignments
  const { data: stockAssignments } = await supabase
    .from('stock_assignments')
    .select(`
      quantity_assigned,
      quantity_sold,
      quantity_returned,
      returned_at,
      product:products(id, name),
      assignee:users!stock_assignments_assigned_to_fkey(id, full_name)
    `)
    .eq('shift_id', shiftId);

  return success({
    shift: {
      id: shift.id,
      number: shift.shift_number,
      date: shift.day?.date,
      status: shift.status,
      startedAt: shift.started_at,
      endedAt: shift.ended_at,
      startedBy: shift.started_by_user?.full_name,
      endedBy: shift.ended_by_user?.full_name,
    },
    staff: staff?.map(s => ({
      name: s.user?.full_name,
      role: s.role,
    })),
    salesByServer: Object.values(salesByServer),
    stockAssignments: stockAssignments?.map(a => ({
      product: a.product?.name,
      assignee: a.assignee?.full_name,
      assigned: a.quantity_assigned,
      sold: a.quantity_sold,
      returned: a.quantity_returned,
      isReturned: !!a.returned_at,
    })),
  });
}

/**
 * GET /reports/staff-performance
 * Staff performance over time
 */
async function staffPerformanceReport(ctx: ServiceContext, url: URL): Promise<Response> {
  const supabase = createServiceClient();

  const startDate = url.searchParams.get('start_date');
  const endDate = url.searchParams.get('end_date');
  const userId = url.searchParams.get('user_id');

  if (!startDate || !endDate) {
    return Errors.badRequest('start_date and end_date are required');
  }

  // Get days in range
  const { data: days } = await supabase
    .from('days')
    .select('id')
    .eq('bar_id', ctx.barId)
    .gte('date', startDate)
    .lte('date', endDate);

  const dayIds = days?.map(d => d.id) || [];

  if (dayIds.length === 0) {
    return success({ performance: [] });
  }

  // Get sales
  let query = supabase
    .from('sales')
    .select(`
      server_id,
      total_amount,
      status,
      created_at,
      server:users!sales_server_id_fkey(id, full_name)
    `)
    .in('day_id', dayIds);

  if (userId) {
    query = query.eq('server_id', userId);
  }

  const { data: sales } = await query;

  // Aggregate by user
  const performance: Record<string, {
    userId: string;
    name: string;
    totalSales: number;
    confirmedSales: number;
    saleCount: number;
    averagePerSale: number;
  }> = {};

  for (const sale of sales || []) {
    const serverId = sale.server_id;
    if (!performance[serverId]) {
      performance[serverId] = {
        userId: serverId,
        name: sale.server?.full_name || 'Unknown',
        totalSales: 0,
        confirmedSales: 0,
        saleCount: 0,
        averagePerSale: 0,
      };
    }

    if (sale.status !== 'reversed') {
      performance[serverId].totalSales += sale.total_amount;
      performance[serverId].saleCount++;
    }

    if (sale.status === 'confirmed') {
      performance[serverId].confirmedSales += sale.total_amount;
    }
  }

  // Calculate averages
  const result = Object.values(performance).map(p => ({
    ...p,
    averagePerSale: p.saleCount > 0 ? p.totalSales / p.saleCount : 0,
  }));

  return success({
    startDate,
    endDate,
    performance: result.sort((a, b) => b.totalSales - a.totalSales),
  });
}

/**
 * GET /reports/stock-summary
 * Current stock levels and value
 */
async function stockSummaryReport(ctx: ServiceContext, url: URL): Promise<Response> {
  const supabase = createServiceClient();

  const category = url.searchParams.get('category');

  let query = supabase
    .from('stock_levels')
    .select(`
      quantity,
      product:products(
        id,
        name,
        category,
        unit,
        selling_price,
        cost_price,
        min_stock_level
      )
    `)
    .eq('bar_id', ctx.barId);

  const { data: levels } = await query;

  let result = levels || [];
  if (category) {
    result = result.filter((l: { product: { category: string } }) => l.product?.category === category);
  }

  // Calculate summary
  let totalValue = 0;
  let totalCost = 0;
  let lowStockCount = 0;
  let outOfStockCount = 0;

  const stockItems = result.map((l: { quantity: number; product: { id: string; name: string; category: string; unit: string; selling_price: number; cost_price: number | null; min_stock_level: number } }) => {
    const value = l.quantity * (l.product?.selling_price || 0);
    const cost = l.quantity * (l.product?.cost_price || 0);
    totalValue += value;
    totalCost += cost;

    if (l.quantity === 0) outOfStockCount++;
    else if (l.quantity < (l.product?.min_stock_level || 0)) lowStockCount++;

    return {
      productId: l.product?.id,
      name: l.product?.name,
      category: l.product?.category,
      unit: l.product?.unit,
      quantity: l.quantity,
      minLevel: l.product?.min_stock_level,
      isLow: l.quantity < (l.product?.min_stock_level || 0),
      sellingPrice: l.product?.selling_price,
      costPrice: l.product?.cost_price,
      value,
      cost,
    };
  });

  return success({
    summary: {
      totalItems: stockItems.length,
      totalValue,
      totalCost,
      potentialProfit: totalValue - totalCost,
      lowStockCount,
      outOfStockCount,
    },
    items: stockItems.sort((a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name)),
  });
}

/**
 * GET /reports/product-sales
 * Product-wise sales analysis
 */
async function productSalesReport(ctx: ServiceContext, url: URL): Promise<Response> {
  const supabase = createServiceClient();

  const startDate = url.searchParams.get('start_date');
  const endDate = url.searchParams.get('end_date');

  if (!startDate || !endDate) {
    return Errors.badRequest('start_date and end_date are required');
  }

  // Get days in range
  const { data: days } = await supabase
    .from('days')
    .select('id')
    .eq('bar_id', ctx.barId)
    .gte('date', startDate)
    .lte('date', endDate);

  const dayIds = days?.map(d => d.id) || [];

  if (dayIds.length === 0) {
    return success({ products: [] });
  }

  // Get sales in range (only confirmed)
  const { data: sales } = await supabase
    .from('sales')
    .select('id')
    .in('day_id', dayIds)
    .eq('status', 'confirmed');

  const saleIds = sales?.map(s => s.id) || [];

  if (saleIds.length === 0) {
    return success({ products: [] });
  }

  // Get sale items
  const { data: items } = await supabase
    .from('sale_items')
    .select(`
      quantity,
      unit_price,
      total_price,
      product:products(id, name, category, cost_price)
    `)
    .in('sale_id', saleIds);

  // Aggregate by product
  const productSales: Record<string, {
    productId: string;
    name: string;
    category: string;
    quantitySold: number;
    totalRevenue: number;
    totalCost: number;
    profit: number;
  }> = {};

  for (const item of items || []) {
    const productId = item.product?.id || 'unknown';
    if (!productSales[productId]) {
      productSales[productId] = {
        productId,
        name: item.product?.name || 'Unknown',
        category: item.product?.category || 'other',
        quantitySold: 0,
        totalRevenue: 0,
        totalCost: 0,
        profit: 0,
      };
    }

    productSales[productId].quantitySold += item.quantity;
    productSales[productId].totalRevenue += item.total_price;
    productSales[productId].totalCost += item.quantity * (item.product?.cost_price || 0);
  }

  // Calculate profit
  const result = Object.values(productSales).map(p => ({
    ...p,
    profit: p.totalRevenue - p.totalCost,
  }));

  return success({
    startDate,
    endDate,
    products: result.sort((a, b) => b.totalRevenue - a.totalRevenue),
  });
}

/**
 * GET /reports/accountability
 * Accountability report showing money trail
 */
async function accountabilityReport(ctx: ServiceContext, url: URL): Promise<Response> {
  const supabase = createServiceClient();

  const dateParam = url.searchParams.get('date');
  const date = dateParam || new Date().toISOString().split('T')[0];

  // Get day
  const { data: day } = await supabase
    .from('days')
    .select('id')
    .eq('bar_id', ctx.barId)
    .eq('date', date)
    .single();

  if (!day) {
    return Errors.notFound(`No data for ${date}`);
  }

  // Get all sales with full details
  const { data: sales } = await supabase
    .from('sales')
    .select(`
      id,
      sale_number,
      total_amount,
      status,
      payment_method,
      created_at,
      collected_at,
      confirmed_at,
      server:users!sales_server_id_fkey(id, full_name),
      confirmed_by_user:users!sales_confirmed_by_fkey(id, full_name)
    `)
    .eq('day_id', day.id)
    .order('created_at', { ascending: true });

  // Categorize by status and server
  const unconfirmedByServer: Record<string, {
    name: string;
    pending: number;
    collected: number;
    total: number;
    sales: { saleNumber: string; amount: number; status: string }[];
  }> = {};

  let confirmedTotal = 0;
  let pendingTotal = 0;
  let collectedTotal = 0;
  let reversedTotal = 0;

  for (const sale of sales || []) {
    switch (sale.status) {
      case 'confirmed':
        confirmedTotal += sale.total_amount;
        break;
      case 'pending':
        pendingTotal += sale.total_amount;
        break;
      case 'collected':
        collectedTotal += sale.total_amount;
        break;
      case 'reversed':
        reversedTotal += sale.total_amount;
        break;
    }

    // Track unconfirmed by server
    if (sale.status === 'pending' || sale.status === 'collected') {
      const serverId = sale.server?.id || 'unknown';
      if (!unconfirmedByServer[serverId]) {
        unconfirmedByServer[serverId] = {
          name: sale.server?.full_name || 'Unknown',
          pending: 0,
          collected: 0,
          total: 0,
          sales: [],
        };
      }

      if (sale.status === 'pending') {
        unconfirmedByServer[serverId].pending += sale.total_amount;
      } else {
        unconfirmedByServer[serverId].collected += sale.total_amount;
      }
      unconfirmedByServer[serverId].total += sale.total_amount;
      unconfirmedByServer[serverId].sales.push({
        saleNumber: sale.sale_number,
        amount: sale.total_amount,
        status: sale.status,
      });
    }
  }

  return success({
    date,
    summary: {
      confirmed: confirmedTotal,
      collected: collectedTotal,
      pending: pendingTotal,
      reversed: reversedTotal,
      totalExpected: confirmedTotal + collectedTotal + pendingTotal,
      unaccountedFor: collectedTotal + pendingTotal,
    },
    unconfirmedByServer: Object.values(unconfirmedByServer),
  });
}
