// server.js — Entry Point
// CRITICAL: const app = express() MUST come before ANY route registration
// CRITICAL: MUST listen on process.env.PORT for Render
// NO business logic here — only app initialization

import express from 'express';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import shopifyRoutes from './routes/shopify.js';
import sumaRoutes from './routes/suma.js';
import { sendTestEmail } from './services/email.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();

// Serve static assets (e.g. email banner images)
app.use('/public', express.static(join(__dirname, 'public')));

// Middleware: Parse JSON and preserve raw body for HMAC verification
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));

// Health check endpoint (required for Render)
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'connabis-verification-system',
    timestamp: new Date().toISOString()
  });
});

// Test endpoint for email functionality
app.get('/test/email', async (req, res) => {
  try {
    const result = await sendTestEmail();
    console.log('[Test Email] Success:', JSON.stringify(result));
    res.status(200).json({ success: true, message: 'Test email sent' });
  } catch (error) {
    console.error('[Test Email] Error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Mount route handlers
app.use('/webhooks/shopify', shopifyRoutes);
app.use('/suma', sumaRoutes);

// Catch-all for unknown routes
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Not found',
    message: `Route ${req.method} ${req.originalUrl} does not exist`
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('[Global Error]', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server (MUST use process.env.PORT for Render)
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server listening on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Base URL: ${process.env.APP_BASE_URL || 'http://localhost:' + PORT}`);
});
