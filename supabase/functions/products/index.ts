/**
 * Products Edge Function
 * @implements ARCHITECTURE.md Section 2.3.6 - Products
 * @implements ARCHITECTURE.md Section 7 - API Layer
 */

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { handleCors } from '../_shared/cors.ts';
import { success, Errors } from '../_shared/response.ts';
import { createServiceClient } from '../_shared/supabase.ts';
import { authenticate, requireRole, ServiceContext } from '../_shared/auth.ts';
import { validate, ValidationSchema } from '../_shared/validation.ts';

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

  const url = new URL(req.url);
  const path = url.pathname.replace('/products', '');

  try {
    switch (path) {
      case '':
      case '/':
        if (req.method === 'GET') return await listProducts(ctx, url);
        if (req.method === 'POST') return await createProduct(ctx, req);
        return Errors.badRequest('Method not allowed');

      case '/categories':
        return await listCategories();

      default:
        // Check for UUID pattern: /products/{id}
        const productIdMatch = path.match(/^\/([0-9a-f-]{36})$/i);
        if (productIdMatch) {
          if (req.method === 'GET') return await getProduct(ctx, productIdMatch[1]);
          if (req.method === 'PUT') return await updateProduct(ctx, req, productIdMatch[1]);
          if (req.method === 'DELETE') return await deactivateProduct(ctx, productIdMatch[1]);
          return Errors.badRequest('Method not allowed');
        }
        return Errors.notFound('Endpoint');
    }
  } catch (error) {
    console.error('Products error:', error);
    return Errors.internal(error.message);
  }
});

/**
 * GET /products
 * List products for the bar
 */
async function listProducts(ctx: ServiceContext, url: URL): Promise<Response> {
  const supabase = createServiceClient();

  const category = url.searchParams.get('category');
  const active = url.searchParams.get('active');
  const search = url.searchParams.get('search');
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '100'), 500);
  const offset = parseInt(url.searchParams.get('offset') || '0');

  let query = supabase
    .from('products')
    .select('*')
    .eq('bar_id', ctx.barId)
    .order('name', { ascending: true })
    .range(offset, offset + limit - 1);

  if (category) {
    query = query.eq('category', category);
  }

  if (active === 'true') {
    query = query.eq('is_active', true);
  } else if (active === 'false') {
    query = query.eq('is_active', false);
  }

  if (search) {
    query = query.ilike('name', `%${search}%`);
  }

  const { data: products, error } = await query;

  if (error) {
    console.error('List products error:', error);
    return Errors.internal('Failed to fetch products');
  }

  return success({ products, limit, offset });
}

/**
 * GET /products/categories
 * List available product categories
 */
async function listCategories(): Promise<Response> {
  const categories = [
    { value: 'beer', label: 'Beer' },
    { value: 'wine', label: 'Wine' },
    { value: 'spirits', label: 'Spirits' },
    { value: 'soft_drinks', label: 'Soft Drinks' },
    { value: 'food', label: 'Food' },
    { value: 'snacks', label: 'Snacks' },
    { value: 'other', label: 'Other' },
  ];

  return success({ categories });
}

/**
 * GET /products/{id}
 * Get a specific product
 */
async function getProduct(ctx: ServiceContext, productId: string): Promise<Response> {
  const supabase = createServiceClient();

  const { data: product, error } = await supabase
    .from('products')
    .select('*')
    .eq('id', productId)
    .eq('bar_id', ctx.barId)
    .single();

  if (error || !product) {
    return Errors.notFound('Product');
  }

  return success({ product });
}

/**
 * POST /products
 * Create a new product
 */
async function createProduct(ctx: ServiceContext, req: Request): Promise<Response> {
  // Only owner/manager can create products
  const roleError = requireRole(ctx, ['owner', 'manager']);
  if (roleError) return roleError;

  const body = await req.json();

  // Validate input
  const schema: ValidationSchema = {
    name: { required: true, type: 'string', minLength: 2, maxLength: 100 },
    category: {
      required: true,
      type: 'string',
      enum: ['beer', 'wine', 'spirits', 'soft_drinks', 'food', 'snacks', 'other'],
    },
    unit: { required: true, type: 'string', maxLength: 20 },
    sellingPrice: { required: true, type: 'number', min: 0 },
    costPrice: { required: false, type: 'number', min: 0 },
    sku: { required: false, type: 'string', maxLength: 50 },
    description: { required: false, type: 'string', maxLength: 500 },
    minStockLevel: { required: false, type: 'number', min: 0 },
  };

  const validation = validate(body, schema);
  if (!validation.valid) {
    return Errors.validationError(validation.errors);
  }

  const supabase = createServiceClient();

  // Check for duplicate name
  const { data: existing } = await supabase
    .from('products')
    .select('id')
    .eq('bar_id', ctx.barId)
    .eq('name', body.name)
    .single();

  if (existing) {
    return Errors.badRequest('A product with this name already exists');
  }

  // Create product
  const { data: product, error } = await supabase
    .from('products')
    .insert({
      bar_id: ctx.barId,
      name: body.name,
      category: body.category,
      unit: body.unit,
      selling_price: body.sellingPrice,
      cost_price: body.costPrice || null,
      sku: body.sku || null,
      description: body.description || null,
      min_stock_level: body.minStockLevel || 0,
      is_active: true,
    })
    .select('*')
    .single();

  if (error) {
    console.error('Create product error:', error);
    return Errors.internal('Failed to create product');
  }

  // Initialize stock level at 0
  await supabase
    .from('stock_levels')
    .insert({
      bar_id: ctx.barId,
      product_id: product.id,
      quantity: 0,
    });

  return success({ product }, 201);
}

