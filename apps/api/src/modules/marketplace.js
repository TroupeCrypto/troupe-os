/*
  TROUPE OS — MARKETPLACE MODULE (PRODUCTS + LISTINGS + ORDERS)

  Provides:

  PRODUCTS
  - POST  /marketplace/products        -> create product
  - GET   /marketplace/products        -> list products

  LISTINGS
  - POST  /marketplace/listings        -> create listing for a product
  - GET   /marketplace/listings        -> list listings (optional filters)

  ORDERS
  - POST  /marketplace/orders          -> create order (empty cart)
  - GET   /marketplace/orders          -> list orders (basic)
  - POST  /marketplace/orders/:id/items -> add item to order
  - PATCH /marketplace/orders/:id/status -> update order status (cart/pending/paid/fulfilled/etc.)

  HEALTH
  - GET   /marketplace/health/ping     -> module health
*/

const express = require('express');
const router = express.Router();

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

// ============================================================================
// PRODUCTS
// ============================================================================

/**
 * POST /marketplace/products
 * Body: {
 *   title: string,
 *   description?: string,
 *   asset_id?: string,
 *   project_id?: string,
 *   currency?: string,        // default 'USD'
 *   unit_price: number,
 *   is_active?: boolean,
 *   metadata?: object
 * }
 */
router.post('/products', async (req, res) => {
  const db = req.db;
  const {
    title,
    description,
    asset_id,
    project_id,
    currency,
    unit_price,
    is_active,
    metadata
  } = req.body || {};

  if (!isNonEmptyString(title)) {
    return res.status(400).json({ error: 'title is required' });
  }

  const priceNum = Number(unit_price);
  if (!Number.isFinite(priceNum) || priceNum < 0) {
    return res.status(400).json({ error: 'unit_price must be a non-negative number' });
  }

  try {
    const result = await db.query(
      `
      INSERT INTO products (
        title,
        description,
        asset_id,
        project_id,
        currency,
        unit_price,
        is_active,
        metadata
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        COALESCE($5, 'USD'),
        $6,
        COALESCE($7, TRUE),
        COALESCE($8, '{}'::jsonb)
      )
      RETURNING *
      `,
      [
        title.trim(),
        description || null,
        asset_id || null,
        project_id || null,
        currency || null,
        priceNum,
        typeof is_active === 'boolean' ? is_active : null,
        metadata || {}
      ]
    );

    return res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Marketplace: create product error:', err);
    return res.status(500).json({ error: 'Failed to create product' });
  }
});

/**
 * GET /marketplace/products
 * Query: is_active?=true|false, limit? (default 100)
 */
router.get('/products', async (req, res) => {
  const db = req.db;
  const { is_active } = req.query || {};
  let limit = parseInt(req.query.limit || '100', 10);
  if (!Number.isFinite(limit) || limit <= 0) limit = 100;
  if (limit > 500) limit = 500;

  let where = [];
  let params = [];

  if (is_active === 'true' || is_active === 'false') {
    params.push(is_active === 'true');
    where.push(`is_active = $${params.length}`);
  }

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  try {
    const result = await db.query(
      `
      SELECT *
      FROM products
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${params.length + 1}
      `,
      [...params, limit]
    );

    return res.status(200).json(result.rows);
  } catch (err) {
    console.error('Marketplace: list products error:', err);
    return res.status(500).json({ error: 'Failed to list products' });
  }
});

// ============================================================================
// LISTINGS
// ============================================================================

/**
 * POST /marketplace/listings
 * Body: {
 *   product_id: string,
 *   channel: string,      // e.g. 'site', 'drop'
 *   label?: string,
 *   is_active?: boolean,
 *   starts_at?: string (ISO),
 *   ends_at?: string (ISO),
 *   metadata?: object
 * }
 */
