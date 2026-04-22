// routes/profile.js — Profile completion form for external/Google login customers
import express from 'express';
import { logEvent } from '../services/logger.js';
import {
  getCustomer,
  updateCustomerProfile,
  addTag,
  removeTag,
  isProfileComplete,
  checkFullApproval
} from '../services/shopify.js';
import { startVerificationFlow } from './shopify.js';

const router = express.Router();

// GET /profile/complete?cid=<shopifyCustomerId>&email=<email>
// Serves the profile completion form
router.get('/complete', async (req, res) => {
  const { cid, email } = req.query;

  if (!cid || !email) {
    return res.status(400).send(errorPage('Enlace inválido. Por favor contacta a connabisco@gmail.com'));
  }

  // Verify this customer exists and still needs profile completion
  try {
    const customer = await getCustomer(cid);
    if (!customer) {
      return res.status(404).send(errorPage('Cuenta no encontrada.'));
    }

    // If already fully verified, show success page instead
    const tags = (customer.tags || '').split(',').map(t => t.trim().toLowerCase());
    if (tags.includes('verified')) {
      return res.send(successPage('Tu perfil ya está completo y verificado. ¡Gracias!'));
    }

    res.send(formPage({ cid, email, customer }));
  } catch (err) {
    console.error('[Profile] Error loading customer:', err.message);
    res.status(500).send(errorPage('Error al cargar tu perfil. Por favor intenta más tarde.'));
  }
});

// POST /profile/complete — Handle form submission
router.post('/complete', express.urlencoded({ extended: true }), async (req, res) => {
  const { cid, email, phone, id_type, id_number, address, zip } = req.body;

  console.log('[Profile] Form submitted for customer:', cid, '| Email:', email);

  if (!cid || !email || !phone || !id_type || !id_number || !address) {
    return res.status(400).send(errorPage('Por favor completa todos los campos requeridos.'));
  }

  try {
    // Build Shopify customer update payload
    // company = ID number (for Dataico compatibility)
    const profileFields = {
      phone: phone.trim(),
      company: id_number.trim(), // ID number stored as company for Dataico
      addresses: [{
        address1: address.trim(),
        zip: (zip || '').trim(),
        country: 'CO',
        city: 'Colombia',
      }]
    };

    // Update customer profile in Shopify
    await updateCustomerProfile(cid, profileFields);
    console.log('[Profile] Customer profile updated:', cid);

    // Remove "Not Verified" tag now that profile is complete
    await removeTag(cid, 'Not Verified');
    console.log('[Profile] Not Verified tag removed');

    // Start the full verification flow (VeriDocID + emails)
    // Get customer name for the session
    const customer = await getCustomer(cid);
    startVerificationFlow({
      id: cid,
      email,
      first_name: customer?.first_name || '',
      last_name: customer?.last_name || ''
    }).catch(err => {
      console.error('[Profile] Verification flow failed after profile complete:', err.message);
    });

    logEvent({ type: 'profile', status: 'ok', detail: 'Profile completed — verification flow started', customerId: cid, email });
    res.send(successPage(`¡Perfil completado! En un momento recibirás un correo con los pasos para verificar tu identidad y firmar tu consentimiento.`));

  } catch (err) {
    console.error('[Profile] Error updating customer:', err.message);
    logEvent({ type: 'error', status: 'error', detail: `Profile form submission failed: ${err.message}`, customerId: cid, email });
    res.status(500).send(errorPage('Error al guardar tu información. Por favor intenta más tarde.'));
  }
});

// ─── HTML Page Templates ─────────────────────────────────────────

