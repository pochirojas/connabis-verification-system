// routes/suma.js — VeriDocID Webhook & Callback Handlers
import express from 'express';
import { sendVerificationResultEmail, sendDebugAdminEmail, sendErrorAlertEmail } from '../services/email.js';
import { markCustomerVerified, searchCustomerByEmail, getCustomerMetafield, getCustomer } from '../services/shopify.js';
import { checkVerificationStatus, getVerificationResults } from '../services/suma.js';
import { logEvent } from '../services/logger.js';

const router = express.Router();

// ─── User redirect after completing VeriDocID verification ───────────
// VeriDocID redirects user here via redirect_url set in createVerification
router.get('/callback', async (req, res) => {
  const { status, customer } = req.query;
  console.log('[VeriDocID Callback] User redirected. Status:', status, '| Customer:', customer);

  // Async: poll VeriDocID for results and write to Shopify (don't block the response)
  if ((status === 'success' || status === 'completed') && customer) {
    (async () => {
      try {
        console.log('[Callback] Fetching UUID metafield for customer:', customer);
        const uuid = await getCustomerMetafield(customer, 'verification_uuid');
        if (!uuid) {
          console.warn('[Callback] No verification_uuid metafield found for customer:', customer);
          return;
        }
        console.log('[Callback] Got UUID:', uuid, '— polling status...');

        // Poll up to 10 times with 3s delay waiting for VeriDocID to finish processing
        let verificationStatus = null;
        for (let i = 0; i < 10; i++) {
          verificationStatus = await checkVerificationStatus(uuid);
          console.log('[Callback] Poll', i + 1, '— status:', verificationStatus);
          if (verificationStatus === 'Checked') break;
          await new Promise(r => setTimeout(r, 3000));
        }

        if (verificationStatus !== 'Checked') {
          console.warn('[Callback] VeriDocID not yet Checked after polling — will rely on webhook. Status:', verificationStatus);
          return;
        }

        const results = await getVerificationResults(uuid);
        const globalResult = results?.globalResult ?? results?.GlobalResult ?? results?.result ?? results?.Result;
        const isVerified = globalResult === true || globalResult === 'true' || globalResult === 1 ||
          String(globalResult).toLowerCase() === 'ok' || String(globalResult).toLowerCase() === 'pass';

        console.log('[Callback] GlobalResult:', globalResult, '| isVerified:', isVerified);

        // Get customer email for Shopify update
        const customerData = await getCustomer(customer).catch(() => null);
        const email = customerData?.email || null;
        const idNumber = customerData?.company || customerData?.default_address?.company || null;

        if (isVerified) {
          await markCustomerVerified({ customerId: customer, email, idNumber });
          logEvent({ type: 'verification', status: 'ok', detail: `Customer verified via callback polling — number ${idNumber}`, customerId: customer, email });
          console.log('[Callback] ✅ Customer marked verified:', customer);
          if (email) await sendVerificationResultEmail({ customerId: customer, email, status: 'verified' }).catch(() => {});
        } else {
          logEvent({ type: 'verification', status: 'warn', detail: 'Customer failed verification (callback poll)', customerId: customer, email });
          console.log('[Callback] ❌ Verification failed for:', customer);
          if (email) await sendVerificationResultEmail({ customerId: customer, email, status: 'failed' }).catch(() => {});
        }
      } catch (err) {
        console.error('[Callback] Error processing results:', err.message);
        logEvent({ type: 'error', status: 'error', detail: `Callback result processing failed: ${err.message}`, customerId: customer });
      }
    })();
  }

  if (status === 'success' || status === 'completed') {
    res.send(`
      <!DOCTYPE html>
      <html lang="es">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Verificación Completada - Connabis</title>
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              display: flex; align-items: center; justify-content: center;
              min-height: 100vh; background-color: #f0fdf4;
              padding: 20px;
            }
            .card {
              background: white; border-radius: 12px; padding: 48px;
              max-width: 480px; width: 100%; text-align: center;
              box-shadow: 0 4px 24px rgba(0,0,0,0.08);
            }
            .icon { font-size: 64px; margin-bottom: 16px; }
            h1 { color: #2d6a4f; font-size: 24px; margin-bottom: 12px; }
            p { color: #555; font-size: 16px; line-height: 1.5; margin-bottom: 24px; }
            .btn {
              display: inline-block; background-color: #2d6a4f; color: white;
              padding: 14px 28px; text-decoration: none; border-radius: 8px;
              font-weight: 600; font-size: 15px; transition: background 0.2s;
            }
            .btn:hover { background-color: #1b4332; }
          </style>
        </head>
        <body>
          <div class="card">
            <div class="icon">✅</div>
            <h1>Verificación Completada</h1>
            <p>
              Tu proceso de verificación ha sido enviado exitosamente.
              Recibirás un correo con los resultados pronto.
            </p>
            <a href="https://connabis.com.co" class="btn">
              Volver a Connabis
            </a>
          </div>
        </body>
      </html>
    `);
  } else {
    res.send(`
      <!DOCTYPE html>
      <html lang="es">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Verificación Fallida - Connabis</title>
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              display: flex; align-items: center; justify-content: center;
              min-height: 100vh; background-color: #fef2f2;
              padding: 20px;
            }
            .card {
              background: white; border-radius: 12px; padding: 48px;
              max-width: 480px; width: 100%; text-align: center;
              box-shadow: 0 4px 24px rgba(0,0,0,0.08);
            }
            .icon { font-size: 64px; margin-bottom: 16px; }
            h1 { color: #dc3545; font-size: 24px; margin-bottom: 12px; }
            p { color: #555; font-size: 16px; line-height: 1.5; margin-bottom: 8px; }
            .contact { color: #2d6a4f; font-weight: 600; }
            .btn {
              display: inline-block; background-color: #6c757d; color: white;
              padding: 14px 28px; text-decoration: none; border-radius: 8px;
              font-weight: 600; font-size: 15px; margin-top: 20px; transition: background 0.2s;
            }
            .btn:hover { background-color: #5a6268; }
          </style>
        </head>
        <body>
          <div class="card">
            <div class="icon">❌</div>
            <h1>Verificación Fallida</h1>
            <p>No pudimos verificar tu identidad en este momento.</p>
            <p>Contacta nuestro soporte:</p>
            <p class="contact">connabisco@gmail.com</p>
            <a href="https://connabis.com.co" class="btn">
              Volver a Connabis
            </a>
          </div>
        </body>
      </html>
    `);
  }
});

