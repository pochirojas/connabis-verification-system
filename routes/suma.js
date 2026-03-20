// routes/suma.js — SUMA Callbacks & Webhook Handlers
import express from 'express';
import { sendVerificationResultEmail } from '../services/email.js';
import { updateShopifyCustomerVerification } from '../services/shopify.js';

const router = express.Router();

// User redirect after completing SUMA verification
// SUMA redirects the user here after they finish the verification process
router.get('/callback', (req, res) => {
  const { status } = req.query;
  console.log('[SUMA Callback] User redirected with status:', status);

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
              Tu cuenta ha sido verificada exitosamente.
              Ya puedes disfrutar de todos nuestros productos.
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

// SUMA webhook for verification results
// SUMA sends a POST here when the customer completes (or fails) verification
router.post('/webhook', express.json(), async (req, res) => {
  console.log('[SUMA Webhook] Received payload:', JSON.stringify(req.body, null, 2));

  try {
    const {
      verification_id,
      external_id,
      status,
      email,
      document_valid,
      face_match,
      liveness_passed,
      failure_reason,
      document_type,
      age,
      date_of_birth
    } = req.body;

    // Extract Shopify customer ID from external_id
    const customerId = external_id?.replace('shopify_customer_', '');

    // Determine overall verification status
    const isVerified = status === 'completed' &&
                       document_valid === true &&
                       face_match === true &&
                       liveness_passed === true;

    console.log('[SUMA Webhook] Verification result:', {
      customerId,
      email,
      isVerified,
      status,
      document_valid,
      face_match,
      liveness_passed,
      age
    });

    // Step 1: Send notification to Connabis admin
    console.log('[SUMA Webhook] Sending admin notification...');
    await sendVerificationResultEmail({
      customerId,
      email,
      status: isVerified ? 'verified' : 'failed',
      reason: failure_reason || (isVerified ? null : 'One or more verification checks failed')
    });
    console.log('[SUMA Webhook] Admin notification email sent');

    // Step 2: Update Shopify customer metafield with verification status
    if (customerId) {
      try {
        await updateShopifyCustomerVerification(customerId, {
          verified: isVerified,
          verification_id,
          verified_at: new Date().toISOString(),
          document_type: document_type || null,
          age: age || null
        });
        console.log('[SUMA Webhook] Shopify customer metafield updated');
      } catch (shopifyError) {
        // Don't fail the webhook if Shopify update fails
        console.error('[SUMA Webhook] Shopify metafield update failed (non-critical):', shopifyError.message);
      }
    }

    res.status(200).json({ received: true });

  } catch (error) {
    console.error('[SUMA Webhook] Error processing webhook:', error.message);
    console.error('[SUMA Webhook] Stack:', error.stack);
    res.status(500).json({ error: error.message });
  }
});

export default router;