function formPage({ cid, email, customer }) {
  const name = [customer?.first_name, customer?.last_name].filter(Boolean).join(' ') || 'Miembro';
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Completa tu Perfil - Connabis</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
      background: #f7f7f7;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
    }

    /* Top bar matching store */
    .topbar {
      width: 100%;
      background: #1a2235;
      padding: 10px 20px;
      text-align: center;
      font-size: 13px;
      color: rgba(255,255,255,0.85);
      letter-spacing: 0.2px;
    }

    /* Logo header */
    .site-header {
      width: 100%;
      background: #fff;
      border-bottom: 1px solid #e8e8e8;
      padding: 18px 20px;
      text-align: center;
    }
    .site-header img {
      height: 60px;
      width: auto;
    }

    /* Main content */
    .page-wrap {
      width: 100%;
      max-width: 560px;
      padding: 36px 16px 60px;
    }

    .card {
      background: #fff;
      border-radius: 4px;
      border: 1px solid #e0e0e0;
      overflow: hidden;
    }

    .card-header {
      background: #2d6a4f;
      padding: 24px 32px;
      text-align: center;
    }
    .card-header h1 {
      color: #fff;
      font-size: 20px;
      font-weight: 700;
      letter-spacing: -0.3px;
    }
    .card-header p {
      color: rgba(255,255,255,0.8);
      font-size: 13px;
      margin-top: 5px;
    }

    .card-body { padding: 32px; }

    .greeting {
      font-size: 17px;
      font-weight: 600;
      color: #111;
      margin-bottom: 6px;
    }
    .subtitle {
      font-size: 14px;
      color: #666;
      line-height: 1.65;
      margin-bottom: 28px;
      padding-bottom: 24px;
      border-bottom: 1px solid #f0f0f0;
    }

    .field { margin-bottom: 18px; }

    label {
      display: block;
      font-size: 12px;
      font-weight: 700;
      color: #444;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 7px;
    }
    .req { color: #c0392b; margin-left: 1px; }
    .opt { color: #aaa; font-weight: 400; text-transform: none; font-size: 11px; letter-spacing: 0; }

    input[type="text"],
    input[type="tel"],
    select {
      width: 100%;
      padding: 12px 14px;
      border: 1px solid #d5d5d5;
      border-radius: 4px;
      font-size: 15px;
      color: #111;
      background: #fff;
      -webkit-appearance: none;
      appearance: none;
      transition: border-color 0.15s, box-shadow 0.15s;
      line-height: 1.4;
    }
    input[type="text"]:focus,
    input[type="tel"]:focus,
    select:focus {
      outline: none;
      border-color: #2d6a4f;
      box-shadow: 0 0 0 3px rgba(45,106,79,0.1);
    }

    /* Custom select arrow */
    .select-wrap { position: relative; }
    .select-wrap::after {
      content: '';
      position: absolute;
      right: 14px;
      top: 50%;
      transform: translateY(-50%);
      width: 0; height: 0;
      border-left: 5px solid transparent;
      border-right: 5px solid transparent;
      border-top: 6px solid #888;
      pointer-events: none;
    }

    .row { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
    @media (max-width: 400px) { .row { grid-template-columns: 1fr; } }

    .hint { font-size: 11px; color: #999; margin-top: 5px; }

    .submit-btn {
      width: 100%;
      background: #2d6a4f;
      color: #fff;
      border: none;
      padding: 15px;
      border-radius: 4px;
      font-size: 15px;
      font-weight: 700;
      letter-spacing: 0.3px;
      cursor: pointer;
      margin-top: 10px;
      transition: background 0.2s;
    }
    .submit-btn:hover { background: #1b4332; }
    .submit-btn:active { background: #143326; }

    .privacy {
      text-align: center;
      font-size: 12px;
      color: #aaa;
      margin-top: 20px;
      line-height: 1.6;
    }
    .privacy a { color: #2d6a4f; text-decoration: none; }
  </style>
</head>
<body>

  <div class="topbar">Connabis Colombia &mdash; Membresía Regulada</div>

  <header class="site-header">
    <a href="https://connabis.com.co">
      <img src="https://cdn.shopify.com/s/files/1/0581/4121/2749/files/Logo_Negro_sin_fondo.png"
           alt="Connabis"
           onerror="this.style.display='none';this.nextElementSibling.style.display='block'">
      <span style="display:none;font-size:22px;font-weight:800;color:#111;letter-spacing:-0.5px;">CO·NNABIS</span>
    </a>
  </header>

  <div class="page-wrap">
    <div class="card">
      <div class="card-header">
        <h1>Completa tu Perfil</h1>
        <p>Requerido para activar tu membresía</p>
      </div>
      <div class="card-body">
        <p class="greeting">Hola, ${name} 👋</p>
        <p class="subtitle">
          Registraste tu cuenta con Google. Para activarla necesitamos algunos
          datos adicionales requeridos por regulación para la compra de productos de cannabis.
        </p>

        <form method="POST" action="/profile/complete" autocomplete="on">
          <input type="hidden" name="cid" value="${cid}">
          <input type="hidden" name="email" value="${email}">

          <div class="row">
            <div class="field">
              <label>Tipo de Doc. <span class="req">*</span></label>
              <div class="select-wrap">
                <select name="id_type" required>
                  <option value="">Seleccionar</option>
                  <option value="CC">C.C. &mdash; Cédula Ciudadanía</option>
                  <option value="CE">C.E. &mdash; Cédula Extranjería</option>
                  <option value="PA">PA &mdash; Pasaporte</option>
                  <option value="TI">T.I. &mdash; Tarjeta Identidad</option>
                </select>
              </div>
            </div>
            <div class="field">
              <label>Número de Doc. <span class="req">*</span></label>
              <input type="text" name="id_number"
                     placeholder="Ej: 1005289529"
                     required pattern="[0-9A-Za-z\-]+" minlength="5"
                     inputmode="numeric">
              <p class="hint">Sin puntos ni espacios</p>
            </div>
          </div>

          <div class="field">
            <label>Celular <span class="req">*</span></label>
            <input type="tel" name="phone"
                   placeholder="+57 300 123 4567"
                   required autocomplete="tel">
          </div>

          <div class="field">
            <label>Dirección <span class="req">*</span></label>
            <input type="text" name="address"
                   placeholder="Calle 123 # 45-67, Barrio"
                   required autocomplete="street-address">
          </div>

          <div class="field">
            <label>Código Postal <span class="opt">(opcional)</span></label>
            <input type="text" name="zip"
                   placeholder="Ej: 680003"
                   maxlength="10" inputmode="numeric">
          </div>

          <button type="submit" class="submit-btn">Guardar y Continuar &rarr;</button>
        </form>

        <p class="privacy">
          Tu información está protegida y solo se usa para verificar tu membresía.<br>
          Al continuar confirmas que tienes 18 años o más.
        </p>
      </div>
    </div>
  </div>

</body>
</html>`;
}

const sharedShell = (content) => `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
      background: #f7f7f7; min-height: 100vh; display: flex; flex-direction: column; align-items: center; }
    .topbar { width: 100%; background: #1a2235; padding: 10px 20px; text-align: center;
      font-size: 13px; color: rgba(255,255,255,0.85); }
    .site-header { width: 100%; background: #fff; border-bottom: 1px solid #e8e8e8;
      padding: 18px 20px; text-align: center; }
    .site-header img { height: 60px; width: auto; }
    .page-wrap { width: 100%; max-width: 480px; padding: 48px 16px 60px;
      display: flex; align-items: center; justify-content: center; flex: 1; }
    .card { background: #fff; border: 1px solid #e0e0e0; border-radius: 4px;
      width: 100%; padding: 48px 40px; text-align: center; }
    @media (max-width: 480px) { .card { padding: 36px 24px; } }
  </style>
</head>
<body>
  <div class="topbar">Connabis Colombia &mdash; Membersía Regulada</div>
  <header class="site-header">
    <a href="https://connabis.com.co">
      <img src="https://cdn.shopify.com/s/files/1/0581/4121/2749/files/Logo_Negro_sin_fondo.png" alt="Connabis"
           onerror="this.style.display='none';this.nextElementSibling.style.display='block'">
      <span style="display:none;font-size:22px;font-weight:800;color:#111;">CO·NNABIS</span>
    </a>
  </header>
  <div class="page-wrap"><div class="card">${content}</div></div>
</body></html>`;

function successPage(message) {
  return sharedShell(`
    <div style="font-size:52px;margin-bottom:16px;">✅</div>
    <h2 style="color:#2d6a4f;font-size:22px;font-weight:700;margin-bottom:10px;">¡Todo listo!</h2>
    <p style="color:#555;font-size:15px;line-height:1.65;margin-bottom:28px;">${message}</p>
    <a href="https://connabis.com.co"
       style="display:inline-block;background:#2d6a4f;color:#fff;padding:13px 28px;
              text-decoration:none;border-radius:4px;font-weight:700;font-size:15px;">
      Volver a Connabis
    </a>`);
}

function errorPage(message) {
  return sharedShell(`
    <div style="font-size:52px;margin-bottom:16px;">❌</div>
    <h2 style="color:#c0392b;font-size:22px;font-weight:700;margin-bottom:10px;">Algo salió mal</h2>
    <p style="color:#555;font-size:15px;line-height:1.65;margin-bottom:28px;">${message}</p>
    <a href="https://connabis.com.co"
       style="display:inline-block;background:#555;color:#fff;padding:13px 28px;
              text-decoration:none;border-radius:4px;font-weight:700;font-size:15px;">
      Volver a Connabis
    </a>`);
}

export default router;
