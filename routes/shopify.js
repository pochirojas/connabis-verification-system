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
  isProfileComplete,
  getCustomerMetafield,
  setCustomerMetafield,
  getCustomer
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
      // ── EXTERNAL CUSTOMER FLOW (Google/social login) ──
      console.log('[Flow] 🔶 Incomplete profile detected (external/Google login)');
      logEvent({ type: 'webhook', status: 'ok', detail: 'Incomplete profile — sending profile form', customerId: id, email });

      await addTag(id, 'Not Verified');
      const baseUrl = process.env.APP_BASE_URL || 'https://connabis-verification-system.onrender.com';
      const formUrl = `${baseUrl}/profile/complete?cid=${id}&email=${encodeURIComponent(email)}`;

      // Pre-generate SUMA session NOW so verification email fires immediately after profile submit
      let sumaUrl = null;
      try {
        const verification = await createSumaVerification({ customerId: id, email, firstName: first_name, lastName: last_name });
        sumaUrl = verification.verification_url;
        // Store the link in a metafield so profile route can retrieve it
        await setCustomerMetafield(id, 'pending_verification_url', sumaUrl);
        console.log('[Flow] Pre-generated SUMA session:', verification.id);
      } catch (sumaErr) {
        console.error('[Flow] SUMA pre-generation failed (non-critical):', sumaErr.message);
        // Not fatal — profile route will generate a new session if metafield missing
      }

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
  // Check if a SUMA session was pre-generated (Google/social login flow)
  let verificationUrl = null;
  try {
    verificationUrl = await getCustomerMetafield(id, 'pending_verification_url');
  } catch (_) {}

  if (verificationUrl) {
    // Reuse the pre-generated link — instant send
    console.log('[Flow] Using pre-generated SUMA session URL');
    await setCustomerMetafield(id, 'pending_verification_url', ''); // clear it
  } else {
    // Step 1: Create a fresh VeriDocID session
    console.log('[Flow] Step 1: Creating VeriDocID session...');
    const verification = await createSumaVerification({ customerId: id, email, firstName: first_name, lastName: last_name });
    verificationUrl = verification.verification_url;
    console.log('[Flow] Session created:', verification.id);
  }

  // Step 2: Mark as sent so customers/update doesn't reprocess
  await setCustomerMetafield(id, 'verification_sent', 'true').catch(() => {});

  // Step 3: Send verification + consent email
  console.log('[Flow] Sending verification email...');
  await sendWithRetry(async () => {
    await sendVerificationEmail({ to: email, link: verificationUrl });
  }, `verification email to ${email}`);
  logEvent({ type: 'email', status: 'ok', detail: 'Verification+consent email sent', customerId: id, email });

  console.log('[Flow] ✅ Verification flow complete for customer:', id);
  logEvent({ type: 'verification', status: 'ok', detail: 'Full verification flow complete', customerId: id, email });
}

// ─── Customer Update Webhook (catches Advanced Registration approvals) ──────
router.post('/customer-updated', async (req, res) => {
  if (!verifyShopifyHmac(req)) return res.status(401).send('Unauthorized');

  const { id, email, first_name, last_name, phone, default_address } = req.body;
  const company = req.body.company || default_address?.company;

  res.status(200).send('ok'); // Respond immediately

  if (!email || !id) return;

  try {
    // Only process if profile is complete (AR customers have all fields)
    if (!isProfileComplete({ phone, company })) return;

    // Skip if already verified
    const [alreadyById, alreadyByEmail] = await Promise.all([
      isCustomerAlreadyVerified(id),
      isEmailAlreadyVerified(email)
    ]);
    if (alreadyById || alreadyByEmail) return;

    // Skip if we already sent a verification email (prevent duplicate on every update)
    const alreadySent = await getCustomerMetafield(id, 'verification_sent').catch(() => null);
    if (alreadySent === 'true') return;

    console.log('[CustomerUpdate] New complete-profile customer detected via update — starting flow:', email);
    logEvent({ type: 'webhook', status: 'ok', detail: 'Customer update — triggering verification flow (Advanced Registration)', customerId: id, email });
    await startVerificationFlow({ id, email, first_name, last_name });

  } catch (error) {
    console.error('[CustomerUpdate] Error:', error.message);
    logEvent({ type: 'error', status: 'error', detail: `Customer update flow failed: ${error.message}`, customerId: id, email });
    sendErrorAlertEmail({ context: 'Customer update webhook', error: error.message, customerId: id, email }).catch(() => {});
  }
});

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