/**
 * PUT /products/{id}
 * Update a product
 */
async function updateProduct(
  ctx: ServiceContext,
  req: Request,
  productId: string
): Promise<Response> {
  // Only owner/manager can update products
  const roleError = requireRole(ctx, ['owner', 'manager']);
  if (roleError) return roleError;

  const body = await req.json();

  // Validate input
  const schema: ValidationSchema = {
    name: { required: false, type: 'string', minLength: 2, maxLength: 100 },
    category: {
      required: false,
      type: 'string',
      enum: ['beer', 'wine', 'spirits', 'soft_drinks', 'food', 'snacks', 'other'],
    },
    unit: { required: false, type: 'string', maxLength: 20 },
    sellingPrice: { required: false, type: 'number', min: 0 },
    costPrice: { required: false, type: 'number', min: 0 },
    sku: { required: false, type: 'string', maxLength: 50 },
    description: { required: false, type: 'string', maxLength: 500 },
    minStockLevel: { required: false, type: 'number', min: 0 },
    isActive: { required: false, type: 'boolean' },
  };

  const validation = validate(body, schema);
  if (!validation.valid) {
    return Errors.validationError(validation.errors);
  }

  const supabase = createServiceClient();

  // Check product exists
  const { data: existing } = await supabase
    .from('products')
    .select('id')
    .eq('id', productId)
    .eq('bar_id', ctx.barId)
    .single();

  if (!existing) {
    return Errors.notFound('Product');
  }

  // Check for duplicate name if updating name
  if (body.name) {
    const { data: duplicate } = await supabase
      .from('products')
      .select('id')
      .eq('bar_id', ctx.barId)
      .eq('name', body.name)
      .neq('id', productId)
      .single();

    if (duplicate) {
      return Errors.badRequest('A product with this name already exists');
    }
  }

  // Build update object
  const updates: Record<string, unknown> = {};
  if (body.name !== undefined) updates.name = body.name;
  if (body.category !== undefined) updates.category = body.category;
  if (body.unit !== undefined) updates.unit = body.unit;
  if (body.sellingPrice !== undefined) updates.selling_price = body.sellingPrice;
  if (body.costPrice !== undefined) updates.cost_price = body.costPrice;
  if (body.sku !== undefined) updates.sku = body.sku;
  if (body.description !== undefined) updates.description = body.description;
  if (body.minStockLevel !== undefined) updates.min_stock_level = body.minStockLevel;
  if (body.isActive !== undefined) updates.is_active = body.isActive;
  updates.updated_at = new Date().toISOString();

  const { data: product, error } = await supabase
    .from('products')
    .update(updates)
    .eq('id', productId)
    .select('*')
    .single();

  if (error) {
    console.error('Update product error:', error);
    return Errors.internal('Failed to update product');
  }

  return success({ product });
}

/**
 * DELETE /products/{id}
 * Deactivate a product (soft delete)
 */
async function deactivateProduct(ctx: ServiceContext, productId: string): Promise<Response> {
  // Only owner/manager can deactivate products
  const roleError = requireRole(ctx, ['owner', 'manager']);
  if (roleError) return roleError;

  const supabase = createServiceClient();

  // Check product exists
  const { data: existing } = await supabase
    .from('products')
    .select('id, name')
    .eq('id', productId)
    .eq('bar_id', ctx.barId)
    .single();

  if (!existing) {
    return Errors.notFound('Product');
  }

  // Soft delete (deactivate)
  const { error } = await supabase
    .from('products')
    .update({
      is_active: false,
      updated_at: new Date().toISOString(),
    })
    .eq('id', productId);

  if (error) {
    console.error('Deactivate product error:', error);
    return Errors.internal('Failed to deactivate product');
  }

  return success({ message: `Product "${existing.name}" has been deactivated` });
}
