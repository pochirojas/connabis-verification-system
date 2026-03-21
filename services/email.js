// services/email.js — Resend Email Client
import { Resend } from 'resend';

const DEFAULT_FROM = 'Connabis <no-reply@connabis.com.co>';

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

  const { data, error } = await resend.emails.send({
    from,
    to,
    subject: 'Verifica tu Edad - Connabis',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #ffffff;">
        <!-- Header -->
        <div style="background-color: #2d6a4f; padding: 30px; text-align: center;">
          <h1 style="color: #ffffff; margin: 0; font-size: 28px;">Connabis</h1>
        </div>

        <!-- Body -->
        <div style="padding: 40px 30px;">
          <h2 style="color: #2d6a4f; margin-top: 0;">Bienvenido a Connabis</h2>
          <p style="color: #333; font-size: 16px; line-height: 1.6;">
            Para completar la configuración de tu cuenta, necesitamos verificar tu edad e identidad.
            Este es un requisito legal para la compra de productos de cannabis.
          </p>

          <p style="color: #333; font-size: 16px; line-height: 1.6;">
            El proceso es rápido y seguro. Solo necesitas tu documento de identidad y una selfie.
          </p>

          <div style="text-align: center; margin: 35px 0;">
            <a href="${link}"
               style="background-color: #2d6a4f; color: white; padding: 16px 32px;
                      text-decoration: none; border-radius: 6px; display: inline-block;
                      font-size: 16px; font-weight: bold;">
              Verificar Ahora
            </a>
          </div>

          <p style="color: #666; font-size: 13px; line-height: 1.5;">
            Este enlace expira en 24 horas. Si no creaste una cuenta en Connabis,
            puedes ignorar este correo.
          </p>
        </div>

        <!-- Footer -->
        <div style="background-color: #f5f5f5; padding: 20px 30px; border-top: 1px solid #eee;">
          <p style="color: #999; font-size: 11px; margin: 0; text-align: center;">
            Connabis - Productos de Cannabis | connabis.com.co<br>
            Floridablanca, Santander, Colombia
          </p>
        </div>
      </div>
    `
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
