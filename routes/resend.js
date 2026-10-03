// routes/resend.js — Customer self-service: resend verification + consent email
// Called from /pages/verificacion-pendiente. Request is signed in Liquid with
// hmac_sha256(`${cid}:${email}`, RESEND_LINK_SECRET) so nobody can trigger it for others.
import express from 'express';
import { createHmac, timingSafeEqual } from 'crypto';
import { getCustomer, getCustomerMetafield, setCustomerMetafield } from '../services/shopify.js';
import { createSumaVerification } from '../services/suma.js';
import { sendVerificationEmail } from '../services/email.js';
import { logEvent } from '../services/logger.js';

const router = express.Router();
const SECRET = process.env.RESEND_LINK_SECRET || 'cnb-resend-7f3a9c2e41b84d6f9e0a5c1d8b2f6e47';
const COOLDOWN_MS = 5 * 60 * 1000;
const lastSent = new Map(); // in-memory cooldown only (no DB by design)

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://connabis.com.co');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}
function sigOk(cid, email, sig) {
  try {
    const exp = createHmac('sha256', SECRET).update(`${cid}:${email}`).digest('hex');
    const a = Buffer.from(String(sig || ''), 'hex'), b = Buffer.from(exp, 'hex');
    return a.length === b.length && timingSafeEqual(a, b);
  } catch { return false; }
}

router.options('/', (req, res) => { cors(res); res.sendStatus(204); });

router.post('/', express.json(), async (req, res) => {
  cors(res);
  const { cid, email, sig } = req.body || {};
  if (!cid || !email || !sigOk(cid, email, sig)) return res.status(403).json({ status: 'forbidden' });

  const prev = lastSent.get(String(cid));
  if (prev && Date.now() - prev < COOLDOWN_MS) {
    return res.json({ status: 'cooldown', minutes: Math.ceil((COOLDOWN_MS - (Date.now() - prev)) / 60000) });
  }

  try {
    const customer = await getCustomer(cid);
    if (!customer || String(customer.email).toLowerCase() !== String(email).toLowerCase()) {
      return res.status(403).json({ status: 'forbidden' });
    }
    const vn = await getCustomerMetafield(cid, 'verified_number').catch(() => null);
    const tags = String(customer.tags || '').split(',').map(t => t.trim());
    if (vn || tags.includes('Solo Hongos') && tags.includes('Verified')) {
      return res.json({ status: 'verified' });
    }
    const company = customer.company || customer.default_address?.company;
    if (!company) {
      const base = process.env.APP_BASE_URL || 'https://connabis-verification-system.onrender.com';
      return res.json({ status: 'profile', url: `${base}/profile/complete?cid=${cid}&email=${encodeURIComponent(email)}` });
    }

    // Always a fresh VeriDoc session — old links may have expired
    const v = await createSumaVerification({ customerId: cid, email, firstName: customer.first_name || '', lastName: customer.last_name || '' });
    await setCustomerMetafield(cid, 'verification_uuid', v.id).catch(() => {});
    await setCustomerMetafield(cid, 'pending_verification_url', v.verification_url).catch(() => {});
    await setCustomerMetafield(cid, 'verification_sent', 'true').catch(() => {});
    await sendVerificationEmail({ to: email, link: v.verification_url });
    lastSent.set(String(cid), Date.now());
    logEvent({ type: 'email', status: 'ok', detail: 'Verification+consent email RESENT by customer', customerId: cid, email });
    res.json({ status: 'sent' });
  } catch (err) {
    console.error('[Resend] Error:', err.message);
    logEvent({ type: 'error', status: 'error', detail: `Resend failed: ${err.message}`, customerId: cid, email });
    res.status(500).json({ status: 'error' });
  }
});

export default router;
