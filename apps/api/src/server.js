/*
  TROUPE OS — LOCAL/DEV SERVER ENTRYPOINT

  - Uses the shared Express app from src/app.js
  - Starts a local HTTP server on PORT
  - Not used on Vercel (Vercel uses api/index.js instead)
*/

const app = require('./app');

const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  console.log(`Troupe OS API running locally on port ${PORT}`);
});
