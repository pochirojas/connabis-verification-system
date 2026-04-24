// server.js — Entry Point
// CRITICAL: const app = express() MUST come before ANY route registration
// CRITICAL: MUST listen on process.env.PORT for Render
// NO business logic here — only app initialization

import express from 'express';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import shopifyRoutes from './routes/shopify.js';
import sumaRoutes from './routes/suma.js';
import profileRoutes from './routes/profile.js';
import adminRoutes from './routes/admin.js';
import registerRoutes from './routes/register.js';
import { sendTestEmail } from './services/email.js';
import { logEvent } from './services/logger.js';

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

// Debug endpoint: runs full verification flow and streams logs back
app.get('/test/flow', async (req, res) => {
  const logs = [];
  const log = (msg) => { logs.push(msg); console.log('[TestFlow]', msg); };
  try {
    const { startVerificationFlow } = await import('./routes/shopify.js');
    log('Starting verification flow for srojasbon@gmail.com...');
    await startVerificationFlow({
      id: '8455601750093',
      email: 'srojasbon@gmail.com',
      first_name: 'Test',
      last_name: 'User'
    });
    log('Flow completed successfully');
    res.status(200).json({ success: true, logs });
  } catch (err) {
    log('FAILED: ' + err.message);
    res.status(500).json({ success: false, error: err.message, logs });
  }
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

// Allow Shopify storefront to embed our pages in iframes
app.use((req, res, next) => {
  res.setHeader('X-Frame-Options', 'ALLOW-FROM https://connabis.com.co');
  res.setHeader('Content-Security-Policy', "frame-ancestors 'self' https://connabis.com.co");
  next();
});

// Mount route handlers
app.use('/webhooks/shopify', shopifyRoutes);
app.use('/suma', sumaRoutes);
app.use('/profile', profileRoutes);
app.use('/admin', adminRoutes);
app.use('/register', registerRoutes);

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
  logEvent({ type: 'error', status: 'error', detail: `Unhandled error: ${err.message}` });
  res.status(500).json({ error: 'Internal server error' });
});

// Start server (MUST use process.env.PORT for Render)
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server listening on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Base URL: ${process.env.APP_BASE_URL || 'http://localhost:' + PORT}`);

  // Keep-alive: Ping own health endpoint every 10 minutes to prevent Render
  // free tier from sleeping the service. Sleeping causes 30s–60s cold start
  // delays on the next incoming webhook, which can delay emails significantly.
  const baseUrl = process.env.APP_BASE_URL || `http://localhost:${PORT}`;
  setInterval(async () => {
    try {
      const res = await fetch(`${baseUrl}/health`);
      if (res.ok) {
        console.log('[Keep-Alive] Ping OK');
      } else {
        console.warn('[Keep-Alive] Ping returned:', res.status);
      }
    } catch (err) {
      console.warn('[Keep-Alive] Ping failed:', err.message);
    }
  }, 10 * 60 * 1000); // Every 10 minutes
});
