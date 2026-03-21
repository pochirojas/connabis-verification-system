// services/email.js — Resend Email Client
import { Resend } from 'resend';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_FROM = 'Connabis <no-reply@connabis.com.co>';

// Load email template at startup
const VERIFICATION_TEMPLATE_PATH = join(__dirname, '..', 'templates', 'verification-email.html');
let verificationTemplate;
try {
  verificationTemplate = readFileSync(VERIFICATION_TEMPLATE_PATH, 'utf-8');
  console.log('[Email] Verification template loaded from:', VERIFICATION_TEMPLATE_PATH);
} catch (err) {
  console.warn('[Email] Template not found, using inline fallback:', err.message);
  verificationTemplate = null;
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
  let html;
  if (verificationTemplate) {
    html = verificationTemplate.replace(/{{VERIFICATION_LINK}}/g, link);
  } else {
    html = `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;"><div style="background:#2d6a4f;padding:30px;text-align:center;"><h1 style="color:#fff;margin:0;font-size:28px;">Connabis</h1></div><div style="padding:40px 30px;"><h2 style="color:#2d6a4f;">Bienvenido a Connabis</h2><p>Para completar tu cuenta, verifica tu identidad.</p><p style="text-align:center;margin:35px 0;"><a href="${link}" style="background:#2d6a4f;color:#fff;padding:16px 32px;text-decoration:none;border-radius:6px;font-weight:bold;">Verificar Ahora</a></p></div></div>`;
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
