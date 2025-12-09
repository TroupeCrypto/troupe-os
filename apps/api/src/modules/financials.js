/*
  TROUPE OS — FINANCIALS MODULE (ACCOUNTS + LEDGER CORE)

  Provides:
  - POST  /financials/accounts          -> create financial account
  - GET   /financials/accounts          -> list accounts
  - POST  /financials/ledger/entries    -> create double-entry ledger entry + lines
  - GET   /financials/ledger/entries    -> list recent ledger entries (with basic info)
  - GET   /financials/health/ping       -> module health

  NOTE:
  - Uses the existing tables: accounts, ledger_entries, ledger_lines
  - Assumes ENUM ledger_direction_enum already exists (debit/credit)
*/

const express = require('express');
const router = express.Router();
const DECIMAL_PRECISION = 18;

// ============================================================================
// HELPERS
// ============================================================================

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

// ============================================================================
// CREATE ACCOUNT
// ============================================================================

/**
 * POST /financials/accounts
 * Body: {
 *   name: string (required),
 *   code?: string,
 *   description?: string,
 *   currency?: string,  // default 'USD'
 *   owner_group_id?: string,
 *   owner_user_id?: string,
 *   metadata?: object
 * }
 */
router.post('/accounts', async (req, res) => {
  const db = req.db;
  const {
    name,
    code,
    description,
    currency,
    owner_group_id,
    owner_user_id,
    metadata
  } = req.body || {};

  if (!isNonEmptyString(name)) {
    return res.status(400).json({ error: 'name is required' });
  }

  try {
    const result = await db.query(
      `
      INSERT INTO accounts (
        name, code, description, currency,
        owner_group_id, owner_user_id, metadata, is_active
      )
      VALUES ($1,$2,$3,COALESCE($4,'USD'),$5,$6,COALESCE($7,'{}'::jsonb),TRUE)
      RETURNING *
      `,
      [
        name,
        code || null,
        description || null,
        currency || null,
        owner_group_id || null,
        owner_user_id || null,
        metadata || {}
      ]
    );

    return res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Financials: create account error:', err);
    return res.status(500).json({ error: 'Failed to create account' });
  }
});

// ============================================================================
// LIST ACCOUNTS
// ============================================================================

/**
 * GET /financials/accounts
 * Query params (optional):
 *   active_only=true|false (default true)
 */
router.get('/accounts', async (req, res) => {
  const db = req.db;
  const activeOnly = req.query.active_only !== 'false';

  try {
    const result = await db.query(
      activeOnly
        ? `SELECT * FROM accounts WHERE is_active = TRUE ORDER BY created_at DESC`
        : `SELECT * FROM accounts ORDER BY created_at DESC`
    );

    return res.status(200).json(result.rows);
  } catch (err) {
    console.error('Financials: list accounts error:', err);
    return res.status(500).json({ error: 'Failed to list accounts' });
  }
});

// ============================================================================
// CREATE LEDGER ENTRY (DOUBLE-ENTRY)
// ============================================================================

/**
 * POST /financials/ledger/entries
 * Body: {
 *   description?: string,
 *   reference_type?: string,
 *   reference_id?: string,
 *   metadata?: object,
 *   lines: [
 *     {
 *       account_id: string,
 *       direction: 'debit' | 'credit',
 *       amount: string | number,
 *       currency: string,
 *       metadata?: object
 *     },
 *     ...
 *   ]
 * }
 *
 * Requirements:
 * - At least 2 lines
 * - Sum(debits) == Sum(credits) in same currency
 */
