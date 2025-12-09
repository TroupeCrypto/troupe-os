/*
  TROUPE OS — ASSET REGISTRY MODULE (CORE CRUD)

  Provides:
  - POST   /assets        -> create asset
  - GET    /assets        -> list assets
  - GET    /assets/:id    -> get asset by ID
  - PATCH  /assets/:id   -> update asset (status + metadata)
*/

const express = require('express');
const router = express.Router();

// ============================================================================
// CREATE ASSET
// ============================================================================

router.post('/', async (req, res) => {
  const db = req.db;
  const {
    type,
    title,
    description,
    source,
    owner_user_id,
    owner_group_id,
    project_id,
    storage_uri,
    thumbnail_uri,
    metadata,
    external_ref
  } = req.body || {};

  if (!type || !title) {
    return res.status(400).json({ error: 'type and title are required' });
  }

  try {
    const result = await db.query(
      `
      INSERT INTO assets (
        type, title, description, source,
        owner_user_id, owner_group_id, project_id,
        storage_uri, thumbnail_uri, metadata, external_ref
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      RETURNING *
      `,
      [
        type,
        title,
        description || null,
        source || null,
        owner_user_id || null,
        owner_group_id || null,
        project_id || null,
        storage_uri || null,
        thumbnail_uri || null,
        metadata || {},
        external_ref || null
      ]
    );

    return res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Asset create error:', err);
    return res.status(500).json({ error: 'Failed to create asset' });
  }
});

// ============================================================================
// LIST ASSETS
// ============================================================================

router.get('/', async (req, res) => {
  const db = req.db;

  try {
    const result = await db.query(
      `SELECT * FROM assets ORDER BY created_at DESC LIMIT 100`
    );

    return res.status(200).json(result.rows);
  } catch (err) {
    console.error('Asset list error:', err);
    return res.status(500).json({ error: 'Failed to list assets' });
  }
});

// ============================================================================
// GET SINGLE ASSET
// ============================================================================

router.get('/:id', async (req, res) => {
  const db = req.db;
  const { id } = req.params;

  try {
    const result = await db.query(
      `SELECT * FROM assets WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Asset not found' });
    }

    return res.status(200).json(result.rows[0]);
  } catch (err) {
    console.error('Asset get error:', err);
    return res.status(500).json({ error: 'Failed to fetch asset' });
  }
});

// ============================================================================
// UPDATE ASSET (STATUS + METADATA)
// ============================================================================

router.patch('/:id', async (req, res) => {
  const db = req.db;
  const { id } = req.params;
  const { status, metadata } = req.body || {};

  try {
    const result = await db.query(
      `
      UPDATE assets
      SET
        status = COALESCE($1, status),
        metadata = COALESCE($2, metadata)
      WHERE id = $3
      RETURNING *
      `,
      [
        status || null,
        metadata || null,
        id
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Asset not found' });
    }

    return res.status(200).json(result.rows[0]);
  } catch (err) {
    console.error('Asset update error:', err);
    return res.status(500).json({ error: 'Failed to update asset' });
  }
});

// ============================================================================
// MODULE HEALTH
// ============================================================================

router.get('/health/ping', (req, res) => {
  return res.status(200).json({ status: 'ok', module: 'assets' });
});

module.exports = router;
