/*
  TROUPE OS — CORE API SERVER BOOTSTRAP
  This file initializes:
  - Environment loading
  - Database connection
  - Core middleware
  - Health check endpoint
  - Future routing mount points for Auth, Assets, Financials, AI, etc.
*/

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const { Pool } = require('pg');

// ============================================================================
// 1. ENVIRONMENT VALIDATION
// ============================================================================

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not defined in environment variables.');
}

if (!process.env.PORT) {
  process.env.PORT = 4000;
}

// ============================================================================
// 2. DATABASE CONNECTION
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
  process.exit(1);
});

// ============================================================================
// 3. EXPRESS APP SETUP
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
// 5. ROUTE MOUNT POINTS (TO BE IMPLEMENTED IN NEXT STEPS)
// ============================================================================

// Auth & Identity
// app.use('/auth', require('./modules/auth'));

// Assets
app.use('/assets', require('./modules/assets'));

// Financials
app.use('/financials', require('./modules/financials'));

// AI Workforce
app.use('/ai', require('./modules/ai'));

// Marketplace
app.use('/marketplace', require('./modules/marketplace'));

// Admin
// app.use('/admin', require('./modules/admin'));

// ============================================================================
// 6. SERVER START
// ============================================================================

const PORT = process.env.PORT;

app.listen(PORT, () => {
  console.log(`Troupe OS API running on port ${PORT}`);
});
