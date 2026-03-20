// utils/verifyShopify.js — Shopify HMAC Webhook Verification
import crypto from 'crypto';

export function verifyShopifyHmac(req) {
  const hmac = req.headers['x-shopify-hmac-sha256'];

  if (!hmac) {
    console.error('[Shopify HMAC] No HMAC header found');
    return false;
  }

  if (!req.rawBody) {
    console.error('[Shopify HMAC] No raw body available for verification');
    return false;
  }

  const secret = process.env.SHOPIFY_WEBHOOK_SECRET;
  if (!secret) {
    console.error('[Shopify HMAC] SHOPIFY_WEBHOOK_SECRET is not set');
    return false;
  }

  const digest = crypto
    .createHmac('sha256', secret)
    .update(req.rawBody)
    .digest('base64');

  // Use timing-safe comparison to prevent timing attacks
  // Both buffers must be the same length for timingSafeEqual
  const digestBuf = Buffer.from(digest, 'utf8');
  const hmacBuf = Buffer.from(hmac, 'utf8');

  if (digestBuf.length !== hmacBuf.length) {
    console.error('[Shopify HMAC] Verification failed (length mismatch)');
    return false;
  }

  const isValid = crypto.timingSafeEqual(digestBuf, hmacBuf);

  if (!isValid) {
    console.error('[Shopify HMAC] Verification failed');
    console.error('[Shopify HMAC] Expected:', digest);
    console.error('[Shopify HMAC] Received:', hmac);
  }

  return isValid;
}
