// routes/shopify.js — Shopify Webhook Handlers
import express from 'express';
import { verifyShopifyHmac } from '../utils/verifyShopify.js';
import { createSumaVerification } from '../services/suma.js';
import { sendVerificationEmail, sendConsentEmail } from '../services/email.js';
import { isCustomerAlreadyVerified, isEmailAlreadyVerified } from '../services/shopify.js';

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
    // Step 0: Check if customer is already verified (duplicate check)
    console.log('[Flow] Step 0: Checking for duplicate verification...');

    // Check by customer ID first (exact match)
    const alreadyVerifiedById = await isCustomerAlreadyVerified(id);
    if (alreadyVerifiedById) {
      console.log('[Flow] ⏭️ Customer', id, 'is already verified — skipping verification flow');
      return;
    }

    // Also check by email (catches re-registrations with same email)
    const alreadyVerifiedByEmail = await isEmailAlreadyVerified(email);
    if (alreadyVerifiedByEmail) {
      console.log('[Flow] ⏭️ Email', email, 'already has a verified account — skipping verification flow');
      return;
    }

    console.log('[Flow] ✓ No duplicate found, proceeding with verification');

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

    // Step 2: Send verification email to customer (with retry)
    console.log('[Flow] Step 2: Sending verification email...');
    await sendWithRetry(email, verification.verification_url);

    // Step 3: Send consent form email (Adobe Sign widget link)
    console.log('[Flow] Step 3: Sending consent email...');
    try {
      await sendConsentEmail({ to: email });
      console.log('[Flow] Consent email sent to:', email);
    } catch (consentErr) {
      // Log but don't fail the whole flow if consent email fails
      console.error('[Flow] Consent email failed (non-critical):', consentErr.message);
    }

    console.log('[Flow] ✅ Complete — customer', id, 'verification flow initiated successfully');

  } catch (error) {
    console.error('[Flow] ❌ Customer verification flow failed:', error.message);
    console.error('[Flow] Stack:', error.stack);
  }
});

// Send email with retry logic (up to 3 attempts with exponential backoff)
async function sendWithRetry(email, verificationUrl, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await sendVerificationEmail({ to: email, link: verificationUrl });
      console.log(`[Flow] Verification email sent to: ${email} (attempt ${attempt})`);
      return;
    } catch (error) {
      console.error(`[Flow] Email send attempt ${attempt} failed:`, error.message);
      if (attempt < maxRetries) {
        const delay = attempt * 2000; // 2s, 4s backoff
        console.log(`[Flow] Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        console.error(`[Flow] ❌ All ${maxRetries} email attempts failed for ${email}`);
        throw error;
      }
    }
  }
}

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
