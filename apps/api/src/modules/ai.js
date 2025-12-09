/*
  TROUPE OS — AI WORKFORCE MODULE (DEPARTMENTS + AGENTS + TASKS)

  Provides:
  - POST  /ai/departments        -> create department
  - GET   /ai/departments        -> list departments

  - POST  /ai/agents             -> create AI agent
  - GET   /ai/agents             -> list agents
  - PATCH /ai/agents/:id         -> update agent (status, description, scope, supervisor)

  - POST  /ai/tasks              -> create task for an agent
  - GET   /ai/tasks              -> list tasks (filter by agent_id, status optional)
  - PATCH /ai/tasks/:id          -> update task (status, metadata, completed_at)

  Uses tables: departments, ai_agents, ai_agent_tasks
*/

const express = require('express');
const router = express.Router();

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

// ============================================================================
// DEPARTMENTS
// ============================================================================

/**
 * POST /ai/departments
 * Body: { code: string, name: string, description?: string }
 */
router.post('/departments', async (req, res) => {
  const db = req.db;
  const { code, name, description } = req.body || {};

  if (!isNonEmptyString(code) || !isNonEmptyString(name)) {
    return res.status(400).json({ error: 'code and name are required' });
  }

  try {
    const result = await db.query(
      `
      INSERT INTO departments (code, name, description)
      VALUES ($1, $2, $3)
      RETURNING *
      `,
      [code.trim(), name.trim(), description || null]
    );

    return res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('AI: create department error:', err);
    return res.status(500).json({ error: 'Failed to create department' });
  }
});

/**
 * GET /ai/departments
 */
router.get('/departments', async (req, res) => {
  const db = req.db;

  try {
    const result = await db.query(
      `SELECT * FROM departments ORDER BY created_at DESC`
    );
    return res.status(200).json(result.rows);
  } catch (err) {
    console.error('AI: list departments error:', err);
    return res.status(500).json({ error: 'Failed to list departments' });
  }
});

// ============================================================================
// AGENTS
// ============================================================================

/**
 * POST /ai/agents
 * Body: {
 *   name: string,
 *   slug?: string,
 *   description?: string,
 *   department_id?: string,
 *   status?: 'active' | 'paused' | 'retired',
 *   scope?: object,
 *   supervisor_id?: string
 * }
 */
router.post('/agents', async (req, res) => {
  const db = req.db;
  const {
    name,
    slug,
    description,
    department_id,
    status,
    scope,
    supervisor_id
  } = req.body || {};

  if (!isNonEmptyString(name)) {
    return res.status(400).json({ error: 'name is required' });
  }

  try {
    const result = await db.query(
      `
      INSERT INTO ai_agents (
        name,
        slug,
        description,
        department_id,
        status,
        scope,
        supervisor_id
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        COALESCE($5, 'active'::ai_agent_status_enum),
        COALESCE($6, '{}'::jsonb),
        $7
      )
      RETURNING *
      `,
      [
        name.trim(),
        slug || null,
        description || null,
        department_id || null,
        status || null,
        scope || {},
        supervisor_id || null
      ]
    );

    return res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('AI: create agent error:', err);
    return res.status(500).json({ error: 'Failed to create agent' });
  }
});

/**
 * GET /ai/agents
 * Query: status?=active|paused|retired, department_id?
 */
router.get('/agents', async (req, res) => {
  const db = req.db;
  const { status, department_id } = req.query || {};

  let where = [];
  let params = [];

  if (status) {
    params.push(status);
    where.push(`status = $${params.length}::ai_agent_status_enum`);
  }

  if (department_id) {
    params.push(department_id);
    where.push(`department_id = $${params.length}`);
  }

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  try {
    const result = await db.query(
      `
      SELECT *
      FROM ai_agents
      ${whereClause}
      ORDER BY created_at DESC
      `,
      params
    );

    return res.status(200).json(result.rows);
  } catch (err) {
    console.error('AI: list agents error:', err);
    return res.status(500).json({ error: 'Failed to list agents' });
  }
});

/**
 * PATCH /ai/agents/:id
 * Body: { name?, description?, status?, scope?, supervisor_id? }
 */
