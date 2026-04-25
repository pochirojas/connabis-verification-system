// services/email.js — Resend Email Client
import { Resend } from 'resend';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_FROM = 'Connabis <no-reply@connabis.com.co>';

// Load email templates at startup
const VERIFICATION_TEMPLATE_PATH = join(__dirname, '..', 'templates', 'verification-email.html');
const CONSENT_TEMPLATE_PATH = join(__dirname, '..', 'templates', 'consent-email.html');

let verificationTemplate;
try {
  verificationTemplate = readFileSync(VERIFICATION_TEMPLATE_PATH, 'utf-8');
  console.log('[Email] Verification template loaded');
} catch (err) {
  console.warn('[Email] Verification template not found, using inline fallback:', err.message);
  verificationTemplate = null;
}

let consentTemplate;
try {
  consentTemplate = readFileSync(CONSENT_TEMPLATE_PATH, 'utf-8');
  console.log('[Email] Consent template loaded');
} catch (err) {
  console.warn('[Email] Consent template not found:', err.message);
  consentTemplate = null;
}

function getResendClient() {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error('RESEND_API_KEY is not configured');
  }
  return new Resend(apiKey);
}

function getFromEmail() {
  return process.env.FROM_EMAIL || DEFAULT_FROM;
}

// Log FROM_EMAIL on first import so we can see what the server is using
console.log('[Email] FROM_EMAIL configured as:', getFromEmail());

