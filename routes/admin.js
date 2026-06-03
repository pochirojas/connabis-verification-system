// routes/admin.js — Admin monitoring dashboard
import express from 'express';
import { createHmac, timingSafeEqual } from 'crypto';
import { getEvents, getStats } from '../services/logger.js';

const router = express.Router();

// ─── Override token helpers ──────────────────────────────────────────────────
const OVERRIDE_SECRET = process.env.OVERRIDE_SECRET || 'connabis-override-secret-2026';
const OVERRIDE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export function generateOverrideToken(customerId) {
  const expires = Date.now() + OVERRIDE_TTL_MS;
  const payload = `${customerId}:${expires}`;
  const sig = createHmac('sha256', OVERRIDE_SECRET).update(payload).digest('hex');
  // Base64url-encode so it's safe in email links
  return Buffer.from(`${payload}:${sig}`).toString('base64url');
}

function verifyOverrideToken(token) {
  try {
    const decoded = Buffer.from(token, 'base64url').toString('utf8');
    const parts = decoded.split(':');
    if (parts.length !== 3) return null;
    const [customerId, expires, sig] = parts;
    if (Date.now() > Number(expires)) return null; // expired
    const payload = `${customerId}:${expires}`;
    const expected = createHmac('sha256', OVERRIDE_SECRET).update(payload).digest('hex');
    const sigBuf = Buffer.from(sig, 'hex');
    const expBuf = Buffer.from(expected, 'hex');
    if (sigBuf.length !== expBuf.length) return null;
    if (!timingSafeEqual(sigBuf, expBuf)) return null;
    return customerId;
  } catch { return null; }
}