router.patch('/agents/:id', async (req, res) => {
  const db = req.db;
  const { id } = req.params;
  const {
    name,
    description,
    status,
    scope,
    supervisor_id
  } = req.body || {};

  try {
    const result = await db.query(
      `
      UPDATE ai_agents
      SET
        name = COALESCE($1, name),
        description = COALESCE($2, description),
        status = COALESCE($3, status),
        scope = COALESCE($4, scope),
        supervisor_id = COALESCE($5, supervisor_id),
        updated_at = NOW()
      WHERE id = $6
      RETURNING *
      `,
      [
        name || null,
        description || null,
        status || null,
        scope || null,
        supervisor_id || null,
        id
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    return res.status(200).json(result.rows[0]);
  } catch (err) {
    console.error('AI: update agent error:', err);
    return res.status(500).json({ error: 'Failed to update agent' });
  }
});

// ============================================================================
// TASKS
// ============================================================================

/**
 * POST /ai/tasks
 * Body: {
 *   agent_id?: string,        // optional for unassigned tasks
 *   created_by_id?: string,   // human user that submitted task
 *   title: string,
 *   description?: string,
 *   status?: string,          // default 'pending'
 *   priority?: number,
 *   metadata?: object
 * }
 */
router.post('/tasks', async (req, res) => {
  const db = req.db;
  const {
    agent_id,
    created_by_id,
    title,
    description,
    status,
    priority,
    metadata
  } = req.body || {};

  if (!isNonEmptyString(title)) {
    return res.status(400).json({ error: 'title is required' });
  }

  try {
    const result = await db.query(
      `
      INSERT INTO ai_agent_tasks (
        agent_id,
        created_by_id,
        title,
        description,
        status,
        priority,
        metadata
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        COALESCE($5, 'pending'),
        COALESCE($6, 0),
        COALESCE($7, '{}'::jsonb)
      )
      RETURNING *
      `,
      [
        agent_id || null,
        created_by_id || null,
        title.trim(),
        description || null,
        status || null,
        Number.isFinite(Number(priority)) ? Number(priority) : null,
        metadata || {}
      ]
    );

    return res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('AI: create task error:', err);
    return res.status(500).json({ error: 'Failed to create task' });
  }
});

/**
 * GET /ai/tasks
 * Query: agent_id?, status?, limit?
 */
router.get('/tasks', async (req, res) => {
  const db = req.db;
  const { agent_id, status } = req.query || {};
  let limit = parseInt(req.query.limit || '50', 10);
  if (!Number.isFinite(limit) || limit <= 0) limit = 50;
  if (limit > 200) limit = 200;

  let where = [];
  let params = [];

  if (agent_id) {
    params.push(agent_id);
    where.push(`agent_id = $${params.length}`);
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
      FROM ai_agent_tasks
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${params.length + 1}
      `,
      [...params, limit]
    );

    return res.status(200).json(result.rows);
  } catch (err) {
    console.error('AI: list tasks error:', err);
    return res.status(500).json({ error: 'Failed to list tasks' });
  }
});

/**
 * PATCH /ai/tasks/:id
 * Body: { title?, description?, status?, priority?, metadata? }
 * If status becomes 'completed', completed_at will be set to NOW() if not already set.
 */
router.patch('/tasks/:id', async (req, res) => {
  const db = req.db;
  const { id } = req.params;
  const {
    title,
    description,
    status,
    priority,
    metadata
  } = req.body || {};

  try {
    const result = await db.query(
      `
      UPDATE ai_agent_tasks
      SET
        title = COALESCE($1, title),
        description = COALESCE($2, description),
        status = COALESCE($3, status),
        priority = COALESCE($4, priority),
        metadata = COALESCE($5, metadata),
        updated_at = NOW(),
        completed_at = CASE
          WHEN COALESCE($3, status) = 'completed' AND completed_at IS NULL
          THEN NOW()
          ELSE completed_at
        END
      WHERE id = $6
      RETURNING *
      `,
      [
        title || null,
        description || null,
        status || null,
        Number.isFinite(Number(priority)) ? Number(priority) : null,
        metadata || null,
        id
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }

    return res.status(200).json(result.rows[0]);
  } catch (err) {
    console.error('AI: update task error:', err);
    return res.status(500).json({ error: 'Failed to update task' });
  }
});

// ============================================================================
// MODULE HEALTH
// ============================================================================

router.get('/health/ping', (req, res) => {
  return res.status(200).json({ status: 'ok', module: 'ai' });
});

module.exports = router;
