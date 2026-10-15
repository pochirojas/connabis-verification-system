// routes/orders.js — Backstop: alert on orders from customers who are not allowed to buy.
// The storefront gate is JS and can be bypassed; this catches anything that gets through.
import express from 'express';
import crypto from 'crypto';
import { shopifyAdminFetch, getCustomer, getCustomerMetafield } from '../services/shopify.js';
import { sendOrderAlertEmail } from '../services/email.js';
import { logEvent } from '../services/logger.js';

const router = express.Router();
const HONGOS_TYPE = 'Suplementos';
const seen = new Set();

function hmacOk(req) {
  const h = req.headers['x-shopify-hmac-sha256'];
  if (!h || !req.rawBody) return false;
  for (const s of [process.env.SHOPIFY_WEBHOOK_SECRET, process.env.SHOPIFY_CLIENT_SECRET].filter(Boolean)) {
    const d = crypto.createHmac('sha256', s).update(req.rawBody).digest('base64');
    if (d.length === h.length && crypto.timingSafeEqual(Buffer.from(d), Buffer.from(h))) return true;
  }
  return false;
}

export async function checkOrder(order) {
  const cid = order.customer?.id;
  const lines = (order.line_items || []).map(l => ({ title: l.title, variant: l.variant_title, product_id: l.product_id, qty: l.quantity }));
  let reason = null, customer = null, vn = null, soloHongos = false;
  if (!cid) reason = 'Pedido sin cliente (compra como invitado)';
  else {
    customer = await getCustomer(cid).catch(() => null);
    vn = await getCustomerMetafield(cid, 'verified_number').catch(() => null);
    const tags = String(customer?.tags || '').split(',').map(t => t.trim());
    soloHongos = tags.includes('Solo Hongos');
    if (!vn) {
      if (soloHongos) {
        const nonHongos = [];
        for (const l of lines) {
          let type = null;
          if (l.product_id) {
            const p = await shopifyAdminFetch(`/products/${l.product_id}.json?fields=product_type`).catch(() => null);
            type = p?.product?.product_type || null;
          }
          if (type !== HONGOS_TYPE) nonHongos.push(l.title);
        }
        if (nonHongos.length) reason = `Cliente "Solo Hongos" (sin VeriDoc) compró productos que no son hongos: ${nonHongos.join(', ')}`;
      } else {
        reason = 'Cliente sin número de verificado (no pasó VeriDoc)';
      }
    }
    const company = customer?.company || customer?.default_address?.company || order.shipping_address?.company || order.billing_address?.company;
    const phone = customer?.phone || order.phone || order.shipping_address?.phone || order.billing_address?.phone;
    if (!reason && (!company || !phone)) reason = `Faltan datos de facturación: ${!company ? 'cédula ' : ''}${!phone ? 'celular' : ''}`.trim();
  }
  return { reason, cid, vn, soloHongos, lines, customer };
}

router.post('/create', async (req, res) => {
  if (!hmacOk(req)) return res.status(401).send('Unauthorized');
  res.status(200).send('ok');
  const order = req.body || {};
  if (seen.has(order.id)) return; seen.add(order.id);
  try {
    const r = await checkOrder(order);
    if (!r.reason) { logEvent({ type: 'order', status: 'ok', detail: `Pedido ${order.name} OK`, customerId: r.cid, email: order.email }); return; }
    // Tag + note the order so it can't be missed in admin
    await shopifyAdminFetch(`/orders/${order.id}.json`, { method: 'PUT', body: JSON.stringify({ order: { id: order.id,
      tags: [order.tags, 'ALERTA NO VERIFICADO'].filter(Boolean).join(', '),
      note: [order.note, `⚠️ ALERTA: ${r.reason}. NO DESPACHAR sin revisar.`].filter(Boolean).join('\n') } }) }).catch(e => console.error('[Orders] tag failed', e.message));
    await sendOrderAlertEmail({ orderName: order.name, orderId: order.id, email: order.email, customerId: r.cid, reason: r.reason, lines: r.lines, total: order.total_price, currency: order.currency });
    logEvent({ type: 'order', status: 'warn', detail: `ALERTA pedido ${order.name}: ${r.reason}`, customerId: r.cid, email: order.email });
  } catch (e) {
    console.error('[Orders] check failed', e.message);
    logEvent({ type: 'error', status: 'error', detail: `Order check failed ${order.name}: ${e.message}`, email: order.email });
  }
});

export default router;