router.post('/listings', async (req, res) => {
  const db = req.db;
  const {
    product_id,
    channel,
    label,
    is_active,
    starts_at,
    ends_at,
    metadata
  } = req.body || {};

  if (!isNonEmptyString(product_id) || !isNonEmptyString(channel)) {
    return res.status(400).json({ error: 'product_id and channel are required' });
  }

  try {
    const result = await db.query(
      `
      INSERT INTO listings (
        product_id,
        channel,
        label,
        is_active,
        starts_at,
        ends_at,
        metadata
      )
      VALUES (
        $1,
        $2,
        $3,
        COALESCE($4, TRUE),
        $5,
        $6,
        COALESCE($7, '{}'::jsonb)
      )
      RETURNING *
      `,
      [
        product_id,
        channel.trim(),
        label || null,
        typeof is_active === 'boolean' ? is_active : null,
        starts_at || null,
        ends_at || null,
        metadata || {}
      ]
    );

    return res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Marketplace: create listing error:', err);
    return res.status(500).json({ error: 'Failed to create listing' });
  }
});

/**
 * GET /marketplace/listings
 * Query:
 *   channel?=string,
 *   product_id?=uuid,
 *   active_only?=true|false (default true)
 */
router.get('/listings', async (req, res) => {
  const db = req.db;
  const { channel, product_id } = req.query || {};
  const activeOnly = req.query.active_only !== 'false';
  let limit = parseInt(req.query.limit || '200', 10);
  if (!Number.isFinite(limit) || limit <= 0) limit = 200;
  if (limit > 500) limit = 500;

  let where = [];
  let params = [];

  if (channel) {
    params.push(channel);
    where.push(`channel = $${params.length}`);
  }

  if (product_id) {
    params.push(product_id);
    where.push(`product_id = $${params.length}`);
  }

  if (activeOnly) {
    where.push(`is_active = TRUE`);
  }

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  try {
    const result = await db.query(
      `
      SELECT *
      FROM listings
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${params.length + 1}
      `,
      [...params, limit]
    );

    return res.status(200).json(result.rows);
  } catch (err) {
    console.error('Marketplace: list listings error:', err);
    return res.status(500).json({ error: 'Failed to list listings' });
  }
});

// ============================================================================
// ORDERS
// ============================================================================

/**
 * POST /marketplace/orders
 * Body: {
 *   user_id?: string,
 *   currency?: string,         // default 'USD'
 *   metadata?: object
 * }
 * Creates an empty "cart" order.
 */
router.post('/orders', async (req, res) => {
  const db = req.db;
  const { user_id, currency, metadata } = req.body || {};

  try {
    const result = await db.query(
      `
      INSERT INTO orders (
        user_id,
        status,
        currency,
        subtotal_amount,
        total_amount,
        metadata
      )
      VALUES (
        $1,
        'cart',
        COALESCE($2, 'USD'),
        0,
        0,
        COALESCE($3, '{}'::jsonb)
      )
      RETURNING *
      `,
      [
        user_id || null,
        currency || null,
        metadata || {}
      ]
    );

    return res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Marketplace: create order error:', err);
    return res.status(500).json({ error: 'Failed to create order' });
  }
});

/**
 * GET /marketplace/orders
 * Query: user_id?, status?, limit?
 */
router.get('/orders', async (req, res) => {
  const db = req.db;
  const { user_id, status } = req.query || {};
  let limit = parseInt(req.query.limit || '50', 10);
  if (!Number.isFinite(limit) || limit <= 0) limit = 50;
  if (limit > 200) limit = 200;

  let where = [];
  let params = [];

  if (user_id) {
    params.push(user_id);
    where.push(`user_id = $${params.length}`);
  }

  if (status) {
    params.push(status);
    where.push(`status = $${params.length}`);
  }

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  try {
    const result = await db.query(
      `
      SELECT *
      FROM orders
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${params.length + 1}
      `,
      [...params, limit]
    );

    return res.status(200).json(result.rows);
  } catch (err) {
    console.error('Marketplace: list orders error:', err);
    return res.status(500).json({ error: 'Failed to list orders' });
  }
});

