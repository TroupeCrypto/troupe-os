/*
  TROUPE OS — EXPRESS APP FACTORY (Vercel-compatible)

  This file creates and exports the Express app WITHOUT calling app.listen().
  It is used by:
    - src/server.js for local/dev running
    - api/index.js as the Vercel serverless handler
*/

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const { Pool } = require('pg');

const isServerless = !!process.env.VERCEL;

// ============================================================================
// 1. ENVIRONMENT VALIDATION
// ============================================================================

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not defined in environment variables.');
}

// ============================================================================
// 2. DATABASE CONNECTION POOL
// ============================================================================

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

pool.on('connect', () => {
  console.log('PostgreSQL connected.');
});

pool.on('error', (err) => {
  console.error('PostgreSQL connection error:', err);
  if (!isServerless) {
    process.exit(1);
  }
});

// ============================================================================
// 3. CREATE EXPRESS APP
// ============================================================================

const app = express();

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));

// Attach DB to request for all downstream routes
app.use((req, res, next) => {
  req.db = pool;
  next();
});

// ============================================================================
// 4. CORE HEALTH CHECK
// ============================================================================

app.get('/health', async (req, res) => {
  try {
    const result = await req.db.query('SELECT NOW() as server_time');
    res.status(200).json({
      status: 'ok',
      server_time: result.rows[0].server_time,
      environment: process.env.NODE_ENV || 'development'
    });
  } catch (err) {
    console.error('Health check failed:', err);
    res.status(500).json({
      status: 'error',
      error: 'Database connection failed'
    });
  }
});

// ============================================================================
// 5. ROUTE MOUNT POINTS
// ============================================================================

const mountModule = (mountPath, modulePath, label) => {
  const moduleExists = () => {
    try {
      require.resolve(modulePath);
      return true;
    } catch (resolveErr) {
      return false;
    }
  };

  if (!moduleExists()) {
    console.warn(`${label} module not loaded: missing at ${modulePath}`);
    return;
  }

  try {
    app.use(mountPath, require(modulePath));
  } catch (e) {
    console.error(`${label} module failed to load:`, e);
    return;
  }
};

mountModule('/assets', './modules/assets', 'Assets');
mountModule('/financials', './modules/financials', 'Financials');
mountModule('/ai', './modules/ai', 'AI');
mountModule('/marketplace', './modules/marketplace', 'Marketplace');

module.exports = app;
