// routes/shopify.js — Shopify Webhook Handlers
import express from 'express';
import { verifyShopifyHmac } from '../utils/verifyShopify.js';
import { createSumaVerification } from '../services/suma.js';
import {
  sendVerificationEmail,
  sendConsentEmail,
  sendProfileCompleteEmail
} from '../services/email.js';
import {
  isCustomerAlreadyVerified,
  isEmailAlreadyVerified,
  addTag,
  isProfileComplete,
  setCustomerMetafield
} from '../services/shopify.js';

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
    // ─── Step 0: Duplicate check ───────────────────────────────────
    const [alreadyById, alreadyByEmail] = await Promise.all([
      isCustomerAlreadyVerified(id),
      isEmailAlreadyVerified(email)
    ]);

    if (alreadyById || alreadyByEmail) {
      console.log('[Flow] ⏭️ Already verified — skipping');
      return;
    }

    // ─── Step 1: Detect if profile is complete ────────────────────
    // Google/social login accounts skip the registration form,
    // so they arrive without phone and company (ID number).
    const profileComplete = isProfileComplete({ phone, company });

    if (!profileComplete) {
      // ── EXTERNAL CUSTOMER FLOW ──
      console.log('[Flow] 🔶 Incomplete profile detected (external/Google login)');

      // Add "Not Verified" tag to block purchases
      await addTag(id, 'Not Verified');
      console.log('[Flow] Not Verified tag added to customer:', id);

      // Build profile completion form URL with customer ID embedded
      // The form will use this to update the right Shopify customer
      const baseUrl = process.env.APP_BASE_URL || 'https://connabis-verification-system.onrender.com';
      const formUrl = `${baseUrl}/profile/complete?cid=${id}&email=${encodeURIComponent(email)}`;

      // Send profile completion email
      await sendWithRetry(async () => {
        await sendProfileCompleteEmail({ to: email, formUrl });
      }, `profile email to ${email}`);

      console.log('[Flow] ✅ External customer handled — profile form sent to:', email);
      return;
    }

    // ── COMPLETE PROFILE FLOW (normal registration) ──
    console.log('[Flow] ✓ Profile complete — starting full verification flow');
    await startVerificationFlow({ id, email, first_name, last_name });

  } catch (error) {
    console.error('[Flow] ❌ Error:', error.message);
    console.error(error.stack);
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

  // Step 3: Send consent email + mark consent_sent metafield
  console.log('[Flow] Step 3: Sending consent email...');
  try {
    await sendConsentEmail({ to: email });
    // Mark that consent email was sent (used in full-approval check)
    await setCustomerMetafield(id, 'consent_sent', 'true');
    console.log('[Flow] Consent email sent to:', email);
  } catch (err) {
    console.error('[Flow] Consent email failed (non-critical):', err.message);
  }

  console.log('[Flow] ✅ Verification flow complete for customer:', id);
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