router.post('/ledger/entries', async (req, res) => {
  const db = req.db;
  const {
    description,
    reference_type,
    reference_id,
    metadata,
    lines
  } = req.body || {};

  if (!Array.isArray(lines) || lines.length < 2) {
    return res.status(400).json({ error: 'At least two ledger lines are required' });
  }

  // Validate and normalize lines
  const normalizedLines = [];
  let currency = null;
  let totalDebits = 0;
  let totalCredits = 0;

  for (const line of lines) {
    const {
      account_id,
      direction,
      amount,
      currency: lineCurrency,
      metadata: lineMetadata
    } = line || {};

    if (!account_id || !direction || amount == null || !lineCurrency) {
      return res.status(400).json({ error: 'Each line requires account_id, direction, amount, and currency' });
    }

    const dir = String(direction).toLowerCase();
    if (dir !== 'debit' && dir !== 'credit') {
      return res.status(400).json({ error: 'direction must be debit or credit' });
    }

    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({ error: 'amount must be a positive number' });
    }

    const ccy = String(lineCurrency).toUpperCase();
    if (!currency) {
      currency = ccy;
    } else if (currency !== ccy) {
      return res.status(400).json({ error: 'All lines must use the same currency' });
    }

    if (dir === 'debit') {
      totalDebits += numericAmount;
    } else {
      totalCredits += numericAmount;
    }

    normalizedLines.push({
      account_id,
      direction: dir,
      amount: numericAmount,
      currency: ccy,
      metadata: lineMetadata || {}
    });
  }

  // Double-entry integrity check
  const roundedDebits = Number(totalDebits.toFixed(DECIMAL_PRECISION));
  const roundedCredits = Number(totalCredits.toFixed(DECIMAL_PRECISION));

  if (roundedDebits !== roundedCredits) {
    return res.status(400).json({
      error: 'Debits and credits must balance',
      details: { total_debits: roundedDebits, total_credits: roundedCredits }
    });
  }

  // Insert entry + lines in a transaction
  let client = null;
  try {
    client = await db.connect();
  } catch (err) {
    console.error('Financials: db connect error:', err);
    return res.status(500).json({ error: 'Database connection failed' });
  }

  try {
    await client.query('BEGIN');

    const entryResult = await client.query(
      `
      INSERT INTO ledger_entries (
        occurred_at,
        description,
        reference_type,
        reference_id,
        metadata
      )
      VALUES (NOW(), $1, $2, $3, COALESCE($4,'{}'::jsonb))
      RETURNING id, occurred_at, description, reference_type, reference_id, metadata, created_at
      `,
      [
        description || null,
        reference_type || null,
        reference_id || null,
        metadata || {}
      ]
    );

    const entry = entryResult.rows[0];

    const lineInserts = [];
    for (const line of normalizedLines) {
      const lineResult = await client.query(
        `
        INSERT INTO ledger_lines (
          entry_id,
          account_id,
          direction,
          amount,
          currency,
          metadata
        )
        VALUES ($1,$2,$3,$4,$5,COALESCE($6,'{}'::jsonb))
        RETURNING id, account_id, direction, amount, currency, metadata
        `,
        [
          entry.id,
          line.account_id,
          line.direction,
          line.amount,
          line.currency,
          line.metadata
        ]
      );
      lineInserts.push(lineResult.rows[0]);
    }

    await client.query('COMMIT');

    return res.status(201).json({
      entry,
      lines: lineInserts
    });
  } catch (err) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackErr) {
        console.error('Financials: rollback error:', rollbackErr);
      }
    }
    console.error('Financials: create ledger entry error:', err);
    return res.status(500).json({ error: 'Failed to create ledger entry' });
  } finally {
    if (client) {
      client.release();
    }
  }
});

// ============================================================================
// LIST LEDGER ENTRIES (BASIC VIEW)
// ============================================================================

/**
 * GET /financials/ledger/entries
 * Query params:
 *   limit?: number (default 50, max 200)
 */
router.get('/ledger/entries', async (req, res) => {
  const db = req.db;
  let limit = parseInt(req.query.limit || '50', 10);
  if (!Number.isFinite(limit) || limit <= 0) limit = 50;
  if (limit > 200) limit = 200;

  try {
    const result = await db.query(
      `
      SELECT
        id,
        occurred_at,
        description,
        reference_type,
        reference_id,
        metadata,
        created_at
      FROM ledger_entries
      ORDER BY occurred_at DESC
      LIMIT $1
      `,
      [limit]
    );

    return res.status(200).json(result.rows);
  } catch (err) {
    console.error('Financials: list ledger entries error:', err);
    return res.status(500).json({ error: 'Failed to list ledger entries' });
  }
});

// ============================================================================
// MODULE HEALTH
// ============================================================================

router.get('/health/ping', (req, res) => {
  return res.status(200).json({ status: 'ok', module: 'financials' });
});

module.exports = router;