// Test email function
export async function sendTestEmail() {
  console.log('[Email] Sending test email...');
  const resend = getResendClient();
  const from = getFromEmail();
  console.log('[Email] Test email from:', from);

  const { data, error } = await resend.emails.send({
    from,
    to: process.env.NOTIFY_EMAIL || 'connabisco@gmail.com',
    subject: 'Test Email - Verification System Operational',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #2d6a4f;">✅ System Test Successful</h2>
        <p>The Connabis verification email system is working correctly.</p>
        <p style="color: #666; font-size: 12px;">
          Timestamp: ${new Date().toISOString()}<br>
          Environment: ${process.env.NODE_ENV || 'development'}
        </p>
      </div>
    `
  });

  if (error) {
    console.error('[Email] Resend API error (test):', JSON.stringify(error));
    throw new Error(`Resend test email failed: ${error.message}`);
  }

  console.log('[Email] Test email accepted, ID:', data?.id);
  return data;
}

// Send verification link to customer
export async function sendVerificationEmail({ to, link }) {
  const from = getFromEmail();
  console.log('[Email] Sending verification email to:', to, '| From:', from);
  const resend = getResendClient();

  // Build HTML from template or fallback
  const bannerUrl = `${process.env.APP_BASE_URL || 'http://localhost:3000'}/public/banner.jpg`;
  let html;
  if (verificationTemplate) {
    html = verificationTemplate
      .replace(/{{VERIFICATION_LINK}}/g, link)
      .replace(/{{BANNER_URL}}/g, bannerUrl);
  } else {
    html = `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;"><img src="${bannerUrl}" alt="REGISTRO EXITOSO - Connabis" style="width:100%;display:block;"><div style="padding:32px 30px;"><h2 style="color:#1a1a1a;font-weight:700;">¡Agradecemos tu interes en ser miembro!</h2><p style="color:#333;font-size:15px;line-height:1.7;">Estas a un paso de terminar tu proceso de <span style="text-decoration:underline;">verificación</span>, por favor asegurate de leer todas las instrucciones ya que te guiaremos paso a paso para segurarnos que toda tu información sea recibida y procesada lo más rápido posible</p><p style="text-align:center;"><a href="${link}" style="background-color:#2d6a4f;color:#ffffff;padding:14px 32px;text-decoration:none;border-radius:6px;display:inline-block;font-size:16px;font-weight:bold;">Continuar con el último paso</a></p><p style="color:#888;font-size:13px;">Por favor no responda a este correo.</p><p style="color:#666;font-size:14px;">Te deseamos un día Connábico,</p><p style="color:#666;font-size:14px;font-weight:600;">El equipo de Connabis Colombia</p></div></div>`;
  }

  const { data, error } = await resend.emails.send({
    from,
    to,
    subject: 'Verifica tu Edad - Connabis',
    html
  });

  if (error) {
    console.error('[Email] Resend API error:', JSON.stringify(error));
    throw new Error(`Resend email failed: ${error.message}`);
  }

  console.log('[Email] Resend accepted, ID:', data?.id);
  return data;
}

// Send debug admin email after SUMA webhook processing (to connabisco@gmail.com)
export async function sendDebugAdminEmail({
  isVerified, customerName, email, customerId, verifiedNumber,
  globalResult, scoreLiveness, scoreFaceMatch, resutlLiveness, resultFaceMatch,
  globalResultDescription, failureReason, rawPayload
}) {
  const from = getFromEmail();
  const resend = getResendClient();

  const displayName = customerName || email || 'Unknown';
  const subject = isVerified
    ? `[VERIFICACIÓN EXITOSA] ${displayName}`
    : `[VERIFICACIÓN FALLIDA] ${displayName}`;

  let body;
  if (isVerified) {
    body = `
      <div style="font-family: monospace; max-width: 700px; margin: 0 auto; padding: 16px;">
        <h2 style="color: #28a745; border-bottom: 2px solid #28a745; padding-bottom: 8px;">VERIFICACIÓN EXITOSA</h2>
        <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
          <tr><td style="padding: 6px 8px; font-weight: bold; width: 180px;">Nombre:</td><td style="padding: 6px 8px;">${customerName || 'N/A'}</td></tr>
          <tr><td style="padding: 6px 8px; font-weight: bold;">Email:</td><td style="padding: 6px 8px;">${email || 'N/A'}</td></tr>
          <tr><td style="padding: 6px 8px; font-weight: bold;">Customer ID:</td><td style="padding: 6px 8px;">${customerId || 'N/A'}</td></tr>
          <tr><td style="padding: 6px 8px; font-weight: bold;">Verified Number:</td><td style="padding: 6px 8px; font-weight: bold; color: #28a745;">${verifiedNumber || 'N/A'}</td></tr>
          <tr><td style="padding: 6px 8px; font-weight: bold;">Global Result:</td><td style="padding: 6px 8px;">${globalResult || 'N/A'}</td></tr>
          <tr><td style="padding: 6px 8px; font-weight: bold;">Liveness Score:</td><td style="padding: 6px 8px;">${scoreLiveness ?? 'N/A'}</td></tr>
          <tr><td style="padding: 6px 8px; font-weight: bold;">Face Match Score:</td><td style="padding: 6px 8px;">${scoreFaceMatch ?? 'N/A'}</td></tr>
          <tr><td style="padding: 6px 8px; font-weight: bold;">Liveness Result:</td><td style="padding: 6px 8px;">${resutlLiveness || 'N/A'}</td></tr>
          <tr><td style="padding: 6px 8px; font-weight: bold;">Face Match Result:</td><td style="padding: 6px 8px;">${resultFaceMatch || 'N/A'}</td></tr>
          <tr><td style="padding: 6px 8px; font-weight: bold;">Timestamp:</td><td style="padding: 6px 8px;">${new Date().toISOString()}</td></tr>
        </table>
      </div>`;
  } else {
    body = `
      <div style="font-family: monospace; max-width: 700px; margin: 0 auto; padding: 16px;">
        <h2 style="color: #dc3545; border-bottom: 2px solid #dc3545; padding-bottom: 8px;">VERIFICACIÓN FALLIDA</h2>
        <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
          <tr><td style="padding: 6px 8px; font-weight: bold; width: 180px;">Email:</td><td style="padding: 6px 8px;">${email || 'N/A'}</td></tr>
          <tr><td style="padding: 6px 8px; font-weight: bold;">Customer ID:</td><td style="padding: 6px 8px;">${customerId || 'N/A'}</td></tr>
          <tr><td style="padding: 6px 8px; font-weight: bold;">Global Result:</td><td style="padding: 6px 8px; color: #dc3545; font-weight: bold;">${globalResult || 'N/A'}</td></tr>
          <tr><td style="padding: 6px 8px; font-weight: bold;">Description:</td><td style="padding: 6px 8px;">${globalResultDescription || 'N/A'}</td></tr>
          <tr><td style="padding: 6px 8px; font-weight: bold;">Failure Reason:</td><td style="padding: 6px 8px; color: #dc3545;">${failureReason || 'N/A'}</td></tr>
          <tr><td style="padding: 6px 8px; font-weight: bold;">Liveness Score:</td><td style="padding: 6px 8px;">${scoreLiveness ?? 'N/A'}</td></tr>
          <tr><td style="padding: 6px 8px; font-weight: bold;">Liveness Result:</td><td style="padding: 6px 8px;">${resutlLiveness || 'N/A'}</td></tr>
          <tr><td style="padding: 6px 8px; font-weight: bold;">Face Match Score:</td><td style="padding: 6px 8px;">${scoreFaceMatch ?? 'N/A'}</td></tr>
          <tr><td style="padding: 6px 8px; font-weight: bold;">Face Match Result:</td><td style="padding: 6px 8px;">${resultFaceMatch || 'N/A'}</td></tr>
          <tr><td style="padding: 6px 8px; font-weight: bold;">Timestamp:</td><td style="padding: 6px 8px;">${new Date().toISOString()}</td></tr>
        </table>
        <details style="margin-top: 12px;">
          <summary style="cursor: pointer; font-weight: bold; font-size: 13px;">Raw Payload</summary>
          <pre style="background: #f5f5f5; padding: 12px; overflow-x: auto; font-size: 12px;">${JSON.stringify(rawPayload, null, 2)}</pre>
        </details>
      </div>`;
  }

  const { data, error } = await resend.emails.send({
    from,
    to: 'connabisco@gmail.com',
    subject,
    html: body
  });

  if (error) {
    console.error('[Email] Resend API error (debug admin):', JSON.stringify(error));
    throw new Error(`Resend debug admin email failed: ${error.message}`);
  }

  console.log('[Email] Debug admin email sent, ID:', data?.id);
  return data;
}

// Send verification result notification to admin
export async function sendVerificationResultEmail({ customerId, email, status, reason }) {
  const from = getFromEmail();
  console.log('[Email] Sending admin notification | From:', from);
  const resend = getResendClient();

  const statusEmoji = status === 'verified' ? '✅' : '❌';
  const statusColor = status === 'verified' ? '#28a745' : '#dc3545';
  const statusBg = status === 'verified' ? '#d4edda' : '#f8d7da';

  const { data, error } = await resend.emails.send({
    from,
    to: process.env.NOTIFY_EMAIL || 'connabisco@gmail.com',
    subject: `${statusEmoji} Customer Verification ${status.toUpperCase()} - ${email}`,
    html: `
      <div style="font-family: monospace; max-width: 600px; margin: 0 auto;">
        <!-- Status Banner -->
        <div style="background-color: ${statusBg}; padding: 20px; border-left: 4px solid ${statusColor};">
          <h3 style="color: ${statusColor}; margin: 0;">
            ${statusEmoji} Verification ${status.toUpperCase()}
          </h3>
        </div>

        <!-- Details -->
        <div style="padding: 20px; background-color: #f8f9fa;">
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 10px 8px; font-weight: bold; border-bottom: 1px solid #dee2e6; width: 140px;">Customer ID:</td>
              <td style="padding: 10px 8px; border-bottom: 1px solid #dee2e6;">${customerId || 'N/A'}</td>
            </tr>
            <tr>
              <td style="padding: 10px 8px; font-weight: bold; border-bottom: 1px solid #dee2e6;">Email:</td>
              <td style="padding: 10px 8px; border-bottom: 1px solid #dee2e6;">${email || 'N/A'}</td>
            </tr>
            <tr>
              <td style="padding: 10px 8px; font-weight: bold; border-bottom: 1px solid #dee2e6;">Status:</td>
              <td style="padding: 10px 8px; border-bottom: 1px solid #dee2e6; color: ${statusColor}; font-weight: bold;">
                ${status.toUpperCase()}
              </td>
            </tr>
            ${reason ? `
            <tr>
              <td style="padding: 10px 8px; font-weight: bold; border-bottom: 1px solid #dee2e6;">Reason:</td>
              <td style="padding: 10px 8px; border-bottom: 1px solid #dee2e6;">${reason}</td>
            </tr>
            ` : ''}
            <tr>
              <td style="padding: 10px 8px; font-weight: bold;">Timestamp:</td>
              <td style="padding: 10px 8px;">${new Date().toISOString()}</td>
            </tr>
          </table>
        </div>

        <!-- Action -->
        <div style="padding: 15px 20px; background-color: #e9ecef; text-align: center;">
          <a href="https://connabis.myshopify.com/admin/customers?query=${encodeURIComponent(email || '')}"
             style="color: #2d6a4f; font-size: 13px;">
            View in Shopify Admin →
          </a>
        </div>
      </div>
    `
  });

  if (error) {
    console.error('[Email] Resend API error (admin):', JSON.stringify(error));
    throw new Error(`Resend admin email failed: ${error.message}`);
  }

  console.log('[Email] Admin notification accepted, ID:', data?.id);
  return data;
}

// Send 'complete your profile' email to external/Google login customers
export async function sendProfileCompleteEmail({ to, formUrl }) {
  const from = getFromEmail();
  console.log('[Email] Sending profile completion email to:', to);
  const resend = getResendClient();

  const { data, error } = await resend.emails.send({
    from,
    to,
    subject: 'Completa tu Perfil para Continuar - Connabis',
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#fff;">
        <div style="background:#2d6a4f;padding:30px;text-align:center;">
          <h1 style="color:#fff;margin:0;font-size:28px;">Connabis</h1>
        </div>
        <div style="padding:32px 30px;">
          <h2 style="color:#1a1a1a;margin:0 0 16px;">Completa tu Perfil</h2>
          <p style="color:#333;font-size:15px;line-height:1.7;margin:0 0 12px;">
            Notamos que tu cuenta fue creada con Google y necesitamos algunos datos adicionales
            para completar tu registro como miembro de Connabis.
          </p>
          <p style="color:#333;font-size:15px;line-height:1.7;margin:0 0 28px;">
            El proceso toma menos de 2 minutos. Una vez completado, recibirás
            los pasos para verificar tu identidad y firmar tu consentimiento.
          </p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td align="center" style="padding:0 0 32px;">
                <a href="${formUrl}"
                   style="background:#2d6a4f;color:#fff;padding:14px 32px;
                          text-decoration:none;border-radius:6px;display:inline-block;
                          font-size:16px;font-weight:bold;">
                  Completar mi Perfil
                </a>
              </td>
            </tr>
          </table>
          <p style="color:#888;font-size:13px;margin:0;">Por favor no responda a este correo.</p>
        </div>
        <div style="padding:0 30px 32px;">
          <p style="color:#666;font-size:14px;margin:0 0 4px;">Te deseamos un día Connábico,</p>
          <p style="color:#666;font-size:14px;font-weight:600;margin:0;">El equipo de Connabis Colombia</p>
        </div>
      </div>
    `
  });

  if (error) {
    console.error('[Email] Resend API error (profile):', JSON.stringify(error));
    throw new Error(`Resend profile email failed: ${error.message}`);
  }
  console.log('[Email] Profile completion email accepted, ID:', data?.id);
  return data;
}

// Send Adobe Sign consent form link to customer
export async function sendConsentEmail({ to }) {
  const from = getFromEmail();
  console.log('[Email] Sending consent email to:', to, '| From:', from);
  const resend = getResendClient();

  const html = consentTemplate || `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
      <div style="background:#2d6a4f;padding:30px;text-align:center;">
        <h1 style="color:#fff;margin:0;font-size:28px;">Connabis</h1>
      </div>
      <div style="padding:32px 30px;">
        <h2 style="color:#1a1a1a;">¡Un paso más para completar tu registro!</h2>
        <p style="color:#333;font-size:15px;line-height:1.7;">Te enviamos el consentimiento de membresía. Por favor fírmalo haciendo clic en el botón a continuación.</p>
        <p style="text-align:center;margin:32px 0;">
          <a href="https://na1.documents.adobe.com/public/esignWidget?wid=CBFCIBAA3AAABLblqZhC7Nt3udkeVJ5XDwPrQui78jw5yKj4I7VMwfuZEwGbyv_H028FmwdqpCtzaxw2B7do*"
             style="background-color:#2d6a4f;color:#fff;padding:14px 32px;text-decoration:none;border-radius:6px;display:inline-block;font-size:16px;font-weight:bold;">
            Firmar Consentimiento
          </a>
        </p>
      </div>
      <div style="padding:0 30px 32px;">
        <p style="color:#888;font-size:13px;">Por favor no responda a este correo.</p>
        <p style="color:#666;font-size:14px;">Te deseamos un día Connábico,</p>
        <p style="color:#666;font-size:14px;font-weight:600;">El equipo de Connabis Colombia</p>
      </div>
    </div>
  `;

  const { data, error } = await resend.emails.send({
    from,
    to,
    subject: 'Firma tu Consentimiento de Membresía - Connabis',
    html
  });

  if (error) {
    console.error('[Email] Resend API error (consent):', JSON.stringify(error));
    throw new Error(`Resend consent email failed: ${error.message}`);
  }

  console.log('[Email] Consent email accepted, ID:', data?.id);
  return data;
}

// Send error alert to admin when any flow fails
export async function sendErrorAlertEmail({ context, error, customerId, email }) {
  const from = getFromEmail();
  const resend = getResendClient();
  const { data, err } = await resend.emails.send({
    from,
    to: 'connabisco@gmail.com',
    subject: `[ERROR] Connabis Verification System — ${context}`,
    html: `
      <div style="font-family:monospace;max-width:600px;margin:0 auto;padding:16px;">
        <h2 style="color:#dc3545;border-bottom:2px solid #dc3545;padding-bottom:8px;">⚠️ SYSTEM ERROR</h2>
        <table style="width:100%;border-collapse:collapse;font-size:14px;">
          <tr><td style="padding:6px 8px;font-weight:bold;width:140px;">Context:</td><td style="padding:6px 8px;">${context}</td></tr>
          <tr><td style="padding:6px 8px;font-weight:bold;">Error:</td><td style="padding:6px 8px;color:#dc3545;">${error}</td></tr>
          ${customerId ? `<tr><td style="padding:6px 8px;font-weight:bold;">Customer ID:</td><td style="padding:6px 8px;">${customerId}</td></tr>` : ''}
          ${email ? `<tr><td style="padding:6px 8px;font-weight:bold;">Email:</td><td style="padding:6px 8px;">${email}</td></tr>` : ''}
          <tr><td style="padding:6px 8px;font-weight:bold;">Timestamp:</td><td style="padding:6px 8px;">${new Date().toISOString()}</td></tr>
        </table>
        <p style="margin-top:16px;font-size:13px;color:#666;">
          Check <a href="https://connabis-verification-system.onrender.com/admin/status">admin dashboard</a> for full event log.
        </p>
      </div>`
  });
  if (err) console.error('[Email] Error alert failed to send:', JSON.stringify(err));
  else console.log('[Email] Error alert sent, ID:', data?.id);
}