/**
 * POST /marketplace/orders/:id/items
 * Body: {
 *   product_id: string,
 *   listing_id?: string,
 *   quantity: number
 * }
 * Recomputes subtotal and total as simple sum of item totals (no tax/fees yet).
 */
router.post('/orders/:id/items', async (req, res) => {
  const db = req.db;
  const { id } = req.params;
  const { product_id, listing_id, quantity } = req.body || {};

  if (!product_id) {
    return res.status(400).json({ error: 'product_id is required' });
  }

  const qty = Number(quantity);
  if (!Number.isFinite(qty) || qty <= 0) {
    return res.status(400).json({ error: 'quantity must be a positive number' });
  }

  const client = await db.connect();

  try {
    await client.query('BEGIN');

    // Fetch product price and currency
    const productRes = await client.query(
      `SELECT id, currency, unit_price FROM products WHERE id = $1 AND is_active = TRUE`,
      [product_id]
    );
    if (productRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Product not found or inactive' });
    }
    const product = productRes.rows[0];

    // Ensure order exists
    const orderRes = await client.query(
      `SELECT * FROM orders WHERE id = $1`,
      [id]
    );
    if (orderRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Order not found' });
    }
    const order = orderRes.rows[0];

    if (order.currency !== product.currency) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Order and product currency must match' });
    }

    const unitPrice = Number(product.unit_price);
    const totalPrice = unitPrice * qty;

    // Insert order item
    await client.query(
      `
      INSERT INTO order_items (
        order_id,
        product_id,
        listing_id,
        quantity,
        unit_price,
        total_price,
        metadata
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,'{}'::jsonb
      )
      `,
      [
        id,
        product_id,
        listing_id || null,
        qty,
        unitPrice,
        totalPrice
      ]
    );

    // Recompute order subtotal / total (simple sum)
    const itemsRes = await client.query(
      `
      SELECT COALESCE(SUM(total_price), 0) AS subtotal
      FROM order_items
      WHERE order_id = $1
      `,
      [id]
    );
    const subtotal = Number(itemsRes.rows[0].subtotal) || 0;

    const updatedOrderRes = await client.query(
      `
      UPDATE orders
      SET
        subtotal_amount = $1,
        total_amount = $1,
        updated_at = NOW()
      WHERE id = $2
      RETURNING *
      `,
      [subtotal, id]
    );

    await client.query('COMMIT');

    return res.status(200).json({
      order: updatedOrderRes.rows[0]
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Marketplace: add order item error:', err);
    return res.status(500).json({ error: 'Failed to add item to order' });
  } finally {
    client.release();
  }
});

/**
 * PATCH /marketplace/orders/:id/status
 * Body: { status: string }
 * Allowed transitions are not strictly enforced yet (handled at app layer).
 */
router.patch('/orders/:id/status', async (req, res) => {
  const db = req.db;
  const { id } = req.params;
  const { status } = req.body || {};

  if (!isNonEmptyString(status)) {
    return res.status(400).json({ error: 'status is required' });
  }

  try {
    const result = await db.query(
      `
      UPDATE orders
      SET
        status = $1,
        updated_at = NOW(),
        completed_at = CASE
          WHEN $1 IN ('paid','fulfilled') AND completed_at IS NULL THEN NOW()
          ELSE completed_at
        END
      WHERE id = $2
      RETURNING *
      `,
      [status, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }

    return res.status(200).json(result.rows[0]);
  } catch (err) {
    console.error('Marketplace: update order status error:', err);
    return res.status(500).json({ error: 'Failed to update order status' });
  }
});

// ============================================================================
// MODULE HEALTH
// ============================================================================

router.get('/health/ping', (req, res) => {
  return res.status(200).json({ status: 'ok', module: 'marketplace' });
});

module.exports = router;