// ─── VeriDocID Webhook (configured by SUMA team) ───────────────────
// SUMA configures this webhook on their side to POST results when verification completes
// Payload format: VeriDocID results JSON (same as /api/id/v3/results response)
router.post('/webhook', express.json(), async (req, res) => {
  console.log('[VeriDocID Webhook] Received payload:', JSON.stringify(req.body, null, 2));

  // Acknowledge immediately
  res.status(200).json({ received: true });

  try {
    const payload = req.body;
    logEvent({ type: 'verification', status: 'ok', detail: 'VeriDocID webhook received', extra: { keys: Object.keys(payload) } });

    // VeriDocID payloads can vary — extract what we can
    // The "id" field we set during createVerification is "shopify_<customerId>"
    const verificationId = payload.uuid || payload.identifier || payload.verification_id;
    // Our custom id is in payload.id as "shopify_<customerId>"
    const externalId = payload.id || payload.externalId || payload.external_id || '';

    // Extract customer ID from our external_id format: "shopify_<id>"
    let customerId = null;
    if (typeof externalId === 'string' && externalId.startsWith('shopify_')) {
      customerId = externalId.replace('shopify_', '');
    }
    console.log('[VeriDocID Webhook] Extracted — verificationId:', verificationId, '| externalId:', externalId, '| customerId:', customerId);

    // Try to determine verification result from payload
    // VeriDocID results contain globalResult, facialVerification, livenessTest, etc.
    const globalResult = payload.globalResult || payload.global_result || payload.result;
    const facialResult = payload.facialVerification || payload.facial_verification;
    const livenessResult = payload.livenessTest || payload.liveness_test;

    // Check various ways VeriDocID might indicate success
    const isVerified = determineVerificationSuccess(payload, globalResult, facialResult, livenessResult);

    // Extract email: check payload.email, or identifier if it looks like an email
    let email = payload.email || null;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email && typeof identifier === 'string' && emailRegex.test(identifier)) {
      email = identifier;
    }
    if (!email && typeof verificationId === 'string' && emailRegex.test(verificationId)) {
      email = verificationId;
    }

    // Bug fix: When customerId is null but we have an email, search Shopify to find the customer
    let customerName = null;
    if (!customerId && email) {
      console.log('[VeriDocID Webhook] No customerId in payload — searching Shopify by email:', email);
      try {
        const customerData = await searchCustomerByEmail(email);
        if (customerData) {
          customerId = customerData.id;
          customerName = [customerData.firstName, customerData.lastName].filter(Boolean).join(' ') || null;
          console.log('[VeriDocID Webhook] Found customer via email lookup:', customerId, '| Name:', customerName);
        } else {
          console.log('[VeriDocID Webhook] No Shopify customer found for email:', email);
        }
      } catch (lookupError) {
        console.error('[VeriDocID Webhook] Shopify email lookup failed:', lookupError.message);
      }
    }

    console.log('[VeriDocID Webhook] Parsed result:', {
      verificationId,
      customerId,
      email,
      isVerified,
      globalResult: typeof globalResult === 'object' ? JSON.stringify(globalResult) : globalResult
    });

    // Step 1: If verified and we have a customer ID, mark verified in Shopify
    let verifiedNumber = null;
    if (customerId && isVerified) {
      try {
        const result = await markCustomerVerified(customerId);
        verifiedNumber = result.verifiedNumber;
        console.log('[VeriDocID Webhook] Customer marked as verified, number:', verifiedNumber);
        logEvent({ type: 'verification', status: 'ok', detail: `Customer verified — number ${verifiedNumber}`, customerId, email });
      } catch (shopifyError) {
        console.error('[VeriDocID Webhook] Shopify update failed (non-critical):', shopifyError.message);
        logEvent({ type: 'error', status: 'error', detail: `Shopify update failed after verification: ${shopifyError.message}`, customerId, email });
        sendErrorAlertEmail({ context: 'Shopify markCustomerVerified', error: shopifyError.message, customerId, email }).catch(() => {});
      }
    } else if (customerId && !isVerified) {
      console.log('[VeriDocID Webhook] Customer', customerId, 'failed verification — no tag/number assigned');
      logEvent({ type: 'verification', status: 'warn', detail: 'Customer failed verification', customerId, email });
    } else {
      console.log('[VeriDocID Webhook] No customer ID found in payload — admin notified only');
      logEvent({ type: 'verification', status: 'warn', detail: 'No customer ID in VeriDocID payload', email });
    }

    // Step 2: Send legacy admin notification
    console.log('[VeriDocID Webhook] Sending admin notification...');
    await sendVerificationResultEmail({
      customerId: customerId || verificationId,
      email: email || 'unknown',
      status: isVerified ? 'verified' : 'failed',
      reason: isVerified ? null : extractFailureReason(payload)
    });
    console.log('[VeriDocID Webhook] Admin notification sent');

    // Step 3: Send debug admin email with detailed SUMA data
    try {
      await sendDebugAdminEmail({
        isVerified,
        customerName: customerName || email || 'Unknown',
        email: email || 'unknown',
        customerId: customerId || null,
        verifiedNumber,
        globalResult: typeof globalResult === 'object' ? JSON.stringify(globalResult) : globalResult,
        scoreLiveness: payload.scoreLiveness || payload.score_liveness || null,
        scoreFaceMatch: payload.scoreFaceMatch || payload.score_face_match || null,
        resutlLiveness: payload.resutlLiveness || payload.resultLiveness || null,
        resultFaceMatch: payload.resultFaceMatch || payload.result_face_match || null,
        globalResultDescription: payload.globalResultDescription || payload.global_result_description || null,
        failureReason: isVerified ? null : extractFailureReason(payload),
        rawPayload: payload
      });
      console.log('[VeriDocID Webhook] Debug admin email sent');
    } catch (debugEmailError) {
      console.error('[VeriDocID Webhook] Debug email failed (non-critical):', debugEmailError.message);
    }

  } catch (error) {
    console.error('[VeriDocID Webhook] Error processing:', error.message);
    console.error('[VeriDocID Webhook] Stack:', error.stack);
    logEvent({ type: 'error', status: 'error', detail: `VeriDocID webhook processing failed: ${error.message}` });
    sendErrorAlertEmail({ context: 'VeriDocID webhook', error: error.message }).catch(() => {});
  }
});

