// routes/shopify.js — Shopify Webhook Handlers
import express from 'express';
import { verifyShopifyHmac } from '../utils/verifyShopify.js';
import { createSumaVerification } from '../services/suma.js';
import {
  sendVerificationEmail,
  sendProfileCompleteEmail,
  sendErrorAlertEmail
} from '../services/email.js';
import {
  isCustomerAlreadyVerified,
  isEmailAlreadyVerified,
  addTag,
  isProfileComplete
} from '../services/shopify.js';
import { logEvent } from '../services/logger.js';

const router = express.Router();

// Webhook: Customer account creation
router.post('/customer-created', async (req, res) => {
  console.log('[Shopify] Customer created webhook received');

  if (!verifyShopifyHmac(req)) {
    console.error('[Shopify] Invalid HMAC — rejecting');
    return res.status(401).send('Unauthorized');
  }

  const { id, email, first_name, last_name, phone, company } = req.body;
  console.log('[Shopify] Customer ID:', id, '| Email:', email, '| Phone:', phone || 'MISSING');

  if (!email) {
    console.error('[Shopify] No email — cannot proceed');
    return res.status(200).send('ok');
  }

  // Respond to Shopify immediately — process async
  res.status(200).send('ok');

  try {
    logEvent({ type: 'webhook', status: 'ok', detail: 'Customer created webhook received', customerId: id, email });

    // ─── Step 0: Duplicate check ───────────────────────────────────
    const [alreadyById, alreadyByEmail] = await Promise.all([
      isCustomerAlreadyVerified(id),
      isEmailAlreadyVerified(email)
    ]);

    if (alreadyById || alreadyByEmail) {
      console.log('[Flow] ⏭️ Already verified — skipping');
      logEvent({ type: 'webhook', status: 'skipped', detail: 'Customer already verified — skipped', customerId: id, email });
      return;
    }

    // ─── Step 1: Detect if profile is complete ────────────────────
    const profileComplete = isProfileComplete({ phone, company });

    if (!profileComplete) {
      // ── EXTERNAL CUSTOMER FLOW ──
      console.log('[Flow] 🔶 Incomplete profile detected (external/Google login)');
      logEvent({ type: 'webhook', status: 'ok', detail: 'Incomplete profile — sending profile form', customerId: id, email });

      await addTag(id, 'Not Verified');
      const baseUrl = process.env.APP_BASE_URL || 'https://connabis-verification-system.onrender.com';
      const formUrl = `${baseUrl}/profile/complete?cid=${id}&email=${encodeURIComponent(email)}`;

      await sendWithRetry(async () => {
        await sendProfileCompleteEmail({ to: email, formUrl });
      }, `profile email to ${email}`);

      logEvent({ type: 'email', status: 'ok', detail: 'Profile completion email sent', customerId: id, email });
      console.log('[Flow] ✅ External customer handled — profile form sent to:', email);
      return;
    }

    // ── COMPLETE PROFILE FLOW (normal registration) ──
    console.log('[Flow] ✓ Profile complete — starting full verification flow');
    await startVerificationFlow({ id, email, first_name, last_name });

  } catch (error) {
    console.error('[Flow] ❌ Error:', error.message);
    console.error(error.stack);
    logEvent({ type: 'error', status: 'error', detail: `Webhook flow failed: ${error.message}`, customerId: id, email });
    sendErrorAlertEmail({ context: 'Shopify webhook flow', error: error.message, customerId: id, email }).catch(() => {});
  }
});

// ─── Shared verification flow (used for both normal and post-profile-complete) ──
export async function startVerificationFlow({ id, email, first_name, last_name }) {
  // Step 1: Create VeriDocID session
  console.log('[Flow] Step 1: Creating VeriDocID session...');
  const verification = await createSumaVerification({
    customerId: id,
    email,
    firstName: first_name,
    lastName: last_name
  });
  console.log('[Flow] Session created:', verification.id);

  // Step 2: Send verification email
  console.log('[Flow] Step 2: Sending verification email...');
  await sendWithRetry(async () => {
    await sendVerificationEmail({ to: email, link: verification.verification_url });
  }, `verification email to ${email}`);
  logEvent({ type: 'email', status: 'ok', detail: 'Verification+consent email sent', customerId: id, email });

  console.log('[Flow] ✅ Verification flow complete for customer:', id);
  logEvent({ type: 'verification', status: 'ok', detail: 'Full verification flow complete', customerId: id, email });
}

// ─── Retry helper ────────────────────────────────────────────────
async function sendWithRetry(fn, label, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await fn();
      return;
    } catch (err) {
      console.error(`[Flow] Attempt ${attempt} failed for ${label}:`, err.message);
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, attempt * 2000));
      } else {
        throw err;
      }
    }
  }
}

export default router;
