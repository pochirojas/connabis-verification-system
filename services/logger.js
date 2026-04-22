// services/logger.js — In-memory event log (no database, ESM)
// Keeps last 100 events in memory. Resets on redeploy (acceptable for diagnostics).

const MAX_EVENTS = 100;
const events = [];

export function logEvent({ type, status, detail, customerId, email, extra }) {
  const entry = {
    ts: new Date().toISOString(),
    type,       // 'webhook' | 'email' | 'verification' | 'profile' | 'error'
    status,     // 'ok' | 'error' | 'skipped' | 'warn'
    detail,     // human-readable description
    customerId: customerId || null,
    email: email || null,
    extra: extra || null
  };
  events.unshift(entry); // newest first
  if (events.length > MAX_EVENTS) events.pop();
  // Also write to stdout so Render logs capture it
  console.log(`[LOG] [${type.toUpperCase()}] [${status.toUpperCase()}] ${detail}${email ? ' | ' + email : ''}${customerId ? ' | cid:' + customerId : ''}`);
}

export function getEvents() {
  return events;
}

export function getStats() {
  const now = Date.now();
  const last24h = events.filter(e => now - new Date(e.ts).getTime() < 86400000);
  return {
    total: events.length,
    last24h: last24h.length,
    errors: last24h.filter(e => e.status === 'error').length,
    webhooks: last24h.filter(e => e.type === 'webhook').length,
    emailsSent: last24h.filter(e => e.type === 'email' && e.status === 'ok').length,
    verifications: last24h.filter(e => e.type === 'verification').length,
    lastEvent: events[0] || null
  };
}