// ─── Manual status check endpoint (fallback if webhook doesn't fire) ───
// GET /suma/check/:uuid?customer=<shopifyCustomerId>
router.get('/check/:uuid', async (req, res) => {
  const { uuid } = req.params;
  const { customer: customerId } = req.query;

  console.log('[VeriDocID Check] Manual check for UUID:', uuid, '| Customer:', customerId);

  try {
    const status = await checkVerificationStatus(uuid);

    if (status === 'Checked') {
      // Get full results
      const results = await getVerificationResults(uuid);
      const isVerified = determineVerificationSuccess(results);

      if (customerId && isVerified) {
        try {
          const shopifyResult = await markCustomerVerified(customerId);
          console.log('[VeriDocID Check] Customer marked as verified:', shopifyResult.verifiedNumber);
        } catch (shopifyError) {
          console.error('[VeriDocID Check] Shopify update failed:', shopifyError.message);
        }
      }

      // Send admin notification
      await sendVerificationResultEmail({
        customerId: customerId || uuid,
        email: results.email || 'unknown',
        status: isVerified ? 'verified' : 'failed',
        reason: isVerified ? null : extractFailureReason(results)
      });

      res.json({ uuid, status, verified: isVerified, results: results });
    } else {
      res.json({ uuid, status, message: `Verification still in progress (${status})` });
    }

  } catch (error) {
    console.error('[VeriDocID Check] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ─── Helper: Determine if verification was successful ─────────────
function determineVerificationSuccess(payload, globalResult, facialResult, livenessResult) {
  if (!payload) return false;

  // Use top-level fields if not passed separately
  globalResult = globalResult || payload.globalResult || payload.global_result || payload.result;
  facialResult = facialResult || payload.facialVerification || payload.facial_verification;
  livenessResult = livenessResult || payload.livenessTest || payload.liveness_test;

  // Method 1: Direct status field
  if (payload.status === 'approved' || payload.status === 'verified' || payload.status === 'passed') {
    return true;
  }

  // Method 2: globalResult indicates success
  // SUMA/VeriDocID sends globalResult: 'Ok' on success
  if (globalResult) {
    const resultStr = typeof globalResult === 'string' ? globalResult.toLowerCase() : '';
    if (resultStr === 'ok' || resultStr === 'passed' || resultStr === 'approved' || resultStr === 'verified') {
      return true;
    }
    // If globalResult is an object, check its status/result field
    if (typeof globalResult === 'object') {
      const innerResult = (globalResult.status || globalResult.result || '').toLowerCase();
      if (innerResult === 'ok' || innerResult === 'passed' || innerResult === 'approved') return true;
    }
  }

  // Method 3: Check individual verification components
  // VeriDocID fields: resultFaceMatch, resutlLiveness (note: typo is from SUMA API)
  const faceMatchResult = facialResult || payload.resultFaceMatch || payload.result_face_match;
  const livenessResultVal = livenessResult || payload.resutlLiveness || payload.resultLiveness || payload.result_liveness;

  const facialPassed = faceMatchResult === true ||
    (typeof faceMatchResult === 'string' && ['passed', 'ok'].includes(faceMatchResult.toLowerCase())) ||
    (typeof faceMatchResult === 'object' && (faceMatchResult?.result === 'passed' || faceMatchResult?.passed === true));

  const livenessPassed = livenessResultVal === true ||
    (typeof livenessResultVal === 'string' && ['passed', 'ok'].includes(livenessResultVal.toLowerCase())) ||
    (typeof livenessResultVal === 'object' && (livenessResultVal?.result === 'passed' || livenessResultVal?.passed === true));

  // If we have facial and liveness info and both pass, consider verified
  if (faceMatchResult !== undefined && livenessResultVal !== undefined) {
    return facialPassed && livenessPassed;
  }

  // Method 4: Check for explicit failure indicators
  if (payload.status === 'failed' || payload.status === 'rejected' || payload.status === 'denied') {
    return false;
  }

  // Default: log warning and return false (conservative — don't auto-verify on unknown format)
  console.warn('[VeriDocID] Could not determine verification result from payload — defaulting to false');
  console.warn('[VeriDocID] Payload keys:', Object.keys(payload));
  return false;
}

// ─── Helper: Extract failure reason from payload ──────────────────
function extractFailureReason(payload) {
  if (!payload) return 'Unknown failure';

  // Check common fields
  return payload.failureReason ||
    payload.failure_reason ||
    payload.reason ||
    payload.message ||
    payload.error ||
    (payload.globalResult && typeof payload.globalResult === 'string' ? payload.globalResult : null) ||
    'Verification checks did not pass';
}

export default router;