// GET /admin/status — HTML dashboard
router.get('/status', (req, res) => {
  const events = getEvents();
  const stats = getStats();

  const statusColor = (s) => {
    if (s === 'ok') return '#28a745';
    if (s === 'error') return '#dc3545';
    if (s === 'skipped') return '#6c757d';
    if (s === 'warn') return '#fd7e14';
    return '#333';
  };

  const typeIcon = (t) => {
    if (t === 'webhook') return '🔔';
    if (t === 'email') return '📧';
    if (t === 'verification') return '🪪';
    if (t === 'profile') return '👤';
    if (t === 'error') return '❌';
    return '•';
  };

  const formatTs = (ts) => {
    const d = new Date(ts);
    return d.toLocaleString('es-CO', { timeZone: 'America/Bogota', hour12: false });
  };

  const rows = events.map(e => `
    <tr>
      <td style="padding:8px 10px;color:#999;white-space:nowrap;font-size:12px;">${formatTs(e.ts)}</td>
      <td style="padding:8px 10px;">${typeIcon(e.type)} <span style="font-size:12px;color:#666;">${e.type}</span></td>
      <td style="padding:8px 10px;">
        <span style="display:inline-block;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600;
          background:${statusColor(e.status)}22;color:${statusColor(e.status)};">
          ${e.status}
        </span>
      </td>
      <td style="padding:8px 10px;font-size:13px;">${e.detail}</td>
      <td style="padding:8px 10px;font-size:12px;color:#666;">${e.email || ''}</td>
      <td style="padding:8px 10px;font-size:12px;color:#999;">${e.customerId || ''}</td>
    </tr>
  `).join('');

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="refresh" content="30">
  <title>Connabis — Admin Dashboard</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #0f0f0f; color: #e0e0e0; min-height: 100vh; padding: 24px; }
    h1 { color: #2d6a4f; font-size: 22px; margin-bottom: 4px; }
    .subtitle { color: #666; font-size: 13px; margin-bottom: 24px; }
    .stats { display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 28px; }
    .stat { background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 8px;
      padding: 16px 20px; min-width: 130px; }
    .stat-value { font-size: 28px; font-weight: 700; color: #fff; }
    .stat-label { font-size: 12px; color: #666; margin-top: 4px; }
    .stat.error .stat-value { color: #dc3545; }
    .stat.ok .stat-value { color: #28a745; }
    table { width: 100%; border-collapse: collapse; background: #1a1a1a;
      border: 1px solid #2a2a2a; border-radius: 8px; overflow: hidden; font-size: 13px; }
    thead tr { background: #222; }
    th { padding: 10px 10px; text-align: left; font-size: 11px; text-transform: uppercase;
      letter-spacing: 0.5px; color: #666; border-bottom: 1px solid #2a2a2a; }
    tbody tr { border-bottom: 1px solid #1e1e1e; }
    tbody tr:hover { background: #222; }
    tbody tr:last-child { border-bottom: none; }
    .empty { text-align: center; padding: 48px; color: #555; }
    .refresh { font-size: 12px; color: #555; margin-bottom: 12px; }
    .health { display: inline-block; width: 8px; height: 8px; border-radius: 50%;
      background: #28a745; margin-right: 6px; }
  </style>
</head>
<body>
  <h1>🌿 Connabis — Admin Dashboard</h1>
  <p class="subtitle">
    <span class="health"></span>Sistema activo &nbsp;·&nbsp;
    Hora Colombia: ${new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota', hour12: false })} &nbsp;·&nbsp;
    Auto-refresh cada 30s
  </p>

  <div class="stats">
    <div class="stat ok">
      <div class="stat-value">${stats.webhooks}</div>
      <div class="stat-label">Webhooks (24h)</div>
    </div>
    <div class="stat ok">
      <div class="stat-value">${stats.emailsSent}</div>
      <div class="stat-label">Emails enviados (24h)</div>
    </div>
    <div class="stat ok">
      <div class="stat-value">${stats.verifications}</div>
      <div class="stat-label">Verificaciones (24h)</div>
    </div>
    <div class="stat ${stats.errors > 0 ? 'error' : 'ok'}">
      <div class="stat-value">${stats.errors}</div>
      <div class="stat-label">Errores (24h)</div>
    </div>
    <div class="stat">
      <div class="stat-value">${stats.total}</div>
      <div class="stat-label">Total en memoria</div>
    </div>
  </div>

  <p class="refresh">Mostrando últimos ${events.length} eventos (se reinicia con cada deploy)</p>

  <table>
    <thead>
      <tr>
        <th>Hora (COT)</th>
        <th>Tipo</th>
        <th>Estado</th>
        <th>Detalle</th>
        <th>Email</th>
        <th>Customer ID</th>
      </tr>
    </thead>
    <tbody>
      ${rows || `<tr><td colspan="6" class="empty">No hay eventos registrados aún</td></tr>`}
    </tbody>
  </table>
</body>
</html>`;

  res.send(html);
});

// GET /admin/status.json — Raw JSON for programmatic access
router.get('/status.json', (req, res) => {
  res.json({ stats: getStats(), events: getEvents() });
});

// POST /admin/resend?customerId=123&email=x@y.com
// Manually trigger verification flow for a customer (tries full flow, falls back to profile email)
// GET /admin/customers — recent customers with tags + metafields for QA
router.get('/customers', async (req, res) => {
  try {
    const { shopifyAdminFetch } = await import('../services/shopify.js');
    // Get last 50 customers ordered by creation date
    const data = await shopifyAdminFetch('/customers.json?limit=50&order=created_at+DESC&fields=id,email,first_name,last_name,phone,tags,note,created_at,default_address');
    const customers = data?.customers || [];

    // Fetch verified_number via GraphQL (same method as production code — works regardless of metafield ownership)
    const { getCustomerMetafield } = await import('../services/shopify.js');
    const results = await Promise.all(customers.map(async (c) => {
      try {
        const verifiedNumber = await getCustomerMetafield(String(c.id), 'verified_number');
        return { ...c, verified_number: verifiedNumber || null };
      } catch { return { ...c, verified_number: null }; }
    }));

    res.json({ ok: true, count: results.length, customers: results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /admin/override?token=X  — one-click manual verification from email link
router.get('/override', async (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).send(overridePage('error', 'Token requerido.'));

  const customerId = verifyOverrideToken(token);
  if (!customerId) return res.status(400).send(overridePage('error', 'El enlace es inválido o ya expió (válido por 7 días).'));

  try {
    const { markCustomerVerified } = await import('../services/shopify.js');
    const { verifiedNumber } = await markCustomerVerified(customerId);
    console.log(`[Admin Override] Customer ${customerId} manually verified — number ${verifiedNumber}`);
    return res.send(overridePage('ok', null, customerId, verifiedNumber));
  } catch (err) {
    console.error('[Admin Override] Failed:', err.message);
    return res.status(500).send(overridePage('error', `Error al verificar: ${err.message}`));
  }
});

function overridePage(status, message, customerId, verifiedNumber) {
  const ok = status === 'ok';
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${ok ? 'Verificado' : 'Error'} — Connabis</title>
  <style>
    body{font-family:Arial,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f5f5f5;}
    .card{background:#fff;border-radius:10px;padding:40px 48px;max-width:460px;width:100%;text-align:center;box-shadow:0 4px 20px rgba(0,0,0,.1);}
    .icon{font-size:52px;margin-bottom:12px;}
    h2{margin:0 0 10px;color:${ok?'#2d6a4f':'#c0392b'};}
    p{color:#555;font-size:15px;margin:6px 0;}
    .num{font-size:28px;font-weight:700;color:#2d6a4f;margin:16px 0;}
    a{color:#2d6a4f;font-size:13px;}
  </style>
</head><body><div class="card">
  <div class="icon">${ok?'&#9989;':'&#10060;'}</div>
  <h2>${ok?'Cliente Verificado':'Error'}</h2>
  ${ok ? `<p>ID: <strong>${customerId}</strong></p><div class="num">Número verificado: ${verifiedNumber}</div><a href="https://connabis.myshopify.com/admin/customers/${customerId}" target="_blank">Ver en Shopify Admin →</a>` : `<p>${message}</p>`}
</div></body></html>`;
}

// POST /admin/verify?customerId=X  — manually trigger markCustomerVerified for a customer
router.post('/verify', async (req, res) => {
  const { customerId } = req.query;
  if (!customerId) return res.status(400).json({ error: 'customerId required' });
  try {
    const { markCustomerVerified } = await import('../services/shopify.js');
    const result = await markCustomerVerified(customerId);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/resend', async (req, res) => {
  const { customerId, email, firstName, lastName } = req.query;
  if (!customerId || !email) return res.status(400).json({ error: 'customerId and email required' });
  try {
    const { startVerificationFlow } = await import('./shopify.js');
    await startVerificationFlow({ id: customerId, email, first_name: firstName || '', last_name: lastName || '' });
    res.json({ ok: true, message: `Verification email sent to ${email}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
