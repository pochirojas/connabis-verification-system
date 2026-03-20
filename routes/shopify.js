// routes/shopify.js — Shopify Webhook Handlers
import express from 'express';
import { verifyShopifyHmac } from '../utils/verifyShopify.js';
import { createSumaVerification } from '../services/suma.js';
import { sendVerificationEmail } from '../services/email.js';

const router = express.Router();

// Webhook: Customer account creation
// Triggered when a new customer registers on connabis.com.co
router.post('/customer-created', async (req, res) => {
  console.log('[Shopify] Customer created webhook received');

  // IMPORTANT: Respond quickly to avoid Shopify timeout (5 seconds)
  // Shopify retries webhooks that don't get 200 within 5s

  // Verify webhook authenticity
  if (!verifyShopifyHmac(req)) {
    console.error('[Shopify] Invalid HMAC signature — rejecting webhook');
    return res.status(401).send('Unauthorized');
  }

  const customer = req.body;
  const { id, email, first_name, last_name } = customer;

  console.log('[Shopify] Customer ID:', id, '| Email:', email);

  // Validate we have the minimum required data
  if (!email) {
    console.error('[Shopify] Customer has no email — cannot send verification');
    return res.status(200).send('ok'); // Still return 200 to prevent Shopify retries
  }

  // Respond to Shopify immediately (async processing continues)
  res.status(200).send('ok');

  // Process verification asynchronously after responding
  try {
    // Step 1: Create SUMA verification session
    console.log('[Flow] Step 1: Creating SUMA verification session...');
    const verification = await createSumaVerification({
      customerId: id,
      email: email,
      firstName: first_name,
      lastName: last_name
    });
    console.log('[Flow] SUMA session created:', verification.id);
    console.log('[Flow] Verification URL:', verification.verification_url);

    // Step 2: Send verification email to customer
    console.log('[Flow] Step 2: Sending verification email...');
    await sendVerificationEmail({
      to: email,
      link: verification.verification_url
    });
    console.log('[Flow] Verification email sent to:', email);

    console.log('[Flow] ✅ Complete — customer', id, 'verification flow initiated successfully');

  } catch (error) {
    console.error('[Flow] ❌ Customer verification flow failed:', error.message);
    console.error('[Flow] Stack:', error.stack);
    // Note: We already sent 200 to Shopify. Log the error for debugging.
    // Consider adding alerting here (e.g., send error notification to admin email)
  }
});

// Webhook: Order creation (future use — can verify before fulfilling orders)
router.post('/order-created', async (req, res) => {
  if (!verifyShopifyHmac(req)) {
    return res.status(401).send('Unauthorized');
  }

  const order = req.body;
  console.log('[Shopify] Order created:', order.id, '| Customer:', order.customer?.email);

  // TODO: Implement order-based verification logic if needed
  // Example: Check if customer is verified before processing order

  res.status(200).send('ok');
});

export default router;
