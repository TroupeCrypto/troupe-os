/*
  TROUPE OS — VERCEL SERVERLESS ENTRYPOINT

  This file exposes the Express app as a Vercel serverless function.
  On Vercel, requests to /api/* will be handled by this module.

  IMPORTANT:
  - In the Vercel project settings, set the Root Directory to "apps/api".
  - Then the deployed routes will look like:
      /api/health
      /api/auth/login
      /api/assets
      etc.
*/

const app = require('../src/app');
const serverless = require('serverless-http');

// Wrap Express app for serverless
module.exports = serverless(app);
